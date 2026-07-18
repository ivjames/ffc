# Mini Golf App — Full Build Plan

A self-contained spec for building the app. Hand this to Claude Code as the source of truth.

---

## 1. Product summary

An app for a mini golf venue with **four themed 18-hole courses**. Core is an easy 4-player scorecard. Ships web-first as an installable PWA, with a clean path to native later. Additional features (TV leaderboard, AI scavenger hunt, interactive course hardware) are planned as later phases but the v1 data layer is designed so they don't require a rewrite.

### Locked decisions
| Decision | Choice |
|---|---|
| Platform | Web-first **PWA**, native later via Capacitor |
| Build | Coded in Claude Code |
| v1 scope | 4-player scorecard + course maps + rules |
| Courses | 4 themed, **18 holes each** |
| Rounds | **One round = one course** (separate rounds per course) |
| Par | Per-hole, values 2–4 (seeded/random placeholder until real pars exist) |
| Player identity | **Three-initial tags** per player (arcade style), 1–4 players; `[A-Z0-9]{3}` |
| Leaderboard tracking | **Individual player only** for now; group tag deferred |
| Deferred | Group tag/leaderboard, TV leaderboard (P2), AI scavenger hunt (P3), native + IoT (P4) |

---

## 2. Tech stack

| Layer | Choice | Rationale |
|---|---|---|
| Frontend | **React + TypeScript + Vite** | Fast, standard, Capacitor-compatible |
| PWA | `vite-plugin-pwa` (Workbox) | Installable, offline service worker |
| Styling | Tailwind CSS | Fast to build touch-friendly UI |
| Local storage | **IndexedDB** via `idb` or Dexie | Offline round state + write queue |
| Backend | **Existing Postgres** on the droplet + **Node/Express API** | No Supabase — you already run Postgres; the Node API (also the write-validation layer) is the data access point |
| Hosting | **DigitalOcean droplet** (nginx) | Server you control; consolidates DB, API, static serving, and the later P3 vision proxy / P4 MQTT on one box |
| Native (P4) | **Capacitor** | Wraps the same web build as iOS/Android |
| Vision (P3) | Claude or GPT-4o vision | Scavenger-hunt verification |

**Why Capacitor, not React Native:** the "PWA now, native later" strategy only pays off if the native app reuses the web codebase. Capacitor wraps the identical Vite build and exposes native camera/storage when needed. React Native would mean a rewrite. Do not choose React Native.

---

## 3. Architecture principles

**Offline-first is mandatory for v1.** Outdoor cell coverage is unreliable; a scorecard that fails mid-round is worse than paper. All scoring works fully offline against IndexedDB. Completed rounds are queued and synced to Supabase when a connection is available.

**Persist finished rounds from v1, even though the leaderboard is P2.** The leaderboard needs score history to already exist. If v1 doesn't collect it, P2 starts empty. Syncing completed rounds to the Postgres-backed API costs nothing now and removes the cold-start problem.

**Three-initial tags, arcade-style — no identity system, and collisions are the convention, not a bug.** Each player enters a 3-character tag (`[A-Z0-9]{3}`). No accounts, no PINs. Two different players who both pick "JIM" show as two separate leaderboard rows with their own scores and dates — exactly how arcade high-score tables always worked. This is the intended model, not a limitation. Group-level tracking is deferred; when it returns it's just a second aggregation over the same `score` rows.

**Static content bundled, not fetched.** Maps and rules ship in the build so they work offline. Move them behind the API/DB later only if they need frequent editing.

**Hosting on a DigitalOcean droplet (nginx).** The Vite build is static assets served by nginx. Two hard requirements: (1) **HTTPS via Let's Encrypt/certbot with auto-renewal** — service workers, and therefore offline + install, only run in a secure context and will silently fail without TLS in production. (2) **Atomic deploys** — build to a new release directory and swap an nginx `root` symlink; never overwrite in place, or a mid-deploy load serves mixed old/new hashed assets and poisons the service-worker cache. The droplet also hosts Postgres, the Node/Express API (§6 write validation), and later the P3 vision proxy and P4 MQTT broker, so DB, backend logic, and static serving live on one box.

---

## 4. Data model

### Schema (Postgres DDL — your existing server)
```sql
create table course (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  theme       text not null,
  hole_count  int  not null default 18,
  pars        int[] not null,          -- length 18, values 2..4
  sort_order  int  not null default 0
);

create table round (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references course(id),
  player_tags   text[] not null,       -- 1..4 entries, each [A-Z0-9]{3}
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  client_id     text                    -- dedupe key from device (idempotent sync)
);
-- group_tag deferred; add a nullable group_tag char(3) column when the group feature returns

create table score (
  round_id      uuid not null references round(id) on delete cascade,
  player_index  int  not null,          -- 0..3, maps to player_tags[player_index]
  hole          int  not null,          -- 1..18
  strokes       int  not null,
  primary key (round_id, player_index, hole)
);
```

Notes:
- `client_id` on `round` is a device-generated UUID used as an idempotency key so a retried sync doesn't create duplicate rounds. Upsert on `client_id`.
- Writes go **only through the Node/Express API**, which holds the DB credentials server-side and re-validates every input (§6). The browser never talks to Postgres directly — there is no anon-key path to lock down because there is no direct client DB access.
- Leaderboard queries derive from these tables — no separate leaderboard table needed for P2.
- **If you use SQLite instead of Postgres:** it has no array type — store `pars` and `player_tags` as JSON text columns and parse them in the API. Everything else is identical. Postgres is the default here since it's already running and handles concurrent TV reads + round writes cleanly.

### Local state (IndexedDB)
```ts
// Active round held locally while playing
type LocalRound = {
  clientId: string;          // UUID, becomes round.client_id on sync
  courseId: string;
  playerTags: string[];      // 1..4 tags, each [A-Z0-9]{3}
  scores: Record<number, (number | null)[]>; // playerIndex -> [18] strokes, null = unentered
  createdAt: number;
  completedAt: number | null;
  syncState: 'active' | 'pending' | 'synced';
};
```
- Active round persists to IndexedDB on every stroke edit so a refresh/crash never loses a game.
- On completion, `syncState -> 'pending'`; a sync worker pushes to Supabase and marks `'synced'`. Pending rounds retry on next app open / connection.

### Course data (bundled JSON for v1)
```ts
type CourseSeed = {
  id: string; name: string; theme: string;
  holeCount: 18; pars: number[]; // length 18
  mapAsset: string;              // path to bundled image/SVG
  rules?: string[];              // course-specific notes
};
```
Seed the four courses in `src/data/courses.ts`. Randomize pars (2–4) as placeholders now; replace with real values later. The same seed loads into the `course` table (via the API or a one-off script) when the backend goes live.

---

## 5. v1 feature specs

### 5.1 Scorecard (core)
Flow:
1. **New round** → pick one of the four courses.
2. **Setup** → choose player count (1–4); each player enters a **three-initial tag** (`[A-Z0-9]{3}`, arcade-style entry). Validated per §6. No group name in v1.
3. **Play** → per-hole score entry for all players. Show par for the current hole, each player's running total, and over/under par.
4. **Complete** → final scorecard summary (per-player totals, winner, vs par). Round saved locally and queued for sync.

Requirements:
- Works fully offline; every edit persists to IndexedDB immediately.
- Fast stroke entry — large tap targets, +/- steppers per player per hole (glove-friendly, outdoor sunlight).
- Optional per-hole **max stroke cap** (common in mini golf, e.g. 6) — configurable constant, not hard-coded UI. Default on.
- Navigate holes forward/back; jump to any hole; edit already-entered scores.
- Resume an in-progress round if the app is reopened.
- Handle 1–4 players (not just exactly 4).

### 5.2 Course maps
- One map per course, bundled asset (image or SVG). Viewable offline.
- Per-hole par shown alongside or on the map. Pan/zoom if images are detailed.

### 5.3 Rules
- General rules screen + optional per-course notes. Static bundled content. Offline.

---

## 6. Input validation

Player entry is a **three-character tag** (arcade high-score style). These render on a public TV leaderboard in P2, so treat them as public content.

- Constrain to exactly **3 characters, `[A-Z0-9]`**. Uppercase on input; reject anything else. This alone eliminates almost all abuse surface (no free text, no length handling, no markup).
- **Blocklist of offensive 3-character combos** — the classic arcade problem (ASS, FUK, SEX, etc.). It's a small fixed list, not an open-ended profanity library. Maintain it as a simple array; reject on match and prompt for a different tag.
- Require 1–4 players; each must have a valid tag before a round can start.
- The Node API re-validates the charset + blocklist on write — the client check is bypassable by hitting the endpoint directly.
- **Group tag (deferred):** when added, apply the same `[A-Z0-9]{3}` + blocklist rule so validation stays uniform and no free-text field is ever introduced.

---

## 7. Routes / screens

| Route | Screen | Phase |
|---|---|---|
| `/` | Home — start round, view maps/rules | v1 |
| `/new` | Course picker | v1 |
| `/new/setup` | Player count + three-initial tags | v1 |
| `/play/:clientId` | Active scorecard | v1 |
| `/play/:clientId/summary` | Final scorecard | v1 |
| `/courses` | Course list | v1 |
| `/courses/:id/map` | Course map + pars | v1 |
| `/rules` | Rules | v1 |
| `/tv` | TV leaderboard (full-screen, read-only) | P2 |
| `/hunt` | Scavenger hunt | P3 |
| `/putt` | Arcade Putt minigame | extra |
| `/fun` | "While You Wait" content hub | §12 |
| `/fun/facts` | Fun facts deck | §12 |
| `/fun/trivia` | Trivia round | §12 |
| `/fun/spinner` | Challenge spinner | §12 |

---

## 8. Suggested project structure
```
src/
  data/courses.ts          # four-course seed (pars, map paths, rules)
  db/                       # IndexedDB wrapper (idb/Dexie), LocalRound CRUD
  sync/                     # pending-round sync worker + Supabase client
  lib/sanitize.ts           # §6 validation/profanity
  lib/scoring.ts            # totals, over/under par, winner, stroke cap
  features/
    scorecard/              # setup, play, summary components + state
    courses/                # list, map viewer
    rules/
  routes/                   # route components
  pwa/                      # service worker config, manifest
  App.tsx  main.tsx
public/
  maps/                     # bundled course map assets
  icons/                    # PWA icons
```

---

## 9. Phasing roadmap

**Phase 1 — Launch (this build).** Offline-first PWA: 4-player scorecard, four courses, maps, rules, installable. Silently syncs completed rounds to the Node API / Postgres to seed the leaderboard.

**Phase 2 — TV leaderboard.** Full-screen `/tv` route. Reads persisted rounds/scores; shows best **player** (three-initial) scores for day / week / month / all-time — the classic arcade high-score board. Auto-refresh by **polling the API every few seconds** (or SSE from the Node backend) — no realtime service needed. Runs on any browser or TV stick. Low effort because P1 already stored the data. (Group leaderboard slots in here once the group tag ships.)

**Phase 3 — AI scavenger hunt.** Photo capture (native camera via Capacitor is much better here) → vision model verifies the target item is present → track findings per group. Must-address before committing: per-image vision cost at volume; **content moderation** (public, possibly minors); anti-cheat (photo-of-a-photo); fixed vs rotating item lists (fixed is far simpler). Photos stored on **droplet disk or DO Spaces** (S3-compatible); the Node API proxies the vision calls to keep the API key server-side.

**Phase 4 — Native + interactive course hardware.** Capacitor wrap for app stores if adoption justifies it. Sound/light cues are a **separate hardware project** (ESP32 / Raspberry Pi / smart plugs) reached over local network or an MQTT broker. Architecturally model every effect as "app fires an event → device reacts" so the app stays simple. Out of scope until the software is proven.

---

## 10. Build sequence for Code

Order to hand to Claude Code:
1. Scaffold Vite + React + TS + Tailwind; add `vite-plugin-pwa` with manifest and icons; confirm it installs to a phone home screen.
2. Seed `src/data/courses.ts` with four 18-hole courses (randomized par 2–4, placeholder map assets).
3. Build the scorecard **local-only**: course picker → player-count + three-initial tag entry (§6 validation) → play screen (per-hole entry, running totals, over/under par, stroke cap) → summary. Persist active round to IndexedDB on every edit; support resume.
4. Add maps and rules screens from bundled content.
5. Stand up the Node/Express API against the existing Postgres: schema from §4, all writes through the API (DB creds server-side), `client_id` idempotent upsert, background sync of `pending` rounds with retry. Server-side re-validate names.
7. Deploy to the droplet: nginx serving the static build, certbot TLS with auto-renewal, atomic release-dir + symlink-swap deploy script. Verify the PWA installs over HTTPS from a phone.
6. QA offline: airplane mode mid-round, refresh mid-round, sync-on-reconnect, duplicate-sync prevention.

Get step 3 feeling right in the hand before wiring the backend — the core loop is the whole product.

---

## 11. Known limitations / open items
- **Three-initial tags collide by design** — two different players picking "JIM" appear as separate rows. This is the arcade convention, not a defect; no identity system in v1.
- **No group tag / group leaderboard in v1** — deferred. Data model and validation reserve space for it (add nullable `group_tag char(3)`, same `[A-Z0-9]{3}` rule) so it's an additive change.
- **Par values are placeholders** (random 2–4) until real course pars are supplied.
- **Map assets are placeholders** until real course maps exist.
- **TV display hardware** (smart TV browser vs. Fire Stick vs. mini PC) — decide before P2; does not affect v1.
- **Anonymous writes** — v1 has no auth. The Node API is the only write path and must rate-limit and fully re-validate input, since anyone can hit the endpoint directly. Consider a simple shared app token + rate limiting to blunt abuse.

---

## 12. "While You Wait" content + mini-games

The venue is a whole family-fun-center (mini golf, bowling, axe throwing,
go-karts, bumper cars/boats, batting cages, air hockey, skee-ball), so the app
grows past the scorecard into **line entertainment** — light, offline content to
pass the wait for a lane or a kart.

**Shipped (this build).** A `/fun` hub of three data-driven, fully-offline
mechanics — content lives in `src/data/funContent.ts`, so adding more is just
editing an array:

- **Fun facts** (`/fun/facts`) — a shuffled deck of bite-size, venue-flavored
  facts; tap to advance.
- **Trivia** (`/fun/trivia`) — a 10-question multiple-choice round; questions and
  choices shuffle per game, right/wrong is colored inline, and a final score
  screen offers a replay.
- **Challenge spinner** (`/fun/spinner`) — an SVG wheel of quick, kid-safe group
  dares that decelerates (with ticking) onto a random challenge.

All three reuse the existing UI kit (`Screen`/`TopBar`/`Content`/`Button`), the
neutral light/dark theme, and the synth sound kit (added `playDing`, `playBuzz`,
`playTick`). No new dependencies; nothing hits the network.

**Next — content expansion (cheap).** More facts / trivia (per-attraction packs:
bowling, karts, axe throwing…); themed spinner decks; a "daily" fact; optionally
localize trivia difficulty for younger players. All additive edits to
`funContent.ts`.

**Attraction mini-games (each its own feature, like Arcade Putt).** Small arcade
games themed to the real attractions, playable one-handed while waiting.

- **Skee-ball** (`/fun/skeeball`) — **shipped.** Swipe up the lane to roll into a
  target of discrete ring-holes (10–50 up the center column, 100 in the two top
  corners); the ball rolls down into the hole at the bottom of whichever ring it
  lands in. Nine balls a game. Landing is deterministic from the swipe, but the
  aim trail fades out before the target so judging the line + power is the skill
  (no pinpoint reticle). The clock pauses when the tab/app is backgrounded;
  physics/scoring stay pure functions (`launchVelocity`/`landingPoint`/`holeAt`).

- **Air hockey** (`/fun/airhockey`) — **shipped.** Drag your mallet in the bottom
  half; a capped-speed CPU defends the top. First to 7. Real-time canvas physics
  on a fixed-timestep accumulator (framerate-independent, no puck tunneling), with
  the loop paused when backgrounded. Kept portrait, so no orientation-lock work is
  needed for it.

- **Bumper cars** (`/fun/bumper`) + **Bumper boats** (`/fun/boats`) — **shipped.**
  Floating-joystick top-down driving; ram the AI units for the most bumps in 30
  seconds. Equal-mass elastic collisions on the fixed-timestep accumulator
  (background-paused); a bump only scores when you drive into another unit hard
  enough. Both share one engine (`BumperArena`) parameterized by a `BumperTheme`:
  cars are grippy on a rink, boats are floatier (less damping) on a water arena
  with a long fading wake trail and splash droplets thrown up on each bump. Boats
  use a lower bump threshold so scoring stays on par with the cars despite the
  floatier handling (tuned via an autopilot sim: ~11 boat bumps vs ~9 car).

- **Axe throwing** (`/fun/axe`) — **shipped.** A two-tap timing game: a vertical
  guide sweeps to set aim, a horizontal guide sweeps to set height, then the axe
  flies and sticks where they cross. Five throws; WATL-style target (bullseye 5,
  rings to 1, corner clutches 7). Distinct timing-skill mechanic vs. the
  swipe/physics games; sweeps pause when backgrounded.

- **Batting cages** (`/fun/batting`) — **shipped.** Hold to load the bat back,
  release to swing — contact timing is the moment you let go (perfect = home run,
  near = base hit, off = foul/strike). Ten pitches at varying speeds. Ball descent
  from absolute timestamps for framerate-exact timing; the bat cocks on the load
  and sweeps through the zone on release.

- **Bowling** (`/fun/bowling`) — **shipped.** Swipe up the lane to roll (angle =
  aim, length = power, an angled shot hooks); real ball↔pin↔pin collision physics
  knock the rack down, scored with standard 10-frame rules (strikes, spares,
  10th-frame fill balls). Settlement waits for the pins to finish toppling so a
  fast strike scores correctly.

- **Go-karts** (`/fun/karts`) — **shipped.** A top-down 3-lap time trial on a
  procedural closed circuit. One-touch control: press to accelerate, press
  left/right of center to steer (release to coast); leaving the asphalt for the
  grass cuts your grip. Nearest-point projection handles on/off-track and lap
  detection (forward-wrap past start/finish, guarded against reverse farming).
  Shows current + best lap; background-paused countdown and clock.

**All seven attraction mini-games are now shipped** — the roadmap list is
complete. Further work is content/variants (bumper boats reskin, more trivia/fact
packs, per-attraction leaderboards) rather than new game engines.

Each is a self-contained `src/features/<game>/` route wired into the `/fun` hub
(or its own "Arcade" hub), following the Arcade Putt / Skee-Ball pattern:
canvas/SVG render, a small pure physics/geometry module, client-side only. Build
one at a time and get it "feeling right in the hand" before starting the next —
the same rule as the scorecard core loop.

**Native-wrap notes (Capacitor) for the games that want them.** None of these
block a PWA build; they're where a web API falls short and the Capacitor plugin
is the answer:

- **Orientation lock** (go-karts, air hockey may want landscape): the manifest
  forces `portrait`, and iOS Safari/PWA can't lock orientation via web API at
  all — use the Capacitor `ScreenOrientation` plugin. Skee-ball and the current
  content are portrait, so unaffected.
- **Tilt / motion steering**: iOS needs an explicit `DeviceMotionEvent`
  permission prompt from a user gesture (HTTPS-only, flaky in standalone PWAs).
  Prefer touch controls, or use the Capacitor `Motion` plugin. Not used today.
- **Haptics** (bumper/axe impact feel): little/no vibration on iOS Safari — use
  the Capacitor `Haptics` plugin. Not used today.
- **Game loops**: pause `requestAnimationFrame`/timers on `visibilitychange` so a
  backgrounded game doesn't burn battery or jump state — Skee-Ball already does
  this; carry the pattern into each new game.
