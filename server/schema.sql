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

-- Bullwinkle's three venues. Idempotent on id; ids + coords mirror
-- src/data/courses.ts (exact coordinates geocoded from the street addresses;
-- 2 km geofence per venue, sites hundreds of km apart so no overlap).
-- schema.sql is the sole source of truth for location rows (there is no
-- separate location seed API), so the conflict clause syncs every field
-- authoritatively — that's how existing DBs pick up name/coord changes on the
-- next migrate. Addresses: Upland 1560 W 7th St 91786; Tukwila 7300 Fun Center
-- Way 98188; Wilsonville 29111 SW Town Center Loop W 97070.
-- `tz` is each venue's IANA timezone. Today's three venues happen to all be
-- Pacific, but that's incidental — a venue elsewhere carries its own zone here,
-- and the leaderboard reads it per round (never one global assumption).
insert into location (id, name, slug, lat, lng, geofence_km, tz, sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Upland',      'upland',      34.08867, -117.67946, 2, 'America/Los_Angeles', 10),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tukwila',     'tukwila',     47.46562, -122.24302, 2, 'America/Los_Angeles', 20),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Wilsonville', 'wilsonville', 45.30969, -122.76680, 2, 'America/Los_Angeles', 30)
on conflict (id) do update
  set name        = excluded.name,
      slug        = excluded.slug,
      lat         = excluded.lat,
      lng         = excluded.lng,
      geofence_km = excluded.geofence_km,
      tz          = excluded.tz,
      sort_order  = excluded.sort_order;

-- The client's nine courses across the three venues (Upland x4, Tukwila x3,
-- Wilsonville x2). Idempotent on id; `deploy/courses.seed.json` / `ffc seed`
-- remains the source of truth and upserts name/theme/pars over these, so the
-- conflict clause only keeps location_id in sync. Ids + pars + location_id
-- mirror src/data/courses.ts. Pars are still placeholders (length 18, 2..4).
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
on conflict (id) do update set location_id = excluded.location_id;

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
-- show an empty hunt (the UI handles that gracefully). ON CONFLICT DO UPDATE
-- makes this seed authoritative for its content columns, so migrate can run
-- repeatedly without duplicating rows AND existing rows pick up edits here (e.g.
-- flipping the horseshoe to `countable`). `id` and `active` are left untouched.
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
on conflict (course_id, slug) do update
  set name       = excluded.name,
      hint       = excluded.hint,
      sort_order = excluded.sort_order,
      countable  = excluded.countable;

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
on conflict (course_id, slug) do update
  set name       = excluded.name,
      hint       = excluded.hint,
      sort_order = excluded.sort_order,
      countable  = excluded.countable;

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
on conflict (course_id, slug) do update
  set name       = excluded.name,
      hint       = excluded.hint,
      sort_order = excluded.sort_order,
      countable  = excluded.countable;

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

-- Forward-compat for real accounts (Phase 2). Present so org-scoping has a home
-- and org_id never needs re-plumbing later; UNUSED by v1 code (single APP_TOKEN).
create table if not exists admin_user (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  role          text not null default 'org_admin',  -- super_admin | org_admin
  org_id        uuid references org(id),             -- null for super_admin
  password_hash text,
  created_at    timestamptz not null default now()
);

-- Seed the default org for the current client (Bullwinkle's) and backfill the
-- existing locations onto it. Fixed id so this is idempotent and mirrors the
-- LOC_* / course id convention in src/data/courses.ts. ON CONFLICT keeps the
-- name/slug authoritative on re-migrate; sort_order/status left to the update.
insert into org (id, name, slug, sort_order) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Bullwinkle''s', 'bullwinkles', 10)
on conflict (id) do update
  set name = excluded.name, slug = excluded.slug;

-- Any location without an org yet joins the default org. Safe to run every
-- migrate: it only touches rows where org_id is still null, so a later
-- reassignment through Master Control is never overwritten.
update location
   set org_id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
 where org_id is null;
