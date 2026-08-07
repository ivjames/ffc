# Mini Golf Scorecard

Offline-first PWA for a mini golf venue with **four themed 18-hole courses**.
The core is an easy 1–4 player scorecard that works fully offline; completed
rounds sync to a Postgres-backed API to seed the (Phase 2) leaderboard.

Built to the spec in [`mini-golf-app-plan.md`](./mini-golf-app-plan.md). This is
**Phase 1 — Launch**.

## What's here (Phase 1)

- **Scorecard core loop** — course picker → 1–4 players with three-initial
  arcade tags → per-hole entry (par, running totals, over/under, stroke cap) →
  final scorecard. Every edit persists to IndexedDB immediately; an in-progress
  round resumes after a refresh/crash.
- **Course maps** — one bundled SVG per course (placeholder art), viewable
  offline, with per-hole pars.
- **Rules** — general rules + per-course notes, static bundled content.
- **Installable PWA** — `vite-plugin-pwa` (Workbox) service worker precaches the
  whole app shell + maps for offline use.
- **Silent sync** — completed rounds queue locally and POST to the Node/Express
  API (idempotent on a client-generated UUID) when online. Nothing is lost
  offline; nothing is duplicated on retry.
- **Backend API** (`server/`) — Node/Express + Postgres. All DB writes go
  through it (creds server-side); it re-validates every input. Also serves a
  leaderboard query (Phase 2 preview at `/tv`).

## Phase 3 — AI scavenger hunt (`/hunt`)

Each course has its own themed list of things to find — four courses, four
lists. Players snap a photo of each, and a vision model verifies it. The model
call is proxied by the Node API so the key (`ANTHROPIC_API_KEY`) stays
server-side; verified photos are stored on the droplet disk. Findings are tracked
per player and per group (the round's roster). The model also flags
photo-of-a-photo attempts (anti-cheat). The lists are fixed for now. Every photo
is **auto-moderated in the same vision call**: unsafe content (family-venue
standard) is blocked before it touches disk, and stored photos carry
people/minors flags plus a recorded moderation status (people in photos are
welcome; only unsafe content blocks). A human review surface is deferred.

The hunt is available **during gameplay only** — it's gated on an in-progress
round, so it isn't an open invitation to wander the course during others' games.
A future expansion is at most new **zones** (each a course-like area with its own
list). See [`server/README.md`](./server/README.md) for the `/api/hunt/*` endpoints.

**Testing toggles.** Two flags loosen the hunt for on-site testing:

- `HUNT_ALLOW_PHOTO_OF_PHOTO` (server, `server/.env.example`) — bypass the
  photo-of-a-photo anti-cheat so a screenshot / picture of a screen still
  verifies a landmark. Defaults off; leave unset for the production-safe state.
- `VITE_DEV_MODE` (client, `.env.example`) — dev mode lets a find come from the
  phone's photo library, not just a live camera capture (it also gates the other
  dev-only UI). Defaults **on**; set to `false` for production so players must
  take a real photo.

## Post-meeting punchlist features

Built to [`post-meeting-punchlist.md`](./post-meeting-punchlist.md) (all tier-1
items except player registration, which is a separate effort):

- **Announcements** — venue specials/updates managed in Master Control, shown
  as a rotating banner on Home and the TV board. This is the platform's first
  **live** content read (`GET /api/announcements`, polled + cached for offline);
  no rebuild needed to publish a promo.
- **Team tag** — an optional 3-char team tag at round setup (same rules as
  player tags). The TV board gains a Players/Teams toggle; a team round scores
  as average strokes per player, best per course (`/api/leaderboard?by=team`).
- **Venue display wall** — `/tv/wall` shows all of a venue's course boards
  side by side (one column per course) for a TV pointed at the URL, separate
  from the phone-first `/tv`. Zero interaction: venue/period/player-vs-team/
  row count all come from query params (`?location=upland&period=day`), fed by
  `GET /api/leaderboard/courses`, polling every 10s with announcements across
  the top.
- **Food & Drink card** — per-location menu/ordering deep links set in Master
  Control, shown on Home when set (grayed out offline). Ships via the normal
  content export.
- **Rewards** — completed rounds earn achievements server-side (Hole-in-One,
  Under Par, Hunt Master), each with a short redemption code shown on the final
  scorecard; staff look codes up under Master Control → Rewards and mark them
  redeemed at the counter.
- **Score sharing** — "Share this round" on the final scorecard renders a
  branded score image client-side (canvas → Web Share API, download fallback).
  Numbers only — no photos, so no moderation surface.
- **Office reporting** — Master Control's Overview gains 30-day trend charts
  (rounds / players / hunt finds) and a rounds CSV export with a date range.
- **Photo auto-moderation** — every hunt photo is moderated by the same vision
  call that verifies the find (no extra model spend): unsafe content is blocked
  before it ever touches disk, and people/minors presence is recorded per
  photo. Auto-mod only for now (a human review surface is a later concern, and
  will start with full history since every verdict is stored).
- **Hunt photo sharing** — verified, auto-approved photos get a share chip in
  the hunt UI (Web Share API, download fallback). Photos are served only to
  the group that took them (keyed by the unguessable round id — no public
  gallery), and only when auto-moderation approved them. Venue policy: photos
  with minors are sharable (a family sharing its own picture).

## Tech stack

React + TypeScript + Vite · Tailwind CSS v4 · `vite-plugin-pwa` · IndexedDB
(`idb`) · react-router · Node/Express + `pg` · deployed on the lab980 droplet
behind nginx with certbot TLS.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173  (proxies /api -> localhost:8060)
```

Run the backend alongside it (optional in dev — the app works without it, rounds
just stay queued):

```bash
cd server
cp .env.example .env      # set DATABASE_URL, PORT=8060
npm install
npm run migrate           # create tables
npm start                 # http://localhost:8060
```

## Build

```bash
npm run build      # export content from DB (best-effort) + tsc + vite -> dist/
npm run build:admin # Master Control admin SPA -> dist-admin/ (separate bundle)
npm run preview    # serve the production build locally
```

`npm run build` first runs `scripts/export-content.mjs`, which regenerates
`src/data/content.generated.ts` from the live DB (`GET /api/content`) so
Master Control edits reach players on the next build. It degrades gracefully —
if the API is unreachable it keeps the committed generated file, so builds never
break offline.

## Master Control (venue admin)

A separate back-office SPA (`admin/`) for onboarding and managing **orgs**
(owner/franchise), **locations** (venues), and **courses**. It writes to Postgres
through the token-guarded `/api/admin/*` API; the DB is the source of truth, and a
site rebuild publishes player-visible content. It ships as its own bundle
(`dist-admin/`) on its own vhost `admin.<fqdn>` — **not** part of the player PWA.
Design + decisions: [`master-control-plan.md`](./master-control-plan.md).

```bash
npm run dev -- --config vite.admin.config.ts   # admin on http://localhost:5174
```

## Testing

Three layers, each covering something the others can't:

```bash
cd server && npm test                      # backend: node:test, see server/README.md
npm run test:admin                         # admin SPA components: Vitest + RTL, mocked api.ts
npm run test:e2e                           # admin SPA e2e: Playwright, real server + Postgres
```

- **`npm run test:admin`** (`admin/*.test.tsx`, config `vitest.admin.config.ts`) —
  fast, no server or DB needed. `./api` is mocked with `vi.mock`, so these test
  component logic in isolation: the RBAC UI gating (`org_admin` vs `super_admin`
  seeing different controls in `Orgs.tsx`/`OrgDetail.tsx`/`Archived.tsx`/
  `LocationWizard.tsx`), the sign-in state machine (`ControlApp.tsx` — checking →
  locked/unlocked, the token vs. session paths, the global sign-out event), and
  `api.ts`'s fetch/401 handling directly (the `quiet401` distinction — a failed
  login is a normal local error, not "you got signed out").
- **`npm run test:e2e`** (`e2e/*.spec.ts`, config `playwright.config.ts`) — a real
  browser against the real Express API + Postgres (`globalSetup`/`globalTeardown`
  seed and clean up two fixed `admin_user` accounts + an org at
  `TEST_DATABASE_URL`, same DB `server/`'s own tests use — create it once with
  `createdb ffc_test`). Playwright's `webServer` option starts both the API
  (`server/index.js`) and the admin dev server automatically. This layer exists
  because manual browser testing during the RBAC work caught two real bugs
  (cookie/credentials handling, a dev-proxy path collision) that mocked
  component tests couldn't have — it's complementary to `test:admin`, not
  redundant with it.
- Both admin layers are separate from `server/`'s own `node:test` suite (backend
  routes/validators/RBAC enforcement) — see `server/README.md`'s "Testing"
  section for that.

## Layout

```
src/
  data/content.generated.ts # DB-exported catalog (locations + course data)
  data/courses.ts          # merges frontend styling (accents/rules) onto the above
  db/                      # IndexedDB wrapper (idb), LocalRound CRUD
  sync/                    # pending-round sync worker + API client
  lib/sanitize.ts          # tag validation + profanity blocklist (§6)
  lib/scoring.ts           # totals, over/under par, winner, stroke cap
  features/
    home/  scorecard/  courses/  rules/  tv/
  ui/                      # shared touch-first components
admin/                     # Master Control admin SPA (separate bundle -> dist-admin)
scripts/export-content.mjs # build-time DB -> content.generated.ts exporter
public/
  maps/                    # bundled course map assets (SVG placeholders)
  icons/                   # PWA icons
server/                    # Node/Express + Postgres API (see server/README.md)
bin/ffc                    # operate CLI (setup/deploy/seed/wildcard-cert/admin-setup)
deploy/                    # nginx vhost templates + ACME doctl hooks + seed JSON
```

## Deploy

Two commands on the droplet (lab980 convention):

```bash
provision-site ffc ivjames/ffc     # subdomain shell: DNS + clone + dir
ffc setup                          # migrate + build + vhost + TLS + seed
```

Routine updates: `ffc deploy`. Full runbook in [`DEPLOY.md`](./DEPLOY.md).

## Known placeholders (Phase 1)

- **Par values** are random 2–4 placeholders until real course pars are supplied.
- **Map art** is generated placeholder SVGs until real maps exist.
- **Group tag / leaderboard**, **TV board**, **AI scavenger hunt**, and
  **native + IoT** are Phases 2–4 — the data model reserves space for them so
  they're additive (see the plan's §9 / §11).
