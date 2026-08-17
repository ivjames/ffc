# Achievements — Brainstorm & Expansion Catalog

Last updated: 2026-08-17. A candidate catalog for growing the app's
achievements from the current three into a real badge wall. **Nothing here is
built** — this is the menu to pick from.

**Premise: achievements pay no tickets.** They are a collection and status
layer, not a currency. That decision is what makes the rest of this document
possible, so the reasoning is up front. Companion docs:
[`post-meeting-punchlist.md`](./post-meeting-punchlist.md) (#8, the
rewards/ticket tie-in these came out of) and [`HUNT-PRICING.md`](./HUNT-PRICING.md).

## Where we are today

Three achievements, granted server-side when a completed round first syncs
(`server/routes/rounds.js` → `server/lib/rewards.js`), one `reward_grant` row
per `(round, player_index, achievement)`, paid out as loyalty-card tickets at
100 / 50 / 75 for `hole_in_one` / `under_par` / `hunt_master`. The player-facing
wall is `src/features/me/Achievements.tsx`, which re-derives earned state from
locally-stored rounds so it works offline and signed-out.

---

## Why "no tickets" is the right call

Every genuinely hard problem in the first draft of this document was a *payout*
problem, not an achievement problem:

- The per-card daily ticket cap is **one shared pool** across mini-games and
  golf (`server/lib/dailyTickets.js`, default 500). A large catalog priced like
  the current three lets a single good round eat a whole day's budget, so every
  new badge needed a pricing review against a realistic round.
- Repeatable achievements needed **anti-farm clamps** (once-per-day rules in the
  claim path) that don't otherwise need to exist.
- **Client-scored surfaces were off-limits.** The 19 fun-zone games score
  themselves in the browser — that's exactly why `server/lib/gameRewards.js`
  caps them server-side. Any badge that pays can't trust them, which walled off
  the single richest source of achievement material in the app.
- `installed` / `signed_in` badges **collided with `bonus_award`**, which
  already pays one-time install and sign-in tickets. Same action, two ledgers.
- The coin pusher is **deliberately excluded** from the ticket registry as pure
  chance (PR #140). A paying badge for it re-opens a settled decision.

All five vanish when nothing pays. What's left is content design.

Three further wins worth naming:

1. **The trust boundary disappears.** Achievements are server-granted today
   because they mint value. Badge-only achievements can be computed entirely
   client-side from IndexedDB — which is exactly what `Achievements.tsx`
   already does for two of the three. No new endpoints, no grant logic in the
   sync path, no idempotency keys, no issuance pollution from synthetic bot
   rounds.
2. **Fairness stops mattering.** Under-par on the Blue Course is not the same
   feat as under-par on Dragon's Hollow, and pricing that honestly is genuinely
   hard. A badge doesn't need to be fair — it needs to be fun. Nobody complains
   that a rare badge is rare.
3. **It becomes a product decision, not a business one.** While badges pay, every
   badge is a venue-economics question needing sign-off. Unpaid, the catalog is
   ours to iterate on freely.

### What it costs, and the one real fork

Punchlist #8 was explicitly *"Rewards/tickets tie in"* — the venue asked for
golf to feed the loyalty economy. So: **does "no tickets" include the existing
three, or only new ones?**

- **Keep the three paying.** Smallest change: the shipped claim lane keeps
  working, #8 stays satisfied, and only new badges are status-only. The cost is
  a permanently two-class catalog — three special achievements and ninety
  ordinary ones — which is confusing to explain on the wall.
- **Nothing pays at all.** Conceptually clean: *achievements are status, tickets
  are for playing.* But it retires a working, venue-requested feature and leaves
  `POST /api/rewards/claim`, `src/lib/pos/golfRewards.ts`, the golf half of
  `dailyTickets.js`, `reward_grant`'s payout columns, and Master Control's golf
  issuance rollup as dead code. Golf would stop feeding the ticket economy
  entirely; only mini-games and adoption bonuses still would.

**Recommendation — decouple instead of deleting.** Move the golf payout off
achievements and onto the round itself: *finish a round, earn N tickets*,
optionally scaled by holes completed. That keeps #8's intent intact (golf feeds
the economy), is far easier to explain to a family at the counter, doesn't
distort play toward one scoring outcome, caps trivially, and frees the
achievement catalog completely. The existing `reward_grant` plumbing is reusable
almost as-is — it becomes one grant per completed round instead of one per
achievement.

If that's too big a swing for now, keep the three paying and ship everything new
as badge-only; the wall can mark the paying three with a ticket icon and the
two-class problem stays legible.

---

## What changes architecturally

Without payout, the useful question stops being *"can the server verify this?"*
and becomes *"where can we detect it?"* Three detection sites:

- **Local** — computable in the browser from `LocalRound` in IndexedDB. Zero
  backend work. Works offline and signed-out. This is where most of the catalog
  should live.
- **Server** — needs data only the API holds (`hunt_find`, round history across
  devices, leaderboards, venue hours).
- **New** — needs tracking that doesn't exist yet, almost always a small
  device-local counter (games played, photos saved) rather than a schema change.

Legend below: **L** local · **S** server · **N** needs new tracking.
★ marks the ones worth building first.

---

## Golf — scoring & skill

Pure arithmetic over score rows and pars. All local, all free.

| Name | How to earn | |
|---|---|---|
| ★ Hole-in-One 🎯 | Sink any hole in one | L |
| ★ Under Par ⛳ | Finish a full round below course par | L |
| Double Trouble 🎯🎯 | Two aces in one round | L |
| Ace Triple 🔥 | Three aces in one round | L |
| Birdie 🐦 | Beat par on any single hole | L |
| On a Roll 📈 | Under par on three consecutive holes | L |
| ★ Bogey-Free ✨ | Full 18 with no hole above par | L |
| Even Steven ⚖️ | Finish a full round exactly at course par | L |
| Par Machine 🤖 | 18 holes, every one exactly par | L |
| Metronome 🎵 | Every hole within one stroke of par | L |
| Front Nine Fire 🔥 | Holes 1–9 under par | L |
| Back Nine Boss 💪 | Holes 10–18 under par | L |
| ★ Comeback Kid 🚀 | +3 or worse at the turn, back nine under par | L |
| Hot Start ⚡ | Ace hole 1 | L |
| The Closer 🎬 | Ace hole 18 | L |
| Escape Artist 🪄 | Max out the stroke cap on a hole, ace the next | L |
| Survivor 🧗 | Hit the 6-stroke cap and still finish under par | L |
| Deep Red 🔻 | Finish 10 or more under par | L |
| Bookends 📚 | Ace both hole 1 and hole 18 in one round | L |
| Halfway Hero 🥁 | Ace hole 9 | L |
| Threading It 🧵 | Beat par on every par-4 hole | L |
| Perfect Nine 💎 | Nine consecutive holes at or under par | L |

## Golf — round shape & drama

Multi-player facts, still all local — the whole roster's scores are on the
device.

| Name | How to earn | |
|---|---|---|
| Party of Four 👨‍👩‍👧‍👦 | Complete a full 4-player round | L |
| Photo Finish 📸 | Win a multi-player round by exactly one stroke | L |
| ★ Clean Sweep 🧹 | Win every hole outright in a multi-player round | L |
| ★ Wire to Wire 🏁 | Lead from hole 1 through hole 18 | L |
| The Ringer 🎩 | Win a 4-player round by 10+ strokes | L |
| Full House 🏠 | 4-player round where everyone finishes under par | L |
| Dead Heat 🤝 | Finish a round exactly tied at the top | L |
| Come From Behind 🐢 | Trail after 17 holes, win on 18 | L |
| Photo Bomb 💥 | Ace a hole where everyone else bogeys it | L |
| Underdog 🐕 | Win a round in which you never led until the final hole | L |

## Golf — wipeouts & humor

Anti-achievements. These only work *because* nothing pays — a badge for playing
badly would be perverse if it minted tickets, and it's delightful when it
doesn't. Bullwinkle's is a family venue; leaning into the bad rounds is on-brand.

| Name | How to earn | |
|---|---|---|
| Capped Out 🧱 | Hit the 6-stroke cap on five holes in one round | L |
| Rock Bottom 🕳️ | Max out the cap on every hole of a round | L |
| The Long Way 🐌 | Finish 20 or more over par | L |
| Windmill's Revenge 🌀 | Cap out the same hole in two different rounds | L |
| Good Sport 🤝 | Finish last and still card all 18 | L |
| Consolation Prize 🥉 | Finish last three rounds in a row | L |
| So Close 😤 | Finish exactly one stroke over course par | L |
| Rally Killer 🧊 | Cap out immediately after an ace | L |

## Courses & venues

| Name | How to earn | |
|---|---|---|
| Dragon Slayer 🐉 | Finish Dragon's Hollow under par | L |
| Yeehaw 🤠 | Finish the Western course under par | L |
| Golden State ☀️ | Finish the California course under par | L |
| Old School 🕰️ | Finish the Classic course under par | L |
| Course Collector 🗂️ | Play every course at one venue | L |
| ★ Road Trip 🚗 | Play a round at all three venues | L |
| Grand Slam 🏆 | Under par on every course at one venue | L |
| ★ Course Record 👑 | Beat the best recorded score on that course | S |
| Personal Best 📊 | Beat your own best on that course | L |
| Night Owl 🦉 | Start a round in the last hour before close | S |
| Early Bird 🐤 | Start within an hour of opening | S |
| Marathon 🏃 | Two full rounds in one day | L |
| Regular ☕ | Five rounds at the same venue | L |

`location.hours` and `lib/venueHours.js` already exist, so the time-of-day pair
is a lookup, not new infrastructure.

## Scavenger hunt

`hunt_find` already stores `confidence`, `flagged`, and `countable` — several of
these are nearly free server-side.

| Name | How to earn | |
|---|---|---|
| ★ Hunt Master 🕵️ | Complete a course's scavenger hunt | S |
| First Find 🔍 | Any verified find | S |
| Eagle Eye 👁️ | A find verified at ≥0.95 confidence | S |
| Sharpshooter 🎯 | Five verified finds with no rejection between | S |
| Persistence 🧠 | Get a find verified after 3+ failed attempts on it | S |
| Above Board ✅ | Complete a hunt with zero anti-cheat flags | S |
| Hoarder 🧲 | Ten or more finds of a single countable item | S |
| ★ Multitasker 🤹 | Complete the hunt *and* finish under par, same round | S |
| Quick Draw ⚡ | Finish the hunt before hole 10 | S |
| Grand Hunter 🗺️ | Hunt Master on every course at a venue | S |
| Naturalist 🦋 | Find every item on one course without a single rejection | S |

## Fun zone

**Entirely unlocked by the no-tickets decision.** These games are client-scored,
which made them untouchable while badges paid; as pure status they're the
richest untapped source in the app — nineteen games, each with its own natural
milestone. Cheapest honest implementation is a device-local counter in
IndexedDB, nothing sent to the server.

| Name | How to earn | |
|---|---|---|
| Arcade Rookie 🕹️ | Play any fun-zone game | N |
| Sampler 🎪 | Play five different games | N |
| ★ Completionist 🏅 | Play all nineteen | N |
| Maxed Out 📈 | Hit a game's per-round ticket ceiling | N |
| Trivia Buff 🧠 | Perfect trivia round | N |
| Turkey 🎳 | Three bowling strikes in a row | N |
| Bullseye 🎯 | Darts bullseye | N |
| Bell Ringer 🔔 | Max the high striker | N |
| Pinball Wizard 🧙 | Beat a pinball score threshold | N |
| Claw Champ 🦞 | Win the claw machine three times | N |
| Mole Patrol 🔨 | Whack-a-mole streak of ten | N |
| Sharpshooter II 🔫 | Clear the shooting gallery without a miss | N |
| Ringer 💍 | Three ring-toss landings in a row | N |
| Avalanche 🪙 | Trigger a big coin-pusher drop | N |

The coin pusher is back on the table precisely because this badge pays nothing —
the skill-only ticket rule (PR #140) is untouched by a status badge.

## Photo booth

`booth_photo` is keyed by an unguessable per-device `booth_id`, not a player, so
these are naturally device-local anyway.

| Name | How to earn | |
|---|---|---|
| Say Cheese 📷 | Save your first booth photo | N |
| Sticker Bomb 🌈 | Place ten or more stickers on one photo | N |
| Framed 🖼️ | Use a venue frame | N |
| Photogenic 🤳 | Save five photos | N |
| Director's Cut 🎞️ | Re-edit a saved photo | N |

## Social & teams

`shared_game` and `team` already carry everything these need.

| Name | How to earn | |
|---|---|---|
| Host 🎤 | Create a shared multi-device game that completes | S |
| Crashed the Party 🎊 | Join someone else's shared game | S |
| Team Player 🧢 | Play a round under a team | S |
| Recruiter 📨 | Send a team invite that gets accepted | S |
| Rivalry ⚔️ | Three rounds sharing the same opponent tag | L |
| Squad Goals 🫂 | A shared game where all four slots are filled | S |

## Habit & loyalty

Now safe to include: with no payout there's no double-credit conflict with
`bonus_award`, which keeps owning the install/sign-in ticket rewards.

| Name | How to earn | |
|---|---|---|
| Home Screen Hero 📲 | Install the app | L |
| Made It Official ✍️ | Create an account | L |
| Carded 💳 | Link a rewards card | L |
| Three-Peat 📅 | Play on three different days | L |
| Weekend Warrior 🎉 | Rounds on both days of the same weekend | L |
| Century Club 💯 | 100 holes played, lifetime | L |
| Anniversary 🎂 | A round one year after your first | L |
| Refueled 🍔 | Place a food order from the app | N |
| Turn Snack 🌭 | Order between holes 9 and 10 | N |

## Secret & meta

Hidden until earned — shown as `???` on the wall. Discovery is half the point,
and it costs nothing to be playful here.

| Name | How to earn | |
|---|---|---|
| Lucky Sevens 🍀 | Card exactly 77 strokes for a round | L |
| Palindrome 🔁 | A round whose front nine mirrors its back nine | L |
| Flatline 📉 | Every hole scored identically | L |
| The Grind 🌙 | Play a round starting after 9pm | S |
| Groundhog Day 🔄 | Score identically on the same course twice | L |
| Trophy Case 🏆 | Earn twenty other badges | L |
| Curator 🖼️ | Earn every badge in any one category | L |
| Legend 🌟 | Earn every badge in the catalog | L |

---

## Implementation notes

1. **One catalog, two consumers.** `server/lib/rewards.js` and
   `src/features/me/Achievements.tsx` hold parallel hand-maintained lists — the
   server file's own comment admits it ("the player app carries its own copy of
   the same labels"). Fine at three entries, a drift bug at a hundred. Extract a
   shared catalog (key, label, emoji, blurb, category, detection site, secret
   flag) and generate both sides from it before the list grows. Without payout
   there's no `ACHIEVEMENT_TICKETS` map to keep in sync, so this is the *only*
   duplication left to solve.
2. **Detection moves client-side.** Most of the catalog is local, and
   `Achievements.tsx` already owns that pattern — extend `earnedFromLocalRounds()`
   rather than adding grant logic to the sync path. The server only needs to be
   involved for the **S** rows.
3. **The wall needs grouping.** It currently renders one flat `<ul>` with an
   "*N* of *M* unlocked" header. At a hundred badges that's a long scroll of grey
   boxes. Group by the categories above, count per section, sort earned first,
   and collapse secret ones to `???`.
4. **Earned-state durability.** Local detection re-derives from stored rounds,
   so a badge silently disappears if local round history is cleared. Either
   persist an earned-set alongside the rounds, or (better, for signed-in players)
   sync earned badges to the account so the wall follows the player across
   devices. This is the one piece of new persistence worth building.
5. **`reward_grant` stops being the achievement store.** If the round-based
   payout above is adopted, `reward_grant` keeps existing for that and
   achievements stop touching it entirely — a clean separation rather than a
   deletion.

## Suggested first slate

Ship the **local golf badges** — scoring, round shape, wipeouts, courses: about
fifty entries, all pure arithmetic over data already in IndexedDB, all working
offline and signed-out, no backend change of any kind. That takes the wall from
3 badges to ~50 with no migration, no new endpoint, and no trust surface.

Then, in order: the **hunt badges** (server-side but nearly free — the columns
already exist), the **fun-zone counter** (one small local store, unlocks fourteen
more), and finally **account-synced earned state** so the wall survives a cleared
cache.
