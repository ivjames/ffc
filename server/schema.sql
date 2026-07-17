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
  sort_order  int  not null default 0
);

-- For databases created before GPS columns existed: add them idempotently.
alter table location add column if not exists lat         double precision;
alter table location add column if not exists lng         double precision;
alter table location add column if not exists geofence_km double precision;

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
insert into location (id, name, slug, lat, lng, geofence_km, sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Upland',      'upland',      34.08867, -117.67946, 2, 10),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Tukwila',     'tukwila',     47.46562, -122.24302, 2, 20),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Wilsonville', 'wilsonville', 45.30969, -122.76680, 2, 30)
on conflict (id) do update
  set name        = excluded.name,
      slug        = excluded.slug,
      lat         = excluded.lat,
      lng         = excluded.lng,
      geofence_km = excluded.geofence_km,
      sort_order  = excluded.sort_order;

-- The client's nine courses across the three venues (Upland x4, Tukwila x3,
-- Wilsonville x2). Idempotent on id; `deploy/courses.seed.json` / `ffc seed`
-- remains the source of truth and upserts name/theme/pars over these, so the
-- conflict clause only keeps location_id in sync. Ids + pars + location_id
-- mirror src/data/courses.ts. Pars are still placeholders (length 18, 2..4).
insert into course (id, name, theme, pars, location_id, sort_order) values
  ('a1111111-1111-4111-8111-111111111111', 'Blue Course', 'blue', '{3,2,3,2,3,4,2,3,2,3,3,2,4,3,2,3,2,3}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 10),
  ('a2222222-2222-4222-8222-222222222222', 'Green Course', 'green', '{2,3,2,3,3,2,4,3,2,3,2,3,3,4,2,3,3,2}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 20),
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

-- Backfill: existing finds for an item that is now `countable` must carry the
-- flag too, so the partial unique index (which excludes countable finds) stops
-- constraining them. Idempotent — only touches rows not already set.
update hunt_find f
   set countable = true
  from hunt_item i
 where f.item_id = i.id and i.countable and f.countable = false;
