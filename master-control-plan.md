# Master Control — Location Onboarding & Management Plan

A self-contained plan for building **Master Control**: the back-office console
that onboards and manages locations, sitting on top of the existing FFC mini-golf
platform. Hand this to Claude Code as the source of truth for the build.

> Status: **plan / design**. Decisions marked _(recommended)_ are my calls made
> to keep momentum; each notes the alternative so they're cheap to change before
> code lands.

---

## 1. Product summary

Today the platform is a player-facing PWA backed by a Node/Express + Postgres
API. Content (which locations exist, their courses, coordinates, timezones) lives
in **two places at once**: the bundled `src/data/courses.ts` that the player app
actually renders, and the Postgres `location`/`course` tables that own
rounds/leaderboard/hunt. There is **no back office** — locations are onboarded by
editing code + running `ffc seed`, and the only write auth is a single shared
`APP_TOKEN` header.

**Master Control** is the console that replaces the "edit code + seed" ritual with
a real management surface, and introduces the **org (owner/franchise) level above
locations** that the data model is currently missing.

Domain hierarchy after this work:

```
Org (owner / franchise)          ← NEW
  └─ Location                     (existing `location` table)
       └─ Course                  (existing `course` table)
            └─ Hunt items, rounds, scores  (existing)
```

### Locked / proposed decisions
| Decision | Choice | Notes |
|---|---|---|
| New top entity | **`org`** table above `location`; `location.org_id` FK | Owner/franchise level |
| Who uses it | **Operator / super-admin only — franchisees have NO admin access** ✅ decided | Master Control is an internal back office; franchise owners never log in |
| Auth (v1) | **Super-admin behind `APP_TOKEN`** ✅ decided; schema still pre-wired for accounts later | No RBAC/logins in v1 (no franchisee self-serve to support) |
| Delete semantics | **Archive / hide (soft), never hard-delete played data** ✅ decided | Archived rows hidden from players + default admin lists; unarchive available |
| Course art | **Deferred — map art/themes stay bundled assets** ✅ decided | Console edits data fields only; no upload/media pipeline in v1 |
| Content source of truth | **OPEN — see §5 / §10** (recommended default: locations live via API, courses bundled) | Franchisee-self-serve is off the table, so the decision is purely: does operator onboarding go live to players, or need a build? |
| v1 admin scope | **Orgs + Locations + Courses management**, plus a light read-only rollup | Hunt-list editing & rich dashboards are Phase 2 |
| Delivery | **Separate admin build served on its own vhost (`admin.ffc.lab980.com`)** — not part of the player PWA | No service worker, no offline, no admin code in the player bundle |
| Admin TLS | **Wildcard `*.ffc.lab980.com` cert via certbot DNS-01, backed by `doctl`** | One admin subdomain now; wildcard so future subdomains need no cert work. Plugin-free — reuses the droplet's existing doctl auth, no token to mint |
| Write path | All admin writes go through the **existing Express API** (creds server-side), never the browser → DB | Matches architecture principle §3 of the base app |

---

## 2. Where this slots into the current system

Concrete facts the build must respect (verified against the repo):

- **`server/routes/locations.js`** already does location create/update/list with
  timezone derivation from coordinates and the `APP_TOKEN` gate. Master Control's
  location endpoints **extend this router**, not replace it. It's missing: `GET /:id`,
  `DELETE`, and org scoping.
- **`server/routes/seed.js`** already upserts courses (`POST /api/seed`, array of
  course seeds, `APP_TOKEN`-gated, `pars` length-18 / values 2–4). Course
  management builds on this shape; we add per-course GET/PATCH/DELETE.
- **`server/schema.sql`** is idempotent DDL run on every `ffc migrate`. New tables
  and columns are added here as `create table if not exists` / `alter table … add
  column if not exists`, following the file's existing convention. **Never** write
  a destructive migration — the file explicitly refuses to drop played data.
- **The player app reads content from the bundle, not the DB** (see the note in
  `schema.sql`: "course lists come from the bundled frontend data"). This is the
  single most important constraint: **admin edits do not reach players until we add
  a DB read path or rebuild the bundle.** §5 addresses this head-on.
- **Auth is one shared token.** `authorized(req)` in both routes checks
  `x-app-token === APP_TOKEN`, and an unset token means "dev, allow". Master
  Control keeps this as the v1 gate but centralizes it into middleware.
- **Deploy is the `ffc` CLI** (`bin/ffc`): `migrate` → build → atomic release swap
  → pm2 restart. Anything we add must be reachable through `ffc deploy`/`migrate`
  with no new manual steps.

---

## 3. Data model changes

All DDL goes in `server/schema.sql`, idempotent, matching the file's style.

### 3.1 New `org` table
```sql
create table if not exists org (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,      -- 'bullwinkles'
  status      text not null default 'active',  -- active | suspended
  created_at  timestamptz not null default now(),
  sort_order  int  not null default 0
);
```

### 3.2 Link locations to an org
```sql
alter table location add column if not exists org_id uuid references org(id);
create index if not exists location_org_idx on location (org_id);
```

### 3.2b Archive columns (soft-delete)
Deletes are archives, not row removals (decided). Add a nullable `archived_at` to
every admin-managed entity; a non-null value means "hidden from players and from the
default admin list, but retained with all history intact". `org.status` already
carries `active | suspended`; add `archived` to its allowed values or lean on the
same `archived_at` for consistency.
```sql
alter table location add column if not exists archived_at timestamptz;
alter table course   add column if not exists archived_at timestamptz;
alter table org      add column if not exists archived_at timestamptz;
create index if not exists location_active_idx on location (archived_at);
create index if not exists course_active_idx   on course   (archived_at);
```
Every player-facing and default admin read filters `archived_at is null`; a separate
"Archived" admin view lists the rest and offers **unarchive** (set `archived_at =
null`). Nothing is ever hard-deleted through the console.
- `org_id` is **nullable** so existing locations migrate cleanly. A seed step
  creates a default org for the current client (Bullwinkle's) and backfills the
  three existing locations onto it — idempotent, id-stable, mirroring how
  `location`/`course` are already seeded.
- The three existing location UUIDs and the default org id become fixed constants
  shared between `schema.sql` and `src/data/*` (as the current ids already are).

### 3.3 Audit trail (recommended, small)
```sql
create table if not exists admin_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      text,               -- token label / user id once accounts exist
  action     text not null,      -- 'org.create', 'location.update', 'course.delete'
  entity     text not null,      -- 'org' | 'location' | 'course'
  entity_id  uuid,
  detail     jsonb,              -- before/after or the submitted payload
  created_at timestamptz not null default now()
);
```
Cheap insurance: onboarding/editing locations is exactly the kind of change you
want a paper trail for. Every successful admin write logs one row.

### 3.4 Forward-compat for accounts (schema only, no code in v1)
To honor "super-admin now, roles later" without a future rewrite, add the tables
now but leave them unused by v1 code:
```sql
create table if not exists admin_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  role          text not null default 'org_admin',  -- super_admin | org_admin
  org_id        uuid references org(id),             -- null for super_admin
  password_hash text,
  created_at    timestamptz not null default now()
);
```
v1 doesn't read this; it exists so the org-scoping in the API (§4) has a natural
home when logins arrive, and so we never have to re-plumb `org_id` through queries.

---

## 4. API design

New/extended routes on the existing Express app. **One shared auth middleware**
extracted from the duplicated `authorized()` helpers, so every mutating admin route
is gated identically and audit-logged in one place.

```
server/routes/admin/
  index.js        mounts the admin sub-routers under /api/admin, applies auth mw
  orgs.js         org CRUD
  locations.js    location CRUD (wraps/extends existing location logic)
  courses.js      course CRUD (wraps/extends existing seed logic)
  overview.js     read-only rollups
server/lib/adminAuth.js   requireAppToken middleware + audit helper
```

Design choices:
- **Mount under `/api/admin/*`** so admin endpoints are grouped, easy to firewall
  or move behind a login later, and never confused with public read routes.
- **Keep `POST /api/locations` and `POST /api/seed` working** (backward compat for
  the `ffc seed` CLI and any scripts). The admin routers reuse their normalize/
  validate functions rather than forking the logic — refactor the validators out of
  the route files into `server/lib/validate*.js` so both callers share them.

| Method & path | Purpose |
|---|---|
| `GET  /api/admin/orgs` | list orgs (+ location counts) |
| `POST /api/admin/orgs` | create/update org (upsert on id, else slug) |
| `GET  /api/admin/orgs/:id` | one org with its locations |
| `POST /api/admin/orgs/:id/archive` | archive (set `archived_at`) / `…/unarchive` to restore |
| `GET  /api/admin/locations?orgId=&archived=` | list locations, org-scoped; `archived=1` for the archived view |
| `POST /api/admin/locations` | create/update location (reuses `normalizeLocation`, adds `orgId`, tz-from-coords) |
| `GET  /api/admin/locations/:id` | one location + its courses |
| `POST /api/admin/locations/:id/archive` | archive / `…/unarchive` to restore |
| `GET  /api/admin/locations/:id/courses` | courses for a location |
| `POST /api/admin/courses` | create/update course (reuses seed normalize; `pars` 18×2–4) |
| `PATCH /api/admin/courses/:id` | edit name/theme/pars/holeCount/sortOrder |
| `POST /api/admin/courses/:id/archive` | archive / `…/unarchive` to restore |
| `GET  /api/admin/overview` | counts: orgs, locations, courses, rounds (7/30d), hunt finds, per location |

**Delete = archive (decided).** There is no hard-delete endpoint in v1. Archiving
sets `archived_at`; the row and all its history (rounds/scores/finds) stay intact,
and it simply disappears from players and the default admin lists. Archiving a
parent cascades in the *read* sense only — a query helper hides an org's/location's
children when the parent is archived, but no rows are removed. This satisfies the
`schema.sql` rule ("never silently drop played user data") by never dropping
anything, and it's gentler than the 409-block model: the operator can always undo.

Validation reuses the existing regexes/ranges (UUID, kebab `slug`, lat/lng bounds,
tz via `isValidTz`, pars). Responses keep the current JSON casing
(`geofenceKm`, `sortOrder`, `tzLabel`).

---

## 5. Making admin edits actually reach players (the split-brain fix)

This is the crux. Right now `src/data/courses.ts` is what players see. Three ways to
close the gap, in increasing ambition:

- **Alt B — admin writes DB only (lowest risk).** Master Control manages Postgres;
  player-visible location/course changes still require editing `courses.ts` + a
  build. Admin fully drives leaderboard/hunt/geo, but onboarding a location is *not*
  live for players. Rejected as the primary path: it doesn't deliver the core
  promise ("onboard a location" should light it up).

- **Recommended — locations live via API, courses bundled for now.** Add **public
  read endpoints** the player app already half-has (`GET /api/locations` exists):
  - `GET /api/locations` (public, cached, **`archived_at is null` only**) → the
    location list + geo/tz/accent the app uses for location detect and picking. The
    app fetches this on load, **falls back to the bundled `LOCATIONS` when offline**
    (PWA requirement), and caches the last good response in IndexedDB. Onboarding a
    location in Master Control makes it appear to players without a redeploy; archiving
    one removes it from the public list.
  - **Courses stay bundled** because a course also carries art (`mapAsset`), themed
    rules, and accent that live in the frontend. Master Control edits course rows in
    the DB (names/pars/theme for leaderboard/hunt correctness); shipping new
    player-visible course *art* remains a build. This matches reality: pars are
    still placeholders and per-course art is pending (§11 of the base plan).

- **Alt A — flip the whole app to API-driven content.** Cleanest long-term, biggest
  change: every screen sources locations+courses from the API with an offline cache
  and a bundled seed as first-paint fallback. Worth a dedicated later phase; out of
  scope for v1 because of the PWA offline + service-worker-precache implications.

**Decision:** build the recommended middle path. Concretely, a small
`src/data/locations-source.ts` that returns API data when fresh, bundle otherwise,
so the switch is one module and the rest of the app is unchanged.

---

## 6. Admin UI — a separate build

Master Control is **its own SPA**, not a route in the player PWA. It shares the
repo, the Postgres DB, and the Express API, but ships as a distinct bundle on its
own vhost. This means: no service worker, no offline caching, no
robots/precache/scope gymnastics, and **zero admin code in the player bundle**.

- **Build:** a second Vite entry (`admin/index.html` + `vite.admin.config.ts`)
  building to `dist-admin/`. Plain SPA — the `vite-plugin-pwa` config stays on the
  player build only. Reuses the existing Tailwind v4 setup and
  `src/ui/components.tsx` primitives so the console matches the house style with no
  new dependencies.
- **Serving:** an nginx vhost `admin.ffc.lab980.com` with `root …/current/dist-admin`
  and `/api` proxied to the same Express port as the player app. `bin/ffc` gains an
  admin build + vhost step (see §9); `ffc deploy` builds both bundles in the same
  atomic release swap.
- **TLS — wildcard, DNS-01.** The admin vhost is served under a **wildcard
  `*.ffc.lab980.com` certificate** issued via certbot **DNS-01**, not the per-host
  HTTP-01 flow the player site uses today. This is a deliberate change:
  - It's the only cert model that can cover a wildcard, and it means **any future
    subdomain** (`admin.`, and later per-org/per-location/per-function if ever
    wanted) is covered with **zero additional cert work** — no re-running certbot per
    host.
  - DNS for `lab980.com` is on **DigitalOcean**, and the droplet is already
    **`doctl`-authenticated** — so the DO credential exists on the box and there is
    **no token to mint**. That lets us do DNS-01 **plugin-free**, using certbot manual
    hooks that shell out to `doctl` to write/remove the `_acme-challenge` TXT record:
    ```
    # deploy/acme-doctl-auth.sh   (certbot --manual-auth-hook)
    doctl compute domain records create lab980.com \
      --record-type TXT \
      --record-name "_acme-challenge.${CERTBOT_DOMAIN%.lab980.com}" \
      --record-data "$CERTBOT_VALIDATION" --record-ttl 30
    # deploy/acme-doctl-cleanup.sh (certbot --manual-cleanup-hook) deletes it again

    certbot certonly --manual --preferred-challenges dns \
      --manual-auth-hook   /var/www/ffc/deploy/acme-doctl-auth.sh \
      --manual-cleanup-hook /var/www/ffc/deploy/acme-doctl-cleanup.sh \
      -d '*.ffc.lab980.com' -d 'ffc.lab980.com' \
      -n --agree-tos -m ivjames@gmail.com
    ```
    Certbot records these hook paths in the renewal config, so **auto-renew runs
    unattended** as long as the in-repo hook scripts stay on disk (they ship in
    `deploy/`, so paths are stable across deploys). No apt plugin, no separate
    credentials INI — it reuses the existing doctl auth.
  - Plus a wildcard `*.ffc.lab980.com` A record in DO DNS pointing at the droplet
    (one-time; also scriptable via `doctl compute domain records create`).
  - **Alt (plugin):** `python3-certbot-dns-digitalocean` with a DO token in
    `/etc/letsencrypt/dns-digitalocean.ini` is the more "standard" route if you'd
    rather not maintain hook scripts. It needs a token dropped in that INI — slightly
    more setup than reusing doctl, so the hook approach is preferred here.
  - `bin/ffc` grows a `wildcard-cert` path wrapping that DNS-01 issue/renew; the admin
    vhost references the resulting cert. The existing player `vhost` (HTTP-01) is
    left as-is — or optionally folded under the same wildcard later, since the cert
    above already covers the apex `ffc.lab980.com` too.
  - **Scope note:** we're provisioning exactly **one** admin subdomain now. The
    wildcard is chosen purely so adding subdomains later never touches the cert flow
    — the multi-tenant/per-org subdomain routing itself (Host→slug scoping) stays
    **deferred** (see §10).
- **Gate:** a token entry screen; the entered `APP_TOKEN` is held in memory/
  `sessionStorage` and sent as `x-app-token` on every admin call. A 401 bounces back
  to the gate. (When accounts land in Phase 2, this screen becomes a real login and
  the token becomes a session cookie/JWT — the UI shell doesn't change.)
- **Screens:**
  1. **Overview** — the rollup from `GET /api/admin/overview`: orgs, locations,
     courses, rounds this week, recent activity.
  2. **Orgs** — list → org detail (its locations) → create/edit org form.
  3. **Location onboarding wizard** — the headline flow: name + slug → drop a pin /
     enter address for lat/lng → **timezone auto-derived and shown** (the API already
     does this) → geofence radius → accent → assign to org. Live preview of the
     derived tz label so the operator sees "Pacific Time (PT)" before saving.
  4. **Location detail** — edit location, list/add/edit courses (name, theme, 18 pars
     grid, hole count), and **archive** a location or course (with a confirm; archived
     items drop out of the list). No hard delete.
  5. **Archived view** — a filtered list (per entity type) of archived orgs/locations/
     courses with a one-click **unarchive**. Keeps the primary lists clean while
     making nothing unrecoverable.

**Isolation is the point:** because it's a separate origin, the admin app is trivial
to firewall (IP-allowlist the vhost, or drop it behind basic-auth at nginx) on top
of the API token gate, and the player app can never accidentally surface admin UI.

---

## 7. Auth & security

- **Audience:** operator/super-admin **only**. Franchisees have **no** admin access in
  any release currently planned — Master Control is an internal back office, so there
  is no franchisee-facing surface to secure, no self-serve org scoping to enforce in
  v1. (The `admin_user`/`org_id` scaffolding in §3.4 stays for optionality, unused.)
- **v1:** single `APP_TOKEN` super-admin gate, centralized in
  `server/lib/adminAuth.js`. Unset token still means "dev, allow" locally, matching
  current behavior — but **document that production MUST set `APP_TOKEN`** (it
  already should for `/api/locations` + `/api/seed`; the admin surface makes this
  non-negotiable, so add a startup warning if `/api/admin/*` is mounted with no
  token).
- **Transport:** admin endpoints only over HTTPS (already true behind nginx/certbot).
- **CORS:** the app currently `app.use(cors())` (open). Admin mutations are
  token-gated so open CORS is acceptable for v1. Since the admin app is now its own
  origin (`admin.ffc.lab980.com`), `/api/admin/*` CORS can be locked to that origin
  straight away, and the vhost itself can be IP-allowlisted / basic-auth'd for
  defense in depth.
- **Audit:** every successful mutation writes `admin_audit` (§3.3).
- **Phase 2 accounts:** `admin_user` table (§3.4) + bcrypt + a sessions mechanism;
  super-admin sees all orgs, `org_admin` is scoped to `org_id`. The API queries are
  written from day one to accept an optional org scope, so adding enforcement is a
  middleware change, not a query rewrite.

---

## 8. Suggested file layout

```
server/
  lib/
    adminAuth.js         requireAppToken + audit()
    validateLocation.js  extracted from routes/locations.js (shared)
    validateCourse.js    extracted from routes/seed.js (shared)
  routes/
    admin/
      index.js
      orgs.js
      locations.js
      courses.js
      overview.js
    locations.js         unchanged public behavior, now imports validateLocation
    seed.js              unchanged, now imports validateCourse
  schema.sql             + org, location.org_id, admin_audit, admin_user, seeds

src/
  data/
    locations-source.ts  API-with-bundle-fallback resolver (§5)

admin/                   the separate admin SPA (own bundle)
  index.html             admin entry (no PWA plugin)
  main.tsx               mounts ControlApp
  ControlApp.tsx         admin shell + token gate + routes
  Overview.tsx
  Orgs.tsx
  LocationWizard.tsx
  LocationDetail.tsx
  api.ts                 typed admin API client (sends x-app-token)

vite.admin.config.ts     builds admin/ -> dist-admin/ (imports src/ui + tailwind)
deploy/
  nginx.admin.conf.template   admin.ffc.lab980.com vhost (root dist-admin, /api proxy)
```
The player `App.tsx` is **untouched** — no `/control` route, no admin imports.
The admin app reuses shared primitives from `src/ui/*` but has its own entry, so
Vite tree-shakes the two bundles apart.

---

## 9. Phasing / build sequence

1. **Schema** — add `org`, `location.org_id`, `archived_at` on org/location/course,
   `admin_audit`, `admin_user`; seed the default org + backfill the three locations.
   Verify `ffc migrate` is idempotent.
2. **API refactor** — extract shared validators; add `adminAuth` middleware + audit;
   keep `/api/locations` + `/api/seed` green.
3. **Admin API** — `/api/admin/orgs|locations|courses|overview` + archive/unarchive
   endpoints (no hard delete); reads default to `archived_at is null`.
4. **Public location read** — confirm `GET /api/locations` shape + `locations-source.ts`
   fallback wiring.
5. **Admin build + vhost** — second Vite entry (`vite.admin.config.ts` → `dist-admin/`);
   `bin/ffc` builds both bundles in the atomic release swap and (re)writes the
   `admin.ffc.lab980.com` vhost. TLS via a **wildcard `*.ffc.lab980.com` DNS-01 cert**
   (new `ffc wildcard-cert` path): ship the `deploy/acme-doctl-{auth,cleanup}.sh`
   hooks, add the wildcard `*.ffc.lab980.com` A record in DO DNS (`doctl`), issue once
   via `certbot --manual` DNS-01 backed by doctl, auto-renew thereafter. No token to
   mint — the droplet's existing doctl auth is reused.
6. **Admin UI** — token gate → Overview → Orgs → Location wizard → Location/course
   detail, shipped in the admin bundle.
7. **Docs/CLI** — README + `server/README.md` for the new endpoints and the admin
   vhost; confirm the extended `ffc deploy`; note `APP_TOKEN` is now required in prod.
8. **(Phase 2)** hunt-list editing, richer dashboards, real admin accounts/RBAC,
   optional full API-driven player content (Alt A).

---

## 10. Open questions / risks

**Decided (this pass):**
- ✅ **Audience** — operator/super-admin only; **franchisees get no admin access**. §7.
- ✅ **Auth depth** — single shared `APP_TOKEN` for v1; no logins/RBAC. §7.
- ✅ **Delete semantics** — **archive/hide** (soft), never hard-delete; unarchive
  available. §3.2b, §4, §6.
- ✅ **Course art** — deferred; art/themes stay bundled assets. §5.

**Still open:**
- ⚠️ **Content source of truth (§5) — the one real remaining decision.** With
  franchisee self-serve off the table, the question is purely: when the *operator*
  onboards/edits a location, should it go **live to players via the API** (recommended
  default: locations live, courses bundled), or is **admin-writes-DB-only** (changes
  need a build to reach players) enough? This sets how much of the read path we build
  in v1. Answer pending.

**Risks / confirmations:**
- **`APP_TOKEN` in prod.** Onboarding writes must not be world-open; the plan assumes
  `APP_TOKEN` is set in production. Worth confirming it currently is on the droplet.
- **Per-tenant subdomains (deferred).** v1 ships exactly one admin subdomain, but the
  wildcard cert (§6) leaves the door open to per-org/per-location subdomains later
  (`bullwinkles.ffc.lab980.com`, Host→`org.slug` scoping feeding the `org_admin`
  role). Not built now — flagged so the org-scoped API queries stay written in a way
  that a Host-derived tenant could later drive.
- **DNS-01 prerequisites (resolved: DigitalOcean + doctl).** `lab980.com` DNS is on DO
  and the droplet is already `doctl`-authenticated, so the wildcard cert is issued
  plugin-free via `certbot --manual` DNS-01 hooks that call `doctl`. **No operator
  action required** — no token to mint, no INI to write; the existing doctl auth is
  reused. Everything (hooks, `ffc wildcard-cert`, the vhost, the wildcard A record) is
  code/CLI. The only assumption to confirm: the authenticated DO token has **write
  scope** for `lab980.com` domain records (needed to create the ACME TXT record).
```
