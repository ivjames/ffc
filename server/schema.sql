-- FFC mini-golf scorecard schema.
-- Requires the pgcrypto extension for gen_random_uuid() (bundled with modern Postgres).
create extension if not exists pgcrypto;

-- White-label: one client operates several physical locations, each with its
-- own distinct courses (a course belongs to exactly one location).
create table if not exists location (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,    -- stable short key, e.g. 'riverside'
  lat         double precision,        -- venue latitude (WGS84), for GPS detect
  lng         double precision,        -- venue longitude
  geofence_km double precision,        -- "you're here" radius; null -> app default
  tz          text,                    -- IANA timezone, e.g. 'America/Los_Angeles';
                                        -- the leaderboard's calendar day/week/month
                                        -- windows are computed in this venue's zone.
                                        -- Null -> API's VENUE_TZ fallback.
  sort_order  int  not null default 0
);

-- For databases created before GPS columns existed: add them idempotently.
alter table location add column if not exists lat         double precision;
alter table location add column if not exists lng         double precision;
alter table location add column if not exists geofence_km double precision;
-- Per-venue timezone (venues can span regions, so this is NOT one global zone).
alter table location add column if not exists tz          text;

create table if not exists course (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  theme       text not null,
  hole_count  int  not null default 18,
  pars        int[] not null,          -- length 18, values 2..4
  location_id uuid references location(id),
  sort_order  int  not null default 0
);

-- For databases created before locations existed: add the column idempotently.
alter table course add column if not exists location_id uuid references location(id);
create index if not exists course_location_idx on course (location_id);

create table if not exists round (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references course(id),
  player_tags   text[] not null,       -- 1..4 entries, each [A-Z0-9]{3}
  created_at    timestamptz not null default now(),
  completed_at  timestamptz,
  client_id     text unique             -- dedupe key from device (idempotent sync)
);

create table if not exists score (
  round_id      uuid not null references round(id) on delete cascade,
  player_index  int  not null,          -- 0..3
  hole          int  not null,          -- 1..18
  strokes       int  not null,
  primary key (round_id, player_index, hole)
);

-- Helps leaderboard queries that filter completed rounds by time window.
create index if not exists round_completed_at_idx on round (completed_at);

-- ---------------------------------------------------------------------------
-- Phase 3 — AI scavenger hunt.
-- ---------------------------------------------------------------------------

-- The hunt is scoped to a course (a round is one course), so each course has its
-- own themed list — four courses, four lists. A future "zone" expansion is just
-- another course-like area with its own list, so the same shape covers it.
--
-- The item list is fixed and curated (a rotating/randomized list is a later
-- phase). `slug` is unique per course so themed lists can reuse short keys.
create table if not exists hunt_item (
  id          uuid not null default gen_random_uuid(),
  course_id   uuid not null references course(id) on delete cascade,
  slug        text not null,               -- stable key within a course, e.g. 'ship'
  name        text not null,               -- what to find, e.g. 'A pirate ship'
  hint        text,                        -- optional nudge shown to players
  sort_order  int  not null default 0,
  active      boolean not null default true,
  countable   boolean not null default false, -- "find as many as you can": every
                                              -- verified find counts, not just one
  primary key (id),
  unique (course_id, slug)
);

-- For databases created before `countable` existed: add it idempotently.
alter table hunt_item add column if not exists countable boolean not null default false;

create index if not exists hunt_item_course_idx on hunt_item (course_id);

-- A photo submission and its verification verdict. One row per accepted find.
-- `round_client_id` is the device round id (§4 LocalRound.clientId), NOT a FK to
-- round(id): the hunt runs during play, before the round has synced, so we can't
-- rely on a server-side round existing yet. It ties findings to a group (the
-- roster playing a given round) regardless of sync state.
create table if not exists hunt_find (
  id              uuid primary key default gen_random_uuid(),
  round_client_id text,                    -- device round id (the group), may be unsynced
  player_tag      text not null,           -- [A-Z0-9]{3}, who found it
  item_id         uuid not null references hunt_item(id),
  verified        boolean not null,        -- vision said the item is present
  confidence      real,                    -- 0..1 model confidence
  reason          text,                    -- model's short explanation
  flagged         boolean not null default false,  -- anti-cheat: looks like a photo-of-a-photo
  photo_path      text,                    -- stored image path on the droplet disk
  countable       boolean not null default false,  -- copy of hunt_item.countable at
                                           -- write time; drives the partial index below
  created_at      timestamptz not null default now()
);

-- For databases created before `countable` existed: add it idempotently.
alter table hunt_find add column if not exists countable boolean not null default false;

create index if not exists hunt_find_round_idx  on hunt_find (round_client_id);
create index if not exists hunt_find_item_idx   on hunt_find (item_id);
create index if not exists hunt_find_player_idx on hunt_find (player_tag);

-- One verified find per (group, player, item) — EXCEPT for `countable` items
-- (e.g. the Western horseshoes), where finding many is the whole point, so those
-- are exempt from the uniqueness rule. For non-countable items this still backs
-- the app-level dedup in routes/hunt.js against a race: two concurrent
-- submissions can both pass the SELECT guard, so the DB is the real arbiter (the
-- insert uses a matching ON CONFLICT). Partial on `verified` so repeated *failed*
-- attempts (verified=false) still insert freely. The predicate changed (added
-- `and not countable`), so drop-then-create rather than `if not exists`, which
-- would keep the old definition; drop+create stays idempotent across migrates.
drop index if exists hunt_find_verified_unique;
create unique index if not exists hunt_find_verified_unique
  on hunt_find (round_client_id, player_tag, item_id)
  where verified and not countable;

-- Vision-spend metering: one row per model call made by POST /api/hunt/verify,
-- successful verdict or not. This is the billing/budget record, separate from
-- hunt_find (the gameplay record): it backs the per-round scan cap (HUNT_SCAN_CAP
-- in routes/hunt.js) and monthly cost rollups per course/venue, reconcilable
-- against the Anthropic invoice via the token counts. `item_id` is SET NULL on
-- item deletion (billing history outlives curation edits); `course_id` is
-- denormalized at write time so rollups survive item deletion too.
create table if not exists hunt_scan (
  id              uuid primary key default gen_random_uuid(),
  round_client_id text not null,           -- device round id (the group)
  player_tag      text not null,           -- [A-Z0-9]{3}, who scanned
  item_id         uuid references hunt_item(id) on delete set null,
  course_id       uuid,                    -- item's course at scan time (no FK: history)
  model           text,                    -- model id that served the call
  input_tokens    int,                     -- from the API's usage object; null if unknown
  output_tokens   int,
  verified        boolean,                 -- verdict outcome; null when no verdict (VISION_NO_OUTPUT)
  flagged         boolean,
  created_at      timestamptz not null default now()
);

create index if not exists hunt_scan_round_idx   on hunt_scan (round_client_id);
create index if not exists hunt_scan_created_idx on hunt_scan (created_at);
create index if not exists hunt_scan_course_idx  on hunt_scan (course_id);

-- Bullwinkle's three venues. Idempotent on id; ids + coords mirror
-- src/data/courses.ts (exact coordinates geocoded from the street addresses;
-- 2 km geofence per venue, sites hundreds of km apart so no overlap).
-- Addresses: Upland 1560 W 7th St 91786; Tukwila 7300 Fun Center Way 98188;
-- Wilsonville 29111 SW Town Center Loop W 97070.
-- `tz` is each venue's IANA timezone. Today's three venues happen to all be
-- Pacific, but that's incidental — a venue elsewhere carries its own zone here,
-- and the leaderboard reads it per round (never one global assumption).
--
-- CREATE-ONLY (ON CONFLICT DO NOTHING): Master Control is now the source of
-- truth for these fields (§5), so a re-migrate must NOT overwrite an operator's
-- edits back to these seed values. This seeds the rows once on a fresh DB and
-- leaves them alone thereafter. (org_id is set by the backfill below, guarded on
-- `org_id is null`, so it never disturbs a later reassignment either.)
insert into location (id, name, slug, lat, lng, geofence_km, tz, sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Upland',      'upland',      34.08867, -117.67946, 2, 'America/Los_Angeles', 10),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tukwila',     'tukwila',     47.46562, -122.24302, 2, 'America/Los_Angeles', 20),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Wilsonville', 'wilsonville', 45.30969, -122.76680, 2, 'America/Los_Angeles', 30)
on conflict (id) do nothing;

-- The client's nine courses across the three venues (Upland x4, Tukwila x3,
-- Wilsonville x2). Idempotent on id. Ids + pars + location_id mirror
-- src/data/courses.ts. Pars are still placeholders (length 18, 2..4).
--
-- CREATE-ONLY (ON CONFLICT DO NOTHING): like the location seed above, Master
-- Control now owns course data (name/theme/pars/location), so a re-migrate must
-- not clobber operator edits. Seeds once on a fresh DB (also guaranteeing the
-- rows exist so the hunt_item FKs below resolve) and leaves them alone after.
-- (`ffc seed` / deploy/courses.seed.json still upsert explicitly when run.)
insert into course (id, name, theme, pars, location_id, sort_order) values
  ('a1111111-1111-4111-8111-111111111111', 'Blue Course', 'california', '{3,2,3,2,3,4,2,3,2,3,3,2,4,3,2,3,2,3}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10),
  ('a2222222-2222-4222-8222-222222222222', 'Green Course', 'classic', '{2,3,2,3,3,2,4,3,2,3,2,3,3,4,2,3,3,2}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 20),
  ('a3333333-3333-4333-8333-333333333333', 'Dragon''s Hollow', 'dragon', '{3,3,4,2,3,3,2,4,3,2,3,4,3,2,3,3,4,2}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 30),
  ('a4444444-4444-4444-8444-444444444444', 'Western', 'western', '{2,3,3,2,4,3,2,3,3,2,4,3,2,3,3,2,3,4}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 40),
  ('b1111111-1111-4111-8111-111111111111', 'Blue Course', 'blue', '{3,2,2,3,3,2,3,4,2,3,3,2,3,2,4,3,2,3}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 10),
  ('b2222222-2222-4222-8222-222222222222', 'Green Course', 'green', '{2,3,3,2,3,3,2,3,4,2,3,2,3,3,2,4,3,2}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 20),
  ('b3333333-3333-4333-8333-333333333333', 'Red Course', 'red', '{3,3,2,4,2,3,3,2,3,4,2,3,2,3,3,2,4,3}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 30),
  ('c1111111-1111-4111-8111-111111111111', 'Blue Course', 'blue', '{2,3,2,3,4,2,3,2,3,3,2,4,3,2,3,2,3,3}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 10),
  ('c2222222-2222-4222-8222-222222222222', 'Green Course', 'green', '{3,2,3,3,2,4,2,3,3,2,3,2,4,3,2,3,2,3}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 20)
on conflict (id) do nothing;

-- NOTE: the earlier placeholder courses (Jungle Run / Pirate's Cove / Space
-- Odyssey / Haunted Manor) may still exist in databases seeded before the real
-- lineup landed. The migration deliberately does NOT delete them: they never
-- appear in the app (course lists come from the bundled frontend data, not the
-- DB), and deleting them is destructive — rounds, scores, and hunt finds
-- reference that pre-launch test data, and cascading through it repeatedly
-- failed migrate on FK constraints. A schema migration must never silently drop
-- played user data. To purge the placeholder courses and everything tied to
-- them explicitly, run `deploy/purge-placeholder-data.sql` (dependency-ordered).

-- Scavenger-hunt lists are per course (hunt_item.course_id). Only the client's
-- real, confirmed hunt content is seeded; courses without a list yet simply
-- show an empty hunt (the UI handles that gracefully).
--
-- CREATE-ONLY (ON CONFLICT DO NOTHING): Master Control now owns hunt items
-- (routes/admin/huntItems.js — the same handoff locations/courses/orgs made
-- above), so a re-migrate (every `ffc deploy` runs `ffc migrate`) must NOT
-- overwrite an operator's edits to name/hint/sort_order/countable back to
-- these seed values. Seeds once on a fresh DB, then leaves the console in
-- charge. Content changes for already-seeded items go through Master
-- Control, not this file.
insert into hunt_item (course_id, slug, name, hint, sort_order, countable) values
  -- Upland · Western — horseshoes are hidden all around the course; each one you
  -- photograph counts, so this item is `countable` (find as many as you can).
  ('a4444444-4444-4444-8444-444444444444', 'horseshoe', 'A hidden horseshoe', 'Horseshoes are hidden all around the Western course — find as many as you can!', 10, true),
  -- Upland · Dragon's Hollow — fairy-tale landmarks around the course. The
  -- castle, climbing vines, pumpkin patch, and green doors are installed scenery;
  -- the cartoon cow and giant veg are themed props being added.
  ('a3333333-3333-4333-8333-333333333333', 'castle',     'The dragon''s castle',   'The big stone castle with red-topped towers — frame the turrets.', 10, false),
  ('a3333333-3333-4333-8333-333333333333', 'vines',      'Climbing flower vines',  'Painted flowering vines climb the castle''s white towers — snap a good stretch.', 20, false),
  ('a3333333-3333-4333-8333-333333333333', 'pumpkin',    'A giant pumpkin',        'Fat orange pumpkins grow by the painted hills — snap one from the patch.', 30, false),
  ('a3333333-3333-4333-8333-333333333333', 'green-door', 'The green doors',        'A pair of green fairy-tale doors with stained-glass windows, beside the stone fireplace.', 40, false),
  ('a3333333-3333-4333-8333-333333333333', 'cow',        'A cartoon cow',          'A big goofy cartoon cow with a lolling tongue — say cheese!', 50, false),
  ('a3333333-3333-4333-8333-333333333333', 'cabbage',    'A giant purple cabbage', 'An oversized purple cabbage, far too big for any garden — find it and snap it.', 60, false),
  ('a3333333-3333-4333-8333-333333333333', 'carrot',     'A giant carrot',         'Enormous orange carrots poke up out of the gravel, green tops and all — snap one.', 70, false)
on conflict (course_id, slug) do nothing;

-- Upland · Blue Course — California themed. Only Upland's Blue Course carries a
-- themed hunt list for now; the other venues' Blue courses stay on the generic
-- placeholder theme (no list) until each venue's real content is confirmed (§11).
-- Themed placeholders until the client confirms the real on-course props (§11).
-- The golden poppy is `countable` (blooms in clusters — find as many as you can).
insert into hunt_item (course_id, slug, name, hint, sort_order, countable) values
  ('a1111111-1111-4111-8111-111111111111', 'golden-gate', 'The Golden Gate',      'A mini Golden Gate Bridge with two tall red towers — frame the span.',            10, false),
  ('a1111111-1111-4111-8111-111111111111', 'redwood',     'A giant redwood',      'The towering painted redwoods along the coast holes — snap the treetops.',        20, false),
  ('a1111111-1111-4111-8111-111111111111', 'lighthouse',  'The coast lighthouse', 'A red-and-white striped lighthouse watching over the Pacific water hazard.',       30, false),
  ('a1111111-1111-4111-8111-111111111111', 'surfboard',   'A surfboard',          'A brightly painted surfboard standing on end near the water — catch the colors.', 40, false),
  ('a1111111-1111-4111-8111-111111111111', 'palm',        'A palm tree',          'A tall California palm — find one and snap the fronds against the sky.',           50, false),
  ('a1111111-1111-4111-8111-111111111111', 'bear-flag',   'The bear flag',        'The California grizzly-bear flag flying over the course — say cheese!',            60, false),
  ('a1111111-1111-4111-8111-111111111111', 'poppy',       'A golden poppy',       'The state flower blooms in bright orange clusters along the fairway edges — find as many as you can!', 70, true)
on conflict (course_id, slug) do nothing;

-- Upland · Green Course — classic mini-golf themed. Again Upland only; other
-- venues' Green courses stay generic until confirmed (§11).
insert into hunt_item (course_id, slug, name, hint, sort_order, countable) values
  ('a2222222-2222-4222-8222-222222222222', 'windmill',       'The windmill',       'The classic red-roofed windmill with turning sails — catch it mid-spin.',      10, false),
  ('a2222222-2222-4222-8222-222222222222', 'loop',           'The loop-the-loop',  'The full 360° loop ramp — frame the whole curl.',                              20, false),
  ('a2222222-2222-4222-8222-222222222222', 'clown',          'The clown''s mouth', 'The big painted clown face whose open mouth swallows a good putt.',            30, false),
  ('a2222222-2222-4222-8222-222222222222', 'wishing-well',   'The wishing well',   'A little stone wishing well with a peaked roof beside the fairway.',           40, false),
  ('a2222222-2222-4222-8222-222222222222', 'castle',         'The castle',         'The classic mini-golf castle with battlements and a drawbridge over the cup.',  50, false),
  ('a2222222-2222-4222-8222-222222222222', 'covered-bridge', 'The covered bridge', 'A small wooden covered bridge the ball rolls straight through.',               60, false),
  ('a2222222-2222-4222-8222-222222222222', 'gnome',          'A garden gnome',     'A cheeky garden gnome tucked into the landscaping — find him and snap it.',     70, false)
on conflict (course_id, slug) do nothing;

-- Converge from an earlier iteration that seeded these California/classic lists
-- onto ALL three venues' Blue/Green courses. Now that only Upland is themed, drop
-- those items from the other venues' Blue/Green courses. Two guards keep this
-- safe on every migrate: (1) match ONLY the exact slugs that earlier seed created
-- (the California slugs on the Blue courses, the classic slugs on the Green
-- courses) so a future venue-specific list with different slugs is never touched;
-- (2) skip any item with recorded finds, so played data is never dropped (matches
-- the "migrations must not silently drop played data" rule above). Idempotent.
delete from hunt_item i
 where not exists (select 1 from hunt_find f where f.item_id = i.id)
   and (
     (i.course_id in (
        'b1111111-1111-4111-8111-111111111111',  -- Tukwila · Blue
        'c1111111-1111-4111-8111-111111111111'   -- Wilsonville · Blue
      ) and i.slug in ('golden-gate', 'redwood', 'lighthouse', 'surfboard', 'palm', 'bear-flag', 'poppy'))
     or
     (i.course_id in (
        'b2222222-2222-4222-8222-222222222222',  -- Tukwila · Green
        'c2222222-2222-4222-8222-222222222222'   -- Wilsonville · Green
      ) and i.slug in ('windmill', 'loop', 'clown', 'wishing-well', 'castle', 'covered-bridge', 'gnome'))
   );

-- Backfill: existing finds for an item that is now `countable` must carry the
-- flag too, so the partial unique index (which excludes countable finds) stops
-- constraining them. Idempotent — only touches rows not already set.
update hunt_find f
   set countable = true
  from hunt_item i
 where f.item_id = i.id and i.countable and f.countable = false;

-- ---------------------------------------------------------------------------
-- Master Control — org (owner/franchise) level above locations, plus the
-- back-office scaffolding. See master-control-plan.md. All DDL here is
-- idempotent and appended after the base tables/seeds so every referenced
-- table + seed row already exists when these run.
-- ---------------------------------------------------------------------------

-- An org is the owner/franchise that operates one or more locations. A location
-- belongs to exactly one org (nullable while existing rows migrate; backfilled
-- to a default org just below).
create table if not exists org (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null unique,            -- 'bullwinkles'
  status      text not null default 'active',  -- active | suspended
  archived_at timestamptz,                     -- soft-delete; null = live
  created_at  timestamptz not null default now(),
  sort_order  int  not null default 0
);

-- Link locations to their org.
alter table location add column if not exists org_id      uuid references org(id);
create index if not exists location_org_idx on location (org_id);

-- Soft-delete (archive) columns. Deletes in Master Control are archives, never
-- row removals: a non-null archived_at hides the row from players and from the
-- default admin lists while keeping all history (rounds/scores/finds) intact.
alter table location add column if not exists archived_at timestamptz;
alter table course   add column if not exists archived_at timestamptz;
-- Partial indexes over the live set (the common read path filters archived_at is null).
create index if not exists location_active_idx on location (archived_at) where archived_at is null;
create index if not exists course_active_idx   on course   (archived_at) where archived_at is null;

-- Append-only audit trail: one row per successful admin mutation.
create table if not exists admin_audit (
  id         uuid primary key default gen_random_uuid(),
  actor      text,               -- token label / admin_user id once accounts exist
  action     text not null,      -- 'org.create', 'location.update', 'course.archive'
  entity     text not null,      -- 'org' | 'location' | 'course'
  entity_id  uuid,
  detail     jsonb,              -- submitted payload / before+after
  created_at timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on admin_audit (created_at);

-- Real accounts (Phase 2). super_admin sees/manages everything; org_admin is
-- scoped to org_id (required for that role — enforced at the app layer, same
-- as `role`'s enum, to match this schema's existing style of not adding CHECK
-- constraints for small fixed vocabularies). password_hash is `scrypt salt:hash`
-- (see lib/adminPasswords.js) — never a plaintext password, never returned by
-- the API.
create table if not exists admin_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  role          text not null default 'org_admin',  -- super_admin | org_admin
  org_id        uuid references org(id),             -- null for super_admin
  password_hash text,
  created_at    timestamptz not null default now()
);

-- Server-side sessions for admin_user logins (lib/adminSession.js). `id` is an
-- opaque high-entropy random token (the session cookie's value — looked up,
-- never decoded), not a JWT. Sits alongside the single-shared-secret APP_TOKEN
-- gate (routes/admin/index.js accepts either); APP_TOKEN remains the
-- bootstrap credential for creating the first admin_user.
create table if not exists admin_session (
  id            text primary key,
  admin_user_id uuid not null references admin_user(id) on delete cascade,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null
);
create index if not exists admin_session_expires_idx on admin_session (expires_at);

-- Seed the default org for the current client (Bullwinkle's) and backfill the
-- existing locations onto it. Fixed id so this is idempotent and mirrors the
-- LOC_* / course id convention in src/data/courses.ts.
--
-- CREATE-ONLY (ON CONFLICT DO NOTHING): Master Control owns org name/slug, so a
-- re-migrate (every `ffc deploy` runs `ffc migrate`) must not reset an operator's
-- rename back to this seed value. Seed once, then leave it to the console.
insert into org (id, name, slug, sort_order) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Bullwinkle''s', 'bullwinkles', 10)
on conflict (id) do nothing;

-- Any location without an org yet joins the default org. Safe to run every
-- migrate: it only touches rows where org_id is still null, so a later
-- reassignment through Master Control is never overwritten.
update location
   set org_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 where org_id is null;

-- ---------------------------------------------------------------------------
-- Player accounts (passwordless email sign-in), teams, and shared multi-device
-- games. Supersedes the original "no player identity" design: accounts are
-- OPTIONAL — the anonymous walk-up flow is untouched, and identity is only
-- required to create teams or host a shared game.
-- ---------------------------------------------------------------------------

-- A registered player. Email is the identity (verified by the sign-in code
-- flow itself — the first successful verify proves the inbox).
create table if not exists app_user (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,   -- stored lowercased
  email_verified_at timestamptz,            -- set on first successful verify
  display_name      text,                   -- 1..40 chars
  default_tag       text,                   -- [A-Z0-9]{3}, roster prefill
  created_at        timestamptz not null default now(),
  archived_at       timestamptz             -- soft-delete, house style
);

-- Privacy: phone used to be collected here "for the venue's contact list" but
-- no code path ever used it — data collected without a purpose is pure
-- liability, so it's gone (drop covers databases created with the column).
alter table app_user drop column if exists phone;

-- Account ownership of rounds ("sign in to keep your scores"). Added here, not
-- on the round table above, because round is defined before app_user. Nullable
-- and additive: the walk-up tag flow is unchanged — a round only gains an owner
-- when a signed-in device syncs it, or when the device retroactively claims its
-- rounds (routes/rounds.js /claim). Since tags collide by design, ownership is
-- keyed off the device's own round client_ids, never the tag. SET NULL on
-- account deletion so a removed account leaves the (still tag-attributed) round.
alter table round add column if not exists app_user_id uuid references app_user(id) on delete set null;
create index if not exists round_app_user_idx on round (app_user_id);

-- Synthetic (bot-generated) rounds. Additive and default-false so every real
-- round keeps its exact meaning. A synthetic round is written by the load/soak
-- + demo-seed bot (scripts/course-bot.mjs) through the SAME /api/rounds path a
-- real device uses, so it exercises the real insert, reward, and leaderboard
-- code. Isolation is by identification, not by a separate path: the flag (plus
-- the bot's `synthetic:<...>` client_id namespace) makes every bot round
-- trivially findable and bulk-deletable — `delete from round where synthetic`
-- cascades to its scores and any minted reward_grant rows (both ON DELETE
-- CASCADE), so a test run leaves zero residue once torn down. Whether synthetic
-- rounds ALSO count on leaderboards / mint reward tickets is a runtime choice
-- (lib/syntheticConfig.js), defaulting to yes so testing hits the full path.
alter table round add column if not exists synthetic boolean not null default false;
-- Partial index: cleanup + board-exclusion both filter on `synthetic = true`,
-- a tiny fraction of rows, so a partial index stays cheap and unused by the
-- default (synthetic-included) board queries.
create index if not exists round_synthetic_idx on round (synthetic) where synthetic;

-- Server-side player sessions (lib/userAuth.js) — the admin_session pattern:
-- `id` is an opaque high-entropy token (the ffc_session cookie's value, looked
-- up, never decoded). 30-day sliding TTL, refreshed on use.
create table if not exists user_session (
  id           text primary key,
  app_user_id  uuid not null references app_user(id) on delete cascade,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null
);
create index if not exists user_session_expires_idx on user_session (expires_at);

-- One row per emailed sign-in attempt (lib/authCodes.js). Carries BOTH the
-- 6-digit OTP and the magic-link token, hashed — a DB leak reveals nothing
-- typeable. `profile` stashes registration fields (displayName/defaultTag)
-- submitted with the request, applied to app_user on first successful verify.
create table if not exists auth_code (
  id               uuid primary key default gen_random_uuid(),
  email            text not null,           -- lowercased; account may not exist yet
  code_hash        text not null,           -- sha256(6-digit code)
  magic_token_hash text not null,           -- sha256(32-byte hex token)
  profile          jsonb,
  attempts         int not null default 0,  -- wrong guesses; dead at 5
  expires_at       timestamptz not null,    -- created + 10 minutes
  consumed_at      timestamptz,             -- single-use
  created_at       timestamptz not null default now()
);
create index if not exists auth_code_email_idx on auth_code (email, created_at);
create index if not exists auth_code_magic_idx on auth_code (magic_token_hash);
-- Privacy: scrub phone numbers stashed in pending sign-in profiles from before
-- app_user.phone was dropped (see above). Idempotent no-op once clean.
update auth_code set profile = profile - 'phone' where profile ? 'phone';

-- Email-send metering — the hunt_scan/HUNT_SCAN_CAP precedent applied to
-- outbound mail: one row per send, backing MAIL_DAILY_CAP (lib/mailer.js).
-- Privacy: the cap only reads a rolling 24h window, so rows older than that
-- are pruned on every send (lib/mailer.js) — this table is a rate-limit
-- ledger, not a permanent registry of recipient addresses.
create table if not exists mail_send (
  id         uuid primary key default gen_random_uuid(),
  recipient  text not null,
  kind       text not null,                 -- 'otp' | 'team_invite'
  created_at timestamptz not null default now()
);
create index if not exists mail_send_created_idx on mail_send (created_at);
-- One-time catch-up for databases from before the on-send prune existed (the
-- prune keeps it empty of old rows thereafter; harmless to re-run).
delete from mail_send where created_at < now() - interval '24 hours';

-- Persistent named teams — membership + convenience (roster prefill, grouped
-- history), NOT a gameplay entity: scores stay positional per round/game.
create table if not exists team (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,               -- 1..40 chars
  owner_user_id uuid not null references app_user(id),
  created_at    timestamptz not null default now(),
  archived_at   timestamptz                  -- soft-delete, house style
);
create index if not exists team_owner_idx on team (owner_user_id);

create table if not exists team_member (
  team_id     uuid not null references team(id) on delete cascade,
  app_user_id uuid not null references app_user(id) on delete cascade,
  role        text not null default 'member', -- owner | member (app-enforced
  joined_at   timestamptz not null default now(), --   vocab, house style: no CHECK)
  primary key (team_id, app_user_id)
);
create index if not exists team_member_user_idx on team_member (app_user_id);

-- Emailed team invites. The token in the accept link is the capability (the
-- recipient may accept from any signed-in address); only its sha256 is stored.
create table if not exists team_invite (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references team(id) on delete cascade,
  email       text not null,                 -- lowercased invitee address
  token_hash  text not null,                 -- sha256(32-byte hex token)
  invited_by  uuid not null references app_user(id),
  expires_at  timestamptz not null,          -- created + 7 days
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists team_invite_team_idx  on team_invite (team_id);
create index if not exists team_invite_token_idx on team_invite (token_hash);

-- Shared multi-device games: players on separate phones mark up the SAME
-- scorecard. Live state lives in these tables while the game is open; on
-- completion the server materializes a canonical round (+ score rows) with
-- round.client_id = 'shared:' || shared_game.id, so the leaderboard, TV
-- screen, and admin all work on shared rounds with zero changes.
create table if not exists shared_game (
  id           uuid primary key default gen_random_uuid(),
  join_code    text not null,                -- 6 chars, lib/joinCode.js alphabet
  course_id    uuid not null references course(id),
  team_id      uuid references team(id),     -- optional roster prefill / grouping
  created_by   uuid not null references app_user(id),
  status       text not null default 'open', -- open | completed | abandoned
  round_id     uuid references round(id),    -- canonical round, set at completion
  created_at   timestamptz not null default now(),
  completed_at timestamptz,
  archived_at  timestamptz
);
-- Join codes only need to be unique among OPEN games — completed/abandoned
-- games retire theirs back into the pool.
create unique index if not exists shared_game_join_code_open_idx
  on shared_game (join_code) where status = 'open';
create index if not exists shared_game_creator_idx on shared_game (created_by);

-- Roster slots — positional, mirroring round.player_tags ordinals (max 4,
-- enforced at the app layer like the 1..4 rule everywhere else). Tags are
-- unique per game: the positional leaderboard join needs them unambiguous.
create table if not exists shared_game_player (
  game_id     uuid not null references shared_game(id) on delete cascade,
  slot        int  not null,                 -- 0..3
  tag         text not null,                 -- [A-Z0-9]{3}, validateTags rules
  app_user_id uuid references app_user(id),  -- null = guest slot
  created_at  timestamptz not null default now(),
  primary key (game_id, slot),
  unique (game_id, tag)
);

-- One row per device that joined; `id` is the device's bearer participant
-- token (query-string auth for the SSE stream — EventSource can't set
-- headers, and game/round ids are already bearer capabilities here, cf.
-- GET /api/hunt/progress).
create table if not exists shared_game_participant (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references shared_game(id) on delete cascade,
  app_user_id  uuid references app_user(id), -- null = guest device
  joined_at    timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists sg_participant_game_idx on shared_game_participant (game_id);

-- Live score cells. Per-cell last-write-wins on (ts_client, updated_by) —
-- see lib/lww.js for the guarded upsert and the client mirror
-- (src/lib/sharedMerge.ts) for the identical comparison devices apply.
create table if not exists shared_score (
  game_id    uuid not null references shared_game(id) on delete cascade,
  slot       int  not null,                  -- 0..3
  hole       int  not null,                  -- 1..18
  strokes    int,                            -- null = cleared
  ts_client  bigint not null,                -- device ms-epoch of the tap
  updated_by uuid not null,                  -- participant id (LWW tiebreak)
  updated_at timestamptz not null default now(),
  primary key (game_id, slot, hole)
);
-- ---------------------------------------------------------------------------
-- Post-meeting punchlist features. See post-meeting-punchlist.md. All DDL
-- idempotent, appended after the tables it references.
-- ---------------------------------------------------------------------------

-- Announcements / special updates (punchlist #1). Managed in Master Control,
-- read live by the player app + TV board (promos are too time-sensitive for
-- the rebuild-to-publish pipeline). location_id null = shown at every venue.
-- starts_at/ends_at bound the display window; null = open-ended on that side.
-- Delete = archive, like every other admin-managed entity.
create table if not exists announcement (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  body        text,
  location_id uuid references location(id),
  starts_at   timestamptz,
  ends_at     timestamptz,
  sort_order  int  not null default 0,
  archived_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists announcement_active_idx on announcement (archived_at) where archived_at is null;

-- Announcement view memory — who's seen which announcement, and when. One row
-- per (announcement, device); the public beacon (POST /api/announcements/views)
-- upserts it, bumping last_seen_at + seen_count on repeat app sessions.
-- device_id is a client-minted install UUID (localStorage ffc_device_id): the
-- app is walk-up/anonymous, so the device is the identity that always exists.
-- app_user_id is captured opportunistically from the player-session cookie when
-- the viewer happens to be signed in (null otherwise), so the admin rollup can
-- separate "devices" from "signed-in accounts". Cascade so archiving is still a
-- soft delete but a hard delete of the parent takes its view rows with it.
create table if not exists announcement_view (
  announcement_id uuid not null references announcement(id) on delete cascade,
  device_id       uuid not null,
  app_user_id     uuid references app_user(id) on delete set null,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  seen_count      int not null default 1,
  primary key (announcement_id, device_id)
);
create index if not exists announcement_view_by_announcement_idx
  on announcement_view (announcement_id);

-- Team tag (punchlist #4 tier 1) — the additive change the original plan
-- reserved. An optional 3-char team tag on the whole round; the team
-- leaderboard is a second aggregation over the same score rows. Same
-- [A-Z0-9]{3} rule + blocklist as player tags, validated at the API.
alter table round add column if not exists group_tag text;
create index if not exists round_group_tag_idx on round (group_tag) where group_tag is not null;

-- Food & drink links (punchlist #7 tier 1). Per-location deep links into
-- whatever menu / online-ordering system the venue runs — content fields only,
-- no ordering integration. Ship to players via the content export like every
-- other location field.
alter table location add column if not exists menu_url     text;
alter table location add column if not exists ordering_url text;

-- POS integration add-on. Which point-of-sale vendor this venue's app talks
-- to and which paid capabilities are switched on — the per-venue config that
-- gates native ordering / rewards in the player app. NULL = no integration
-- (the default for every venue; the menu_url/ordering_url deep links above
-- remain the un-integrated fallback). Shape is validated in
-- lib/validateLocation.js: { vendor, ordering, loyalty, gameRewards, apiBase }.
-- Vendor-specific credentials do NOT live here — they stay server-side.
alter table location add column if not exists pos jsonb;

-- Business hours. Per-venue weekly open/close, evaluated in the venue's own tz
-- (location.tz). jsonb keyed by weekday (mon..sun); each day is
-- {"open":"HH:MM","close":"HH:MM"} or "closed"; a missing day = closed; null =
-- unset/unknown. Shape validated in lib/venueHours.js (normalizeHours) and
-- shipped to players via /api/content like every other location field. Models
-- the base weekly pattern only — date-specific holiday/event overrides are a
-- later addition. The load bot gates synthetic play on isVenueOpen() so bot
-- traffic mirrors real open hours. Seeded once below (guarded on `hours is
-- null`) so a re-migrate never clobbers an operator's Master Control edits.
alter table location add column if not exists hours jsonb;

-- Date-specific hours layered over the base weekly `hours` (lib/venueHours.js):
--   hours_overrides — per-date exceptions: { "2026-08-18": "closed",
--                     "2026-08-28": {"open":"11:00","close":"19:00"} }
--   hours_seasons   — date-ranged weekly patterns (holiday/seasonal shifts):
--                     [{ "from":"2026-09-09","to":"2026-12-31","weekly":{...},
--                        "label":"Fall" }]
-- Resolution for any date: override → season (later match wins) → base weekly.
-- Populated/refreshed from each venue's published calendar by
-- scripts/fetch-venue-hours.mjs (and hand-editable in Master Control); NOT seeded
-- here because the calendar is volatile and only extends a few months out.
alter table location add column if not exists hours_overrides jsonb;
alter table location add column if not exists hours_seasons   jsonb;

-- Seed the three venues' base weekly hours (Bullwinkle's Upland/Tukwila/
-- Wilsonville, from bullwinkles.com/<city>/hours). Guarded on `hours is null`
-- so this backfills once and never overwrites later Master Control edits (same
-- pattern as the org_id backfill). Times are the venue-local base pattern;
-- date-specific holiday/event exceptions are not modeled here.
update location set hours = '{
  "mon":{"open":"12:00","close":"21:00"},"tue":{"open":"12:00","close":"21:00"},
  "wed":{"open":"12:00","close":"21:00"},"thu":{"open":"12:00","close":"21:00"},
  "fri":{"open":"12:00","close":"23:00"},"sat":{"open":"11:00","close":"23:00"},
  "sun":{"open":"11:00","close":"21:00"}}'::jsonb
 where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and hours is null;
update location set hours = '{
  "mon":{"open":"11:00","close":"21:00"},"tue":{"open":"11:00","close":"21:00"},
  "wed":{"open":"11:00","close":"21:00"},"thu":{"open":"11:00","close":"21:00"},
  "fri":{"open":"11:00","close":"23:00"},"sat":{"open":"11:00","close":"23:00"},
  "sun":{"open":"11:00","close":"22:00"}}'::jsonb
 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and hours is null;
update location set hours = '{
  "mon":{"open":"11:00","close":"22:00"},"tue":{"open":"11:00","close":"22:00"},
  "wed":{"open":"11:00","close":"22:00"},"thu":{"open":"11:00","close":"22:00"},
  "fri":{"open":"11:00","close":"23:00"},"sat":{"open":"11:00","close":"23:00"},
  "sun":{"open":"11:00","close":"22:00"}}'::jsonb
 where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and hours is null;

-- Rewards (punchlist #8 tier 1). One row per earned achievement, granted
-- server-side when a completed round syncs; achievements pay out as tickets on
-- the player's loyalty card (see the redeemed_* columns below). Keyed by
-- player_index (positional, like score) because tags can repeat within a round;
-- player_tag is denormalized for display. Cascade with the round like score does.
create table if not exists reward_grant (
  id           uuid primary key default gen_random_uuid(),
  round_id     uuid not null references round(id) on delete cascade,
  player_index int  not null,            -- 0..3
  player_tag   text not null,            -- [A-Z0-9]{3} at grant time
  achievement  text not null,            -- hole_in_one | under_par | hunt_master
  created_at   timestamptz not null default now(),
  redeemed_at  timestamptz,              -- set once, when banked to a loyalty card
  unique (round_id, player_index, achievement)
);
create index if not exists reward_grant_round_idx    on reward_grant (round_id);
create index if not exists reward_grant_redeemed_idx on reward_grant (redeemed_at) where redeemed_at is null;

-- A grant is claimed exactly once, when it's banked to a loyalty card: the app
-- credits it server-side, sets redeemed_at (the single consume point), and
-- records the value paid + the vendor tx so a re-opened summary settles from
-- the row instead of crediting again.
alter table reward_grant add column if not exists tickets_awarded   int;   -- tickets paid on a card claim
alter table reward_grant add column if not exists card_player_id    text;  -- the loyalty card credited
alter table reward_grant add column if not exists pos_transaction_id text; -- vendor tx id (null until credited)
-- The counter-redemption flow is retired: codes are no longer minted, Master
-- Control reports on issuance instead of redeeming it, and a card claim is the
-- only lane — so redeemed_at alone marks a claimed grant. Drop its columns (a
-- grant's identity is its UUID; achievements pay out only as tickets).
alter table reward_grant drop column if exists code;
alter table reward_grant drop column if exists redeemed_by;
-- All existing reward_grant data is test data, so clear the table before
-- dropping the lane marker — this leaves no historical counter redemption for
-- the claim route to misread once redeemed_via is gone (a card claim for the
-- same round could otherwise re-credit a prize already handed out at the
-- counter). Guarded on redeemed_via's existence so it fires exactly ONCE, on
-- the upgrade that drops the column, and never on a later schema re-apply
-- (schema.sql re-runs in full when its content changes) or a fresh DB.
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_name = 'reward_grant' and column_name = 'redeemed_via') then
    delete from reward_grant;
  end if;
end $$;
alter table reward_grant drop column if exists redeemed_via;

-- Photo auto-moderation (unblocks people-in-photos + the social photo share).
-- Every hunt photo is classified in the SAME vision call that verifies the
-- find: content safety for a family venue, plus whether people / apparent
-- minors are in frame (recorded now; display policy decided at the sharing
-- surface). Auto-mod only for now — a human review surface is a later
-- concern, but every verdict is recorded from day one so it starts with
-- full history. `moderation` on hunt_find:
--   'approved'  auto-passed by the vision moderation — displayable
--   'flagged'   auto-blocked at upload: the photo was NEVER written to disk
--   'rejected'  removed by an operator (routes/admin/photos.js) — file deleted
--   null        legacy pre-moderation rows
alter table hunt_find add column if not exists moderation        text;
alter table hunt_find add column if not exists moderation_reason text;
alter table hunt_find add column if not exists people_present    boolean;
alter table hunt_find add column if not exists minors_present    boolean;
-- Reads of stored photos by moderation state (future review/sharing surfaces).
create index if not exists hunt_find_moderation_idx
  on hunt_find (moderation) where photo_path is not null;

-- ---------------------------------------------------------------------------
-- Scavenger-hunt admin (Master Control → Hunt): per-item judge guidance and
-- vetting image sets. See routes/admin/huntItems.js.
-- ---------------------------------------------------------------------------

-- Extra judge guidance per item, written by the operator and appended to the
-- production vision prompt (lib/vision.js) alongside name + hint — e.g.
-- "credit only the RED windmill, not the blue one by hole 4". Null = none.
alter table hunt_item add column if not exists extra_prompt text;

-- An item's vetting test set: admin-sourced sample photos of the real prop,
-- run against the hunt judge (vision bench) to tune name/hint/extra_prompt
-- before the item goes live. ADMIN-ONLY test data — never shown to players
-- and never sent along with player verifications. Test-data policy
-- (CLAUDE.md): these images go to third-party model providers, so uploads
-- are people-screened at the API and rejected if anyone is visible.
-- Files live on disk under HUNT_ITEM_IMAGE_DIR (image_path), like
-- hunt_find.photo_path; rows cascade with their item, files are removed by
-- the delete routes.
create table if not exists hunt_item_image (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references hunt_item(id) on delete cascade,
  image_path  text not null,            -- stored image path on the droplet disk
  media_type  text not null,            -- image/jpeg | png | webp | gif
  subject     text,                     -- descriptor's label from the upload screen
  note        text,                     -- operator's free-text note
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists hunt_item_image_item_idx on hunt_item_image (item_id);

-- ---------------------------------------------------------------------------
-- Photo booth (player photo sharing + stickers). See routes/photos.js.
-- A deliberately AI-free pipeline: unlike hunt photos, booth photos are never
-- sent to any model provider — decorating happens on the phone (stickers are
-- flattened into the JPEG before upload) and the server only stores bytes.
-- Access control is hunt-style capability keys: booth_id is an unguessable
-- per-device id minted by the client; whoever holds it (the group's phone)
-- sees that gallery, and nobody else can browse or enumerate. With no AI
-- moderation pass, the operator review surface (routes/admin/boothPhotos.js)
-- and the retention sweep (lib/boothPhotoRetention.js,
-- PHOTO_BOOTH_RETENTION_DAYS) carry the whole safety/privacy load.
-- ---------------------------------------------------------------------------
create table if not exists booth_photo (
  id          uuid primary key default gen_random_uuid(),
  booth_id    text not null,            -- unguessable per-device booth key (the capability)
  location_id uuid references location(id) on delete set null,
                                        -- venue at upload time; scopes the admin review
                                        -- surface (null = super_admin-only, hunt precedent)
  photo_path  text not null,            -- stored image path on the droplet disk
  media_type  text not null,            -- image/jpeg | png | webp | gif
  bytes       int,                      -- stored file size; backs the global disk
                                        -- budget (PHOTO_BOOTH_DISK_BUDGET_MB)
  created_at  timestamptz not null default now()
);
-- For databases created before `bytes` existed: add it idempotently.
alter table booth_photo add column if not exists bytes int;
create index if not exists booth_photo_booth_idx   on booth_photo (booth_id, created_at desc);
create index if not exists booth_photo_created_idx on booth_photo (created_at);

-- ---------------------------------------------------------------------------
-- Game ticket awards — the server-side ledger behind POST /api/game-rewards/
-- award (the trusted proxy mini-games credit tickets through; see
-- routes/gameRewards.js and lib/gameRewards.js). One row per game round that
-- reached the award endpoint, whether or not it paid: the unique
-- (game, session_id) is the idempotency key (a re-mounted end screen or
-- retried request replays instead of double-crediting), tickets_awarded is
-- what actually landed after cap clamping, and the rows back both the daily
-- per-card cap (sum over the venue-local day) and Master Control's issuance
-- rollup (routes/admin/gameRewards.js). status:
--   'pending'    reserved (caps checked, row committed) but the POS credit
--                hasn't confirmed — a replay retries the POS call
--   'awarded'    credited vendor-side (pos_transaction_id set)
--   'daily_cap'  the card was already at its daily cap; nothing credited
create table if not exists game_ticket_award (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references location(id) on delete cascade,
  player_id          text not null,     -- vendor player/card id (opaque here)
  game               text not null,     -- registry key, e.g. 'skeeball'
  session_id         text not null,     -- client round id (idempotency)
  tickets_requested  int  not null,     -- what the client asked for
  tickets_awarded    int  not null,     -- after per-round + daily clamping
  status             text not null,     -- pending | awarded | daily_cap
  pos_transaction_id text,              -- vendor tx id once credited
  created_at         timestamptz not null default now(),
  unique (game, session_id)
);
create index if not exists game_ticket_award_player_day_idx
  on game_ticket_award (location_id, player_id, created_at);
create index if not exists game_ticket_award_created_idx
  on game_ticket_award (location_id, created_at);

-- ---------------------------------------------------------------------------
-- Photo-booth venue stickers (routes/admin/boothStickers.js + the player
-- booth's sticker sheet). Venue staff upload their own SVG decorations per
-- location; players at that venue get them alongside the built-in emoji.
-- SVG is an XSS vector, so uploads are validated (lib/svgSanitize.js), only
-- ever rendered as <img>/canvas (never inlined), and served with hardened
-- headers. Intrinsic width/height are captured at upload so the client sizes
-- each sticker with the right aspect without parsing the SVG.
-- ---------------------------------------------------------------------------
create table if not exists booth_sticker (
  id          uuid primary key default gen_random_uuid(),
  location_id uuid not null references location(id) on delete cascade,
  svg_path    text not null,            -- asset file on the droplet disk (svg or png)
  media_type  text not null default 'image/svg+xml', -- image/svg+xml | image/png
  label       text,                     -- optional admin label / alt text
  width       int  not null default 100, -- intrinsic px box (aspect ratio source)
  height      int  not null default 100,
  -- What the asset is, which drives how the booth applies it:
  --   'sticker'   a draggable decoration (default)
  --   'frame'     a full-photo overlay (proscenium/border), one at a time
  --   'watermark' venue branding forced into a corner of every photo
  kind        text not null default 'sticker',
  -- Corner for a watermark: 'tl' | 'tr' | 'bl' | 'br' (ignored for other kinds).
  corner      text not null default 'tr',
  sort_order  int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
-- For databases created before kinds existed: add them idempotently.
alter table booth_sticker add column if not exists kind   text not null default 'sticker';
alter table booth_sticker add column if not exists corner text not null default 'tr';
alter table booth_sticker add column if not exists media_type text not null default 'image/svg+xml';
create index if not exists booth_sticker_location_idx
  on booth_sticker (location_id, sort_order) where active;

-- First-party funnel analytics (adoption + sign-in). Aggregate product usage
-- only — enough to measure "install prompt shown -> installed" and "sign-in
-- started -> completed" and find where players drop off. Deliberately
-- privacy-clean: identity is ONLY the anonymous device install id (same id the
-- announcement-view beacon uses) — we intentionally do NOT store app_user_id,
-- so a funnel event can never be linked back to a name or email (that's the
-- promise on the Privacy page). No IP or other PII is stored either. `event`
-- is constrained to a server-side allowlist in the route, so a bad client
-- can't write junk names. `meta` carries small, non-identifying context.
--
-- `client_event_id` is a stable per-event id minted on the device. The beacon
-- uses keepalive and a durable retry queue, so a request can commit while the
-- page closes before the client sees the ack — the batch is then re-sent on the
-- next launch. A unique constraint + ON CONFLICT DO NOTHING makes that retry a
-- no-op instead of double-counting the funnel.
create table if not exists funnel_event (
  id              uuid primary key default gen_random_uuid(),
  client_event_id uuid not null unique,                -- device-minted, dedups retries
  event           text not null,                       -- allowlisted name (see routes/events.js)
  device_id       uuid not null,                       -- anonymous per-install id
  location_id     uuid references location(id) on delete set null,
  platform        text,                                -- 'ios' | 'android' | 'desktop' | 'other'
  meta            jsonb not null default '{}'::jsonb,  -- small non-identifying context
  created_at      timestamptz not null default now()
);
create index if not exists funnel_event_name_time_idx on funnel_event (event, created_at);
create index if not exists funnel_event_device_idx on funnel_event (device_id);

-- Adoption bonuses (lib/adoptionBonus.js + routes/gameRewards.js /bonus): a
-- ONE-TIME ticket reward per card for installing the app and for signing in.
-- Distinct from game_ticket_award — a milestone economy, not a per-round one —
-- so it's kept out of the mini-game daily cap. The unique key makes the award
-- one-time per (venue, card, kind); the pending -> awarded flow mirrors the
-- game proxy so a lost POS response is retried under the same idempotency key
-- rather than double-credited.
create table if not exists bonus_award (
  id                 uuid primary key default gen_random_uuid(),
  location_id        uuid not null references location(id) on delete cascade,
  player_id          text not null,     -- vendor player/card id (opaque here)
  kind               text not null,     -- 'install' | 'signin'
  tickets            int  not null,     -- amount credited (venue-tuned)
  status             text not null,     -- pending | awarded
  pos_transaction_id text,              -- vendor tx id once credited
  created_at         timestamptz not null default now(),
  unique (location_id, player_id, kind)
);
create index if not exists bonus_award_player_idx on bonus_award (location_id, player_id);
