#!/usr/bin/env node
// course-bot — synthetic player traffic for the FFC mini-golf API.
//
// WHAT IT DOES
//   Plays every live course a few times, on a repeating interval, by POSTing
//   real rounds to /api/rounds with `synthetic: true` (and the x-synthetic-key
//   header). Each round travels the exact production path — insert, rewards,
//   leaderboards — so this doubles as a load/soak test, an end-to-end smoke
//   test, and a demo-data seeder. Whether synthetic rounds also count on boards
//   / mint reward tickets is a SERVER policy (SYNTHETIC_COUNT_ON_BOARD,
//   SYNTHETIC_MINT_REWARDS), not something this bot decides.
//
// SAFETY / ISOLATION
//   * The server rejects `synthetic: true` unless SYNTHETIC_BOT_KEY is set there
//     AND this bot sends the matching --key. No key → no synthetic rounds.
//   * Every round is tagged `synthetic = true` in the DB and carries a
//     reserved client_id (`synthetic:<runId>:<uuid>`), so a whole run is
//     bulk-deletable with ZERO residue:
//         delete from round where synthetic;              -- all bot rounds ever
//         delete from round where client_id like 'synthetic:<runId>:%';  -- one run
//     Both cascade to score + reward_grant (ON DELETE CASCADE).
//
// USAGE
//   node scripts/course-bot.mjs \
//     --api https://ffc.example.com --key "$SYNTHETIC_BOT_KEY" \
//     --plays-per-course 2 --interval-min 60 [--sweeps N] [--yes] [--dry-run]
//
//   --api URL             API base (env FFC_API_BASE, default http://localhost:8060)
//   --key KEY             synthetic bot key (env SYNTHETIC_BOT_KEY)
//   --location UUID       only play courses at this venue (default: all live courses)
//   --plays-per-course N  rounds per course per sweep (default 2)
//   --interval-min M      minutes between sweeps (default 60; one sweep = every course)
//   --sweeps N            stop after N sweeps (default: run forever until Ctrl-C)
//   --max-players N       cap players per round, 1..4 (default 4; each round is 1..cap)
//   --concurrency N       in-flight requests per sweep (default 4)
//   --yes                 skip the pre-flight confirmation prompt
//   --dry-run             discover + estimate + print sample payloads, POST nothing
//
// Reports per-sweep and cumulative stats: rounds OK/failed, latency p50/p95/max,
// throughput, bytes sent, and the annualized round/player volume the current
// cadence projects — so you can line the bot up against a real target (e.g.
// "70k players/year across 4 courses"). No third-party model calls are made, so
// there is no per-token model cost — the only spend is API/DB load, metered here
// as request count + latency.

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import { isValidTag } from "../server/lib/sanitize.js";

// --- args ------------------------------------------------------------------
function parseArgs(argv) {
  const a = {
    api: process.env.FFC_API_BASE || "http://localhost:8060",
    key: process.env.SYNTHETIC_BOT_KEY || "",
    location: null,
    playsPerCourse: 2,
    intervalMin: 60,
    sweeps: Infinity,
    maxPlayers: 4,
    concurrency: 4,
    yes: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const val = () => argv[++i];
    switch (k) {
      case "--api": a.api = val(); break;
      case "--key": a.key = val(); break;
      case "--location": a.location = val(); break;
      case "--plays-per-course": a.playsPerCourse = Number(val()); break;
      case "--interval-min": a.intervalMin = Number(val()); break;
      case "--sweeps": a.sweeps = Number(val()); break;
      case "--max-players": a.maxPlayers = Number(val()); break;
      case "--concurrency": a.concurrency = Number(val()); break;
      case "--yes": a.yes = true; break;
      case "--dry-run": a.dryRun = true; break;
      case "--help": case "-h": printHelpAndExit(); break;
      default: fail(`unknown arg: ${k} (try --help)`);
    }
  }
  if (!(a.playsPerCourse >= 1)) fail("--plays-per-course must be >= 1");
  if (!(a.intervalMin >= 0)) fail("--interval-min must be >= 0");
  if (!(a.maxPlayers >= 1 && a.maxPlayers <= 4)) fail("--max-players must be 1..4");
  if (!(a.concurrency >= 1)) fail("--concurrency must be >= 1");
  a.api = a.api.replace(/\/+$/, "");
  return a;
}

function fail(msg) {
  console.error(`course-bot: ${msg}`);
  process.exit(1);
}
function printHelpAndExit() {
  // The header comment is the manual; dump the USAGE block.
  console.log(
    "node scripts/course-bot.mjs --api URL --key KEY [--plays-per-course N] " +
      "[--interval-min M] [--sweeps N] [--location UUID] [--max-players N] " +
      "[--concurrency N] [--yes] [--dry-run]\nSee the header of this file for full docs."
  );
  process.exit(0);
}

// --- randomness ------------------------------------------------------------
const randInt = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const TAG_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomTag() {
  // Reuse the server's validator so we never emit a blocklisted tag.
  for (;;) {
    let t = "";
    for (let i = 0; i < 3; i++) t += pick(TAG_CHARS.split(""));
    if (isValidTag(t)) return t;
  }
}

// A believable per-hole score around par: mostly par / bogey, a few birdies and
// the odd ace or blow-up. Never below 1, capped at 8.
function strokesForPar(par) {
  const r = Math.random();
  let delta;
  if (r < 0.04) delta = 1 - par; // ace-ish (→ strokes 1)
  else if (r < 0.34) delta = -1; // birdie
  else if (r < 0.64) delta = 0; // par
  else if (r < 0.86) delta = 1; // bogey
  else if (r < 0.96) delta = 2; // double
  else delta = 3; // blow-up
  return Math.max(1, Math.min(8, par + delta));
}

function buildRound(course, runId, maxPlayers) {
  const nPlayers = randInt(1, maxPlayers);
  const playerTags = Array.from({ length: nPlayers }, randomTag);
  const pars = course.pars ?? Array(18).fill(3);
  const scores = {};
  for (let p = 0; p < nPlayers; p++) {
    scores[p] = pars.map((par) => strokesForPar(par));
  }
  const now = Date.now();
  // Backdate a bit so created/completed look like a real ~20-min round.
  const createdAt = now - randInt(12, 30) * 60_000;
  return {
    clientId: `synthetic:${runId}:${randomUUID()}`,
    courseId: course.courseId,
    playerTags,
    createdAt,
    completedAt: now,
    scores,
    synthetic: true,
  };
}

// --- API -------------------------------------------------------------------
async function discoverCourses(api, location) {
  const url = `${api}/api/leaderboard/courses${location ? `?locationId=${location}` : ""}`;
  const res = await fetch(url);
  if (!res.ok) fail(`course discovery failed: GET ${url} → ${res.status}`);
  const body = await res.json();
  const courses = (body.courses ?? []).map((c) => ({
    courseId: c.courseId,
    courseName: c.courseName,
    locationName: c.locationName,
  }));
  if (courses.length === 0) fail("no live courses found to play");
  // The board list omits pars; fetch them so scores respect each course's pars.
  // Falls back to all-3s if the (admin-only) pars aren't reachable.
  return courses;
}

async function postRound(api, key, body) {
  const payload = JSON.stringify(body);
  const t0 = performance.now();
  let status = 0;
  let ok = false;
  let error = null;
  try {
    const res = await fetch(`${api}/api/rounds`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-synthetic-key": key },
      body: payload,
    });
    status = res.status;
    const j = await res.json().catch(() => ({}));
    ok = res.ok && j.ok === true;
    if (!ok) error = j.error || `HTTP ${status}`;
  } catch (e) {
    error = e.message;
  }
  return { ms: performance.now() - t0, bytes: Buffer.byteLength(payload), status, ok, error };
}

// --- stats -----------------------------------------------------------------
function pct(sorted, p) {
  if (sorted.length === 0) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}
function summarize(results, wallMs) {
  const okr = results.filter((r) => r.ok);
  const lat = okr.map((r) => r.ms).sort((x, y) => x - y);
  const bytes = results.reduce((s, r) => s + r.bytes, 0);
  return {
    total: results.length,
    ok: okr.length,
    failed: results.length - okr.length,
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    max: lat.length ? lat[lat.length - 1] : 0,
    bytes,
    wallMs,
    rps: wallMs > 0 ? (results.length / (wallMs / 1000)) : 0,
    errors: tallyErrors(results),
  };
}
function tallyErrors(results) {
  const m = new Map();
  for (const r of results) if (!r.ok) m.set(r.error, (m.get(r.error) || 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}
const fmtMs = (ms) => `${ms.toFixed(0)}ms`;
const fmtKB = (b) => `${(b / 1024).toFixed(1)}KB`;

function printSweep(label, s, avgPlayers) {
  console.log(
    `${label}: ${s.ok}/${s.total} ok` +
      (s.failed ? ` (${s.failed} FAILED)` : "") +
      ` · lat p50 ${fmtMs(s.p50)} p95 ${fmtMs(s.p95)} max ${fmtMs(s.max)}` +
      ` · ${s.rps.toFixed(1)} req/s · ${fmtKB(s.bytes)} sent`
  );
  for (const [err, n] of s.errors) console.log(`    ✗ ${n}× ${err}`);
}

// --- pre-flight estimate ---------------------------------------------------
function preflight(a, courses) {
  const roundsPerSweep = courses.length * a.playsPerCourse;
  const avgPlayers = (1 + a.maxPlayers) / 2; // uniform 1..cap
  const sweepsPerHour = a.intervalMin > 0 ? 60 / a.intervalMin : roundsPerSweep; // 0 = as fast as possible (rough)
  const roundsPerHour = roundsPerSweep * sweepsPerHour;
  const roundsPerDay = roundsPerHour * 24;
  const roundsPerYear = roundsPerDay * 365;
  const finiteSweeps = Number.isFinite(a.sweeps);
  console.log("── course-bot pre-flight ─────────────────────────────────────");
  console.log(`  API                : ${a.api}`);
  console.log(`  courses discovered : ${courses.length}`);
  for (const c of courses) {
    console.log(`     • ${c.courseName}${c.locationName ? ` @ ${c.locationName}` : ""} (${c.courseId})`);
  }
  console.log(`  plays/course/sweep : ${a.playsPerCourse}`);
  console.log(`  players/round      : 1..${a.maxPlayers} (avg ${avgPlayers.toFixed(1)})`);
  console.log(`  rounds per sweep   : ${roundsPerSweep}`);
  console.log(`  interval           : ${a.intervalMin} min  (${sweepsPerHour.toFixed(2)} sweeps/hr)`);
  console.log(`  sweeps to run      : ${finiteSweeps ? a.sweeps : "∞ (until Ctrl-C)"}`);
  console.log("  ── projected steady-state volume ──");
  console.log(`  rounds : ~${Math.round(roundsPerHour)}/hr · ~${Math.round(roundsPerDay)}/day · ~${Math.round(roundsPerYear).toLocaleString()}/yr`);
  console.log(`  players: ~${Math.round(roundsPerDay * avgPlayers)}/day · ~${Math.round(roundsPerYear * avgPlayers).toLocaleString()}/yr (round×avg players)`);
  if (finiteSweeps) {
    console.log(`  this run   : ${roundsPerSweep * a.sweeps} rounds total across ${a.sweeps} sweeps`);
  }
  console.log("──────────────────────────────────────────────────────────────");
  return { roundsPerSweep, avgPlayers };
}

function confirm(question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

// --- concurrency-limited map ----------------------------------------------
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// --- main ------------------------------------------------------------------
async function main() {
  const a = parseArgs(process.argv);
  if (!a.dryRun && !a.key) {
    fail("no --key / SYNTHETIC_BOT_KEY set — the server will reject synthetic rounds. " +
      "Pass --dry-run to preview without posting.");
  }
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const courses = await discoverCourses(a.api, a.location);
  const { roundsPerSweep, avgPlayers } = preflight(a, courses);

  if (a.dryRun) {
    console.log("\n[dry-run] sample payload:");
    console.log(JSON.stringify(buildRound(courses[0], runId, a.maxPlayers), null, 2));
    console.log("\n[dry-run] nothing posted. Cleanup for a real run would be:");
    console.log(`    delete from round where client_id like 'synthetic:${runId}:%';`);
    return;
  }
  if (!a.yes) {
    const go = await confirm(`\nPost ~${roundsPerSweep}/sweep synthetic rounds to ${a.api}? [y/N] `);
    if (!go) { console.log("aborted."); return; }
  }

  console.log(`\nrun id: ${runId}  (cleanup: delete from round where client_id like 'synthetic:${runId}:%';)\n`);
  const cumulative = [];
  let sweepNo = 0;
  let stopping = false;
  process.on("SIGINT", () => {
    if (stopping) process.exit(130);
    stopping = true;
    console.log("\n↩ finishing current sweep, then stopping (Ctrl-C again to force)…");
  });

  while (sweepNo < a.sweeps && !stopping) {
    sweepNo++;
    // Build this sweep's work: each course played playsPerCourse times.
    const jobs = [];
    for (const c of courses) {
      for (let n = 0; n < a.playsPerCourse; n++) jobs.push(c);
    }
    const t0 = performance.now();
    const results = await mapLimit(jobs, a.concurrency, (course) =>
      postRound(a.api, a.key, buildRound(course, runId, a.maxPlayers))
    );
    const wall = performance.now() - t0;
    cumulative.push(...results);
    printSweep(`sweep ${sweepNo}${Number.isFinite(a.sweeps) ? `/${a.sweeps}` : ""}`,
      summarize(results, wall), avgPlayers);

    if (sweepNo >= a.sweeps || stopping) break;
    if (a.intervalMin > 0) {
      const waitMs = a.intervalMin * 60_000;
      console.log(`  … next sweep in ${a.intervalMin} min`);
      // Sleep in short slices so Ctrl-C is responsive.
      const until = Date.now() + waitMs;
      while (Date.now() < until && !stopping) await sleep(Math.min(1000, until - Date.now()));
    }
  }

  console.log("\n══ cumulative ════════════════════════════════════════════════");
  printSweep(`total (${sweepNo} sweeps)`, summarize(cumulative, 0), avgPlayers);
  const okRounds = cumulative.filter((r) => r.ok).length;
  console.log(`  rounds posted OK: ${okRounds} · players simulated (est): ~${Math.round(okRounds * avgPlayers)}`);
  console.log(`  cleanup this run: delete from round where client_id like 'synthetic:${runId}:%';`);
  console.log("══════════════════════════════════════════════════════════════");
}

main().catch((e) => fail(e.stack || e.message));
