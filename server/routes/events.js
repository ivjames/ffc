// POST /api/events — first-party funnel analytics beacon (adoption + sign-in).
//
// The player app fires this to record aggregate product-usage events so we can
// measure the two funnels we're trying to grow — "install prompt shown ->
// installed" and "sign-in started -> completed" — and see where players drop
// off. It is deliberately privacy-clean and matches the announcement-view
// beacon's shape:
//
//   { deviceId: <uuid>, platform?: <string>, events: [{ name, meta?, locationId? }, ...] }
//
// - Identity is the anonymous device install id (always present). A signed-in
//   app_user (if any) rides along via attachUser, so we can split funnels by
//   signed-in vs anonymous WITHOUT storing anything that identifies a person.
// - We store NO IP address and no other PII — see the Privacy page.
// - `name` is checked against a fixed server-side allowlist; unknown names are
//   dropped (not 500'd), so a stale or malicious client can't write junk or
//   grow the event vocabulary on its own.
// - Best-effort and fire-and-forget: bad rows are skipped, the batch is capped,
//   and the client re-sends anything still queued.
import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The allowed event vocabulary. Keeping it here (not client-driven) is what
// keeps the table honest — the client can only ever record these names.
export const ALLOWED_EVENTS = new Set([
  // Install / adoption funnel
  "install_prompt_shown", // our install CTA was presented
  "install_accepted", // native prompt accepted
  "install_dismissed", // native prompt dismissed
  "app_installed", // appinstalled fired
  "app_launch_standalone", // app booted as an installed PWA
  // Sign-in funnel
  "signin_started", // requested an email code / opened sign-in
  "signin_completed", // verified a code -> session
  "signin_failed", // verify rejected
]);

const ALLOWED_PLATFORMS = new Set(["ios", "android", "desktop", "other"]);
const MAX_EVENTS = 50;
const MAX_META_BYTES = 1_000;

/** Keep only small, well-formed meta so a client can't stuff PII or bloat the
 *  row. Non-object or oversized meta collapses to {}. */
function sanitizeMeta(meta) {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return {};
  try {
    const json = JSON.stringify(meta);
    if (json.length > MAX_META_BYTES) return {};
    return JSON.parse(json);
  } catch {
    return {};
  }
}

router.post("/", async (req, res) => {
  const body = req.body ?? {};
  const deviceId = typeof body.deviceId === "string" ? body.deviceId : null;
  if (!deviceId || !UUID_RE.test(deviceId)) {
    return res.status(400).json({ ok: false, error: "deviceId must be a uuid" });
  }
  const platform =
    typeof body.platform === "string" && ALLOWED_PLATFORMS.has(body.platform)
      ? body.platform
      : null;

  const rawEvents = Array.isArray(body.events) ? body.events : [];
  // Keep only allowlisted events, capped. Each row carries its own optional
  // location so a multi-venue session attributes correctly.
  const rows = [];
  for (const e of rawEvents) {
    if (rows.length >= MAX_EVENTS) break;
    if (!e || typeof e !== "object") continue;
    if (typeof e.name !== "string" || !ALLOWED_EVENTS.has(e.name)) continue;
    const locationId =
      typeof e.locationId === "string" && UUID_RE.test(e.locationId) ? e.locationId : null;
    rows.push({ name: e.name, meta: sanitizeMeta(e.meta), locationId });
  }
  if (rows.length === 0) return res.json({ ok: true, recorded: 0 });

  const appUserId = req.user?.id ?? null;
  try {
    // One multi-row insert. unnest keeps it a single round-trip; a location id
    // that doesn't exist is set null by the FK-safe left join rather than 23503.
    const result = await pool.query(
      `insert into funnel_event (event, device_id, app_user_id, location_id, platform, meta)
         select e.name, $1::uuid, $2::uuid,
                (select l.id from location l where l.id = e.location_id),
                $3::text, e.meta
           from jsonb_to_recordset($4::jsonb)
             as e(name text, location_id uuid, meta jsonb)`,
      [deviceId, appUserId, platform, JSON.stringify(rows.map((r) => ({
        name: r.name,
        location_id: r.locationId,
        meta: r.meta,
      })))]
    );
    return res.json({ ok: true, recorded: result.rowCount });
  } catch (err) {
    console.error("[events] beacon error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
