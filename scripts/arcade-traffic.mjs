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
// PLAYER IDS ARE NOT SYNTHETIC
//   `playerId` is a LOYALTY VENDOR card id, and the award route forwards it
//   straight to the vendor (routes/gameRewards.js → lib/posLoyalty.js). Made-up
//   ids do not work: the CenterEdge mock 404s any unseeded player, so the award
//   comes back 502 and leaves a 'pending' reservation holding daily-cap budget.
//   So pass real test-card ids with --player-id (repeatable) or --players-file.
//   The `synthetic-card-<n>` fallback pool exists only so --dry-run can show the
//   shape of a payload; using it against a live API is expected to fail, and the
//   script says so before it posts anything.
//
// SAFETY / ISOLATION, AND THE LIMIT OF IT
//   Every award is posted with a reserved session id —
//   `synthetic:<runId>:<uuid>` — which is the endpoint's idempotency key and is
//   recorded in game_ticket_award, so OUR ledger rows are bulk-deletable:
//       delete from game_ticket_award where session_id like 'synthetic:<runId>:%';
//
//   That is not full cleanup, and this script does not claim it is. A settled
//   award has already credited the loyalty VENDOR (a balance increase plus a
//   vendor transaction), which no local delete can undo — reversing that needs
//   the vendor's own tooling, or a disposable card pool you can reset. Worse,
//   deleting the ledger row also drops the idempotency record, so a later run
//   replaying the same session ids could credit the vendor a second time.
//   Treat the delete as "reset our side"; reverse or discard the cards
//   separately.
//
// USAGE
//   node scripts/arcade-traffic.mjs --profile arcade-profile.json \
//     --api http://localhost:8060 --location <uuid> \
//     --player-id <card> --plays 200 [--yes] [--dry-run]
//
//   --profile FILE     score profile from arcade-bot.mjs --out (required)
//   --api URL          API base (env FFC_API_BASE, default http://localhost:8060)
//   --location UUID    venue to award against (required)
//   --plays N          awards per sweep (default 100)
//   --player-id ID     a real loyalty card id to award against, repeatable
//   --players-file F   file of card ids, one per line (blank/# lines ignored)
//   --players N        size of the placeholder pool when no real ids are given
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
    playerIds: [],
    playersFile: null,
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
    else if (k === '--player-id') a.playerIds.push(next());
    else if (k === '--players-file') a.playersFile = next();
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

function printCleanup(runId, realCards) {
  console.log(`\nCleanup (our side only):`);
  console.log(`  delete from game_ticket_award where session_id like 'synthetic:${runId}:%';`);
  if (realCards) {
    console.log(
      '  ⚠ This clears OUR ledger, not the loyalty vendor. Settled awards have\n' +
        '    already credited each card\'s balance and written a vendor transaction,\n' +
        '    which no local delete undoes — reverse those with the vendor\'s own\n' +
        '    tooling, or use disposable cards you can reset.\n' +
        '  ⚠ The delete also drops the idempotency records, so replaying these\n' +
        '    session ids afterwards could credit the vendor a second time.',
    );
  }
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

  // Real vendor card ids if supplied; otherwise a clearly-labelled placeholder
  // pool that only makes sense for --dry-run (see the header note).
  let cards = [...args.playerIds];
  if (args.playersFile) {
    for (const line of readFileSync(args.playersFile, 'utf8').split(/\r?\n/)) {
      const id = line.trim();
      if (id && !id.startsWith('#')) cards.push(id);
    }
  }
  const realCards = cards.length > 0;
  if (!realCards) {
    cards = Array.from({ length: args.players }, (_, i) => `synthetic-card-${i + 1}`);
  }

  console.log(`arcade-traffic — run ${runId}`);
  console.log(`  profile   ${args.profile} (captured ${profile.capturedAt}, ${ageDays.toFixed(1)}d old)`);
  console.log(`  games     ${pools.map((p) => `${p.key}(${p.samples.length})`).join(', ')}`);
  console.log(`  target    ${args.api}  venue ${args.location}`);
  console.log(`  volume    ${args.plays} award(s)/sweep × ${args.sweeps === Infinity ? '∞' : args.sweeps} sweep(s)`);
  console.log(
    `  players   ${cards.length} card(s)` +
      (realCards ? '' : ' — PLACEHOLDER ids, not real loyalty cards'),
  );
  if (ageDays > 30) {
    console.log('  ⚠ profile is over 30 days old — re-capture before trusting these scores');
  }
  if (!realCards && !args.dryRun) {
    // Fail loudly rather than posting a few hundred requests that all 502 and
    // leave 'pending' reservations eating the venue's daily-cap budget.
    console.error(
      '\n  ✗ No real card ids given. playerId is a LOYALTY VENDOR card id and the\n' +
        '    award route forwards it to the vendor, which rejects unknown cards —\n' +
        '    every request would 502 and leave a pending reservation behind.\n' +
        '    Pass --player-id <card> (repeatable) or --players-file <file>,\n' +
        '    or use --dry-run to inspect payloads without posting.',
    );
    process.exitCode = 1;
    return;
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
            playerId: cards[Math.floor(rng() * cards.length)],
            game: pool.key,
            tickets: s.tickets,
            sessionId: `synthetic:${runId}:${randomUUID()}`,
          }),
      );
    }
    printCleanup(runId, realCards);
    return;
  }

  if (!args.yes) {
    const ok = await confirm(`POST ${args.plays} real award(s) per sweep to ${args.api}? [y/N] `);
    if (!ok) return console.log('aborted.');
  }

  const fresh = () => ({ ok: 0, failed: 0, requested: 0, awarded: 0, clamped: 0, capped: 0, lat: [] });
  // Per-sweep counters are what the sweep line reports; run totals accumulate
  // for the final summary. Reporting cumulative numbers under a sweep's label
  // would hide exactly what a multi-sweep run is for — whether behaviour drifts
  // between sweeps as daily caps fill up.
  const totals = fresh();

  for (let sweep = 1; sweep <= args.sweeps; sweep++) {
    const m = fresh();
    const tasks = Array.from({ length: args.plays }, () => async () => {
      const pool = pools[Math.floor(rng() * pools.length)];
      const s = pool.samples[Math.floor(rng() * pool.samples.length)];
      const body = {
        locationId: args.location,
        playerId: cards[Math.floor(rng() * cards.length)],
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
        m.lat.push(Date.now() - t0);
        m.requested += body.tickets;
        if (!res.ok) {
          m.failed++;
          if (m.failed <= 3) console.log(`  ! ${res.status} ${data.error ?? ''} (${body.game})`);
          return;
        }
        m.ok++;
        // The server decides what actually paid, and names it `ticketsAwarded`
        // (routes/gameRewards.js). It also reports `capped` itself, and answers
        // status 'daily-cap' with zero when the card's budget is spent — so both
        // kinds of clamping are counted from the server's own words.
        m.awarded += Number(data.ticketsAwarded ?? 0);
        if (data.capped === true) m.capped++;
        if (data.status === 'daily-cap') m.clamped++;
      } catch (err) {
        m.failed++;
        m.lat.push(Date.now() - t0);
        if (m.failed <= 3) console.log(`  ! ${err.message}`);
      }
    });

    const t0 = Date.now();
    await pooled(tasks, args.concurrency);
    const secs = (Date.now() - t0) / 1000;
    console.log(
      `sweep ${sweep}: ${m.ok} ok / ${m.failed} failed  ` +
        `${m.awarded}/${m.requested} tickets paid  ` +
        `${(args.plays / secs).toFixed(1)} req/s  ` +
        `p50 ${pct(m.lat, 50)}ms p95 ${pct(m.lat, 95)}ms max ${Math.max(...m.lat, 0)}ms` +
        (m.capped ? `  (${m.capped} trimmed to per-round cap)` : '') +
        (m.clamped ? `  (${m.clamped} hit the daily cap)` : ''),
    );

    for (const k of ['ok', 'failed', 'requested', 'awarded', 'clamped', 'capped']) totals[k] += m[k];
    totals.lat.push(...m.lat);

    if (sweep < args.sweeps && args.intervalMin) {
      const perYear = Math.round((args.plays * (60 / args.intervalMin) * 24 * 365) / 1000);
      console.log(`  cadence projects ~${perYear}k awards/year; next sweep in ${args.intervalMin} min`);
      await new Promise((r) => setTimeout(r, args.intervalMin * 60_000));
    }
  }

  console.log(
    `\nDone. ${totals.ok} awarded, ${totals.failed} failed, ` +
      `${totals.awarded} tickets paid of ${totals.requested} requested` +
      (totals.capped || totals.clamped
        ? ` (${totals.capped} per-round trims, ${totals.clamped} daily-cap zeros).`
        : '.'),
  );
  printCleanup(runId, realCards);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
