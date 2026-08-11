#!/usr/bin/env node
// course-bot — synthetic player traffic for the FFC mini-golf API.
//
// WHAT IT DOES
//   Plays every OPEN course a few times, on a repeating interval, by POSTing
//   real rounds to /api/rounds with `synthetic: true` (and the x-synthetic-key
//   header). Each round travels the exact production path — insert, rewards,
//   leaderboards — so this doubles as a load/soak test, an end-to-end smoke
//   test, and a demo-data seeder. Whether synthetic rounds also count on boards
//   / mint reward tickets is a SERVER policy (SYNTHETIC_COUNT_ON_BOARD,
//   SYNTHETIC_MINT_REWARDS), not something this bot decides.
//
// BUSINESS HOURS
//   By default the bot only plays a venue while it is OPEN, evaluated in the
//   venue's own timezone from its full schedule — base weekly hours + per-date
//   overrides + date-ranged seasons (location.hours / hours_overrides /
//   hours_seasons, served by /api/content; resolution in lib/venueHours.js). It
//   re-reads the schedule at the top of every sweep, so a change (edited in
//   Master Control, or refreshed from the venue calendar) is honored with no
//   restart. Unknown/unset schedule or missing tz → treated CLOSED (fail-closed).
//   Pass --ignore-hours to play 24/7 (pure load testing). Note: the pre-flight's
//   "h/wk open" + hours-gated projection use the BASE WEEKLY pattern only (a
//   rough estimate); actual play still respects overrides/seasons exactly.
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
//   --ignore-hours        play 24/7, ignore venue business hours (load testing)
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
import { isVenueOpen, WEEKDAY_KEYS } from "../server/lib/venueHours.js";

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
    ignoreHours: false,
    fallbackTz: null,
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
      case "--ignore-hours": a.ignoreHours = true; break;
      case "--fallback-tz": a.fallbackTz = val(); break;
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
  if (a.fallbackTz !== null) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: a.fallbackTz });
    } catch {
      fail(`--fallback-tz ${JSON.stringify(a.fallbackTz)} is not a valid IANA zone`);
    }
  }
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
      "[--concurrency N] [--ignore-hours] [--yes] [--dry-run]\nSee the header of this file for full docs."
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
// Everything comes from the open content catalog (GET /api/content) in one
// fetch: courses (with pars), and each course's venue (tz + business hours) so
// the bot can gate synthetic play on "is this venue open right now, in its own
// timezone" — the same rows the app bundles and the same source of truth.
async function discoverCourses(api, location, fallbackTz = null) {
  const url = `${api}/api/content`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`course discovery failed: GET ${url} → ${res.status}`);
  const content = await res.json();

  const locsById = new Map();
  for (const l of content.locations ?? []) {
    locsById.set(l.id, {
      name: l.name,
      // Never assume a zone: the server's VENUE_TZ fallback is configurable and
      // not necessarily Pacific, so guessing could play a venue while it's
      // actually closed. Use an operator-supplied --fallback-tz if given, else
      // leave null → isVenueOpen fails closed (venue skipped) rather than guess.
      tz: l.tz || fallbackTz || null,
      // Full schedule: base weekly + per-date overrides + date-ranged seasons.
      schedule: {
        weekly: l.hours ?? null,
        overrides: l.hoursOverrides ?? null,
        seasons: l.hoursSeasons ?? null,
      },
    });
  }

  const courses = [];
  for (const c of content.courses ?? []) {
    if (location && c.locationId !== location) continue;
    const venue = locsById.get(c.locationId);
    if (!venue) continue; // course whose venue is archived/absent — skip
    const s = venue.schedule;
    courses.push({
      courseId: c.id,
      courseName: c.name,
      locationId: c.locationId,
      locationName: venue.name,
      tz: venue.tz,
      schedule: s,
      // `hours` (base weekly) kept for the "hours unset" check + the weekly
      // open-hours estimate in the pre-flight projection.
      hours: s.weekly,
      pars: Array.isArray(c.pars) && c.pars.length > 0 ? c.pars : null,
    });
  }
  if (courses.length === 0) {
    throw new Error(location ? `no live courses at location ${location}` : "no live courses found to play");
  }

  const noPars = courses.filter((c) => !c.pars).length;
  if (noPars > 0) {
    console.warn(`  ! pars unavailable for ${noPars}/${courses.length} course(s) — using flat par-3 for those`);
  }
  const hasSchedule = (c) => c.hours || c.schedule.overrides || c.schedule.seasons;
  const noHours = courses.filter((c) => !hasSchedule(c)).length;
  if (noHours > 0) {
    console.warn(
      `  ! hours unset for ${noHours}/${courses.length} course(s) — those venues are treated ` +
        `as CLOSED (fail-closed). Set location.hours, or pass --ignore-hours to play regardless.`
    );
  }
  const noTz = courses.filter((c) => hasSchedule(c) && !c.tz).length;
  if (noTz > 0) {
    console.warn(
      `  ! ${noTz}/${courses.length} course(s) have hours but no timezone — treated as CLOSED ` +
        `(the server's VENUE_TZ fallback isn't assumed). Set location.tz, or pass --fallback-tz <IANA>.`
    );
  }
  return courses;
}

// Total open hours per week for a venue's hours object (for the gated volume
// projection). Unknown/unset → 0 (fail-closed).
function weeklyOpenHours(hours) {
  if (!hours || typeof hours !== "object") return 0;
  let mins = 0;
  for (const key of WEEKDAY_KEYS) {
    const d = hours[key];
    if (!d || d === "closed") continue;
    const to = (s) => (s === "24:00" ? 1440 : Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)));
    const o = to(d.open);
    const c = to(d.close);
    mins += c > o ? c - o : 1440 - o + c; // same-day or overnight wrap
  }
  return mins / 60;
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
const WEEKS_PER_YEAR = 52.142857;

function preflight(a, courses, now = new Date()) {
  const avgPlayers = (1 + a.maxPlayers) / 2; // uniform 1..cap
  const roundsPerSweep = courses.length * a.playsPerCourse;
  const sweepsPerHour = a.intervalMin > 0 ? 60 / a.intervalMin : roundsPerSweep; // 0 = as fast as possible
  const gating = !a.ignoreHours;

  // Dedup venues (courses share one) for the status + open-hours display.
  const venues = new Map();
  for (const c of courses) {
    if (!venues.has(c.locationId)) {
      venues.set(c.locationId, { name: c.locationName, tz: c.tz, hours: c.hours, schedule: c.schedule, courses: 0 });
    }
    venues.get(c.locationId).courses += 1;
  }

  console.log("── course-bot pre-flight ─────────────────────────────────────");
  console.log(`  API                : ${a.api}`);
  console.log(`  gating             : ${gating ? "business-hours-only (skip venues that are closed now)" : "OFF — --ignore-hours (play 24/7)"}`);
  console.log(`  venues / courses   : ${venues.size} / ${courses.length}`);
  for (const v of venues.values()) {
    let status;
    if (!gating) status = "gating off";
    else if (!v.hours) status = "hours unset → treated CLOSED";
    else status = isVenueOpen(v.schedule, v.tz, now) ? "OPEN now" : "closed now";
    const wk = gating && v.hours ? ` · ${weeklyOpenHours(v.hours).toFixed(0)}h/wk open` : "";
    console.log(`     • ${v.name} (${v.courses} course${v.courses > 1 ? "s" : ""}, ${v.tz}) — ${status}${wk}`);
  }
  console.log(`  plays/course/sweep : ${a.playsPerCourse}`);
  console.log(`  players/round      : 1..${a.maxPlayers} (avg ${avgPlayers.toFixed(1)})`);
  console.log(`  interval           : ${a.intervalMin} min  (${sweepsPerHour.toFixed(2)} sweeps/hr)`);
  console.log(`  sweeps to run      : ${Number.isFinite(a.sweeps) ? a.sweeps : "∞ (until Ctrl-C)"}`);

  console.log("  ── projected volume ──");
  const maxHour = roundsPerSweep * sweepsPerHour;
  const maxYear = maxHour * 24 * 365;
  console.log(`  24/7 max   : ~${Math.round(maxHour)} rounds/hr · ~${Math.round(maxYear).toLocaleString()} rounds/yr · ~${Math.round(maxYear * avgPlayers).toLocaleString()} players/yr`);
  if (gating && a.intervalMin > 0) {
    // Each course only plays while its venue is open: expected sweeps/week that
    // land in open hours ≈ weeklyOpenHours / intervalHours. Unknown hours → 0.
    const intervalHours = a.intervalMin / 60;
    let gatedYear = 0;
    for (const c of courses) gatedYear += a.playsPerCourse * (weeklyOpenHours(c.hours) / intervalHours) * WEEKS_PER_YEAR;
    console.log(`  hours-gated: ~${Math.round(gatedYear).toLocaleString()} rounds/yr · ~${Math.round(gatedYear * avgPlayers).toLocaleString()} players/yr (only while venues are open)`);
  } else if (gating) {
    console.log(`  hours-gated: annual estimate needs --interval-min > 0`);
  }
  if (Number.isFinite(a.sweeps)) {
    console.log(`  this run   : up to ${roundsPerSweep * a.sweeps} rounds across ${a.sweeps} sweeps (fewer when venues are closed)`);
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
  let courses;
  try {
    courses = await discoverCourses(a.api, a.location, a.fallbackTz);
  } catch (e) {
    fail(e.message);
  }
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
    const label = `sweep ${sweepNo}${Number.isFinite(a.sweeps) ? `/${a.sweeps}` : ""}`;

    // Refresh courses + venue hours live each sweep, so a schedule change
    // (edited in Master Control, or a re-fetch job) is honored with no restart.
    // If the refresh fails, keep the last-known set rather than dying.
    try {
      courses = await discoverCourses(a.api, a.location, a.fallbackTz);
    } catch (e) {
      console.warn(`  ! ${label}: hours/course refresh failed (${e.message}); using last-known set`);
    }

    // Gate on business hours (unless --ignore-hours): only play venues open now,
    // in their own tz. Unknown/unset hours → closed (fail-closed).
    const now = new Date();
    const playable = a.ignoreHours ? courses : courses.filter((c) => isVenueOpen(c.schedule, c.tz, now));
    const skippedVenues = new Set(
      courses.filter((c) => !playable.includes(c)).map((c) => c.locationName)
    );

    if (playable.length === 0) {
      console.log(`${label}: all venues closed — 0 rounds (skipped: ${[...skippedVenues].join(", ") || "—"})`);
    } else {
      // Each playable course played playsPerCourse times.
      const jobs = [];
      for (const c of playable) {
        for (let n = 0; n < a.playsPerCourse; n++) jobs.push(c);
      }
      const t0 = performance.now();
      const results = await mapLimit(jobs, a.concurrency, (course) =>
        postRound(a.api, a.key, buildRound(course, runId, a.maxPlayers))
      );
      const wall = performance.now() - t0;
      cumulative.push(...results);
      const skipNote = skippedVenues.size ? ` · closed: ${[...skippedVenues].join(", ")}` : "";
      printSweep(`${label} (${playable.length}/${courses.length} courses open)`,
        summarize(results, wall), avgPlayers);
      if (skipNote) console.log(`   ${skipNote.trim()}`);
    }

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
