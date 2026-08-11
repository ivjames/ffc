// Admin: synthetic (load/soak) bot control plane — Master Control → Synthetic.
//   GET  /api/admin/synthetic-bot/status       key state, policy, courses, counts, runner
//   POST /api/admin/synthetic-bot/projection    projected players/yr for a cadence
//   POST /api/admin/synthetic-bot/start          launch the bot (super_admin)
//   POST /api/admin/synthetic-bot/stop           stop the bot (super_admin)
//
// The bot itself is scripts/course-bot.mjs (see server/README.md "Synthetic
// rounds & the load bot"). This surface drives it from the browser WITHOUT ever
// handling the SYNTHETIC_BOT_KEY: the key lives in the API's env and is injected
// into the child by lib/syntheticBotRunner.js; here we only ever report whether
// one is set.
//
// Auth: status + projection are readable by any admin, org-scoped to their own
// venues. start + stop are super_admin only — the load bot is a platform tool,
// not a per-venue control, and it isn't scoped to one org's courses.
import { Router } from "express";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";
import { isVenueOpen } from "../../lib/venueHours.js";
import { weeklyOpenHours, projectVolume } from "../../lib/syntheticVolume.js";
import { syntheticCountsOnBoard, syntheticMintsRewards } from "../../lib/syntheticConfig.js";
import * as runner from "../../lib/syntheticBotRunner.js";

export const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Live courses + their venue's tz/hours, org-scoped, optionally one venue.
// Mirrors the bot's own discovery (open-now + weekly open hours), but read
// straight from the DB rather than the public content feed.
async function loadCourses(scope, locationId, now = new Date()) {
  const res = await pool.query(
    `select c.id as course_id, c.name as course_name, c.pars,
            l.id as location_id, l.name as location_name, l.tz, l.hours
       from course c
       join location l on l.id = c.location_id
      where c.archived_at is null and l.archived_at is null
        and ($1::uuid is null or l.org_id = $1)
        and ($2::uuid is null or l.id = $2)
      order by l.name, c.sort_order, c.name`,
    [scope, locationId ?? null]
  );
  return res.rows.map((r) => ({
    courseId: r.course_id,
    courseName: r.course_name,
    locationId: r.location_id,
    locationName: r.location_name,
    tz: r.tz,
    hours: r.hours,
    parsKnown: Array.isArray(r.pars) && r.pars.length > 0,
    openNow: isVenueOpen(r.hours, r.tz, now),
    weeklyOpenHours: weeklyOpenHours(r.hours),
  }));
}

// Validate + coerce the cadence knobs shared by /projection and /start. Ranges
// are deliberately tight — this argv drives a process that hammers the API.
function validateParams(body) {
  const b = body ?? {};
  const plays = Number(b.playsPerCourse);
  if (!Number.isInteger(plays) || plays < 1 || plays > 20) {
    return { error: "playsPerCourse must be an integer 1..20" };
  }
  const intervalMin = Number(b.intervalMin);
  if (!Number.isInteger(intervalMin) || intervalMin < 1 || intervalMin > 1440) {
    return { error: "intervalMin must be an integer 1..1440" };
  }
  const maxPlayers = Number(b.maxPlayers);
  if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 4) {
    return { error: "maxPlayers must be an integer 1..4" };
  }
  const concurrency = b.concurrency === undefined ? 4 : Number(b.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    return { error: "concurrency must be an integer 1..16" };
  }
  let locationId = null;
  if (b.locationId !== undefined && b.locationId !== null && b.locationId !== "") {
    if (typeof b.locationId !== "string" || !UUID_RE.test(b.locationId)) {
      return { error: "locationId must be a uuid" };
    }
    locationId = b.locationId;
  }
  return {
    params: { playsPerCourse: plays, intervalMin, maxPlayers, concurrency, locationId, ignoreHours: b.ignoreHours === true },
  };
}

// --- Status -----------------------------------------------------------------
router.get("/status", async (req, res) => {
  const scope = orgScope(req);
  try {
    const courses = await loadCourses(scope, null);
    // Synthetic round volume already on the system — org_admins see only their
    // own venues' bot rounds; super_admins see the whole system.
    const counts = await pool.query(
      `select count(*)::int as total,
              count(*) filter (where r.created_at > now() - interval '24 hours')::int as last24h
         from round r
         left join course c on c.id = r.course_id
         left join location l on l.id = c.location_id
        where r.synthetic and ($1::uuid is null or l.org_id = $1)`,
      [scope]
    );
    return res.json({
      keySet: !!process.env.SYNTHETIC_BOT_KEY,
      // start/stop are super_admin only — tell the UI so it can hide the controls.
      canControl: scope === null,
      policy: {
        countsOnBoard: syntheticCountsOnBoard(process.env),
        mintsRewards: syntheticMintsRewards(process.env),
      },
      courses,
      syntheticRounds: counts.rows[0],
      runner: runner.status(),
    });
  } catch (err) {
    console.error("[admin/synthetic-bot] status error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Projection (pure math for a cadence) -----------------------------------
router.post("/projection", async (req, res) => {
  const v = validateParams(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  const scope = orgScope(req);
  try {
    const courses = await loadCourses(scope, v.params.locationId);
    const projection = projectVolume({
      courses,
      plays: v.params.playsPerCourse,
      intervalMin: v.params.intervalMin,
      maxPlayers: v.params.maxPlayers,
      ignoreHours: v.params.ignoreHours,
    });
    return res.json({ courseCount: courses.length, ...projection });
  } catch (err) {
    console.error("[admin/synthetic-bot] projection error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Start (super_admin) ----------------------------------------------------
router.post("/start", async (req, res) => {
  if (orgScope(req) !== null) {
    return res.status(403).json({ ok: false, error: "forbidden: super_admin only" });
  }
  const v = validateParams(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  if (!process.env.SYNTHETIC_BOT_KEY) {
    return res.status(409).json({
      ok: false,
      error: "SYNTHETIC_BOT_KEY is not set on the server — set it in server/.env and restart the API",
    });
  }
  if (runner.isRunning()) {
    return res.status(409).json({ ok: false, error: "bot already running — stop it first" });
  }
  try {
    return res.json({ ok: true, runner: runner.start(v.params) });
  } catch (err) {
    return res.status(409).json({ ok: false, error: err.message });
  }
});

// --- Stop (super_admin) -----------------------------------------------------
router.post("/stop", (req, res) => {
  if (orgScope(req) !== null) {
    return res.status(403).json({ ok: false, error: "forbidden: super_admin only" });
  }
  return res.json({ ok: true, runner: runner.stop() });
});
