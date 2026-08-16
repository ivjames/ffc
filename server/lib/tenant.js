// Tenant (org) resolution from the request host (MULTI-VENUE.md §1). One
// deployed instance serves every client subdomain; the first DNS label of the
// Host header is the candidate org slug. A miss falls back to DEFAULT_ORG_SLUG
// (so today's staging host `ffc.lab980.com` keeps resolving to Bullwinkle's),
// then to the first live org; no live orgs at all resolves to null and readers
// preserve their pre-org unfiltered behavior.
import { pool } from "../db.js";

const ORG_COLS = `id, slug, name, branding`;
// "Live" for tenant purposes: not archived AND active (a suspended org's
// subdomain stops resolving without losing any data).
const LIVE = `archived_at is null and status = 'active'`;

// The content endpoint is hit on every app boot, so resolutions are cached
// in-process per host label. 30s TTL keeps an org archive/branding change
// propagating to players within half a minute without a restart.
const TTL_MS = 30_000;
const cache = new Map(); // label -> { value, expires }

/** Drop all cached resolutions (tests; also handy after admin org edits). */
export function clearTenantCache() {
  cache.clear();
}

async function liveOrgBySlug(slug) {
  const db = await pool.query(`select ${ORG_COLS} from org where slug = $1 and ${LIVE}`, [slug]);
  return db.rows[0] ?? null;
}

/**
 * Resolve the tenant for a request. Returns `{ org, via }` or `null`:
 *   - org: { id, slug, name, branding } (branding as stored — sparse; merge
 *     through resolveBranding() before use)
 *   - via: 'host' when the subdomain label matched an org slug exactly, else
 *     'fallback' (default-org path — steps 3/4). Readers use this to decide
 *     whether org-less legacy rows are in scope (fallback only).
 */
export async function resolveTenant(req) {
  // Express strips the port from req.hostname, but belt-and-braces it anyway.
  const host = String(req.hostname || "").toLowerCase().replace(/:\d+$/, "");
  const label = host.split(".")[0];

  const hit = cache.get(label);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = null;
  const bySlug = label ? await liveOrgBySlug(label) : null;
  if (bySlug) {
    value = { org: bySlug, via: "host" };
  } else {
    const fallback = await liveOrgBySlug(process.env.DEFAULT_ORG_SLUG || "bullwinkles");
    if (fallback) {
      value = { org: fallback, via: "fallback" };
    } else {
      const first = await pool.query(
        `select ${ORG_COLS} from org where ${LIVE} order by sort_order, name limit 1`
      );
      if (first.rowCount > 0) value = { org: first.rows[0], via: "fallback" };
    }
  }
  cache.set(label, { value, expires: Date.now() + TTL_MS });
  return value;
}

// --- Tenant scoping helpers (MULTI-VENUE.md §6 bullet 1) ---------------------
// Player-facing routes accept course/location/row ids the device remembered —
// a guessed or stale UUID from another tenant must behave exactly like a
// nonexistent id (the route's own not-found shape, never a 403: existence must
// not leak). Every reader applies the /api/content contract: via='host' →
// strict org match; via='fallback' → the tenant's rows plus org-less legacy
// rows (the safety net); no tenant at all → legacy unfiltered behavior.

/**
 * WHERE fragment scoping an org_id column to the tenant. `col` is the org_id
 * column reference — usually a LEFT-JOINed location's ("l.org_id"), so a row
 * with no location at all counts as org-less. `placeholder` is the $n that
 * carries tenant.org.id; append tenantParams(tenant) to the query's params —
 * it is [] exactly when this fragment is "" (no tenant), so the two always
 * stay in step.
 */
export function tenantOrgFilter(tenant, col, placeholder) {
  if (tenant == null) return "";
  return tenant.via === "host"
    ? `and ${col} = ${placeholder}`
    : `and (${col} = ${placeholder} or ${col} is null)`;
}

/** The params that pair with tenantOrgFilter's placeholder. */
export function tenantParams(tenant) {
  return tenant == null ? [] : [tenant.org.id];
}

/**
 * Look up a course within the tenant's scope (course → location → org).
 * Returns { id, pars } or null — a course that exists under another tenant is
 * null, indistinguishable from a nonexistent id. Pass a transaction's client
 * as `q` when the caller is already inside one.
 */
export async function findTenantCourse(courseId, tenant, q = pool) {
  const db = await q.query(
    `select c.id, c.pars from course c
       left join location l on l.id = c.location_id
      where c.id = $1 ${tenantOrgFilter(tenant, "l.org_id", "$2")}`,
    [courseId, ...tenantParams(tenant)]
  );
  return db.rows[0] ?? null;
}

/**
 * Look up a LIVE (not archived) location within the tenant's scope; null for
 * foreign and nonexistent alike. Callers name the columns they need
 * (caller-chosen literals, never user input).
 */
export async function findTenantLocation(locationId, tenant, { cols = "id", q = pool } = {}) {
  const db = await q.query(
    `select ${cols} from location
      where id = $1 and archived_at is null ${tenantOrgFilter(tenant, "org_id", "$2")}`,
    [locationId, ...tenantParams(tenant)]
  );
  return db.rows[0] ?? null;
}

/**
 * Middleware form: sets req.tenant (result of resolveTenant, or null). Mounted
 * per-route on the reads that need it (content, manifest, announcements) —
 * not globally. A resolution failure degrades to no tenant rather than 500ing
 * the read; the route's own query will surface a genuinely down DB.
 */
export function tenant() {
  return async (req, _res, next) => {
    try {
      req.tenant = await resolveTenant(req);
    } catch (err) {
      console.error("[tenant] resolution failed:", err);
      req.tenant = null;
    }
    next();
  };
}
