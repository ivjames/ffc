# Built Features Inventory

What is actually shipped in this repo, as of `main` @ `301b22e`.

This is an **inventory**, not a spec: it records what exists and where, so a new
session can orient without reading everything. Behaviour detail lives in the
source, which is heavily commented — this file points at it.

> **On staleness.** The previous version of this file went 92% wrong in 29 days:
> 56 of 61 live routes were undocumented and its three most-referenced paths
> (`/fun`, `/leaderboard`, `/putt`) had all been renamed out from under it.
> Every count and path below was derived from the tree rather than remembered.
> The commands to re-derive them are in [§16](#16-keeping-this-file-honest).

---

## 1. Scorecard core loop (`/golf`)

The original product: a shared mini-golf scorecard.

| route | purpose |
| --- | --- |
| `/golf` | golf home |
| `/golf/new`, `/golf/new/setup` | start a round, add players |
| `/golf/play/:clientId` | the live scorecard |
| `/golf/play/:clientId/summary` | round summary |
| `/golf/spinner` | challenge spinner |
| `/join`, `/games/:gameId/lobby` | joining someone else's round |

Rounds are client-owned (`:clientId`) and sync through `server/routes/rounds.js`
and `shared_game*` tables, so several phones can score one round. Merge
behaviour is last-write-wins per field — see `src/lib/sharedMerge.ts` and its
tests.

## 2. Courses, maps & rules

`/golf/courses`, `/golf/courses/:id/map`, `/golf/rules`. Course data is in
`src/data/courses.ts`. Themes (`course.classic`, `course.dragon`, `course.haunted`,
`course.jungle`, `course.pirate`, `course.space`, `course.western`, plus the four
colour variants) each have their own icon in the set — see §11.

## 3. Arcade (`/arcade`)

22 tiles. All are client-side canvas games that work offline; **19 of 22 award
tickets** where the venue has that module enabled (§10).

| tile | route | tickets |
| --- | --- | --- |
| Fun Facts | `/arcade/facts` | — |
| Trivia | `/arcade/trivia` | yes |
| Live Trivia | `/arcade/trivia/live` | — |
| Arcade Putt | `/arcade/putt` | — |
| Skee-Ball | `/arcade/skeeball` | yes |
| Air Hockey | `/arcade/airhockey` | yes |
| Bumper Cars | `/arcade/bumper` | yes |
| Bumper Boats | `/arcade/boats` | yes |
| Axe Throwing | `/arcade/axe` | yes |
| Batting Cages | `/arcade/batting` | yes |
| Bowling | `/arcade/bowling` | yes |
| Go-Karts | `/arcade/karts` | yes |
| Whack-a-Mole | `/arcade/mole` | yes |
| Pop-a-Shot | `/arcade/hoops` | yes |
| Darts | `/arcade/darts` | yes |
| Shooting Gallery | `/arcade/gallery` | yes |
| Claw Machine | `/arcade/claw` | yes |
| High Striker | `/arcade/striker` | yes |
| Ring Toss | `/arcade/rings` | yes |
| Milk Bottles | `/arcade/bottles` | yes |
| Water Gun Race | `/arcade/watergun` | yes |
| Pinball | `/arcade/pinball` | yes |

Plus `/arcade/scores` (per-game top ten, per venue) and `/arcade/challenges`,
`/arcade/challenges/:id` (head-to-head: two players, one game, one record).

**Coin Pusher was removed** — the route is gone and the component deleted.

Pinball is the one game split across two files: `Pinball.tsx` is the shell
(rendering, input, frame loop) and `pinballTable.ts` holds geometry and the
240 Hz physics sim, so the table can also be balanced headless via
`scripts/pinball-sim.ts`.

## 4. Live Trivia (`/arcade/trivia/live`)

One host, a room of phones, one synchronised game. `/arcade/trivia/host` runs
the room; `/arcade/trivia/live/:sessionId` joins one. Server side is
`server/routes/triviaLive.js` plus `server/lib/triviaDeal.js`, over the
`trivia_session` / `trivia_question` / `trivia_entrant` / `trivia_participant` /
`trivia_answer` tables. Entrants can join solo or as a table.

## 5. AI Scavenger Hunt (`/golf/hunt`)

Photo-verified hunt. `server/routes/hunt.js`, tables `hunt_item`,
`hunt_item_image`, `hunt_find`, `hunt_scan`. Model spend is metered per scan —
see `HUNT-PRICING.md` and `IMAGE-DESCRIPTION-PRICING.md`, and the admin rollup
at `admin/HuntUsage.tsx`. There is a course-free venue-wide mode for sites
without mini golf.

## 6. Leaderboards

`/golf/leaderboard` for players; `/tv` and `/tv/wall` are the venue display
surfaces. Server: `server/routes/leaderboard.js`, `teamLeaderboard`, and
`leaderboardWall`.

## 7. Accounts, teams & rewards (`/me`)

`/me`, `/me/account`, `/me/achievements`, `/me/privacy`, `/me/rewards`,
`/me/teams`, `/me/teams/:id`, `/teams/accept`.

Sign-in is magic-link, per-tenant origin aware (`server/routes/auth.js`,
`auth_code`, `app_user`, `user_session`). Rewards cards bind to accounts
(`user_card_link`, `reward_grant`). Achievements have an expansion catalog.
Tickets are granted server-side (`game_ticket_award`, `bonus_award`) —
`server/lib/gameRewards.js`, `dailyTickets.js`.

**No money is attached to any of this** — see `CLAUDE.md`.

## 8. Food & drink (`/food`)

`/food`, `/food/checkout`, `/food/order/:orderId`. Cart and order state in
`src/lib/foodCart.ts` / `foodOrders.ts`; order notifications in
`orderNotifications.ts`. Kitchen side is mocked for development — see §15.

## 9. Photo booth (`/photos`)

Capture, stickers and overlays. `server/routes/photos.js`, tables `booth_photo`
and `booth_sticker`. Admin curation at `admin/BoothPhotos.tsx` /
`admin/BoothStickers.tsx`.

## 10. Multi-venue & à la carte modules

`src/lib/modules.ts` defines five switchable modules:

`arcade` · `hunt` · `ordering` · `rewards` · `gameTickets`

`ordering` and `rewards` derive from whether the venue's POS config exposes
them; `gameTickets` additionally requires loyalty game-rewards to be on. A venue
that has not bought a module does not see it — the Arcade tile and drawer entry
are gated on `modules.arcade`, not merely hidden.

Unknown or suspended tenants get a dead-end page rather than a default-mode app.
See `MULTI-VENUE.md`.

## 11. Branding & the icon system

**96 semantic icons**, named for meaning rather than picture
(`src/ui/icons/manifest.ts`, `registry.tsx`, `vendored.generated.tsx`). The
naming matters: Skee-Ball and Bowling previously shared 🎳 and Whack-a-Mole and
High Striker shared 🔨, so the tiles were lying about being different games.
Sourced from Lucide (ISC) and Phosphor (MIT), with hand-drawn additions for
arcade subjects no general set carries.

Per-tenant branding (logo, wordmark, badge, colours) hydrates from
`/api/content` **after the first frames** — anything cached at render time must
account for that. Master Control can derive both PWA manifest icons from an
org's logo in-browser. See `admin/OrgDetail.tsx`, `admin/appIcon.ts`,
`src/features/fun/logo.ts`.

## 12. PWA, install & update flow

`/install` shows the org's real launcher icon and names the venue.
`server/routes/manifest.js` serves the per-tenant manifest. Service worker via
`vite-plugin-pwa` (generateSW). Update prompt uses `action.refresh`.

## 13. System UX

Theming (light/dark), sound and haptics, all toggleable from the drawer.
`src/lib/sound.ts`, `src/lib/haptics.ts` — haptics honours
`prefers-reduced-motion`, since a vibration is motion you feel.

`/style` is the living style guide; `public/docs/style-guide.html` is the built
artifact (`scripts/build-style-guide.py`).

## 14. Canvas game toolkit

Every arcade game shares one rendering vocabulary in `src/features/fun/fx.ts`:

```
TWO_PI  fxRandom  withAlpha  roundRectPath  drawShadow  drawSphere  neonLine
spawnBurst  stepParticles  drawParticles  spawnFloater  stepFloaters
drawFloaters  pushTrail  decay  shakeOffset
LAYER_SS  makeLayer  makeCachedLayer  brushedStreaks  drawGlow
```

Two conventions worth knowing before touching a game:

- **Static scenery is built once and blitted**, not repainted per frame
  (`makeCachedLayer`). Backdrops, playfields and board art are cached offscreen;
  the frame loop draws one image. `makeCachedLayer` keys its rebuild on
  `logoReady()` because branding hydrates late (§11).
- **Light means something is live or just happened** — a struck bumper, a lit
  drop target, a scored cup, the bed a dart landed in. There is no ambient or
  attract-mode glow, and no full-frame flash. `drawGlow` is driven from decaying
  per-object scalars, never from a clock.

`useFitCanvas` owns canvas rect maths; games map pointer input through it.

## 15. Backend, database & admin

Express API in `server/`, deployed via pm2 as `ffc-api` behind nginx.

**Route modules:** announcements, auth, challenges, content, events, feedback,
gameRewards, gameScores, games, hunt, launchSignup, leaderboard, locations,
loyalty, manifest, photos, rewards, rounds, seed, teams, triviaLive.

**43 tables**, including: `org`, `location`, `app_user`, `user_session`,
`round`, `score`, `shared_game*`, `game_score`, `game_ticket_award`,
`challenge*`, `trivia_*`, `hunt_*`, `booth_*`, `team*`, `reward_grant`,
`announcement*`, `admin_*`, `funnel_event`, `mail_send`.

**Master Control** (separate SPA in `admin/`): Overview, Orgs, OrgDetail,
LocationDetail, LocationModules, LocationWizard, ProvisionSite, Rewards, Hunt,
HuntUsage, Photos, BoothPhotos, BoothStickers, Announcements, Feedback,
Signups, Account, Archived, SyntheticBot.

**POS integration** targets CenterEdge; `mock-centeredge/` is a zero-dependency
local mock (app, KDS, kitchen, seed) so F&B and loyalty work can proceed without
vendor API access. See `pos-vendor-research.md`, `MULTI-VENUE.md`.

**Tests:** 33 app · 20 admin · 81 server · 4 e2e.
Server tests need Postgres: `cd server && TEST_DATABASE_URL=... npm test`.

## 16. Keeping this file honest

Everything above is derivable. To check for drift:

```bash
# routes — should match §1–9
git grep -oE 'path="[^"]+"' -- src/App.tsx | sed 's/.*path="//;s/"//' | sort -u

# arcade tiles + which award tickets — should match §3
grep -E "to: '/arcade|title:|earns:" src/features/fun/FunZone.tsx

# modules — should match §10
grep 'ModuleKey' src/lib/modules.ts

# icon count — should match §11
grep -cE "^\s*'[a-z]+\.[a-z0-9-]+':" src/ui/icons/manifest.ts

# fx toolkit surface — should match §14
grep -oE '^export (function|const) \w+' src/features/fun/fx.ts
```

If any of those disagree with the text, the text is wrong.

## 17. Known gaps & deferred work

- **This file is hand-maintained**, and the last one rotted badly. §16 exists so
  drift is cheap to detect, but nothing enforces it — a CI check comparing the
  route list against §1–9 would.
- **Deploys pull `main` only** (`bin/ffc`); feature branches are checked out by
  hand plus `ffc restart`.
- **Two environments**, development and staging; staging serves as production.
  No money-bearing tier — see `CLAUDE.md`.
- **Model-cost surfaces** must report exact billed tokens from the API's usage
  object, not estimates, and pre-flight an estimate before any batch. Precedents:
  `hunt_scan` metering, the admin hunt-usage rollup, and the vision bake-off's
  burn ticker.
- **Test images must not contain people** — they go to third-party providers.
  The stored-photo picker filters on the hunt verifier's `people_present` flag.
