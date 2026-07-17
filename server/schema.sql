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
  primary key (id),
  unique (course_id, slug)
);

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
  created_at      timestamptz not null default now()
);

create index if not exists hunt_find_round_idx  on hunt_find (round_client_id);
create index if not exists hunt_find_item_idx   on hunt_find (item_id);
create index if not exists hunt_find_player_idx on hunt_find (player_tag);

-- One verified find per (group, player, item). This backs the app-level dedup in
-- routes/hunt.js against a race: two concurrent submissions can both pass the
-- SELECT guard, so the DB is the real arbiter (the insert uses ON CONFLICT).
-- Partial on `verified` so repeated *failed* attempts (verified=false) still
-- insert freely. `if not exists` keeps migrate idempotent.
create unique index if not exists hunt_find_verified_unique
  on hunt_find (round_client_id, player_tag, item_id)
  where verified;

-- Placeholder locations for the first client (three sites). Idempotent on id;
-- ids + coords mirror src/data/courses.ts. Coords are placeholders in far-apart
-- cities so GPS detect is unambiguous while testing; the client's real venues
-- swap in here. The conflict clause backfills coords onto rows that predate the
-- GPS columns (coalesce) without clobbering any real values already set.
insert into location (id, name, slug, lat, lng, geofence_km, sort_order) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Riverside',  'riverside',  40.7128,  -74.0060, 25, 10),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Summit',     'summit',     34.0522, -118.2437, 25, 20),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Harborwalk', 'harborwalk', 41.8781,  -87.6298, 25, 30)
on conflict (id) do update
  set lat         = coalesce(location.lat, excluded.lat),
      lng         = coalesce(location.lng, excluded.lng),
      geofence_km = coalesce(location.geofence_km, excluded.geofence_km);

-- Ensure the four courses exist so the hunt seed's course FK resolves even on a
-- fresh `npm run migrate` (before `ffc seed` loads them via the API). Idempotent
-- on id; `deploy/courses.seed.json` / `ffc seed` remains the source of truth and
-- upserts name/theme/pars over these. Ids + pars + location_id mirror
-- src/data/courses.ts (placeholder 2/1/1 split across the three sites). The
-- conflict clause keeps location_id in sync even for pre-existing course rows,
-- while leaving name/theme/pars for the seed route to own.
insert into course (id, name, theme, pars, location_id) values
  ('11111111-1111-4111-8111-111111111111', 'Jungle Run',    'jungle',  '{3,2,4,3,3,2,4,3,2,3,4,3,2,3,3,4,2,3}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('22222222-2222-4222-8222-222222222222', 'Pirate''s Cove', 'pirate', '{2,3,3,4,3,2,3,4,3,2,3,3,4,2,3,3,4,3}', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ('33333333-3333-4333-8333-333333333333', 'Space Odyssey', 'space',   '{3,3,2,4,3,3,2,3,4,3,3,2,4,3,3,2,3,4}', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('44444444-4444-4444-8444-444444444444', 'Haunted Manor', 'haunted', '{3,4,2,3,3,4,3,2,3,4,2,3,3,4,3,2,3,3}', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
on conflict (id) do update set location_id = excluded.location_id;

-- Seed the four themed hunt lists (one per course). ON CONFLICT (course_id, slug)
-- DO NOTHING keeps this idempotent so migrate can run repeatedly without
-- duplicating rows or clobbering edits.
insert into hunt_item (course_id, slug, name, hint, sort_order) values
  -- Jungle Run
  ('11111111-1111-4111-8111-111111111111', 'vine',      'A hanging vine',                'Swinging from the canopy.',        10),
  ('11111111-1111-4111-8111-111111111111', 'animal',    'An animal statue',              'Monkey, tiger, snake — anything.', 20),
  ('11111111-1111-4111-8111-111111111111', 'water',     'A waterfall or pond',           'Holes 7 and 14 have water.',       30),
  ('11111111-1111-4111-8111-111111111111', 'bridge',    'The rope bridge',               'It crosses hole 11.',              40),
  ('11111111-1111-4111-8111-111111111111', 'flower',    'A big tropical flower',         'Bright and hard to miss.',         50),
  ('11111111-1111-4111-8111-111111111111', 'flag',      'A red flag on a hole',          'Check the pin.',                   60),
  -- Pirate's Cove
  ('22222222-2222-4222-8222-222222222222', 'ship',      'A pirate ship or shipwreck',    'The hull ramp is on hole 5.',      10),
  ('22222222-2222-4222-8222-222222222222', 'cannon',    'A cannon',                      'Ready to fire.',                   20),
  ('22222222-2222-4222-8222-222222222222', 'chest',     'A treasure chest',              'X marks the spot.',                30),
  ('22222222-2222-4222-8222-222222222222', 'skull',     'A skull-and-crossbones',        'On a flag or a sign.',             40),
  ('22222222-2222-4222-8222-222222222222', 'anchor',    'An anchor',                     'Heavy and iron.',                  50),
  ('22222222-2222-4222-8222-222222222222', 'parrot',    'A parrot',                      'Might be on a shoulder.',          60),
  -- Space Odyssey
  ('33333333-3333-4333-8333-333333333333', 'rocket',    'A rocket ship',                 'Pointed at the stars.',            10),
  ('33333333-3333-4333-8333-333333333333', 'planet',    'A planet or moon',              'A big model sphere.',              20),
  ('33333333-3333-4333-8333-333333333333', 'astronaut', 'An astronaut',                  'Suited up.',                       30),
  ('33333333-3333-4333-8333-333333333333', 'ufo',       'A UFO or satellite',            'Something orbiting.',              40),
  ('33333333-3333-4333-8333-333333333333', 'wormhole',  'The wormhole',                  'It teleports your ball on hole 9.', 50),
  ('33333333-3333-4333-8333-333333333333', 'crater',    'A crater',                      'A dent in the surface.',           60),
  -- Haunted Manor
  ('44444444-4444-4444-8444-444444444444', 'ghost',     'A ghost',                       'Boo.',                             10),
  ('44444444-4444-4444-8444-444444444444', 'tombstone', 'A tombstone',                   'R.I.P.',                           20),
  ('44444444-4444-4444-8444-444444444444', 'bat',       'A bat',                         'Look up.',                         30),
  ('44444444-4444-4444-8444-444444444444', 'pumpkin',   'A jack-o''-lantern',            'Carved and grinning.',             40),
  ('44444444-4444-4444-8444-444444444444', 'spider',    'A spider or web',               'Sticky business.',                 50),
  ('44444444-4444-4444-8444-444444444444', 'gate',      'The spinning gate',             'Time it right on hole 6.',         60)
on conflict (course_id, slug) do nothing;
