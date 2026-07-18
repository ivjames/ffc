// Locations API — venue onboarding.
//
//   POST /api/locations  — create or update a venue (guarded by APP_TOKEN)
//   GET  /api/locations  — list venues (open read, like the leaderboard)
//
// The venue's timezone drives the leaderboard's calendar-day windows
// (routes/leaderboard.js), so this endpoint is where that value is resolved
// authoritatively — never typed by a human:
//   - if `tz` is omitted, it's derived from the venue's coordinates
//     (tzFromCoords), so onboarding just sends lat/lng;
//   - any `tz` that IS sent is validated (isValidTz), rejecting typos and
//     fixed-offset abbreviations like "PST" that would silently ignore DST.
// Responses echo the stored `tz` plus a friendly `tzLabel` for admin UIs.
import { Router } from "express";
import { pool } from "../db.js";
import { tzFromCoords, isValidTz, friendlyTzLabel } from "../lib/timezone.js";

export const router = Router();

// Same guard as POST /api/seed: header `x-app-token` must match APP_TOKEN.
// Unset APP_TOKEN = dev, allow. Set it in production to lock writes down.
function authorized(req) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return true;
  return req.get("x-app-token") === expected;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Lowercase kebab: letters/digits in groups joined by single hyphens, no
// leading/trailing/double hyphen. e.g. "riverside", "north-40".
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Columns to return (and their JSON casing) — shared by insert RETURNING and the
// list SELECT so both responses have the same shape.
const RETURN_COLS = `id, name, slug, lat, lng,
  geofence_km as "geofenceKm", tz, sort_order as "sortOrder"`;

// Add the derived friendly label so admin UIs don't have to compute it.
function withLabel(loc) {
  return { ...loc, tzLabel: loc.tz ? friendlyTzLabel(loc.tz) : null };
}

/**
 * Validate + normalize the POST body into a DB row, resolving the timezone.
 * @returns {{ row: object } | { error: string, status: number }}
 */
function normalizeLocation(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a location object", status: 400 };
  }

  const { id, name, slug } = body;

  if (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) {
    return { error: "id must be a uuid when provided", status: 400 };
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return { error: "name is required (1..200 chars)", status: 400 };
  }
  if (typeof slug !== "string" || slug.length > 64 || !SLUG_RE.test(slug)) {
    return {
      error: "slug must be lowercase [a-z0-9-], no leading/trailing/double hyphen",
      status: 400,
    };
  }

  // Coordinates — optional, but range-checked when present.
  let lat = null;
  let lng = null;
  if (body.lat !== undefined && body.lat !== null) {
    if (!isFiniteNum(body.lat) || body.lat < -90 || body.lat > 90) {
      return { error: "lat must be a number in -90..90", status: 400 };
    }
    lat = body.lat;
  }
  if (body.lng !== undefined && body.lng !== null) {
    if (!isFiniteNum(body.lng) || body.lng < -180 || body.lng > 180) {
      return { error: "lng must be a number in -180..180", status: 400 };
    }
    lng = body.lng;
  }
  // A lone coordinate can't place the venue (or derive a zone) — require both.
  if ((lat === null) !== (lng === null)) {
    return { error: "lat and lng must be provided together", status: 400 };
  }

  let geofenceKm = null;
  if (body.geofenceKm !== undefined && body.geofenceKm !== null) {
    if (!isFiniteNum(body.geofenceKm) || body.geofenceKm <= 0) {
      return { error: "geofenceKm must be a positive number", status: 400 };
    }
    geofenceKm = body.geofenceKm;
  }

  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer", status: 400 };
    }
    sortOrder = body.sortOrder;
  }

  // Resolve the timezone. Explicit `tz` wins (validated); otherwise derive from
  // coordinates; otherwise leave null and let the leaderboard fall back to
  // VENUE_TZ. Onboarding normally sends just lat/lng and lets it derive.
  let tz = null;
  if (body.tz !== undefined && body.tz !== null) {
    if (!isValidTz(body.tz)) {
      return {
        error: `tz ${JSON.stringify(body.tz)} is not a valid IANA zone ` +
          `(use e.g. "America/Los_Angeles", not "PST")`,
        status: 400,
      };
    }
    tz = body.tz;
  } else if (lat !== null && lng !== null) {
    try {
      tz = tzFromCoords(lat, lng);
    } catch {
      return { error: "could not derive a timezone from lat/lng", status: 400 };
    }
  }

  return {
    row: { id, name: name.trim(), slug, lat, lng, geofenceKm, tz, sortOrder },
  };
}

// --- List ------------------------------------------------------------------
router.get("/", async (_req, res) => {
  try {
    const result = await pool.query(
      `select ${RETURN_COLS} from location order by sort_order, name`
    );
    return res.json(result.rows.map(withLabel));
  } catch (err) {
    console.error("[locations] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Create / update -------------------------------------------------------
router.post("/", async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const result = normalizeLocation(req.body);
  if (result.error) {
    return res.status(result.status).json({ ok: false, error: result.error });
  }
  const row = result.row;

  try {
    // Upsert on id when the caller supplies one (updating a known venue),
    // otherwise on slug (its natural key) so re-posting a venue is idempotent
    // rather than a duplicate. A slug that collides with a *different* row's id
    // path surfaces as a 23505 unique violation -> 409 below.
    let db;
    if (row.id) {
      db = await pool.query(
        `insert into location (id, name, slug, lat, lng, geofence_km, tz, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7, $8)
         on conflict (id) do update set
           name = excluded.name, slug = excluded.slug, lat = excluded.lat,
           lng = excluded.lng, geofence_km = excluded.geofence_km,
           tz = excluded.tz, sort_order = excluded.sort_order
         returning ${RETURN_COLS}`,
        [row.id, row.name, row.slug, row.lat, row.lng, row.geofenceKm, row.tz, row.sortOrder]
      );
    } else {
      db = await pool.query(
        `insert into location (name, slug, lat, lng, geofence_km, tz, sort_order)
           values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (slug) do update set
           name = excluded.name, lat = excluded.lat, lng = excluded.lng,
           geofence_km = excluded.geofence_km, tz = excluded.tz,
           sort_order = excluded.sort_order
         returning ${RETURN_COLS}`,
        [row.name, row.slug, row.lat, row.lng, row.geofenceKm, row.tz, row.sortOrder]
      );
    }
    return res.json({ ok: true, location: withLabel(db.rows[0]) });
  } catch (err) {
    if (err && err.code === "23505") {
      // Unique violation — the only unique constraint here is slug.
      return res
        .status(409)
        .json({ ok: false, error: "slug already in use by another location" });
    }
    console.error("[locations] upsert error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
