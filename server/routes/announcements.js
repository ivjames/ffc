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

export const router = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/", async (req, res) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : null;
  if (locationId !== null && !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
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
        order by a.sort_order, a.created_at`,
      [locationId]
    );
    return res.json(result.rows);
  } catch (err) {
    console.error("[announcements] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
