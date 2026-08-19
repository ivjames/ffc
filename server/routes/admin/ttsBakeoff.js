// Admin: Polly voice bake-off API, mounted at /api/admin/tts-bakeoff.
// super_admin only — /run spends on the AWS key in the server's environment.
//
// The UI is a normal Master Control screen (admin/VoiceBench.tsx, Ops → Voice
// bench). This router used to serve its own standalone HTML page too, copied
// from the vision bench's shape; that made the bench unfindable and unlike
// every other screen, so the page is gone and the SPA owns the rendering.
//
// The engine is lib/ttsBakeoff.js, shared with scripts/tts-bakeoff.mjs so the
// CLI and the screen audition identically.
import { Router } from "express";
import { pool } from "../../db.js";
import { isSuperAdmin } from "../../lib/adminAuth.js";
import {
  bakeoffDir,
  estimate,
  linesFor,
  listRuns,
  loadQuestions,
  loadVenues,
  noProviderReason,
  planClips,
  readRun,
  synthesizeAll,
} from "../../lib/ttsBakeoff.js";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";

export const router = Router();

// A button that spends money should never be able to spend a lot of it by
// accident: three questions is what the audition needs, five is the ceiling.
const MAX_QUESTIONS = 5;

router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "super_admin only" });
  }
  return next();
});

router.get("/venues", async (req, res) => {
  try {
    return res.json({ ok: true, venues: await loadVenues(pool) });
  } catch (err) {
    console.error("[tts-bakeoff] venues error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

/** Price a run without making one. */
router.post("/plan", async (req, res) => {
  try {
    const plan = await buildPlan(req.body ?? {});
    if (plan.error) return res.status(plan.status).json({ ok: false, error: plan.error });
    return res.json({
      ok: true,
      venue: plan.venue,
      lines: plan.lines.map((l) => ({ label: l.label, text: l.text })),
      ...estimate(plan.clips),
      // So the screen can say "no OPENAI_API_KEY" rather than silently
      // showing one column where the operator expected three.
      providers: plan.status,
    });
  } catch (err) {
    console.error("[tts-bakeoff] plan error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

/** Synthesize. THIS is the one that bills. */
router.post("/run", async (req, res) => {
  try {
    const plan = await buildPlan(req.body ?? {});
    if (plan.error) return res.status(plan.status).json({ ok: false, error: plan.error });
    if (plan.clips.length === 0) {
      // Not always a missing key: a configured provider with an empty voice
      // library gets here too, and telling that operator to add a key they
      // already have sends them to the wrong file.
      return res.status(400).json({ ok: false, error: noProviderReason(plan.status) });
    }

    const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${plan.venue.slug}`;
    const run = await synthesizeAll(plan.clips, {
      runId,
      meta: { venue: `${plan.venue.name}${plan.venue.orgName ? ` (${plan.venue.orgName})` : ""}` },
    });
    console.log(
      `[tts-bakeoff] ${runId}: ${run.clips.length} clips, ${run.billed} billed chars, ` +
        `$${run.usd.toFixed(4)}${run.errors ? `, ${run.errors} failed` : ""}`
    );
    return res.json({ ok: true, run });
  } catch (err) {
    console.error("[tts-bakeoff] run error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.get("/runs", (req, res) => {
  return res.json({ ok: true, runs: listRuns() });
});

router.get("/runs/:runId", (req, res) => {
  const run = readRun(req.params.runId);
  if (!run) return res.status(404).json({ ok: false, error: "unknown run" });
  return res.json({ ok: true, run });
});

/** The audio itself. Fetched by the page with its auth header and turned into
 *  a blob URL — an <audio src> is a plain navigation-style GET that cannot
 *  carry x-app-token, so a token-mode admin would get a 401 for every clip. */
router.get("/audio/:runId/:file", (req, res) => {
  const { runId, file } = req.params;
  // Both segments are single path components from Express, but be explicit:
  // anything with a separator or a dot-dot never reaches the filesystem.
  if (!/^[A-Za-z0-9._-]+$/.test(runId) || !/^[A-Za-z0-9._-]+\.mp3$/.test(file)) {
    return res.status(400).json({ ok: false, error: "bad path" });
  }
  const path = join(bakeoffDir(), runId, file);
  if (!existsSync(path)) return res.status(404).json({ ok: false, error: "unknown clip" });
  res.type("audio/mpeg").set("Cache-Control", "private, max-age=3600");
  return createReadStream(path).pipe(res);
});

/** Resolve a venue and build the clip list for it. */
async function buildPlan({ locationId, questions }) {
  const count = Math.min(MAX_QUESTIONS, Math.max(1, Number(questions) || 3));
  const venues = await loadVenues(pool);
  const venue = venues.find((v) => v.id === locationId || v.slug === locationId);
  if (!venue) return { error: "unknown venue", status: 404 };
  const bank = await loadQuestions(pool, {
    locationId: venue.id,
    orgId: venue.orgId,
    count,
  });
  if (bank.length === 0) return { error: "no active questions in this venue's bank", status: 409 };
  const lines = linesFor(bank);
  const { clips, status } = await planClips(lines);
  return { venue, lines, clips, status };
}
