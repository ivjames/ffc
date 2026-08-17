// Tenant (org) resolution from the request host (MULTI-VENUE.md §1). One
// deployed instance serves every client subdomain; the first DNS label of the
// Host header is the candidate org slug. A label that matches NO org at all
// falls back to DEFAULT_ORG_SLUG (so today's staging host `ffc.lab980.com`
// keeps resolving to Bullwinkle's). Only when no org with that slug EXISTS at
// all (fresh-install bootstrap: the seed org was renamed) does resolution fall
// through to the first live org; no live orgs at all resolves to null and
// readers preserve their pre-org unfiltered behavior.
//
// PLATFORM_FQDN narrows that fallback. The wildcard vhost answers EVERY
// subdomain of the platform domain, so without it a typo'd or unconfigured
// subdomain (typo.ffc.lab980.com) would serve the default org's full catalog
// and brand. With PLATFORM_FQDN set (e.g. "ffc.lab980.com"):
//   - the apex itself, and www. in front of it, keep the default-org fallback
//     (today's staging behavior, org-less legacy sweep included);
//   - any OTHER subdomain of it whose label matches no org goes DARK — the
//     same sentinel as a suspended org, so every reader serves empty;
//   - hosts outside the platform domain (localhost, tests, a future
//     bring-your-own custom domain) keep the fallback.
// Unset = legacy behavior everywhere: every unmatched host falls back. Read
// per request, like the other live-tunable envs.
//
// A label that matches an org that EXISTS but is not live (suspended or
// archived) must NOT fall through to the default org — that would serve the
// default tenant's brand and catalog on the suspended client's subdomain, a
// cross-brand leak. It resolves to the distinct 'suspended' shape instead
// (see resolveTenant), which every reader treats as "matches nothing". The
// same rule guards the fallback itself: a DEFAULT org that exists but is
// suspended/archived takes every unmatched host dark with it — it never hands
// the apex/staging hosts to whichever OTHER client sorts first.
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

// Any org row for a slug, live or not — resolveTenant needs to tell "no such
// org" (fallback) apart from "org exists but is suspended/archived" (the
// subdomain goes dark, no fallback).
async function orgBySlug(slug) {
  const db = await pool.query(
    `select ${ORG_COLS}, status, archived_at as "archivedAt" from org where slug = $1`,
    [slug]
  );
  return db.rows[0] ?? null;
}

// Shape an orgBySlug row into a resolution: a live row resolves normally under
// the given via; a suspended/archived row resolves to the dark SENTINEL (see
// resolveTenant's doc comment) regardless of which path found it.
function resolution(row, via) {
  if (row.archivedAt == null && row.status === "active") {
    const { status: _s, archivedAt: _a, ...org } = row;
    return { org, via };
  }
  return { org: { id: null, slug: row.slug, name: null, branding: null }, via: "suspended" };
}

/**
 * Resolve the tenant for a request. Returns `{ org, via }` or `null`:
 *   - org: { id, slug, name, branding } (branding as stored — sparse; merge
 *     through resolveBranding() before use)
 *   - via: 'host' when the subdomain label matched a LIVE org slug exactly;
 *     'suspended' when the label matched an org that exists but is suspended
 *     or archived — AND for an unknown subdomain of PLATFORM_FQDN (no org at
 *     all carries the label): both are "this host serves nothing", and
 *     sharing the via keeps every reader's suspended short-circuit covering
 *     the unknown case too; else 'fallback' (default-org path — steps 3/4).
 *     Readers use via to decide whether org-less legacy rows are in scope
 *     (fallback only).
 *
 * The 'suspended' shape keeps `org` a non-null SENTINEL — { id: null, slug,
 * name: null, branding: null } — so readers that pass `tenant.org.id` into
 * tenantOrgFilter's strict `col = $n` predicate compare against NULL and match
 * nothing (never true in SQL), and branding readers (`tenant?.org.branding ??
 * {}`) land on the platform defaults. That makes every guarded route take its
 * existing empty/not-found path without special-casing.
 */
export async function resolveTenant(req) {
  // Express strips the port from req.hostname, but belt-and-braces it anyway.
  const host = String(req.hostname || "").toLowerCase().replace(/:\d+$/, "");
  const label = host.split(".")[0];

  // Host classification against PLATFORM_FQDN (see header comment). Only a
  // strict subdomain counts — the apex and www. are the platform's own front
  // door and keep the default-org fallback; anything not under the platform
  // domain at all (localhost, custom domains) is out of scope. Case handled
  // by the lowercase above; PLATFORM_FQDN unset disables the whole check.
  const platform = (process.env.PLATFORM_FQDN || "").trim().toLowerCase();
  const platformSub =
    platform !== "" &&
    host !== platform &&
    host !== `www.${platform}` &&
    host.endsWith(`.${platform}`);

  // The cache key carries the host CLASS, not just the first label: the same
  // label resolves differently on a platform subdomain (typo.<platform> →
  // dark) than on the apex or a foreign host (→ default-org fallback), so the
  // two must not share an entry. Unknown-subdomain dark results are cached
  // like any other completed resolution (errors still never are).
  const key = platformSub ? `${label}|sub` : label;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;

  let value = null;
  const bySlug = label ? await orgBySlug(label) : null;
  if (bySlug) {
    // Exact slug match. A suspended/archived org's subdomain goes DARK (empty
    // catalog, default branding) instead of leaking the default org.
    value = resolution(bySlug, "host");
  } else if (platformSub) {
    // An UNCONFIGURED subdomain of the platform domain: no org carries this
    // label, so it must go dark, never fall back — the fallback would hang
    // the default org's brand and catalog on every typo'd/junk subdomain the
    // wildcard vhost answers. Same sentinel (and same via) as a suspended
    // org ON PURPOSE: readers that short-circuit on via === 'suspended'
    // (content, announcements) treat it identically without knowing about
    // this path, and every shape-keyed reader compares against the NULL org
    // id and matches nothing.
    value = { org: { id: null, slug: label, name: null, branding: null }, via: "suspended" };
  } else {
    // No org matches the label: the default-org fallback. Looked up WITHOUT
    // the live filter on purpose — a default org that exists but is
    // suspended/archived resolves to the same dark sentinel as a suspended
    // host match, so unmatched hosts (apex/staging included) go blank rather
    // than falling through to the first live org, which would serve ANOTHER
    // client's catalog, branding, and manifest there.
    const byDefault = await orgBySlug(process.env.DEFAULT_ORG_SLUG || "bullwinkles");
    if (byDefault) {
      value = resolution(byDefault, "fallback");
    } else {
      // No org with the default slug exists at all — fresh-install bootstrap
      // (the seed org was renamed): fall back to the first live org.
      const first = await pool.query(
        `select ${ORG_COLS} from org where ${LIVE} order by sort_order, name limit 1`
      );
      if (first.rowCount > 0) value = { org: first.rows[0], via: "fallback" };
    }
  }
  // Only completed resolutions are cached — a NEGATIVE result (null = no live
  // orgs) and the 'suspended' shape included (an unsuspend propagates within
  // the TTL, same as any other org edit). A thrown DB error never reaches this
  // line, so a transient failure can neither masquerade as "no orgs" nor
  // poison the cache.
  cache.set(key, { value, expires: Date.now() + TTL_MS });
  return value;
}

// --- Tenant scoping helpers (MULTI-VENUE.md §6 bullet 1) ---------------------
// Player-facing routes accept course/location/row ids the device remembered —
// a guessed or stale UUID from another tenant must behave exactly like a
// nonexistent id (the route's own not-found shape, never a 403: existence must
// not leak). Every reader applies the /api/content contract: via='host' →
// strict org match; via='fallback' → the tenant's rows plus org-less legacy
// rows (the safety net); via='suspended' → the strict predicate against the
// sentinel's NULL org id, which matches nothing (the venue is off); no tenant
// at all → legacy unfiltered behavior.

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
  // Only the fallback path sweeps in org-less legacy rows. 'host' matches the
  // org strictly; 'suspended' takes the same strict form on purpose — its
  // sentinel org id is NULL, and `col = NULL` is never true, so a suspended
  // tenant matches zero rows (legacy rows included).
  return tenant.via === "fallback"
    ? `and (${col} = ${placeholder} or ${col} is null)`
    : `and ${col} = ${placeholder}`;
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
 * per-route on the reads and writes that need scoping — not globally. Fails
 * CLOSED: null means a VERIFIED "no live orgs" (legacy unfiltered mode), so a
 * resolution error must not degrade to it — every tenant filter treats null as
 * unfiltered, and a transient DB blip would silently drop the org boundary.
 * The error answers 500 here (and is never cached), so the next request
 * re-resolves against a healthy DB.
 */
export function tenant() {
  return async (req, res, next) => {
    try {
      req.tenant = await resolveTenant(req);
    } catch (err) {
      console.error("[tenant] resolution failed:", err);
      return res.status(500).json({ ok: false, error: "internal error" });
    }
    next();
  };
}
