#!/usr/bin/env node
// arcade-traffic — the volume half of the arcade bot.
//
// WHAT IT DOES
//   Replays a score profile captured by scripts/arcade-bot.mjs against the real
//   award endpoint (POST /api/game-rewards/award), at a rate a browser could
//   never reach. The browser bot earns the numbers by actually playing; this
//   resamples those measured scores and posts the awards they imply.
//
//   Scores are resampled from the captured SAMPLES, not from a fitted curve, so
//   the replayed distribution keeps whatever shape real play produced —
//   including the lumpy multi-modal shapes that a mean±sigma model would smooth
//   away (Skee-Ball's scores cluster on multiples of its ring values; they are
//   not remotely normal).
//
// WHY NOT JUST MAKE THE NUMBERS UP
//   Because they go stale silently. Ticket formulas and game constants live in
//   src/features/fun/*.tsx and server/lib/gameRewards.js and get retuned; a
//   hand-authored distribution keeps emitting last quarter's scores and nobody
//   notices. Re-running the capture is what keeps this honest, and a profile
//   carries the date it was captured so a stale one is visible.
//
// SAFETY / ISOLATION
//   Every award is posted with a reserved session id —
//   `synthetic:<runId>:<uuid>` — which is the endpoint's idempotency key and is
//   recorded in game_ticket_award. So a whole run is bulk-deletable with zero
//   residue:
//       delete from game_ticket_award where session_id like 'synthetic:%';
//       delete from game_ticket_award where session_id like 'synthetic:<runId>:%';
//   Player ids are drawn from a reserved `synthetic-card-<n>` pool, so bot
//   awards never land on a real card, and the server's own per-card daily cap
//   applies to them exactly as it would to a real player.
//
// USAGE
//   node scripts/arcade-traffic.mjs --profile arcade-profile.json \
//     --api http://localhost:8060 --location <uuid> --plays 200 [--yes] [--dry-run]
//
//   --profile FILE     score profile from arcade-bot.mjs --out (required)
//   --api URL          API base (env FFC_API_BASE, default http://localhost:8060)
//   --location UUID    venue to award against (required)
//   --plays N          awards per sweep (default 100)
//   --players N        size of the synthetic card pool (default 25)
//   --game KEY         restrict to these games, repeatable (default: all in profile)
//   --interval-min M   minutes between sweeps (default: single sweep and exit)
//   --sweeps N         stop after N sweeps (default 1, or forever with --interval-min)
//   --concurrency N    in-flight requests (default 6)
//   --seed N           PRNG seed for a replayable run (default 1)
//   --dry-run          print the plan and sample payloads, POST nothing
//   --yes              skip the pre-flight confirmation
//
// COST
//   No third-party model calls, so no per-token spend. The run reports request
//   count, latency p50/p95/max, throughput, tickets requested vs actually
//   awarded (the server clamps), and the annualized volume the cadence projects.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { makeRng } from './lib/arcade/skill.mjs';

function parseArgs(argv) {
  const a = {
    profile: null,
    api: process.env.FFC_API_BASE || 'http://localhost:8060',
    location: null,
    plays: 100,
    players: 25,
    games: [],
    intervalMin: null,
    sweeps: null,
    concurrency: 6,
    seed: 1,
    dryRun: false,
    yes: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--profile') a.profile = next();
    else if (k === '--api') a.api = next();
    else if (k === '--location') a.location = next();
    else if (k === '--plays') a.plays = Number(next());
    else if (k === '--players') a.players = Number(next());
    else if (k === '--game') a.games.push(next());
    else if (k === '--interval-min') a.intervalMin = Number(next());
    else if (k === '--sweeps') a.sweeps = Number(next());
    else if (k === '--concurrency') a.concurrency = Number(next());
    else if (k === '--seed') a.seed = Number(next());
    else if (k === '--dry-run') a.dryRun = true;
    else if (k === '--yes') a.yes = true;
    else throw new Error(`unknown flag ${k}`);
  }
  if (!a.profile) throw new Error('--profile is required (capture one with arcade-bot.mjs --out)');
  if (!a.location) throw new Error('--location <uuid> is required');
  if (a.sweeps === null) a.sweeps = a.intervalMin ? Infinity : 1;
  return a;
}

const pct = (xs, p) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};

/** Run `tasks` with a fixed number in flight. */
async function pooled(tasks, limit) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) out.push(await tasks[i++]());
  });
  await Promise.all(workers);
  return out;
}

async function confirm(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((res) => rl.question(question, res));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

async function main() {
  const args = parseArgs(process.argv);
  const profile = JSON.parse(readFileSync(args.profile, 'utf8'));
  const rng = makeRng(args.seed);
  const runId = randomBytes(4).toString('hex');

  const keys = args.games.length ? args.games : Object.keys(profile.games);
  const pools = [];
  for (const k of keys) {
    const g = profile.games[k];
    if (!g) throw new Error(`profile has no game "${k}"`);
    const usable = g.samples.filter((s) => s.tickets >= 1);
    if (!usable.length) {
      console.warn(`  (skipping ${k}: no sample earned a ticket)`);
      continue;
    }
    pools.push({ key: k, label: g.label, samples: usable });
  }
  if (!pools.length) throw new Error('no usable games in profile');

  const ageDays = (Date.now() - Date.parse(profile.capturedAt)) / 86_400_000;

  console.log(`arcade-traffic — run ${runId}`);
  console.log(`  profile   ${args.profile} (captured ${profile.capturedAt}, ${ageDays.toFixed(1)}d old)`);
  console.log(`  games     ${pools.map((p) => `${p.key}(${p.samples.length})`).join(', ')}`);
  console.log(`  target    ${args.api}  venue ${args.location}`);
  console.log(`  volume    ${args.plays} award(s)/sweep × ${args.sweeps === Infinity ? '∞' : args.sweeps} sweep(s)`);
  console.log(`  players   ${args.players} synthetic cards`);
  if (ageDays > 30) {
    console.log('  ⚠ profile is over 30 days old — re-capture before trusting these scores');
  }

  // Pre-flight ticket estimate, from the profile's own mean tickets.
  const meanTickets = pools.reduce((t, p) => t + p.samples.reduce((s, x) => s + x.tickets, 0) / p.samples.length, 0) / pools.length;
  const perSweep = Math.round(meanTickets * args.plays);
  console.log(`  estimate  ~${perSweep} tickets/sweep requested (~${Math.round(meanTickets)}/award before server caps)`);
  console.log('  (no model/API calls — cost is request load only)\n');

  if (args.dryRun) {
    console.log('DRY RUN — sample payloads:');
    for (let i = 0; i < Math.min(3, args.plays); i++) {
      const pool = pools[Math.floor(rng() * pools.length)];
      const s = pool.samples[Math.floor(rng() * pool.samples.length)];
      console.log(
        '  ' +
          JSON.stringify({
            locationId: args.location,
            playerId: `synthetic-card-${Math.floor(rng() * args.players) + 1}`,
            game: pool.key,
            tickets: s.tickets,
            sessionId: `synthetic:${runId}:${randomUUID()}`,
          }),
      );
    }
    console.log(`\nCleanup for this run:\n  delete from game_ticket_award where session_id like 'synthetic:${runId}:%';`);
    return;
  }

  if (!args.yes) {
    const ok = await confirm(`POST ${args.plays} real award(s) per sweep to ${args.api}? [y/N] `);
    if (!ok) return console.log('aborted.');
  }

  const totals = { ok: 0, failed: 0, requested: 0, awarded: 0, clamped: 0, lat: [] };

  for (let sweep = 1; sweep <= args.sweeps; sweep++) {
    const tasks = Array.from({ length: args.plays }, () => async () => {
      const pool = pools[Math.floor(rng() * pools.length)];
      const s = pool.samples[Math.floor(rng() * pool.samples.length)];
      const body = {
        locationId: args.location,
        playerId: `synthetic-card-${Math.floor(rng() * args.players) + 1}`,
        game: pool.key,
        tickets: s.tickets,
        sessionId: `synthetic:${runId}:${randomUUID()}`,
      };
      const t0 = Date.now();
      try {
        const res = await fetch(`${args.api}/api/game-rewards/award`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        totals.lat.push(Date.now() - t0);
        totals.requested += body.tickets;
        if (!res.ok) {
          totals.failed++;
          if (totals.failed <= 3) console.log(`  ! ${res.status} ${data.error ?? ''} (${body.game})`);
          return;
        }
        totals.ok++;
        // The server decides what actually paid — always trust its number.
        const paid = Number(data.awarded ?? data.tickets ?? 0);
        totals.awarded += paid;
        if (paid < body.tickets) totals.clamped++;
      } catch (err) {
        totals.failed++;
        totals.lat.push(Date.now() - t0);
        if (totals.failed <= 3) console.log(`  ! ${err.message}`);
      }
    });

    const t0 = Date.now();
    await pooled(tasks, args.concurrency);
    const secs = (Date.now() - t0) / 1000;
    console.log(
      `sweep ${sweep}: ${totals.ok} ok / ${totals.failed} failed  ` +
        `${totals.awarded}/${totals.requested} tickets paid  ` +
        `${(args.plays / secs).toFixed(1)} req/s  ` +
        `p50 ${pct(totals.lat, 50)}ms p95 ${pct(totals.lat, 95)}ms max ${Math.max(...totals.lat, 0)}ms` +
        (totals.clamped ? `  (${totals.clamped} clamped by caps)` : ''),
    );

    if (sweep < args.sweeps && args.intervalMin) {
      const perYear = Math.round((args.plays * (60 / args.intervalMin) * 24 * 365) / 1000);
      console.log(`  cadence projects ~${perYear}k awards/year; next sweep in ${args.intervalMin} min`);
      await new Promise((r) => setTimeout(r, args.intervalMin * 60_000));
    }
  }

  console.log(
    `\nDone. ${totals.ok} awarded, ${totals.failed} failed, ` +
      `${totals.awarded} tickets paid of ${totals.requested} requested.`,
  );
  console.log(`Cleanup:\n  delete from game_ticket_award where session_id like 'synthetic:${runId}:%';`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
