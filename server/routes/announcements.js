// GET /api/announcements?locationId= — the live promo/update feed for the
// player app and TV board (punchlist #1). Open read, like the leaderboard:
// announcements are venue marketing, nothing secret.
//
// This is the platform's first LIVE content read (master-control-plan §5
// anticipated the flip): promos are too time-sensitive for the
// rebuild-to-publish pipeline, so the client polls this and caches the last
// good response for offline display.
//
// A row shows when it is not archived and now falls inside its
// [starts_at, ends_at) window (either side null = open-ended), and it is
// either global (location_id null) or pinned to the requested location.
import { Router } from "express";
import { pool } from "../db.js";
import { tenant } from "../lib/tenant.js";

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/", tenant(), async (req, res) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
  if (locationId !== null && !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  // Multi-venue: location-scoped rows must belong to the tenant's venues so a
  // guessed locationId can't read another client's promos; global rows
  // (location_id null) show on every subdomain. Same fallback rule as
  // /api/content — the default-org path also covers org-less legacy locations.
  const t = req.tenant;
  const tenantFilter =
    t == null
      ? ""
      : t.via === "host"
        ? "and (a.location_id is null or l.org_id = $2)"
        : "and (a.location_id is null or l.org_id = $2 or l.org_id is null)";
  const params = t == null ? [locationId] : [locationId, t.org.id];
  try {
    const result = await pool.query(
      `select a.id, a.title, a.body, a.location_id as "locationId",
              a.starts_at as "startsAt", a.ends_at as "endsAt",
              a.sort_order as "sortOrder"
         from announcement a
         left join location l on l.id = a.location_id
        where a.archived_at is null
          and (a.starts_at is null or a.starts_at <= now())
          and (a.ends_at   is null or a.ends_at   >  now())
          and (a.location_id is null or l.archived_at is null)
          and (a.location_id is null or $1::uuid is not null and a.location_id = $1)
          ${tenantFilter}
        order by a.sort_order, a.created_at`,
      params
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[announcements] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// POST /api/announcements/views — view-memory beacon. The player app/TV board
// fires this when the banner actually displays announcements, so Master Control
// can answer "who's seen what, and when". Best-effort and idempotent:
//
//   { deviceId: <uuid>, ids: [<announcement uuid>, ...] }
//
// Identity is the client-minted device install id (always present); the
// signed-in app_user (if any) rides along via attachUser for the "signed-in
// accounts" rollup. Each id upserts one (announcement, device) row — first hit
// stamps first_seen_at, repeats bump last_seen_at + seen_count. Unknown/garbage
// ids are dropped, never 500'd, so a stale cached id can't wedge the beacon.
const MAX_VIEW_IDS = 50;

router.post("/views", tenant(), async (req, res) => {
  const body = req.body;
  const deviceId = body && typeof body.deviceId === "string" ? body.deviceId : null;
  if (!deviceId || !UUID_RE.test(deviceId)) {
    return res.status(400).json({ ok: false, error: "deviceId must be a uuid" });
  }
  const rawIds = Array.isArray(body.ids) ? body.ids : [];
  // De-dupe, keep only well-formed uuids, and cap the batch so a bad client
  // can't drive an unbounded write. Dropping the overflow is fine — a beacon
  // is fire-and-forget and the client re-sends anything still queued.
  const ids = [...new Set(rawIds.filter((x) => typeof x === "string" && UUID_RE.test(x)))].slice(
    0,
    MAX_VIEW_IDS
  );
  if (ids.length === 0) return res.json({ ok: true, recorded: 0 });

  const appUserId = req.user?.id ?? null;
  // Multi-venue: a view only counts for announcements this tenant can actually
  // see (global rows, or rows pinned to the tenant's venues — the GET filter
  // above), so a guessed foreign id is dropped exactly like a nonexistent one
  // instead of inflating another client's view rollup.
  const t = req.tenant;
  const tenantFilter =
    t == null
      ? ""
      : t.via === "host"
        ? "and (a.location_id is null or l.org_id = $4)"
        : "and (a.location_id is null or l.org_id = $4 or l.org_id is null)";
  const params = t == null ? [ids, deviceId, appUserId] : [ids, deviceId, appUserId, t.org.id];
  try {
    // insert...select over the real announcements filters out ids that don't
    // exist (no FK 23503), so `recorded` reflects genuine announcements only.
    const result = await pool.query(
      `insert into announcement_view (announcement_id, device_id, app_user_id)
         select a.id, $2::uuid, $3::uuid
           from announcement a
           left join location l on l.id = a.location_id
          where a.id = any($1::uuid[])
            ${tenantFilter}
       on conflict (announcement_id, device_id) do update set
         last_seen_at = now(),
         seen_count   = announcement_view.seen_count + 1,
         app_user_id  = coalesce(excluded.app_user_id, announcement_view.app_user_id)`,
      params
    );
    return res.json({ ok: true, recorded: result.rowCount });
  } catch (err) {
    console.error("[announcements] view beacon error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
