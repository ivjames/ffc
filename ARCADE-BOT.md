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
`darts`, `whackamole`, `bowling`, `shootinggallery`, `clawmachine`,
`battingcages`, `watergunrace`, `trivia`, `milkbottle`, `airhockey`, `pinball`,
`bumpercars`, `bumperboats`, `gokarts` — **all 19** games in the server's earning registry. Run `node scripts/arcade-bot.mjs --list` for the current list and, more
usefully, for *why* each unsupported game isn't in it.

The gap is narrowing rather than fixed. Whack-a-Mole was the first REACTIVE
game — targets that are live state, not fixed geometry — and it works by
sampling all nine holes in one round trip and acting on what is there. Its holes
are a known 3×3 grid, so nothing has to be tracked frame to frame; games with
genuinely moving entities (a duck on a rail, a puck, a pinball) need the
position recovered from pixels and predicted forward, which is the next step up.

Every game in the server's earning registry now has a policy. Go-Karts is the
weakest of them: it completes races but its lap times are dominated by barrier
scraping and the opening wrong-way stall rather than by the skill knob, so its
expert/beginner ordering is **not** established (78s vs 55–86s). A best lap of
~6.5s is achievable against the ~25s it turns, so a centred racing line is the
open work there.

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
| Claw Machine | 45–55 | 20–55 | 80 |
| Batting Cages | 40 | 14–22 | 40 |
| Water Gun Race | 2 (sweeps) | 0 | 3 heats |
| Trivia | 10/10 | 3/10 | 10 |
| Milk Bottle | 27–33 | 21–27 | 33 |
| Air Hockey | 7 (wins) | 0–1 | 7 goals |
| Pinball | 8010 mean | 6800 mean | — (high variance) |
| Bumper Cars | 24–30 | 16–22 | (30s clock) |
| Bumper Boats | 19–31 | 15–17 | (30s clock) |
| Go-Karts | 78s | 55–86s | (time — lower is better) |

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

Trivia reads its answer bank from `src/data/funContent.ts`, which needs
**Node 22.6+** for type stripping. On an older Node the bot says so and plays
trivia by guessing; every other game is unaffected.

```bash
# capture a profile (needs the app running — npm run dev)
node scripts/arcade-bot.mjs --rounds 20 --out arcade-profile.json

# replay it at volume (dry run first)
node scripts/arcade-traffic.mjs --profile arcade-profile.json \
  --location <venue-uuid> --players 8 --plays 200 --dry-run
```

`--skill N` fixes ability instead of sampling a player mix; `--seed N` makes a
run replayable; `--headed` lets you watch it play.

### Leave the skill knob alone

**The default — no `--skill` at all — is the right one for traffic.** It draws
each round's ability from a player population (`sampleSkill`): a bell around
0.5 with a thin good tail, because most arcade play is casual. A measured
10-round Skee-Ball capture came out skill 0.30–0.74, mean 0.51, scoring 50–360
against an expert's 780 — about 15 tickets an award rather than 89.

`--skill 1` exists for the regression harness (`--assert-skill`, below), not
for generating traffic. It matters because **a profile is a recording**: replay
resamples the captured rounds, so a profile captured at a fixed skill pays that
same standard of play forever. Master Control's profile picker labels each
profile with the skill spread it will replay as, and says so out loud when one
is fixed.

### From Master Control

Both halves are also driven from the admin: **Master Control → Ops → Arcade
bot** (super_admin only). Capture and replay are separate processes with their
own status, live log tail and stop button, so both can run at once.

- Capture writes into `data/arcade-profiles/`, and replay's profile picker reads
  that directory back — so the two steps chain without touching a shell. The
  newest profile is preselected.
- **Capture needs a browser on the API host**, which an API box has no reason to
  ship. When there isn't one the page says so and the button stays disabled
  rather than spawning a run that dies on a Playwright stack trace. Capture on a
  workstation and drop the profile JSON into `data/arcade-profiles/` instead.
- The venue picker flags venues with game rewards switched off — awards to those
  come back 403 — and replay always talks to the API over loopback, never out
  through a proxy or to another host.
- The capture form shows a pre-flight estimate summed from the bot's own
  per-game `estRoundMs`, because the games are nowhere near equal: a full
  one-round pass over all 19 is ~20 minutes, and Go-Karts alone is ~3 min a
  round against Skee-Ball's ~20s.
- Each profile is listed with its game/round counts and the skill spread it
  will replay as — `skill 0.30–0.74 (mean 0.51)` or a flagged `fixed skill
  1.00`. A profile that recorded 0 rounds (a capture whose app went down
  mid-run still writes one) is refused rather than replayed as silence.

The child processes are started with `FFC_EXIT_WITH_PARENT=1` and killed on API
shutdown, so a bot can't outlive the API that's reporting on it.

To watch it on a machine with no display — CI, a remote dev container — record
the session instead, since `--headed` has nothing to display to there:

```bash
node scripts/arcade-bot.mjs --game skeeball --skill 1 --video ./vid   # → ./vid/*.webm
```

## Awards ride a signed-in session — there is no `playerId`

The award route is `tenant(), requireUser` and resolves the card from the
**session**, not the request: *"the card is the session's, never the request's"*.
Posting a `playerId` does nothing; posting without a cookie is a flat 401. So
each synthetic player is a real account, minted before any award:

```
POST /api/auth/request-code  {email}        -> {bypassCode}
POST /api/auth/verify        {email, code}  -> session cookie
POST /api/loyalty/link       {locationId, cardNumber}
POST /api/game-rewards/award {locationId, game, tickets, sessionId}
```

`--players N` fabricates N cards at the loyalty vendor and signs an account in
for each, so no card list is needed. `N` is the pool SIZE, not "mint N more":
cached sessions count toward it and are reused first, so `--players 0` against
a warm cache runs with no auth calls at all. Against a real vendor — which issues cards
at a counter, not over an API — pass existing numbers with `--card` /
`--cards-file` instead. Either way a card the vendor doesn't know fails at link
time, before anything is posted.

**The pool is rate-limited.** `/api/auth/request-code` allows 10 per IP per
hour, so a single run can mint at most 10 new accounts and refuses more up
front. Sessions are cached to `--sessions-file` and reused free on later runs,
so the pool grows across runs and a warm one costs no auth calls at all.

The bypass code is only returned when no mail provider is configured and
`NODE_ENV` isn't production — the dev/staging shape this tool is for. Against a
mail-configured deployment, sessions can't be minted from a script; the run
refuses to start and asks for `--cookie` values from real sessions.

### Verified end to end

Against a local stack (Postgres + `ffc-api` + the CenterEdge mock): 20 awards
across 2 cards, 20 ok / 0 failed, 157 req/s, 761 of 805 tickets paid — the
shortfall being one per-round trim and one daily-cap zero, both fired by the
server. Ledger rows matched, and the vendor balances moved (PL-1001 4380 →
4880), confirming the awards reached the POS and not just our table.

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
