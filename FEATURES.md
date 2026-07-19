# Built Features Inventory

A complete inventory of everything shipped in the FFC mini-golf / family-fun-center
PWA to date. Grouped by area, with the concrete behavior of each feature. This
reflects the current state of `main`, which has grown well past the original
Phase-1 plan — the scorecard core, a full arcade Fun Zone, a procedural putting
game, and the AI scavenger hunt are all live.

- **Stack:** React + TypeScript + Vite · Tailwind CSS v4 · `vite-plugin-pwa`
  (Workbox) · IndexedDB (`idb`) · react-router · Node/Express + Postgres (`pg`) ·
  nginx + certbot on the lab980 droplet, managed by pm2.
- **Architecture:** offline-first client; all DB writes go through the Node API
  (creds server-side, every input re-validated); completed rounds sync
  idempotently on a client-generated UUID.

---

## 1. Scorecard core loop

The heart of the product: a 4-step, fully-offline flow —
**Course picker → Player setup → Play → Summary** — backed by IndexedDB and a
retry-based sync layer.

### Course picker (`/new`)
- Lists only the courses at the currently-selected location.
- Each card shows a themed emoji tile, name, and a live `{holes} holes · par {N}`
  subtitle (par summed from the course's 18 pars).
- Header chip shows the active location and links to the location switcher
  (carrying a `next` param so it returns here).

### Player setup (`/new/setup`)
- Choose **1–4 players** (default 2); a 4-slot tag array is retained so toggling
  the count down and back up never loses typed tags.
- **Three-initial arcade tags** (`[A-Z0-9]{3}`): monospace/uppercase inputs,
  live-sanitized on every keystroke, with inline per-field validation and a red
  border once a full 3-char tag is invalid.
- Start button is gated on a valid roster; on submit it creates the round in
  IndexedDB and navigates to the play screen (replacing history so Back doesn't
  return to setup).
- **Testing aids:** "Auto play" / "Fast forward" ghost buttons roll a random
  roster and drive the whole round automatically.

### Play screen (`/play/:clientId`)
- One hole at a time; a par medallion, optional hole name, and a per-player card
  with `−` / count / `+` steppers.
- **No auto-fill:** an untouched hole stays blank; the first `+` registers 1.
  Strokes are clamped to a floor of 1 and a cap of 6 (configurable constants).
- **Persist on every edit:** each stroke change writes the round to IndexedDB
  immediately — a refresh or crash never loses a game.
- **Resume:** reopening a round lands on the first unscored hole.
- **Gating:** you can't advance a half-scored hole (every player must be scored),
  and Finish is disabled until all players have all 18 holes.
- Hole-jump grid marks each hole current / done / incomplete.
- Score-pop animation fires only on a real edit, not on hole navigation.
- Top bar links out to the scavenger hunt and challenge spinner, carrying state so
  their Back returns to the round.

### Summary (`/play/:clientId/summary`)
- Marks the round complete exactly once, stamps `completedAt`, flips it to
  `pending`, and triggers a sync attempt on arrival (with a distinct "sync failed"
  state vs. "saving…" when online but rejected).
- **Winner logic:** lowest total wins; ties yield multiple winners
  ("Tied for the win"). Winner(s) get a hero card (trophy, tag, total, over/under);
  everyone else is ranked below.
- **Hole-by-hole grid** split into front/back nines (two 10-column tables so 18
  holes don't overflow a phone); each cell colors under-par green / over-par amber.
- Footer shows sync status ("Saved to leaderboard ✓" / retry / "will sync when
  back online"). "View leaderboard" passes the exact just-played scores so the
  leaderboard can highlight this round.

### Scoring & validation
- `src/lib/scoring.ts` — 18 holes, stroke cap 6 (toggleable), running fair
  over/under computed only over entered holes, course par, winner/tie logic.
- `src/lib/sanitize.ts` — `[A-Z0-9]{3}` charset, live input sanitizer, a small
  fixed profanity blocklist (kept in sync with the server), and roster validation.

### Local persistence & offline sync
- `src/db/index.ts` — `idb`-backed store keyed on `clientId`, with a `by-sync`
  index; CRUD plus "most recent active round" for Resume.
- `src/sync/index.ts` — `POST /api/rounds`, **idempotent on `clientId`** so retries
  never duplicate; HTTP 400 treated as permanent rejection. A background worker
  drains pending rounds on load, on the `online` event, and when the tab becomes
  visible again.

---

## 2. Courses, maps & rules

- **Course data** (`src/data/courses.ts`) — white-label seed for the first client
  (Bullwinkle's): **3 locations** (Upland CA, Tukwila WA, Wilsonville OR) and
  **9 courses** across them, each 18 holes with placeholder pars (2–4) and a theme
  (blue / green / red / dragon / western).
- **Course list** (`/courses`) — scoped to the current location.
- **Course map** (`/courses/:id/map`) — bundled per-course art (placeholder SVGs),
  viewable offline, with per-hole pars; falls back to a themed placeholder.
- **Rules** (`/rules`) — general rules plus per-course themed notes, static bundled
  content, tinted with the course accent.

---

## 3. Fun Zone — "While You Wait" (`/fun`)

An arcade hub of offline, bundled line-entertainment reflecting the whole
family-fun-center (bowling, axe throwing, go-karts, etc.). Two content activities,
one interactive wheel, and **eight full real-time canvas mini-games** sharing a
common "juice" toolkit (`fx.ts` — lit spheres, particles, trails, screen-shake,
with an isolated PRNG so effects never perturb gameplay RNG).

### Content activities
- **Fun Facts** (`/fun/facts`) — a shuffled deck of ~61 venue-flavored facts; tap
  to advance.
- **Trivia** (`/fun/trivia`) — a 10-question round sampled from ~58 questions;
  question and choice order shuffled, inline right/wrong coloring with sounds, a
  scored results screen with a tiered remark, and replay.
- **Challenge Spinner** (`/fun/spinner`) — an SVG prize wheel of ~14 kid-safe
  group dares. Decelerates onto a random wedge with easing-accurate tick sounds
  (it inverts the easing curve to time each peg crossing). Reached from the
  scorecard toolbar, not the hub.

### Canvas mini-games
All share a logical field scaled to fit, a fixed-timestep sim where physics
matters, DPR-aware rendering, visibility-pausing, and a results screen with a
tiered remark and replay.

- **Skee-Ball** (`/fun/skeeball`) — swipe up the lane; deterministic parabola with
  a fading aim trail so you commit to line + power. 7 scoring rings (corner 100s),
  9 balls.
- **Air Hockey** (`/fun/airhockey`) — 1-v-CPU, first to 7. 120 Hz substepped puck
  (no tunneling), mallet "slam," and a hit-and-retreat CPU that stays beatable.
- **Bumper Cars** (`/fun/bumper`) & **Bumper Boats** (`/fun/boats`) — one shared
  arena engine (`BumperArena`) themed two ways (grippy cars vs. floaty boats).
  Drag-to-lead control; rack up the most bumps in 30 s (a bump only scores when
  *you* drive into an AI hard enough); wake ripples / spark trails per theme.
- **Axe Throwing** (`/fun/axe`) — two-tap timing (lock X on a sweeping vertical
  guide, then Y). Concentric rings 1–5 plus corner "clutch" dots worth 7; 5 throws;
  previous axes stay stuck in the board.
- **Batting Cages** (`/fun/batting`) — hold to wind up, release to swing; a
  randomized pitch delay defeats timing off the press. Timing windows grade
  HOME RUN / hit / foul / miss; 10 pitches; batted balls carom off the netting.
- **Bowling** (`/fun/bowling`) — full 10-frame game with real ball/pin mass +
  restitution physics, hook on angled shots, gutters, and **standard scoring**
  (strikes, spares, 10th-frame fill balls) with a live running total.
- **Go-Karts** (`/fun/karts`) — top-down 3-lap time trial across **8 procedurally
  built tracks** (incl. a figure-8 with a rendered over/under bridge). Drag-to-lead
  steering, solid barrier walls that scrape rather than launch you off,
  corner-cut-proof lap detection, per-track best lap.

*(Note: the `/fun` hub also surfaces a tile for Arcade Putt below.)*

---

## 4. Arcade Putt — procedural mini-golf (`/putt`)

A fully client-side canvas putting game with two modes: a hand-authored
**9-hole course** and an infinite **Endless (procedural)** run. Physics and
geometry live in a pure, React-free module (`world.ts`) shared verbatim by the
game, an offline validator, and a map renderer, so the three never drift.

- **Controls:** slingshot aim — drag back from the ball, launch opposite the drag;
  drag length is power, with a dashed color-shifting aim arrow and a power meter.
- **Geometry:** everything is built from **capsules** (rounded stadiums) unioned
  by a smooth signed-distance field, so the exact surface you see is what the ball
  rolls on — no sharp corners. Fairway, green (with a rough collar), walls/bumpers,
  sand pits, water, and rough patches.
- **Physics:** sub-stepped (no tunneling), surface-containment rails, wall bounce,
  per-surface friction (fairway / rough / sand), and water that finds a clean
  re-drop spot with a +1 penalty. **The cup has no magnet** — capture radius shrinks
  with speed and off-center-ness, and near-misses catch the far rim and lip out, so
  pace and centering genuinely matter.
- **Procedural generation** (`generate.ts`) — seeded RNG (reproducible), a
  generate-then-validate rejection-sampling loop (fairway spine + optional dogleg,
  bunkers, one-sided water, bumper channels, rough rails), par derived from route
  features. Endless mode prefetches the next hole during the sink celebration.
- **Validation contract** (`validate.ts`) — the single definition of "valid,"
  shared by generator and CLI: cheap geometry checks, a BFS completability check,
  and a ~864-shot sweep that proves the hole is sinkable and never traps the ball.
- **Dev scripts:** `putt:sim` validates the authored holes in CI; `putt-render`
  rasterizes all nine holes to a PNG montage (with a hand-rolled PNG encoder) for
  eyeballing without a browser.

---

## 5. AI Scavenger Hunt (`/hunt`)

A play-time activity gated on an in-progress round. Each course has a themed list
of items to find; a player snaps a photo, a server-proxied vision model verifies
the item is present, and confirmed finds are tracked **per player and per group**.

- **Capture** — camera-first (`capture="environment"`); the finder is snapshotted
  at submit time so the credit goes to whoever actually took the shot (the phone
  gets handed around). A test flag can allow library uploads.
- **Preprocessing** — photos are downscaled/re-encoded client-side to fit a ~600 KB
  budget (under nginx and server caps) before upload.
- **Verification** (`server/lib/vision.js`) — the browser never touches the model;
  the Node API proxies the call so `ANTHROPIC_API_KEY` stays server-side. Uses
  `claude-haiku-4-5` (cheap single-image classification) with a structured-output
  schema returning `present`, `confidence`, `reason`, and a `photo_of_photo` flag.
- **Anti-cheat** — a photo of a screen / printed photo is flagged and never counts,
  regardless of content (toggleable off for on-site testing).
- **Anti-farming** — one-off items short-circuit (skipping the paid model call) once
  found; a partial unique DB index closes double-tap races. **Countable** items
  (e.g. Western horseshoes — "find as many as you can") are exempt and every
  verified shot counts.
- **Tracking UI** — "Found by" tag chips, per-player counts for countable items,
  ✓ / disabled Snap for found one-offs, and hint toggles.
- **Storage** — only successful unflagged finds are stored to disk
  (`HUNT_UPLOAD_DIR`); rejects are discarded. Public moderation is deferred.
- **Endpoints** — `GET /api/hunt/items?course=`, `GET /api/hunt/progress?round=`,
  `POST /api/hunt/verify` (rate-limited 20/min/IP, 10 MB image cap, 503 without a key).

---

## 6. Leaderboard (`/leaderboard`)

Arcade high-score board, fed by data the scorecard has been persisting since
launch.

- **API** (`routes/leaderboard.js`) — per player **tag**, best (lowest) total per
  course, sorted ascending, for **day / week / month / all-time**. Windows are
  **calendar** windows in each venue's own timezone (a round played last night
  isn't "today"), with the zone resolved per round and bound as a parameter.
- **Board UI** — polls every 5 s, period tabs, one-time confetti on first populated
  load. When arriving from a finished round it highlights and pins the just-played
  rows (matched on course + exact total, since tags are reused by design) above the
  scrollable standings.

---

## 7. Multi-location / venue support

White-label, multi-venue from the data layer up.

- **Server** (`routes/locations.js`) — `GET /api/locations` (open) and
  `POST /api/locations` (token-gated onboarding) with strict slug/coord validation.
- **Timezone** is resolved server-side, never hand-typed: explicit IANA zone wins,
  else derived from coordinates (`tz-lookup`), else a configured fallback — so the
  leaderboard's calendar windows are correct per region.
- **Client** (`src/lib/location.ts`) — current-location store in localStorage
  (with a manual "pinned" flag that overrides GPS), reactive via
  `useSyncExternalStore`; course lists everywhere scope to it.
- **Location picker** (`/locations`) — manual venue list + "Use my location,"
  supports `?next=` chaining, shows course counts.

### Geolocation / auto-detect
- Haversine distance + km/miles helpers; `detectNearestLocation()` returns a
  discriminated result (matched / nearest-out-of-range with distance / denied /
  timeout / unavailable).
- Home does a **silent** auto-detect only when permission is already granted and
  the user hasn't pinned a site — it never fires an unsolicited prompt.

---

## 8. PWA, install & update flow

- **Installable PWA** — `vite-plugin-pwa` (Workbox, `autoUpdate`) precaches the
  full app shell + maps + rules so everything works offline; `navigateFallback` to
  the app with an **API denylist** so the service worker never intercepts `/api/`.
- **Install landing** (`/install`) — QR-code target that branches by platform:
  already-installed confirmation, iOS Share-sheet instructions, or a real native
  install button on Chrome/Edge. The `beforeinstallprompt` event is captured at
  module load so it's never missed.
- **Update flow** — a build SHA is baked into the bundle *and* written to
  `/version.json` *and* served at `/api/health`. The client polls the API build
  every 60 s; on a mismatch a blocking **Update modal** reloads onto the fresh
  build (skip-waiting nudge + safety-net timeout). Solves the "stale precached
  bundle vs. new API after deploy" problem.
- **Build stamp** — a tiny pill on every screen showing `build · api`, flagging a
  mismatch in amber, tap-to-copy.

---

## 9. System UX: theming, sound, haptics

- **Light/dark mode** (`src/lib/mode.ts`) — `data-theme` toggle recolors via CSS
  vars (no re-render), persisted, follows OS preference until the user chooses,
  no theme flash (pre-paint inline script), updates the PWA theme-color. WCAG-AA
  in both modes. Always-available toggle in the corner.
- **Per-course theming** (`src/lib/theme.ts`) — accent ink per theme (auto-darkened
  in light mode for legibility) and theme emoji, used on Home tiles, maps, and
  rules cards.
- **Sound** (`src/lib/sound.ts`) — a fully-synthesized Web Audio "sound kit" (no
  audio files → offline-friendly), lazily created inside a user gesture, with a
  persisted mute toggle and ~a dozen named effects (stroke, cup, ding, buzz, tick,
  bump, score, fanfare…).
- **Haptics** (`src/lib/haptics.ts`) — Vibration-API wrapper that no-ops when
  unsupported, honors `prefers-reduced-motion`, shares the mute with sound, and
  fires automatically alongside each sound effect.
- **Confetti** (`src/ui/Confetti.tsx`) — high-DPI-correct celebration used on the
  leaderboard and wins.

---

## 10. Backend API & database

Node/Express + Postgres, behind nginx, managed by pm2. No Supabase — the API is the
only write path and re-validates every input.

### Endpoints
| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET  | `/api/health` | none | `{ ok, build }` liveness + build stamp |
| POST | `/api/rounds` | rate-limited | Idempotent completed-round sync |
| GET  | `/api/leaderboard?period=` | open | Arcade high-score board |
| POST | `/api/seed` | `x-app-token` | Upsert courses (dev/ops helper) |
| GET  | `/api/locations` | open | List venues |
| POST | `/api/locations` | `x-app-token` | Create/update a venue |
| GET  | `/api/hunt/items?course=` | open | Course's active hunt items |
| GET  | `/api/hunt/progress?round=` | open | A group's verified finds |
| POST | `/api/hunt/verify` | rate-limited | Photo → vision verdict → find |

- **Round sync** — per-IP rate limit (30/min), full validation (UUID course,
  1–4 valid tags, 18-hole score arrays), transactional
  `INSERT ... ON CONFLICT (client_id) DO NOTHING` so a resynced round never
  duplicates.
- **Server-side re-validation** (`server/lib/sanitize.js`) — re-checks the tag
  charset, count, and profanity blocklist, kept in sync with the client (the client
  check is bypassable and tags render on a public board).

### Schema (`server/schema.sql`, idempotent migrations)
- `location`, `course`, `round`, `score` (core), plus `hunt_item` and `hunt_find`
  (Phase 3). Notable: `round.client_id` unique dedupe key; `score` PK on
  `(round_id, player_index, hole)`; a partial unique index enforcing one verified
  hunt find per group/player/item except for countable items.
- Seed data embedded: 3 locations + 9 courses + hunt items for the Western and
  Dragon courses. Migrations never delete placeholder courses (would cascade through
  played data) — a separate purge script is provided.

---

## 11. Operations & deploy

- **`bin/ffc` operate CLI** — a bash ops script (lab980 convention). Subcommands:
  `setup` (one-time: migrate → API up → build → nginx vhost + certbot TLS → seed),
  `deploy` (fetch/reset, **re-exec the freshly-pulled script**, atomic
  release-dir + symlink swap, prune old releases, migrate, pm2 restart, self-heal
  nginx body-size, version check), `migrate`, `version`, `seed`, `restart`, `logs`,
  `backup` (`pg_dump`), and `vhost`.
- **Deploy model** — atomic release directories + symlink swap (never overwrite in
  place, so a mid-deploy load never serves mixed old/new hashed assets and poisons
  the SW cache); HTTPS via certbot with auto-renewal (required for SW + install).
- Full runbook in `DEPLOY.md`; nginx vhost template + course seed JSON in `deploy/`.

---

## Known placeholders & deferred work

- **Par values** are random 2–4 placeholders until real course pars are supplied.
- **Map art** is generated placeholder SVGs until real maps exist.
- **Content moderation** of stored hunt photos is deferred (nothing is shown
  publicly).
- **Group tag / group leaderboard** is deferred; the data model reserves space so
  it's an additive change.
- **Native wrap (Capacitor) + interactive course hardware (IoT)** are the planned
  Phase-4 direction, out of scope until the software is proven.
- Two **hunt testing toggles** (`HUNT_ALLOW_PHOTO_OF_PHOTO`, `VITE_HUNT_ALLOW_UPLOAD`)
  default off and must stay off in production.
