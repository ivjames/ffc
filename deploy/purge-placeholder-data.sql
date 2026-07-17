-- Optional, one-off cleanup of the pre-launch PLACEHOLDER courses and every
-- record tied to them: Jungle Run, Pirate's Cove, Space Odyssey, Haunted Manor.
--
-- This is DESTRUCTIVE — it deletes played rounds, their scores, and scavenger-
-- hunt finds (including stored photo references) for those courses. The schema
-- migration intentionally does NOT do this; run it by hand only when you're sure
-- that data is disposable test data. Real course data is never affected: the
-- nine live courses use different ids (a1111111…, b1111111…, c1111111…).
--
-- Usage on the droplet:
--   set -a; . /var/www/ffc/server/.env; set +a
--   psql "$DATABASE_URL" -f /var/www/ffc/deploy/purge-placeholder-data.sql
--
-- Wrapped in a transaction: it all applies or none of it does. Idempotent —
-- re-running after a successful purge deletes nothing more.

begin;

-- The four placeholder course ids.
create temporary table _placeholder_course (id uuid primary key) on commit drop;
insert into _placeholder_course (id) values
  ('11111111-1111-4111-8111-111111111111'),
  ('22222222-2222-4222-8222-222222222222'),
  ('33333333-3333-4333-8333-333333333333'),
  ('44444444-4444-4444-8444-444444444444');

-- 1. Hunt finds -> hunt_item(id) has no cascade, so clear finds first.
delete from hunt_find
 where item_id in (
   select hi.id from hunt_item hi
    where hi.course_id in (select id from _placeholder_course)
 );

-- 2. Rounds -> course(id) has no cascade (scores cascade with the round).
delete from round
 where course_id in (select id from _placeholder_course);

-- 3. Courses -> hunt_item rows cascade now that no hunt_find references them.
delete from course
 where id in (select id from _placeholder_course);

commit;
