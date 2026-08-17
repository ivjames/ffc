# Achievements — Brainstorm & Expansion Catalog

Last updated: 2026-08-17. A candidate catalog for growing the app's
achievements from the current three to something worth a badge wall, plus the
plumbing notes each tier needs. **Nothing here is built** — this is the menu to
pick from. Companion docs: [`post-meeting-punchlist.md`](./post-meeting-punchlist.md)
(#8, the rewards/ticket tie-in these came out of) and
[`HUNT-PRICING.md`](./HUNT-PRICING.md).

## Where we are today

Three achievements, granted server-side when a completed round first syncs
(`server/routes/rounds.js` → `server/lib/rewards.js`), one `reward_grant` row
per `(round, player_index, achievement)`, paid out as loyalty-card tickets:

| Key | Label | Earned by | Tickets |
|---|---|---|---|
| `hole_in_one` | Hole-in-One | any hole carded as a 1 | 100 |
| `under_par` | Under Par | full 18 finished below course par | 50 |
| `hunt_master` | Hunt Master | course's scavenger hunt completed | 75 |

The player-facing wall is `src/features/me/Achievements.tsx`, which re-derives
earned state from locally-stored rounds so it works offline and signed-out.

## Five facts that shape the whole design

1. **Adding an achievement key needs no migration.** `reward_grant.achievement`
   is a plain `text` column with no CHECK constraint. A new achievement is a
   pure code change: add it to `ACHIEVEMENTS` (label), optionally to
   `ACHIEVEMENT_TICKETS` (payout), and emit the grant.

2. **Omitting a key from `ACHIEVEMENT_TICKETS` makes it badge-only.**
   `achievementTickets()` returns `0` for an unpriced key and the claim endpoint
   derives payout from the stored grant, so an unpriced achievement can never
   pay — even to a tampered client. That's the safety valve that lets us ship a
   large, flavorful catalog without touching the ticket economy: **most of these
   should ship at 0 tickets.**

3. **The daily ticket cap is one shared pool** (`server/lib/dailyTickets.js`,
   default 500/card/venue/day, spanning mini-games *and* golf). A 40-badge
   catalog priced like the current three would let one good round eat a whole
   day's budget. Suggested rubric below keeps new payouts in the 5–25 range and
   leaves the existing three as the headliners.

4. **`reward_grant`'s unique key is round-scoped.** `(round_id, player_index,
   achievement)` means the table natively models *"this round earned this"*.
   Career/cumulative achievements ("play 10 rounds") don't fit — see
   [Cumulative achievements](#cumulative-achievements-the-one-structural-decision).

5. **Identity is thin by design.** Rounds are tag-attributed; `app_user_id` is
   set only when a signed-in device syncs (or retro-claims). Anything spanning
   rounds needs either sign-in or device-local detection. The existing badge
   wall already picks the device-local lane, and its footer already sells
   sign-in — that's the right split to keep.

---

## Tiers

- **T0 — free now.** Computable inside `scoreAchievements()` from the score rows
  and pars already in hand. No new queries, no new tables, and the client wall
  can detect them from `LocalRound` with the same logic.
- **T1 — one query.** Needs data we already store (`hunt_find`, round history,
  `course`/`location`, leaderboard) — a lookup in the grant path.
- **T2 — needs identity or a career store.** Cumulative/streak achievements.
- **T3 — needs new tracking.** Mini-games, photo booth, and food don't record
  per-player outcomes an achievement can read today.

Ticket rubric used below: **50–100** headliner (rare + skill-gated), **20–40**
solid, **5–15** flavor, **0** badge-only (client-scored, luck-based, or
unfalsifiable).

---

## T0 — Scoring achievements (free from score rows + pars)

These need nothing but arithmetic in `scoreAchievements()`. Highest
value-per-effort in the whole document.

| Key | Name | How to earn | Tickets |
|---|---|---|---|
| `double_ace` | Double Trouble 🎯🎯 | Two hole-in-ones in one round | 40 |
| `triple_ace` | Ace Triple 🔥 | Three hole-in-ones in one round | 75 |
| `birdie` | Birdie 🐦 | Beat par on any single hole | 5 |
| `birdie_streak` | On a Roll | Under par on 3 consecutive holes | 20 |
| `bogey_free` | Bogey-Free ✨ | Full 18 with no hole above par | 40 |
| `even_steven` | Even Steven ⚖️ | Finish a full round exactly at course par | 10 |
| `par_machine` | Par Machine 🤖 | 18 holes, every one exactly par | 50 |
| `consistent` | Metronome 🎵 | Every hole within one stroke of par | 25 |
| `front_nine` | Front Nine Fire 🔥 | Holes 1–9 under par | 15 |
| `back_nine` | Back Nine Boss 💪 | Holes 10–18 under par | 15 |
| `comeback` | Comeback Kid 📈 | +3 or worse at the turn, back nine under par | 30 |
| `hot_start` | Hot Start 🚀 | Ace hole 1 | 10 |
| `closer` | The Closer 🎬 | Ace hole 18 | 10 |
| `escape_artist` | Escape Artist 🪄 | Max out the stroke cap on a hole, ace the next | 20 |
| `survivor` | Survivor 🧗 | Hit the stroke cap (6) and still finish under par | 15 |
| `deep_red` | Deep Red 🔻 | Finish 10 or more under par | 60 |
| `photo_finish` | Photo Finish 📸 | Win a multi-player round by exactly one stroke | 15 |
| `sweep` | Clean Sweep 🧹 | Win every hole outright in a multi-player round | 50 |
| `ringer` | The Ringer 🎩 | Win a 4-player round by 10+ strokes | 25 |
| `wire_to_wire` | Wire to Wire 🏁 | Lead from hole 1 through hole 18 | 30 |
| `full_house` | Full House 🏠 | 4-player round where *everyone* finishes under par | 20 ea. |
| `party_of_four` | Party of Four 👨‍👩‍👧‍👦 | Complete a full 4-player round | 5 |
| `finisher` | Finisher 🏌️ | Complete all 18 holes of any round | 5 |
| `last_but_proud` | Good Sport 🤝 | Finish last and still card all 18 | 5 |

**Notes.** `birdie` and `finisher` are near-universal — they exist as the
"first badge" moment, so price them at flavor or zero. `sweep` and `wire_to_wire`
are the two genuinely rare ones here and deserve headliner treatment. Mini-golf
pars run 2–4, so "under par on a hole" is a real (not automatic) event.

**Anti-farm caution.** `under_par` today is repeatable every round, and several
above are too. If any of these get real ticket value, consider a
once-per-card-per-day rule for the repeatable ones — a `distinct on` over the
day in the claim path, not a schema change.

---

## T1 — Course, venue, and hunt (one query in the grant path)

### Course & venue

| Key | Name | How to earn | Notes |
|---|---|---|---|
| `course_record` | Course Record 👑 | Beat the best recorded score on that course | Leaderboard query; the single best headliner idea here. 100 tickets. |
| `dragon_slayer` | Dragon Slayer 🐉 | Finish Dragon's Hollow under par | Theme flavor, `course.theme = 'dragon'`. 25. |
| `go_west` | Yeehaw 🤠 | Finish the Western course under par | 25 |
| `grand_slam` | Grand Slam 🏆 | Under par on every course at one venue | Needs career scope — see T2. |
| `night_owl` | Night Owl 🦉 | Start a round in the last hour before close | `location.hours` + `lib/venueHours.js` already exist. 10. |
| `early_bird` | Early Bird 🐤 | Start within an hour of open | 10 |
| `marathon` | Marathon 🏃 | Two full rounds in one day | 20 |

### Scavenger hunt (`hunt_find` is keyed by `round_client_id` + `player_tag`)

| Key | Name | How to earn | Notes |
|---|---|---|---|
| `first_find` | First Find 🔍 | Any verified hunt find | The onboarding badge for the hunt. 5. |
| `eagle_eye` | Eagle Eye 👁️ | A find verified at ≥0.95 confidence | `hunt_find.confidence` already stored. 15. |
| `sharpshooter` | Sharpshooter 🎯 | 5 verified finds with no rejection between | 25 |
| `persistent` | Persistence 🧠 | Get a find verified after 3+ failed attempts on it | Failed attempts already insert rows. 10. |
| `squeaky_clean` | Above Board ✅ | Complete a hunt with zero anti-cheat flags | `hunt_find.flagged`. 15. |
| `horseshoe_hoard` | Hoarder 🧲 | 10+ finds of a single countable item | The `countable` column exists for exactly this (Western horseshoes). 20. |
| `multitasker` | Multitasker 🤹 | Complete the hunt *and* finish under par, same round | The best composite in the doc. 50. |
| `speed_hunter` | Quick Draw ⚡ | Finish the hunt before hole 10 | Needs a hole marker on the find; cheapest proxy is `hunt_find.created_at` vs. round pace. 25. |
| `grand_hunter` | Grand Hunter 🗺️ | Hunt Master on every course at a venue | Career scope — T2. |

---

## T2 — Career, streaks, and social

Everything here spans rounds. See the structural decision below before
committing to any of them.

| Key | Name | How to earn |
|---|---|---|
| `personal_best` | Personal Best 📊 | Beat your own best on that course |
| `course_collector` | Course Collector 🗂️ | Play every course at one venue |
| `road_trip` | Road Trip 🚗 | Play a round at all three venues |
| `regular` | Regular ☕ | 5 rounds at the same venue |
| `century` | Century Club 💯 | 100 holes played, lifetime |
| `streak_3` | Three-Peat 📅 | Play on three different days |
| `weekend_warrior` | Weekend Warrior 🎉 | Rounds on both days of the same weekend |
| `anniversary` | Anniversary 🎂 | A round one year after your first |
| `ticket_tycoon` | Ticket Tycoon 🎟️ | 1,000 lifetime tickets earned |
| `rivalry` | Rivalry ⚔️ | Three rounds sharing the same opponent tag |

### Social & shared games

The `shared_game` / `team` tables already carry everything these need.

| Key | Name | How to earn |
|---|---|---|
| `host` | Host 🎤 | Create a shared multi-device game that reaches completion |
| `joiner` | Crashed the Party 🎊 | Join someone else's shared game |
| `team_player` | Team Player 🧢 | Play a round under a team |
| `recruiter` | Recruiter 📨 | Send a team invite that gets accepted |
| `carded` | Carded 💳 | Link a rewards card |
| `signed_in` | Made It Official ✍️ | Create an account |
| `installed` | Home Screen Hero 📲 | Install the app |

**Note on the last three:** `installed` and `signed_in` overlap the existing
adoption bonuses (`bonus_award`, one-time tickets per card for install/sign-in).
Ship these as **badge-only** and let `bonus_award` keep owning the payout —
otherwise the same action pays twice out of two ledgers.

### Cumulative achievements — the one structural decision

`reward_grant`'s `(round_id, player_index, achievement)` key models per-round
facts. Two ways to hold career badges:

- **Grant on the crossing round.** When the round that crosses the threshold
  syncs, write a normal `reward_grant` row against it. Zero schema change, and
  the unique key still prevents duplicates (only one round can be the 100th
  hole). The cost is a per-sync history query, and it's silent for signed-out
  players.
- **A `player_achievement` table** keyed on `app_user_id` (+ `first_earned_at`,
  `progress`). Cleaner, supports progress bars ("62/100 holes"), survives the
  round record, and is the honest home for anything not round-shaped. Costs a
  migration and makes sign-in a hard requirement for those badges.

**Recommendation:** grant-on-crossing-round for the handful of career badges
worth ticket value; a `player_achievement` table only if we want progress bars
on the wall — which, for a 60-badge catalog, we probably will.

---

## T3 — Needs new tracking

### Fun-zone mini-games (19 of them)

There's no per-player game-outcome record: `game_ticket_award` stores tickets,
not performance, and games are **client-scored** — which is precisely why the
ticket registry caps them server-side. Achievements here would be
self-reported, so **all of these should be badge-only at 0 tickets**, or skipped.

| Name | How to earn |
|---|---|
| Arcade Rookie 🕹️ | Play any fun-zone game |
| Sampler 🎪 | Play 5 different games |
| Completionist 🏅 | Play all 19 |
| Maxed Out 📈 | Hit a game's per-round ticket ceiling |
| Trivia Buff 🧠 | Perfect trivia round |
| Turkey 🎳 | Three bowling strikes in a row |
| Bullseye 🎯 | Darts bullseye |
| Bell Ringer 🔔 | Max the high striker |
| Pinball Wizard 🧙 | Beat a pinball score threshold |

The cheapest honest version: a device-local "games played" set in IndexedDB
driving badge-wall state only, with nothing sent to the server. That keeps the
trust boundary exactly where it is.

### Photo booth

`booth_photo` rows are keyed by an unguessable per-device `booth_id`, not a
player — so these are naturally device-local too.

| Name | How to earn |
|---|---|
| Say Cheese 📷 | Save your first booth photo |
| Sticker Bomb 🌈 | Place 10+ stickers on one photo |
| Framed 🖼️ | Use a venue frame |
| Photogenic 🤳 | Save 5 photos |

### Food

| Name | How to earn |
|---|---|
| Refueled 🍔 | Place a food order from the app |
| Turn Snack 🌭 | Order mid-round (between holes 9 and 10) |

---

## Deliberately not recommended

- **Birthday Round.** Requires storing a date of birth. The `app_user` table has
  already had `phone` removed on the grounds that data collected without a
  purpose is pure liability; a DOB for one badge is the same trade.
- **Coin Pusher achievements.** The coin pusher is deliberately excluded from
  the ticket registry as pure chance (PR #140). A badge for it re-opens the
  skill-only decision through the back door.
- **Anything paying tickets off client-scored input.** See T3.

---

## Implementation notes, if we pick a slate

1. **One catalog, two consumers.** `server/lib/rewards.js` and
   `src/features/me/Achievements.tsx` currently hold parallel hand-maintained
   lists, and the server file's own comment admits it ("the player app carries
   its own copy of the same labels"). Three entries is fine; sixty is a drift
   bug waiting to happen. Extract a shared catalog — key, label, emoji, blurb,
   category, tickets, detectable-locally — and generate both sides from it
   before the list grows.
2. **The wall needs grouping.** `Achievements.tsx` renders one flat `<ul>` and a
   header reading "*N* of *M* unlocked". At 60 badges that's a scroll of
   greyed-out boxes. Group by category with per-section counts, and sort earned
   first within each.
3. **Locked-badge copy.** With a big catalog, some badges are better shown as
   "???" until earned — the discovery is half the point. Worth a `secret` flag
   on the catalog entry.
4. **Synthetic rounds mint grants too.** The bot writes through the real
   `/api/rounds` path, so every new achievement gets minted by
   `scripts/course-bot.mjs` runs. That's already a runtime choice
   (`lib/syntheticConfig.js`) — just don't be surprised by the issuance rollup.
5. **Pricing review before payout.** Any key that lands in
   `ACHIEVEMENT_TICKETS` should be sanity-checked against the 500/day shared
   cap with a realistic round. Shipping the whole catalog at 0 tickets first,
   then promoting a few after watching real issuance, is the low-risk order.

## Suggested first slate

If the point is maximum visible payoff for minimum plumbing: ship the **24 T0
scoring achievements** (pure arithmetic, no queries, client wall detects them
all offline) plus the **six cheap hunt badges** — all at 0–15 tickets, leaving
the existing three as the headliners. That's a wall that goes from 3 badges to
33 with no migration and no new trust surface.
