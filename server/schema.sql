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
