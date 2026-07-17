-- FFC mini-golf scorecard schema.
-- Requires the pgcrypto extension for gen_random_uuid() (bundled with modern Postgres).
create extension if not exists pgcrypto;

create table if not exists course (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  theme       text not null,
  hole_count  int  not null default 18,
  pars        int[] not null,          -- length 18, values 2..4
  sort_order  int  not null default 0
);

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

-- The fixed list of things players hunt for. Seeded below (idempotent on slug);
-- a rotating/randomized list is a later phase — this one is curated and stable.
create table if not exists hunt_item (
  id          uuid primary key default gen_random_uuid(),
  slug        text unique not null,        -- stable key, e.g. 'red-flag'
  name        text not null,               -- what to find, e.g. 'A red flag'
  hint        text,                        -- optional nudge shown to players
  sort_order  int  not null default 0,
  active      boolean not null default true
);

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

-- Seed the fixed item list. ON CONFLICT (slug) DO NOTHING keeps this idempotent
-- so `npm run migrate` can run repeatedly without duplicating or clobbering edits.
insert into hunt_item (slug, name, hint, sort_order) values
  ('windmill',    'A windmill',                 'Every good mini-golf course has one.', 10),
  ('red-flag',    'A red flag on a hole',       'Check the pin.',                       20),
  ('water-hazard','Water — a pond, stream, or fountain', 'Keep your ball out of it.',   30),
  ('bridge',      'A little bridge',            'Something you walk or putt over.',     40),
  ('animal-statue','An animal statue or figure', 'Frog, gator, flamingo — anything.',   50),
  ('scoreboard',  'A scoreboard or leaderboard screen', 'Where the high scores live.',  60),
  ('golf-ball',   'A golf ball that is NOT yours', 'Spot a stray on the course.',       70),
  ('course-sign', 'A course or hole number sign', 'Tells you where you are.',           80)
on conflict (slug) do nothing;
