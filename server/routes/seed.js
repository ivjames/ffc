// POST /api/seed — dev helper to load/upsert courses.
//
// Body: an array of course seeds:
//   { id?: uuid, locationId?: uuid, name: string, theme: string,
//     holeCount?: number, pars: int[18] }
// locationId, when given, must reference an existing location(id).
//
// Guard: requires header `x-app-token` to match process.env.APP_TOKEN. If
// APP_TOKEN is unset we assume dev and allow it (so a fresh local box can seed
// without ceremony). Set APP_TOKEN in production to lock this down.
import { Router } from "express";
import { pool } from "../db.js";

export const router = Router();

function authorized(req) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return true; // dev: no token configured -> allow
  return req.get("x-app-token") === expected;
}

// Validate a single seed; returns a normalized row or an error string.
function normalizeSeed(seed, idx) {
  if (seed == null || typeof seed !== "object") {
    return { error: `seed[${idx}] must be an object` };
  }
  const { id, name, theme, locationId } = seed;
  const holeCount = seed.holeCount ?? 18;
  const pars = seed.pars;

  if (typeof name !== "string" || name.length === 0) {
    return { error: `seed[${idx}].name is required` };
  }
  if (typeof theme !== "string" || theme.length === 0) {
    return { error: `seed[${idx}].theme is required` };
  }
  if (!Number.isInteger(holeCount) || holeCount < 1) {
    return { error: `seed[${idx}].holeCount must be a positive integer` };
  }
  if (!Array.isArray(pars) || pars.length !== 18) {
    return { error: `seed[${idx}].pars must be an array of length 18` };
  }
  for (const p of pars) {
    if (!Number.isInteger(p) || p < 2 || p > 4) {
      return { error: `seed[${idx}].pars values must be integers 2..4` };
    }
  }
  if (id !== undefined && (typeof id !== "string" || id.length === 0)) {
    return { error: `seed[${idx}].id must be a uuid string when provided` };
  }
  if (
    locationId !== undefined &&
    locationId !== null &&
    (typeof locationId !== "string" || locationId.length === 0)
  ) {
    return { error: `seed[${idx}].locationId must be a uuid string when provided` };
  }
  return { row: { id, name, theme, holeCount, pars, locationId: locationId ?? null } };
}

router.post("/", async (req, res) => {
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const seeds = req.body;
  if (!Array.isArray(seeds) || seeds.length === 0) {
    return res.status(400).json({ ok: false, error: "body must be a non-empty array of course seeds" });
  }

  const rows = [];
  for (let i = 0; i < seeds.length; i++) {
    const result = normalizeSeed(seeds[i], i);
    if (result.error) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    rows.push(result.row);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const ids = [];
    for (const row of rows) {
      if (row.id) {
        // Explicit id -> upsert on primary key so re-seeding is idempotent.
        const r = await client.query(
          `insert into course (id, name, theme, hole_count, pars, location_id)
             values ($1, $2, $3, $4, $5, $6)
           on conflict (id) do update
             set name = excluded.name,
                 theme = excluded.theme,
                 hole_count = excluded.hole_count,
                 pars = excluded.pars,
                 location_id = excluded.location_id
           returning id`,
          [row.id, row.name, row.theme, row.holeCount, row.pars, row.locationId]
        );
        ids.push(r.rows[0].id);
      } else {
        // No id -> plain insert (course has no natural key to conflict on).
        const r = await client.query(
          `insert into course (name, theme, hole_count, pars, location_id)
             values ($1, $2, $3, $4, $5)
           returning id`,
          [row.name, row.theme, row.holeCount, row.pars, row.locationId]
        );
        ids.push(r.rows[0].id);
      }
    }
    await client.query("COMMIT");
    return res.json({ ok: true, count: ids.length, ids });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[seed] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});
