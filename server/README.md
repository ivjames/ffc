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
| `APP_TOKEN`         | Shared token guarding `POST /api/seed`, `POST /api/locations`, and the whole `/api/admin/*` (Master Control) surface. **Required** — unset/empty fails closed (every one of those routes returns `401`, including on a local dev box; the API also warns loudly at startup). On `/api/admin/*` it also doubles as the **bootstrap credential**: use it to call `POST /api/admin/users` and create the first real `admin_user` (see "Admin accounts & sessions" below). |
| `NODE_ENV`          | When `production`, admin session cookies are marked `Secure` (HTTPS-only) and `HUNT_ALLOW_PHOTO_OF_PHOTO` is forced off regardless of its own value. Unset/anything else = dev behavior. |
| `VENUE_TZ`          | **Fallback** IANA timezone for leaderboard calendar windows, used only for a venue whose `location.tz` is unset. The real zone is per venue (see "Venue timezones" below). Default `America/Los_Angeles`. |
| `ANTHROPIC_API_KEY` | Vision key for the scavenger hunt (`POST /api/hunt/verify`). Unset = hunt verification returns `503`; the rest of the API is unaffected. |
| `HUNT_UPLOAD_DIR`   | Where verified hunt photos are stored on disk. Default `<cwd>/data/hunt-uploads`; point at a durable volume in production. |
| `HUNT_SCAN_CAP`     | Max vision (model) calls per round — the hard ceiling on hunt API spend per group. Default `240`, the legitimate max (4 players × 20 items max × 3 attempts; ~$0.50 full-burn on Haiku 4.5) — `HUNT_ATTEMPT_CAP` is the working spend control, this is the backstop (and the bound on countable-item grinding). `0` = kill switch (every verify `429`s). Read per request, so changes apply without a restart. |
| `HUNT_ATTEMPT_CAP`  | Max judged shots per player per non-countable item per round (bounds failed attempts — successful finds dedupe, and "couldn't read that photo" retries don't count). Countable items are exempt; the round cap still bounds them. Default `3`. Read per request. |

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
- `groupTag` (optional): a team tag for the whole round, same `[A-Z0-9]{3}` rule
  + blocklist. Rounds carrying one also appear on the team leaderboard.
- `scores`: object keyed by player index (`0..playerTags.length-1`); each value
  an array of length 18 of `number|null`. Only non-null holes are stored; strokes
  must be integers >= 1.
- `completedAt` may be `null`; `createdAt`/`completedAt` are ms-epoch numbers.
- **Rewards**: when a *completed* round first syncs, achievement grants
  (hole-in-one; under par on a full card; hunt master when the player's verified
  finds cover the course's active non-countable hunt list) are written to
  `reward_grant` in the same transaction — one short redemption code per
  (player, achievement). A duplicate re-sync never re-grants. See
  `GET /api/rewards` and the admin redemption flow below.

Responses:
- `200 { "ok": true, "roundId": "<uuid>" }` — created, or the existing round id
  on a duplicate `clientId` (no duplication, scores untouched).
- `400 { "ok": false, "error": "<reason>" }` — validation failure.
- `429 { "ok": false, "error": "rate limit exceeded" }` — per-IP write cap
  (30/min per IP by default).

### `GET /api/leaderboard?period=day|week|month|all&by=player|team`
Arcade high-score board. For each player **tag**, computes total strokes per
completed round per course and keeps that tag's best (lowest) total per course.

`by=team` (default `player`) aggregates the same score rows by the round's
optional `group_tag` instead: a team round is scored as **average strokes per
rostered player** (teams are 1..4 players, so a raw sum would just reward small
teams), rounded to 1 decimal, and each team keeps its best average per course.
Rounds without a `group_tag` never appear on the team board.

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
Dev helper. Upserts courses. Requires header `x-app-token: $APP_TOKEN`; fails
closed (`401`) if `APP_TOKEN` isn't set.

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
(fails closed if `APP_TOKEN` is unset). Upserts on `id` when given, else on `slug`
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
- `menuUrl` / `orderingUrl` (optional): the venue's food & drink deep links,
  absolute `http(s)` URLs only (max 500 chars; anything else — including
  `javascript:` — is rejected). Empty string clears a link. They ship to the
  player app's "Food & Drink" card via `GET /api/content` and the build export.

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

### `GET /api/announcements?locationId=<uuid>`
Open read — the live promo/update feed for the player app and TV board
(managed in Master Control; **no rebuild needed**, this is the platform's first
live content read). Returns non-archived rows whose `[startsAt, endsAt)` window
contains now, that are either global (`locationId: null`) or pinned to the
requested venue. Without `locationId` only global rows return.

→ `200` array:
```json
[
  { "id": "<uuid>", "title": "Taco Tuesday", "body": "Half-price tacos",
    "locationId": null, "startsAt": null, "endsAt": "2026-08-31T07:00:00.000Z",
    "sortOrder": 0 }
]
```

### `GET /api/rewards?clientId=<device round id>`
Open read keyed by the round's client-generated UUID (unguessable, same id the
sync path dedupes on) — the final scorecard's "show this at the counter"
screen. Returns the round's grants:

```json
[
  { "code": "K7M2PX", "playerIndex": 0, "playerTag": "ACE",
    "achievement": "hole_in_one", "redeemedAt": null,
    "createdAt": "2026-08-07T18:00:00.000Z" }
]
```
Achievements: `hole_in_one` · `under_par` · `hunt_master`. Staff redeem codes in
Master Control (below), so a code pays out once.

### Master Control — `/api/admin/*`
Back-office API for onboarding/managing orgs (owner/franchise), locations
(venues), and courses. **Every route except `POST /login` is guarded by
`requireAdminAuth`** — either the `x-app-token` = `APP_TOKEN` header (operator/
super-admin only; fails closed — unset `APP_TOKEN` denies every request) OR a
logged-in `admin_user` session cookie (see "Admin accounts & sessions" below).
Mutations are recorded in `admin_audit` (`actor` is the session's email, or
`"app-token"` for the token path). **Deletes are soft archives — there is no
hard-delete endpoint** for domain data; archiving sets `archived_at` and hides
the row while keeping all history. (`admin_user` itself IS hard-deletable —
no domain history hangs off an account.)

| Method & path | Purpose |
| --- | --- |
| `POST /api/admin/login` | email+password login (no auth required to call this one) |
| `POST /api/admin/logout` · `GET /api/admin/me` | end / inspect the current session |
| `GET  /api/admin/users` · `POST /api/admin/users` | list / create `admin_user` accounts — **super_admin only** |
| `PATCH /api/admin/users/:id` · `DELETE /api/admin/users/:id` | edit (incl. password reset) / remove an account — **super_admin only** |
| `GET  /api/admin/overview` | rollup: counts + rounds 7/30d + per-location (org-scoped for `org_admin`) |
| `GET  /api/admin/hunt-usage` | hunt vision-spend rollup from `hunt_scan`: monthly per-venue rounds/scans/tokens + list-price cost (`?months=1..24`, default 6; org-scoped for `org_admin`; see `HUNT-PRICING.md`) |
| `GET  /api/admin/orgs` · `POST /api/admin/orgs` | list / create-update org — **create/update/archive is super_admin only**; `org_admin` can only read their own org |
| `GET  /api/admin/orgs/:id` | one org + its live locations (`org_admin`: 403 on any org but their own) |
| `POST /api/admin/orgs/:id/archive` · `…/unarchive` | soft-delete / restore — **super_admin only** |
| `GET  /api/admin/locations?orgId=&archived=` · `POST /api/admin/locations` | list / create-update venue (reuses the `/api/locations` validation + tz derivation, plus `orgId`); `org_admin` is always scoped to their own org (an `orgId` query param or body field for a *different* org is overridden/rejected, never honored) |
| `GET  /api/admin/locations/:id` | one venue + its live courses (`org_admin`: 403 outside their org) |
| `GET  /api/admin/locations/:id/courses` | courses for a venue (same scoping) |
| `POST /api/admin/locations/:id/archive` · `…/unarchive` | soft-delete / restore (same scoping) |
| `POST /api/admin/courses` · `PATCH /api/admin/courses/:id` | create-update / edit course (`pars` length 18, values 2–4); `org_admin` must name a `locationId` in their own org (required, not optional, for that role) |
| `POST /api/admin/courses/:id/archive` · `…/unarchive` | soft-delete / restore (same scoping, resolved via the course's location) |
| `GET  /api/admin/overview/series?days=1..90` | daily trend buckets (rounds, distinct player tags, verified hunt finds), zero-filled, calendar days in `ADMIN_TZ` (default `America/Los_Angeles`); org-scoped |
| `GET  /api/admin/export/rounds.csv?from=&to=&locationId=` | CSV download, one row per (completed round, player); `from`/`to` are `YYYY-MM-DD` calendar days in `ADMIN_TZ`, inclusive, defaulting to the last 30 days; org-scoped |
| `GET  /api/admin/announcements?archived=` · `POST /api/admin/announcements` | list / create-update announcements; global rows (`locationId: null`) are **super_admin only** to write, `org_admin` manages rows pinned to their own org's venues (and sees global ones read-only) |
| `POST /api/admin/announcements/:id/archive` · `…/unarchive` | soft-delete / restore (same scoping) |
| `GET  /api/admin/rewards?code=` · `?redeemed=&limit=` | look up one redemption code (case-insensitive), or list recent grants (default: unredeemed, limit 50); org-scoped via the round's course → location |
| `POST /api/admin/rewards/:id/redeem` · `…/unredeem` | mark a reward handed out (records who) / undo a mistaken redemption; audited |
| `GET  /api/admin/photos?filter=review\|people\|minors\|approved\|flagged\|rejected\|all` | hunt-photo moderation queue (default `review` = legacy unreviewed photos + flagged events); org-scoped |
| `GET  /api/admin/photos/:id/image` | stream the stored photo (admin-authed — hunt photos are never publicly served) |
| `POST /api/admin/photos/:id/approve` · `…/reject` | operator verdict; **reject permanently deletes the image file from disk** (the find's DB row and gameplay credit stay); audited |

The admin **UI** is a separate SPA (repo `admin/`, built to `dist-admin/`) served
on its own vhost `admin.<fqdn>` under a wildcard TLS cert — it is **not** part of
the player PWA. See `../master-control-plan.md` and `ffc admin-setup`. The SPA
today still authenticates with `x-app-token` (`admin/api.ts`) — wiring its
login screen to `POST /login` + session cookies is frontend work not yet done.

#### Admin accounts & sessions

`admin_user` (email/role/org_id/password_hash) and `admin_session` (opaque
server-side session tokens) back real per-operator logins, alongside the
original single-shared-secret `APP_TOKEN`:

- **Bootstrap**: there's no self-serve signup. Use `APP_TOKEN` (still a full
  super-admin bypass) to call `POST /api/admin/users` and create the first
  `admin_user`; from then on that account can log in and, if `super_admin`,
  create more.
- **Login**: `POST /api/admin/login { email, password }` → on success, an
  `httpOnly`, `SameSite=Lax` cookie scoped to `/api/admin` (named
  `ffc_admin_session`, 7-day expiry, `Secure` when `NODE_ENV=production`).
  Wrong password and unknown email return the identical `401` + message (and
  pay the same scrypt cost via `verifyDummyPassword`) so login can't be used to
  enumerate registered emails.
- **Passwords**: `scrypt` (Node's built-in `node:crypto`, no bcrypt/argon2
  dependency), stored as `salt:hash` — never returned by any endpoint.
- **Roles**: `super_admin` is unrestricted (identical access to the `APP_TOKEN`
  path). `org_admin` is confined to their own `org_id` everywhere — orgs
  (read-only, own org only), locations, courses (via their location's org),
  and the overview rollup. Enforced per-route via `orgScope(req)` (returns
  `null` for `super_admin`, meaning "no filter"), not by a single shared
  middleware — each router applies it to its own queries because the
  ownership path differs (locations carry `org_id` directly; courses only
  reach it through `location_id`).
- Session lookups and org-scope checks add real per-request DB round trips —
  fine at this scale (single droplet, small operator headcount); revisit if
  Master Control traffic ever justifies caching.

### Scavenger hunt (Phase 3)

Each course has its **own themed list** — four courses, four lists — seeded by
`schema.sql` (idempotent on `(course_id, slug)`). Photos are verified by a vision
model proxied server-side (the key never reaches the browser) and stored on the
droplet disk. **Every photo is auto-moderated in the same vision call** that
verifies the find: content unsafe for a family venue is blocked before it ever
touches disk (no credit, a `flagged` event row, one friendly retake message to
the player — the model's content description is never echoed); safe stored
photos carry `moderation = 'approved'` plus `people_present`/`minors_present`
flags. People in photos are welcome — the flags exist so a future sharing
surface can apply display policy, not to block anyone. Operators review and
override in Master Control → Photos (`/api/admin/photos`, table above);
nothing is displayed publicly yet.

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
Submit a photo; one model call judges whether the target item is present,
whether the shot looks like a photo-of-a-photo (anti-cheat), and the moderation
verdict (unsafe content / people / minors). Uses its own 16 MB body
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
- An **unsafe** photo (family-venue standard) never counts, is never written to
  disk, and returns a fixed "keep it family-friendly" reason.
- Only verified, unflagged, safe photos are written to disk (auto-`approved`).

Cost controls: every model call is metered into `hunt_scan` — the API's exact
`input_tokens`/`output_tokens` (what Anthropic bills), the model id, and the
item's `course_id` for monthly per-venue cost rollups. On top of the per-IP
rate limit, each player gets `HUNT_ATTEMPT_CAP` (default 3) judged shots per
non-countable item per round, and each round has a total scan budget
(`HUNT_SCAN_CAP`, default 240 — the legitimate max of 4 players × 20 items ×
3 attempts). Countable items are exempt from the attempt cap but still bounded
by the round budget. Dedupe short-circuits don't call the
model, so they aren't metered or counted against either cap; a
`VISION_NO_OUTPUT` retry is metered (it was billed) but carries no verdict, so
it doesn't burn an attempt.

Responses:
- `200 { "ok": true, "verified": true|false, "flagged": bool, "confidence": num, "reason": "…" }`
- `200 { "ok": true, "verified": true, "alreadyFound": true, "reason": "…" }` — dedupe.
- `400` — validation failure. `429` — per-IP cap (20/min), the round's scan
  budget (`scan limit reached for this round`), or the player's attempts on an
  item (`attempt limit reached for this item`). `503` — `ANTHROPIC_API_KEY` unset.

## Testing

```sh
npm test                              # node's built-in test runner
node --test --experimental-test-coverage   # + a per-file coverage report
```

`npm test` runs with `--experimental-test-module-mocks` (needed by the hunt
tests below, which mock `lib/vision.js` — real Anthropic calls never happen in
tests). It's an experimental Node flag, stable enough for this, but expect an
`ExperimentalWarning` on stderr; it doesn't affect results.

- Pure unit tests (`lib/*.test.js`) need no database — they run against `lib/`'s
  exported functions directly.
- Integration tests (`routes/*.integration.test.js`) boot the real Express app
  (`app.js`) on an ephemeral port and need a reachable Postgres. They point at
  `TEST_DATABASE_URL` (default `postgres://postgres:postgres@localhost:5432/ffc_test`)
  — create that database once (`createdb ffc_test`) and the tests apply
  `schema.sql` themselves on each run.
- `test-support/testDb.js` holds the shared DB helpers (`ensureSchema`,
  `testQuery`, `listenEphemeral`); it isn't itself a test file.
- If a test needs a module re-imported under different env combinations,
  prefer extracting the env-dependent bit into a small pure function (see
  `lib/huntAntiCheat.js`) over cache-busted dynamic `import()`s — the latter
  corrupts V8's per-file coverage accounting for the re-imported module across
  the rest of the suite (confirmed: `routes/hunt.js` showed 26% coverage with
  the cache-busting trick in play, 91% once it was removed).

Coverage today (full-suite `--experimental-test-coverage` run): **95% lines /
91% branches / 96% funcs** across all of `server/`. Every route file has an
integration test; every `lib/` validator has a unit test. What that run
actually exercises:

- The `APP_TOKEN` fail-closed gate (`lib/adminAuth.js`) end-to-end through
  every guarded surface: `/api/admin/*` (orgs, locations, courses, overview,
  users), `/api/seed`, and the public `/api/locations`.
- Admin accounts & sessions (`lib/adminPasswords.js` 100%, `lib/adminSession.js`
  100%): login/logout/me, password hashing + reset, and — the security-critical
  part — org_admin RBAC isolation (`routes/admin/orgScoping.integration.test.js`):
  two separate org_admin accounts confirming each sees/writes only their own
  org's orgs/locations/courses/overview numbers, that an org_admin can't
  escalate by submitting someone else's `orgId`, and that a session-based
  super_admin is exactly as unrestricted as the `APP_TOKEN` bypass.
- The `HUNT_ALLOW_PHOTO_OF_PHOTO` production fail-safe (`lib/huntAntiCheat.js`, 100%).
- The pure validators (`lib/sanitize.js`, `lib/validateCourse.js` — both 100%;
  `lib/timezone.js` 99%; `lib/validateLocation.js` 96%).
- `routes/hunt.js` (91%) — items/progress, verify's full validation +
  happy-path + dedupe + anti-cheat-flagged + countable-count + no-output
  branches, and the per-IP rate limit, all via a mocked `lib/vision.js`.
  Cost controls live in their own file (`hunt.scanCap.integration.test.js`,
  fresh process = fresh rate limiter): `hunt_scan` token metering (incl. the
  billed-but-no-verdict path), the `HUNT_SCAN_CAP` per-round budget 429, and
  the `HUNT_ATTEMPT_CAP` per-item 429 (countable items exempt).
- `routes/rounds.js` (96%) — validation, idempotent re-sync (scores untouched
  on a duplicate `clientId`), the rate limit.
- `routes/leaderboard.js` (97%) — best-per-(tag, course) aggregation, calendar
  window filtering (day/week/month vs. a 2020 fixture round), sort order.
- `routes/content.js` (92%), `routes/locations.js` (94%), `routes/seed.js`
  (100% lines) — live-only filtering, upsert-on-id/slug, transactional
  rollback on a mid-batch DB error (seed).
- `routes/admin/{orgs,locations,courses,users}.js` (85–92%) — CRUD, org/location
  FK errors, PATCH's merge-over-existing semantics, archive/unarchive + the
  `admin_audit` trail, nested list/detail endpoints, plus every RBAC branch above.

Remaining gaps, all minor: `lib/adminAuth.js`'s DB-failure catch branches
(session lookup, `audit()` write, both "can't happen unless Postgres itself is
down") and `warnIfNoToken()`; `lib/vision.js`'s real Anthropic call (52% —
intentionally never exercised, since tests must not hit the network); a
handful of uncommon catch branches in the admin routers (bad-uuid/not-found
edge cases not every route re-tests). None of these are silently assumed
tested — this list is current as of the last coverage run.

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

- `app.js` — Express app: middleware + route mounting (importable with no
  side effects, so tests can boot it without a real `listen()`).
- `index.js` — process entrypoint: imports `app.js`, calls `listen()`.
- `db.js` — shared `pg` Pool from `DATABASE_URL`.
- `test-support/testDb.js` — shared helpers for DB-backed tests (not itself a
  test file); see "Testing" above.
- `schema.sql` — DDL (course / round / score / hunt_item / hunt_find / hunt_scan) +
  per-course hunt seed (ensures the four courses exist so the hunt FK resolves on a
  fresh migrate).
- `migrate.js` — applies `schema.sql`.
- `lib/sanitize.js` — tag validation + offensive-word blocklist (`isValidTag`,
  `validateTags`, `BLOCKLIST`). Mirrors the client's rules exactly.
- `lib/timezone.js` — venue timezone contract (`tzFromCoords`, `isValidTz`,
  `friendlyTzLabel`); see "Venue timezones" above.
- `lib/adminAuth.js` — `requireAppToken` (APP_TOKEN-only, used by seed/public-locations),
  `requireAdminAuth` (APP_TOKEN OR admin_user session, used by `/api/admin/*`),
  `isSuperAdmin`/`orgScope`/`actorLabel` RBAC helpers, `audit()` writer, and the
  no-token startup warning.
- `lib/adminPasswords.js` — `scrypt` password hashing (`hashPassword`,
  `verifyPassword`, `verifyDummyPassword` for login timing-uniformity). No
  bcrypt/argon2 dependency — uses Node's built-in `node:crypto`.
- `lib/adminSession.js` — server-side admin_user sessions: `createSession`/
  `getSessionUser`/`deleteSession` (backed by `admin_session`) plus the cookie
  helpers (`ffc_admin_session`, httpOnly, scoped to `/api/admin`).
- `lib/validateLocation.js` / `lib/validateCourse.js` — shared validators so the
  public `/api/locations`, `/api/seed`, and the admin routers all validate alike.
- `routes/rounds.js` — `POST /api/rounds` (idempotent sync, per-IP rate limit).
- `routes/leaderboard.js` — `GET /api/leaderboard`.
- `routes/seed.js` — `POST /api/seed`.
- `routes/locations.js` — `GET`/`POST /api/locations` (venue onboarding; resolves
  `location.tz` via `lib/timezone.js`).
- `routes/content.js` — `GET /api/content` (live catalog for the build exporter).
- `routes/admin/` — Master Control, mounted under `/api/admin` by `admin/index.js`
  (`requireAdminAuth`-guarded, `/login` excepted): `auth.js` (login/logout/me),
  `users.js` (admin_user CRUD, super_admin only), `orgs.js`, `locations.js`,
  `courses.js`, `overview.js`, `huntUsage.js` (hunt vision-spend rollup —
  see `HUNT-PRICING.md`; the latter five org-scoped for `org_admin` —
  see "Admin accounts & sessions" above).
- `routes/hunt.js` — scavenger hunt: `GET /api/hunt/items`, `GET /api/hunt/progress`,
  `POST /api/hunt/verify` (photo → vision → find; per-IP rate limit, dedupe,
  `HUNT_SCAN_CAP` per-round budget, `hunt_scan` token metering).
- `lib/huntAntiCheat.js` — pure resolver for the `HUNT_ALLOW_PHOTO_OF_PHOTO`
  production fail-safe (`resolveAllowPhotoOfPhoto`); split out of `routes/hunt.js`
  so it's unit-testable without re-importing the route module.
- `lib/vision.js` — Claude vision proxy (`claude-haiku-4-5`, structured JSON
  verdict + exact token usage for metering).
