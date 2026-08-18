// What "a course the synthetic bot may play" means, in one place.
//
// The bot is a platform tool: it discovers across every org (routes/synthetic.js)
// and posts rounds that skip tenant scoping (routes/rounds.js). Those two sides
// must agree, or the write path becomes wider than the catalog that fed it — a
// course whose org is suspended (or whose venue/course was archived) between
// discovery and the next sweep would still accept rounds, manufacturing traffic
// for a client that is dark to players. The bot keeps its last-known course set
// when a refresh fails, so that window is real, not theoretical.
//
// Hence one predicate, imported by both: live course, live location, and either
// a live org or the org-less legacy rows the rest of the platform still honors.
import { pool } from "../db.js";

/**
 * WHERE fragment for the live-catalog scope. Assumes the query joins
 * `location l` and LEFT JOINs `org o on o.id = l.org_id`. Pure literal — no
 * user input flows in.
 */
export const LIVE_CATALOG_SCOPE = `l.archived_at is null
  and (l.org_id is null or (o.archived_at is null and o.status = 'active'))`;

/**
 * Look up a course platform-wide, restricted to the catalog scope above.
 * Returns { id, pars } or null — a course outside the scope is null,
 * indistinguishable from a nonexistent id, exactly like findTenantCourse.
 * Pass a transaction's client as `q` when the caller is already inside one.
 */
export async function findSyntheticCourse(courseId, q = pool) {
  const db = await q.query(
    `select c.id, c.pars from course c
       join location l on l.id = c.location_id
       left join org o on o.id = l.org_id
      where c.id = $1 and c.archived_at is null and ${LIVE_CATALOG_SCOPE}`,
    [courseId]
  );
  return db.rows[0] ?? null;
}
