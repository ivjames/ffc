# Arcade bot — synthetic arcade traffic

Two scripts, in a deliberate order:

1. **`scripts/arcade-bot.mjs`** opens the real games in headless Chromium and
   *plays* them, then writes a **score profile**.
2. **`scripts/arcade-traffic.mjs`** replays that profile against
   `POST /api/game-rewards/award` at a volume a browser could never reach.

The browser earns the numbers; the fast path reuses them. That split is the
whole design: playing every synthetic round in a browser caps throughput at
~2.5 rounds/min, while inventing score distributions by hand goes stale the
moment someone retunes a game and nobody notices.

## How it plays

Each game's launch is a closed-form function of the input gesture, so the bot
**inverts the game's own physics** to find the gesture that hits a chosen
target, then perturbs that aim by a skill-scaled amount *before* committing —
the same way a real player misjudges a line and finds out when the ball lands.
Everything after the release is the shipped game reacting to a slightly-wrong
input.

So score realism is *derived from the game*, not authored next to it. Skill is
one knob in `[0,1]`; the distributions fall out.

Skee-Ball is the reference derivation. Its apex model reduces to

```
land.x = X0 - 2·ux·uy·s²        land.y = Y0 - uy²·s²
```

so for a target `(tx,ty)`, with `k = (X0-tx) / (2·(Y0-ty))`:

```
û = (-k,-1)/√(k²+1)             s = √((Y0-ty)·(k²+1))
```

which is exact and lands every ring inside the legal speed band.

**Timing games** can't be dead-reckoned: the sweep phase lives in a React ref
that's re-based from a rAF frame. So the bot *looks at the screen* — it reads
the guide straight off the canvas with `getImageData`, inverts the draw code to
recover the live value, samples twice to get direction, and schedules the tap.

For High Striker that's the power meter's fill height, re-measured every swing
so phase error never accumulates. It rings the bell (100/100) reliably.

Axe Throw and Darts are **two-axis** timing games — a vertical guide sweeps for
x, then a horizontal one for y — and they get solved by two different means,
because the games hand us a freebie:

- **x** — phase unknown, so probe the amber guide line and schedule, as above.
- **y** — phase *known*. Locking x runs `gs.sweepBase = now` inside the
  pointerdown handler, so the vertical sweep restarts from the bot's own tap.
  Its phase is whatever the clock said when we pressed, making the y lock plain
  dead reckoning off a timestamp we measured ourselves — no second probe.

The guide finder takes the intensity-weighted centroid of the amber run rather
than the single best pixel, which recovers the line to well under a pixel. It's
deliberately strict about what counts as amber: the boards carry warm browns and
low-alpha sparkle, and a nearest-colour match would happily lock onto those when
the guide isn't drawn at all.

## Coverage

Supported: `skeeball`, `ringtoss`, `popashot`, `highstriker`, `axethrow`,
`darts`, `whackamole`, `bowling`, `shootinggallery` — 9 of the 19 games in the server's earning registry. Run `node scripts/arcade-bot.mjs --list` for the current list and, more
usefully, for *why* each unsupported game isn't in it.

The gap is narrowing rather than fixed. Whack-a-Mole was the first REACTIVE
game — targets that are live state, not fixed geometry — and it works by
sampling all nine holes in one round trip and acting on what is there. Its holes
are a known 3×3 grid, so nothing has to be tracked frame to frame; games with
genuinely moving entities (a duck on a rail, a puck, a pinball) need the
position recovered from pixels and predicted forward, which is the next step up.

Still out: air hockey, batting cages, pinball, water gun and the driving games; bowling and milk
bottle, whose aim inverts but whose scatter is a sim (bowling is now in, by
CALIBRATING the line rather than solving it — see its policy); claw machine, whose sweep is solvable but whose prize
positions come from a physics pile; and trivia, which is knowledge rather than a
gesture.

Measured, expert vs beginner (`--skill 1` vs `--skill 0.15`):

| Game | Expert | Beginner | Round max |
| --- | --- | --- | --- |
| Skee-Ball | 570–820 | 30–90 | 900 |
| Ring Toss | 16–31 | 0–4 | 40 |
| Pop-a-Shot | 69–72 | — | (45s clock) |
| High Striker | 100 | 100 | 100 |
| Axe Throw | 27–31 | 17–20 | 35 |
| Darts | 286–370 | 154–175 | 540 |
| Whack-a-Mole | 48–53 | — | (30s clock) |
| Bowling | 300 | 126 | 300 |
| Shooting Gallery | 1085–1105 | — | (45s clock) |

Two honest caveats:

- **High Striker's headline is the best of five swings**, which compresses
  scores toward 100 regardless of skill. That's the game's shape, not a bot
  artifact, and it's left alone rather than faked into a wider spread.
- **Axe Throw's spread is narrow** because any hit inside the outer ring scores.
  A beginner still hits the board — which is also true of real axe throwing.

Darts is the least forgiving, by design: the treble band is 12px deep and sector
20's neighbours are 1 and 5, so missing the treble sideways scores 1 instead of
60. That cruelty is the real dartboard's, and it makes the distribution wide and
lumpy in exactly the way real darts is.

## Usage

```bash
# capture a profile (needs the app running — npm run dev)
node scripts/arcade-bot.mjs --rounds 20 --out arcade-profile.json

# replay it at volume (dry run first)
node scripts/arcade-traffic.mjs --profile arcade-profile.json \
  --location <venue-uuid> --player-id <card> --plays 200 --dry-run
```

`--skill N` fixes ability instead of sampling a player mix; `--seed N` makes a
run replayable; `--headed` lets you watch it play.

To watch it on a machine with no display — CI, a remote dev container — record
the session instead, since `--headed` has nothing to display to there:

```bash
node scripts/arcade-bot.mjs --game skeeball --skill 1 --video ./vid   # → ./vid/*.webm
```

## Player ids are real loyalty cards

`playerId` is a **loyalty vendor card id**, and the award route forwards it
straight to the vendor. Made-up ids don't work — the CenterEdge mock 404s any
unseeded player, so the award comes back 502 and leaves a `pending` reservation
holding daily-cap budget.

So pass real test-card ids with `--player-id` (repeatable) or `--players-file`.
The `synthetic-card-<n>` fallback exists only so `--dry-run` can show a payload's
shape; the script refuses to post with it and says why.

## Safety and cleanup

Every award posts with a reserved session id, `synthetic:<runId>:<uuid>` — the
endpoint's idempotency key, recorded in `game_ticket_award` — so our ledger rows
are bulk-deletable:

```sql
delete from game_ticket_award where session_id like 'synthetic:<runId>:%';   -- one run
delete from game_ticket_award where session_id like 'synthetic:%';           -- all bot awards
```

**That is not full cleanup, and the script doesn't claim it is.** A settled award
has already credited the loyalty *vendor* — a balance increase plus a vendor
transaction — which no local delete undoes. Reverse those with the vendor's own
tooling, or use disposable cards you can reset. The delete also drops the
idempotency records, so replaying the same session ids afterwards could credit
the vendor twice. Treat it as "reset our side".

The server's per-game ceiling and per-card daily cap apply to bot traffic exactly
as they do to real players, and each sweep reports tickets *paid* vs *requested*
— read from the server's own `ticketsAwarded` and `capped` fields — so both kinds
of clamping are visible. Per-sweep counters are per sweep, not cumulative, so a
multi-sweep run shows drift as daily caps fill up.

Both scripts report request/round counts, latency percentiles, throughput and
projected annual volume. Neither makes third-party model calls, so there is no
per-token spend — the cost is wall clock and request load.

## It doubles as a regression harness

`--assert-skill` fails the run if an expert bot can't clear each game's score
floor. A game whose constants changed underneath the solver stops landing its
target, which is a cheap smoke test that every game is still playable at all.
It implies `--skill 1` (an explicit `--skill` still wins) — the floors are expert
floors, so sampling the ordinary player mix would fail healthy games at random.

## Keeping it honest

A profile records `capturedAt`, and `arcade-traffic.mjs` warns when one is over
30 days old. Re-capture after retuning any game's constants or ticket formula.
