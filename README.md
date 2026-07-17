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
npm run build      # tsc + vite build -> dist/  (includes the service worker)
npm run preview    # serve the production build locally
```

## Layout

```
src/
  data/courses.ts          # four-course seed (pars, map paths, rules)
  db/                      # IndexedDB wrapper (idb), LocalRound CRUD
  sync/                    # pending-round sync worker + API client
  lib/sanitize.ts          # tag validation + profanity blocklist (§6)
  lib/scoring.ts           # totals, over/under par, winner, stroke cap
  features/
    home/  scorecard/  courses/  rules/  tv/
  ui/                      # shared touch-first components
public/
  maps/                    # bundled course map assets (SVG placeholders)
  icons/                   # PWA icons
server/                    # Node/Express + Postgres API (see server/README.md)
bin/ffc                    # operate CLI (setup/deploy/seed/restart/logs/backup)
deploy/                    # nginx vhost template + course seed JSON
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
