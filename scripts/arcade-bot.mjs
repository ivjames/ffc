#!/usr/bin/env node
// arcade-bot — plays the app's arcade mini-games for real, in a browser.
//
// WHAT IT DOES
//   Opens each game in headless Chromium and plays complete rounds by solving
//   the game's own launch physics for the gesture that hits a chosen target,
//   then perturbing that aim by a skill-scaled amount before committing. Scores
//   are read back off the end card, so a run is a MEASUREMENT of the shipped
//   game, not a restatement of what the bot intended.
//
//   Its output is a score profile: per-game, per-skill-band score distributions
//   plus the tickets those scores would earn. That profile is what
//   scripts/arcade-traffic.mjs replays at volume against the award API — the
//   browser earns the numbers, the fast path reuses them. Playing every
//   synthetic round in a real browser would cap throughput at a few rounds a
//   minute; sampling a profile that was captured from real play keeps the
//   volume path honest without paying that cost per round.
//
// IT IS ALSO A REGRESSION HARNESS
//   A game whose aim solver stops landing its target has had its constants
//   changed underneath the bot. `--assert-skill` fails the run if an expert bot
//   cannot reach a game's expected score floor, which is a cheap smoke test
//   that every game is still playable at all.
//
// USAGE
//   node scripts/arcade-bot.mjs [--base URL] [--game KEY]... [--rounds N]
//                               [--skill N] [--seed N] [--out FILE]
//                               [--headed] [--assert-skill]
//
//   --base URL        app origin (default http://localhost:5173)
//   --game KEY        game to play, repeatable (default: all supported)
//   --rounds N        rounds per game (default 6)
//   --skill N         fix skill at N in [0,1] (default: sample a player mix)
//   --seed N          PRNG seed, for a replayable run (default 1)
//   --out FILE        write the captured score profile as JSON
//   --headed          run with a visible browser, for watching it play
//   --video DIR       record the session to DIR as .webm — how to watch it play
//                     on a headless box, where --headed has nothing to display to
//   --assert-skill    exit non-zero if an expert bot can't clear each game's
//                     floor; implies --skill 1 unless --skill is given
//   --list            print supported + unsupported games and exit
//
// COST
//   No third-party model or API calls are made, so there is no per-token spend.
//   The cost is wall clock and one browser: the run reports rounds played,
//   wall-clock per round per game, and the projected time to capture a larger
//   profile, so a bigger capture can be sized before it is started.
import { chromium } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { BY_KEY, GAMES, UNSUPPORTED, resolve } from './lib/arcade/registry.mjs';
import { playRound } from './lib/arcade/round.mjs';
import { makeRng, sampleSkill } from './lib/arcade/skill.mjs';
import { watchParentOrExit } from './lib/parentWatchdog.mjs';

function parseArgs(argv) {
  const a = {
    base: process.env.FFC_APP_BASE || 'http://localhost:5173',
    games: [],
    rounds: 6,
    skill: null,
    seed: 1,
    workers: 1,
    out: null,
    headed: false,
    video: null,
    assertSkill: false,
    list: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--base') a.base = next();
    else if (k === '--game') a.games.push(next());
    else if (k === '--rounds') a.rounds = Number(next());
    else if (k === '--skill') a.skill = Number(next());
    else if (k === '--seed') a.seed = Number(next());
    else if (k === '--workers') a.workers = Number(next());
    else if (k === '--out') a.out = next();
    else if (k === '--headed') a.headed = true;
    else if (k === '--video') a.video = next();
    else if (k === '--assert-skill') a.assertSkill = true;
    else if (k === '--list') a.list = true;
    else throw new Error(`unknown flag ${k}`);
  }
  return a;
}

/** Expert-bot score floors — the regression signal for "this game still works". */
const SKILL_FLOOR = {
  skeeball: 400,
  ringtoss: 12,
  popashot: 20,
  highstriker: 70,
  axethrow: 22,
  darts: 200,
  whackamole: 20,
  bowling: 150,
  shootinggallery: 60,
  clawmachine: 30,
  battingcages: 24,
  watergunrace: 2,
  trivia: 8,
  milkbottle: 12,
  airhockey: 4,
  pinball: 1200,
  bumpercars: 5,
  bumperboats: 4,
  // Go-Karts scores a TIME, so its floor is a CEILING — see lowerIsBetter.
  gokarts: 120,
};

/**
 * Deterministic per-round seed (FNV-1a over seed:game#round).
 *
 * Each round gets its OWN rng instead of drawing from one shared stream, which
 * is what makes parallel capture reproducible at all: with a shared stream the
 * draws depend on scheduling order, so --seed would mean nothing past
 * --workers 1. It also fixes a quieter defect the shared stream always had —
 * adding one game to the list shifted every later game's draws, so two
 * captures of overlapping game sets never shared a single round.
 */
function roundSeed(seed, key, i) {
  let h = 0x811c9dc5 ^ (seed >>> 0);
  for (const ch of `${key}#${i}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) || 1;
}

const pct = (xs, p) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

async function main() {
  // Spawned by the admin control plane? Then die when it does — a capture
  // holds a browser open for minutes at a time, which is exactly the kind of
  // orphan nobody notices. No-op when run by hand.
  watchParentOrExit('arcade-bot');
  const args = parseArgs(process.argv);

  if (args.list) {
    console.log('Supported (the bot plays these for real):');
    for (const g of GAMES) console.log(`  ${g.key.padEnd(14)} ${g.label} — ${g.route}`);
    console.log('\nNot yet supported:');
    for (const [k, why] of UNSUPPORTED) console.log(`  ${k.padEnd(14)} ${why}`);
    return;
  }

  const games = resolve(args.games);
  const workers = Math.max(1, Math.min(Number.isFinite(args.workers) ? args.workers : 1, 8));

  const estMs = games.reduce((t, g) => t + g.estRoundMs * args.rounds, 0) / workers;
  console.log(
    `arcade-bot: ${games.length} game(s) × ${args.rounds} round(s)` +
      (workers > 1 ? ` on ${workers} workers` : '') +
      ` — ~${Math.ceil(estMs / 60000)} min estimated, seed ${args.seed}`,
  );
  console.log('(no model/API calls — cost is wall clock + one headless browser)\n');

  const browser = await chromium.launch({ headless: !args.headed });
  const viewport = { width: 420, height: 900 };

  const profile = { capturedAt: new Date().toISOString(), base: args.base, games: {} };
  const t0 = Date.now();
  let failures = 0;
  let unreachable = false;
  let played = 0;

  // One flat queue of (game, round) jobs, drained by N workers — each worker a
  // browser CONTEXT with its own page, all inside one Chromium (a page is a
  // renderer process; a whole browser per worker would triple the memory for
  // nothing). Rounds land back in their (game, index) slot, so the profile is
  // identical no matter which worker finished first.
  const jobs = [];
  for (const game of games) for (let i = 0; i < args.rounds; i++) jobs.push({ game, i });
  const rows = new Map(games.map((g) => [g.key, []]));
  let cursor = 0;

  async function runWorker() {
    // --video: one .webm per page as before, written when the context closes.
    const context = await browser.newContext({
      viewport,
      ...(args.video ? { recordVideo: { dir: args.video, size: viewport } } : {}),
    });
    const page = await context.newPage();
    while (!unreachable) {
      const job = jobs[cursor++];
      if (!job) break;
      const { game, i } = job;
      // Every round draws from its OWN seeded rng (see roundSeed) — the only
      // scheme under which --seed reproduces a run at any worker count.
      const rng = makeRng(roundSeed(args.seed, game.key, i));
      // --assert-skill compares against EXPERT floors, so it has to play like
      // one: sampling the ordinary player mix would fail a perfectly healthy
      // game whenever no strong round happened to be drawn. An explicit
      // --skill still wins, so a floor can be checked at any ability.
      const skill = args.skill ?? (args.assertSkill ? 1 : sampleSkill(rng));
      try {
        const r = await playRound(page, game, { rng, skill, baseUrl: args.base });
        rows.get(game.key)[i] = r;
        played++;
        console.log(
          `  ${game.key.padEnd(12)} #${String(i + 1).padStart(2)} ` +
            `skill ${skill.toFixed(2)}  score ${String(r.score).padStart(5)}  ` +
            `${r.tickets} tickets  ${(r.ms / 1000).toFixed(1)}s`,
        );
      } catch (err) {
        failures++;
        console.log(`  ${game.key.padEnd(12)} #${String(i + 1).padStart(2)} FAILED: ${err.message}`);
        // A NETWORK error before anything has ever loaded means we can't reach
        // the app at all — wrong base, DNS, TLS, a proxy in the way. Every
        // remaining round fails identically, so stop rather than spending 19
        // games proving it; net::ERR_* covers REFUSED, RESET, TIMED_OUT and
        // NAME_NOT_RESOLVED alike. Only while NOTHING has succeeded yet,
        // though: once rounds are landing, a single blip shouldn't kill a
        // long capture.
        if (played === 0 && /net::ERR_/.test(err.message)) unreachable = true;
      }
    }
    await context.close(); // finalises any video
  }

  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => runWorker()));

  for (const game of games) {
    const done = (rows.get(game.key) ?? []).filter(Boolean);
    const scores = done.map((r) => r.score);
    profile.games[game.key] = {
      label: game.label,
      rounds: done.length,
      // The samples themselves, not just moments: the volume path resamples
      // these directly, so the replayed distribution is the measured one
      // (multi-modal shapes and all) rather than a fitted approximation.
      samples: done.map((r) => ({ score: r.score, tickets: r.tickets, skill: Number(r.skill.toFixed(3)) })),
      stats: {
        mean: Math.round(mean(scores)),
        p10: pct(scores, 10),
        p50: pct(scores, 50),
        p90: pct(scores, 90),
        max: scores.length ? Math.max(...scores) : 0,
        min: scores.length ? Math.min(...scores) : 0,
        meanRoundMs: Math.round(mean(done.map((r) => r.ms))),
      },
    };
    const st = profile.games[game.key].stats;
    console.log(
      `  → ${game.key}: mean ${st.mean}, p10/p50/p90 ${st.p10}/${st.p50}/${st.p90}, ` +
        `max ${st.max}, ${(st.meanRoundMs / 1000).toFixed(1)}s/round`,
    );
  }

  await browser.close();

  const wall = (Date.now() - t0) / 1000;

  if (unreachable) {
    console.error(
      `\n  ✗ Could not reach the app at ${args.base} — stopped before playing anything.\n` +
        '    Capture opens the PLAYER APP: the Vite dev server (npm run dev) on a dev\n' +
        '    box, nginx on a deployed one — never the API port. A refusal means the\n' +
        '    wrong origin; a reset or timeout usually means DNS, TLS, or a proxy that\n' +
        '    the browser (unlike curl) is not going through. Pass --base <origin>, or\n' +
        '    set PLATFORM_FQDN / FFC_APP_BASE so the admin can derive it.',
    );
  }
  console.log(`Played ${played} round(s) in ${wall.toFixed(0)}s` + (failures ? `, ${failures} failed` : ''));
  if (played > 0) {
    const perRound = wall / played;
    console.log(
      `Throughput: ${(60 / perRound).toFixed(1)} rounds/min on ${workers} worker(s) — ` +
        `a 1000-round capture would take ~${Math.ceil((perRound * 1000) / 60)} min.`,
    );
  }

  if (args.out && played === 0) {
    // Writing a zero-round profile just leaves a file that every replay has to
    // refuse. The run already failed; don't make it litter too.
    console.error(`  (no rounds played — no profile written to ${args.out})`);
  } else if (args.out) {
    writeFileSync(args.out, JSON.stringify(profile, null, 2));
    console.log(`Wrote profile → ${args.out}`);
  }

  if (args.assertSkill) {
    let bad = 0;
    for (const [key, g] of Object.entries(profile.games)) {
      const floor = SKILL_FLOOR[key];
      if (floor === undefined) continue;
      // A time-scored game's BEST round is its lowest, and the bound is an
      // upper one — comparing it the usual way would pass any result at all.
      const lower = BY_KEY.get(key)?.lowerIsBetter;
      const best = lower ? g.stats.min : g.stats.max;
      const failed = lower ? best > floor : best < floor;
      if (failed) {
        console.error(
          `FAIL ${key}: best ${best} ${lower ? '>' : '<'} ${lower ? 'ceiling' : 'floor'} ${floor}`,
        );
        bad++;
      }
    }
    if (bad > 0 || failures > 0) process.exitCode = 1;
    else console.log('Skill floors OK.');
  } else if (failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
