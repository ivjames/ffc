# ffc-server

Backend API for the FFC mini-golf scorecard PWA. Plain Node/Express + Postgres
(`pg`). All DB writes go through this API — the browser holds active rounds in
IndexedDB (offline-first) and syncs completed rounds here. There is no Supabase.

## Run locally

```sh
npm install
cp .env.example .env          # set DATABASE_URL (and optionally APP_TOKEN)
npm run migrate               # create tables from schema.sql
npm start                     # listens on PORT (default 8060)
```

Node >= 18 (ES modules).

## Deploy (lab980 droplet)

Runs under **pm2** on a local port in the **8060+** range, behind per-site nginx
with certbot TLS, one dir per site (`/var/www/ffc-server` or similar). Typical:

```sh
cd /var/www/<dir> && npm ci && npm run migrate && pm2 start index.js --name ffc-server && pm2 save
```

## Environment

| var            | purpose                                                        |
| -------------- | -------------------------------------------------------------- |
| `DATABASE_URL`      | Postgres connection string (server-side creds).           |
| `PORT`              | Listen port (default 8060).                               |
| `APP_TOKEN`         | Shared token guarding `POST /api/seed`, `POST /api/locations`, and the whole `/api/admin/*` (Master Control) surface. Unset = allow (dev). **Must be set in production** — the admin surface is world-writable without it (the API warns at startup). |
| `VENUE_TZ`          | **Fallback** IANA timezone for leaderboard calendar windows, used only for a venue whose `location.tz` is unset. The real zone is per venue (see "Venue timezones" below). Default `America/Los_Angeles`. |
| `ANTHROPIC_API_KEY` | Vision key for the scavenger hunt (`POST /api/hunt/verify`). Unset = hunt verification returns `503`; the rest of the API is unaffected. |
| `HUNT_UPLOAD_DIR`   | Where verified hunt photos are stored on disk. Default `<cwd>/data/hunt-uploads`; point at a durable volume in production. |

## Endpoints

All JSON. Base path `/api`.

### `GET /api/health`
→ `200 { "ok": true }`

### `POST /api/rounds`
Idempotent sync of a completed round. Deduped on `clientId`.

Request:
```json
{
  "clientId": "device-uuid-or-similar",
  "courseId": "<uuid, must exist>",
  "playerTags": ["ABC", "XY9"],
  "createdAt": 1700000000000,
  "completedAt": 1700000900000,
  "scores": { "0": [3,2,null,4, ...18 ], "1": [2,3,3,null, ...18 ] }
}
```
- `playerTags`: 1..4 entries, each `[A-Z0-9]{3}`, not on the blocklist.
- `scores`: object keyed by player index (`0..playerTags.length-1`); each value
  an array of length 18 of `number|null`. Only non-null holes are stored; strokes
  must be integers >= 1.
- `completedAt` may be `null`; `createdAt`/`completedAt` are ms-epoch numbers.

Responses:
- `200 { "ok": true, "roundId": "<uuid>" }` — created, or the existing round id
  on a duplicate `clientId` (no duplication, scores untouched).
- `400 { "ok": false, "error": "<reason>" }` — validation failure.
- `429 { "ok": false, "error": "rate limit exceeded" }` — per-IP write cap
  (30/min per IP by default).

### `GET /api/leaderboard?period=day|week|month|all`
Arcade high-score board. For each player **tag**, computes total strokes per
completed round per course and keeps that tag's best (lowest) total per course.

→ `200` array, sorted ascending by `total`:
```json
[
  { "tag": "ABC", "courseId": "<uuid>", "courseName": "Neon Jungle",
    "total": 41, "completedAt": "2026-07-17T12:00:00.000Z" }
]
```
`period` filters by `completed_at` (default `all`). Invalid period → `400`.
`day`/`week`/`month` are **calendar** windows in each venue's local time (since
local midnight / start of the local week / start of the local month), **not** a
rolling 24h/7d/30d. The zone is resolved per round as `coalesce(location.tz,
VENUE_TZ)`, so a venue in another region uses its own calendar day — see "Venue
timezones" below.

### `POST /api/seed`
Dev helper. Upserts courses. Requires header `x-app-token: $APP_TOKEN` when
`APP_TOKEN` is set (unset = allowed in dev).

Request: array of seeds
```json
[
  { "id": "<uuid, optional>", "name": "Neon Jungle", "theme": "jungle",
    "holeCount": 18, "pars": [3,2,4,3,3,2,4,3,3,2,4,3,3,2,4,3,3,2] }
]
```
- `pars`: length 18, values 2..4. With `id` present the row is upserted on that
  id (idempotent re-seed); without `id` it is inserted fresh each call.

→ `200 { "ok": true, "count": N, "ids": ["<uuid>", ...] }`
→ `401` if the token is required and missing/wrong; `400` on validation failure.

### `GET /api/locations`
List venues, ordered by `sortOrder` then `name`. Open read (like the leaderboard).

→ `200` array:
```json
[
  { "id": "<uuid>", "name": "Upland", "slug": "upland",
    "lat": 34.08867, "lng": -117.67946, "geofenceKm": 2,
    "tz": "America/Los_Angeles", "tzLabel": "Pacific Time (PT)", "sortOrder": 10 }
]
```
`tzLabel` is derived from `tz` for display; it's `null` when `tz` is unset.

### `POST /api/locations`
Create or update a venue (onboarding). Same `x-app-token` guard as `/api/seed`
(unset `APP_TOKEN` = allowed in dev). Upserts on `id` when given, else on `slug`
(idempotent re-post). The **timezone is resolved server-side** — see "Venue
timezones" below: omit `tz` and it's derived from `lat`/`lng`; send `tz` and it's
validated (a fixed-offset abbreviation like `"PST"` is rejected).

Request:
```json
{
  "id": "<uuid, optional — omit to create / upsert on slug>",
  "name": "Boston",
  "slug": "boston",
  "lat": 42.36, "lng": -71.06,
  "geofenceKm": 2,
  "tz": "America/New_York",
  "sortOrder": 40
}
```
- `name`: required, 1..200 chars. `slug`: required, lowercase `[a-z0-9-]`, no
  leading/trailing/double hyphen.
- `lat`/`lng`: optional but must be sent **together** (−90..90 / −180..180). When
  present and `tz` is omitted, the zone is derived from them.
- `tz`: optional IANA name; validated when present. If omitted and no coords are
  given, it's stored `null` and the leaderboard falls back to `VENUE_TZ`.
- `geofenceKm`: optional positive number. `sortOrder`: optional integer (default 0).

Responses:
- `200 { "ok": true, "location": { …, "tz": "…", "tzLabel": "Eastern Time (ET)" } }`
- `400` — validation failure (bad slug, out-of-range coords, invalid `tz`, …).
- `401` — token required and missing/wrong.
- `409` — `slug` already in use by a different location.

`GET /api/locations` returns only **live** venues (`archived_at is null`); an
optional `orgId` field ties a venue to its org.

### `GET /api/content`
Open read. The live player-facing catalog — `{ locations: [...], courses: [...] }`,
archived rows excluded — used by the build-time exporter
(`scripts/export-content.mjs`) to regenerate `src/data/content.generated.ts`. The
DB is the source of truth; a site rebuild publishes changes to players.

### Master Control — `/api/admin/*`
Back-office API for onboarding/managing orgs (owner/franchise), locations
(venues), and courses. **Every route is guarded by `x-app-token` = `APP_TOKEN`**
(operator/super-admin only; unset = dev-allow). Mutations are recorded in
`admin_audit`. **Deletes are soft archives — there is no hard-delete endpoint;**
archiving sets `archived_at` and hides the row while keeping all history.

| Method & path | Purpose |
| --- | --- |
| `GET  /api/admin/overview` | rollup: counts + rounds 7/30d + per-location |
| `GET  /api/admin/orgs` · `POST /api/admin/orgs` | list / create-update org |
| `GET  /api/admin/orgs/:id` | one org + its live locations |
| `POST /api/admin/orgs/:id/archive` · `…/unarchive` | soft-delete / restore |
| `GET  /api/admin/locations?orgId=&archived=` · `POST /api/admin/locations` | list / create-update venue (reuses the `/api/locations` validation + tz derivation, plus `orgId`) |
| `GET  /api/admin/locations/:id` | one venue + its live courses |
| `GET  /api/admin/locations/:id/courses` | courses for a venue |
| `POST /api/admin/locations/:id/archive` · `…/unarchive` | soft-delete / restore |
| `POST /api/admin/courses` · `PATCH /api/admin/courses/:id` | create-update / edit course (`pars` length 18, values 2–4) |
| `POST /api/admin/courses/:id/archive` · `…/unarchive` | soft-delete / restore |

The admin **UI** is a separate SPA (repo `admin/`, built to `dist-admin/`) served
on its own vhost `admin.<fqdn>` under a wildcard TLS cert — it is **not** part of
the player PWA. See `../master-control-plan.md` and `ffc admin-setup`.

### Scavenger hunt (Phase 3)

Each course has its **own themed list** — four courses, four lists — seeded by
`schema.sql` (idempotent on `(course_id, slug)`). Photos are verified by a vision
model proxied server-side (the key never reaches the browser) and stored on the
droplet disk. Content moderation of stored photos is deferred — verified photos
are kept but nothing is displayed publicly yet.

The hunt is a **play-time** activity: every find is tied to a group's in-progress
round (`roundClientId` is required on verify), so it isn't an open invitation to
wander the course during others' games. A future expansion is at most new
**zones** — each a course-like area with its own list, so the shape is unchanged.

#### `GET /api/hunt/items?course=<uuid>`
The list is scoped to a course (a round is one course), so `course` is required.
→ `200` array of that course's active items:
```json
[ { "id": "<uuid>", "slug": "ship", "name": "A pirate ship or shipwreck", "hint": "The hull ramp is on hole 5." } ]
```
Missing/invalid `course` → `400`.

#### `GET /api/hunt/progress?round=<clientId>`
A group's verified finds so far (`round` is the device round id — §4 `LocalRound.clientId`).
→ `200` array:
```json
[ { "itemId": "<uuid>", "itemSlug": "windmill", "playerTag": "ABC",
    "confidence": 0.9, "flagged": false, "createdAt": "2026-07-17T12:00:00.000Z" } ]
```
Missing `round` → `400`.

#### `POST /api/hunt/verify`
Submit a photo; the model judges whether the target item is present and whether
the shot looks like a photo-of-a-photo (anti-cheat). Uses its own 16 MB body
parser for the base64 image (aligned with nginx's `client_max_body_size`); the
decoded image itself is capped at 10 MB.

Request:
```json
{
  "itemId": "<uuid, must exist and be active on this course>",
  "courseId": "<uuid — the round's course; the item must belong to it>",
  "playerTag": "ABC",
  "roundClientId": "<device round id — required, the group's in-progress round>",
  "imageBase64": "<base64 image bytes, no data: prefix>",
  "mediaType": "image/jpeg"
}
```
- `roundClientId`: required — the hunt runs during gameplay only.
- `courseId`: required — the item is looked up scoped to this course.
- `mediaType`: one of `image/jpeg|png|webp|gif`; decoded image ≤ 10 MB.
- If the player already has a verified find for this item in this round, the call
  short-circuits (`alreadyFound: true`) without a model call.
- A photo-of-a-photo is `flagged` and never counts as a find.
- Only verified, unflagged photos are written to disk.

Responses:
- `200 { "ok": true, "verified": true|false, "flagged": bool, "confidence": num, "reason": "…" }`
- `200 { "ok": true, "verified": true, "alreadyFound": true, "reason": "…" }` — dedupe.
- `400` — validation failure. `429` — per-IP cap (20/min). `503` — `ANTHROPIC_API_KEY` unset.

## Venue timezones

The leaderboard buckets rounds by **calendar** day/week/month in each venue's
local time, so every venue carries an IANA zone in `location.tz` (e.g.
`America/Los_Angeles`). We store the IANA name, never a 3-letter abbreviation:
`PST` is a *fixed* UTC−8 offset that ignores daylight time (it would bucket
summer rounds an hour off local midnight) and abbreviations are ambiguous (`CST`
= US Central / China / Cuba). IANA names carry the DST rules and are unique.

Humans never type these. `lib/timezone.js` is the contract:

| function | use | example |
| -------- | --- | ------- |
| `tzFromCoords(lat, lng)` | **Onboarding** derives the zone from the venue's coordinates (already captured on `location`) and writes it to `location.tz`. | `(34.089, -117.679)` → `"America/Los_Angeles"` |
| `isValidTz(tz)` | Validate before writing — rejects typos **and** fixed-offset abbreviations (`"PST"`), so a bad value can't reach the query. | `"PST"` → `false`; `"America/Los_Angeles"` → `true` |
| `friendlyTzLabel(tz)` | **Admin UIs** render a human label from the stored IANA name (season-independent). | `"America/Los_Angeles"` → `"Pacific Time (PT)"` |

`POST /api/locations` is the live entry point: it runs `tzFromCoords` /
`isValidTz` for you, so onboarding just sends `lat`/`lng` (or an explicit `tz`)
and the endpoint stores the resolved zone and echoes back a `tzLabel`.

Coordinate → zone lookup uses `tz-lookup` (offline, no network). If a venue's
`location.tz` is somehow unset, the query falls back to the `VENUE_TZ` env var.
The three seeded venues are all `America/Los_Angeles`, but that's incidental —
nothing assumes one global zone.

## Files

- `index.js` — Express app, middleware, route mounting, listen.
- `db.js` — shared `pg` Pool from `DATABASE_URL`.
- `schema.sql` — DDL (course / round / score / hunt_item / hunt_find) + per-course
  hunt seed (ensures the four courses exist so the hunt FK resolves on a fresh migrate).
- `migrate.js` — applies `schema.sql`.
- `lib/sanitize.js` — tag validation + offensive-word blocklist (`isValidTag`,
  `validateTags`, `BLOCKLIST`). Mirrors the client's rules exactly.
- `lib/timezone.js` — venue timezone contract (`tzFromCoords`, `isValidTz`,
  `friendlyTzLabel`); see "Venue timezones" above.
- `lib/adminAuth.js` — shared token guard (`requireAppToken`), `audit()` writer,
  and the no-token startup warning; used by the admin surface and the seed/
  locations write guards.
- `lib/validateLocation.js` / `lib/validateCourse.js` — shared validators so the
  public `/api/locations`, `/api/seed`, and the admin routers all validate alike.
- `routes/rounds.js` — `POST /api/rounds` (idempotent sync, per-IP rate limit).
- `routes/leaderboard.js` — `GET /api/leaderboard`.
- `routes/seed.js` — `POST /api/seed`.
- `routes/locations.js` — `GET`/`POST /api/locations` (venue onboarding; resolves
  `location.tz` via `lib/timezone.js`).
- `routes/content.js` — `GET /api/content` (live catalog for the build exporter).
- `routes/admin/` — Master Control: `orgs.js`, `locations.js`, `courses.js`,
  `overview.js`, mounted under `/api/admin` by `admin/index.js` (token-guarded).
- `routes/hunt.js` — scavenger hunt: `GET /api/hunt/items`, `GET /api/hunt/progress`,
  `POST /api/hunt/verify` (photo → vision → find; per-IP rate limit, dedupe).
- `lib/vision.js` — Claude vision proxy (`claude-opus-4-8`, structured JSON verdict).
