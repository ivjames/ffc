// GET /api/content — the live player-facing catalog (locations + courses),
// live rows only (archived_at is null). Open read, like the leaderboard: this
// is the same content the app bundles, so nothing here is secret.
//
// Multi-venue (MULTI-VENUE.md §3): the catalog is filtered to the tenant
// resolved from the Host header, and the payload carries the tenant org (with
// its SPARSE stored branding — the client merges its own defaults) so the PWA
// can restyle itself. An
// exact subdomain match filters strictly to that org; the fallback path (the
// default org) also sweeps up org-less legacy rows as a safety net; no tenant
// at all (no live orgs) preserves the pre-org unfiltered behavior.
//
// The build-time exporter (scripts/export-content.mjs) pulls this to regenerate
// src/data/content.generated.ts, so the DB stays the single source of truth and
// a rebuild publishes changes. Shapes mirror GeneratedLocation/GeneratedCourse.
import { Router } from "express";
import { pool } from "../db.js";
import { tenant } from "../lib/tenant.js";
import { BRANDING_KEYS } from "../lib/branding.js";

export const router = Router();

// Sparse projection of the stored branding: known keys with non-empty string
// values, NO default-merging (resolveBranding's acceptance rule minus the
// defaults). The wire format must preserve explicitness — the client pins the
// theme-color meta only when the ORG set themeColor (src/lib/branding.ts
// hasExplicitThemeColor), so a merged payload would make every org, even one
// storing {}, look explicit and override the light/dark mode greys. The client
// owns an identical BRANDING_DEFAULTS and merges in getBranding(). (The
// manifest endpoint is the opposite case: no client-side merge, so it stays
// server-resolved.)
function sparseBranding(raw) {
  const branding = {};
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    // BRANDING_KEYS, not the defaults' keys: the logo trio has no platform
    // default but must still ride the wire when an org set it.
    for (const key of BRANDING_KEYS) {
      if (typeof raw[key] === "string" && raw[key].length > 0) branding[key] = raw[key];
    }
  }
  return branding;
}

router.get("/", tenant(), async (req, res) => {
  const t = req.tenant;
  // A suspended/archived org's subdomain serves an EMPTY catalog with no org —
  // never the default org's brand and venues (lib/tenant.js). The client
  // accepts empty-with-org-key payloads and shows its empty state (PR #191).
  if (t?.via === "suspended") {
    return res.json({ org: null, locations: [], courses: [] });
  }
  const orgFilter =
    t == null
      ? ""
      : t.via === "host"
        ? "and l.org_id = $1"
        : "and (l.org_id = $1 or l.org_id is null)";
  const params = t == null ? [] : [t.org.id];
  try {
    const [locations, courses] = await Promise.all([
      pool.query(
        `select l.id, l.name, l.slug, l.lat, l.lng, l.geofence_km as "geofenceKm",
                l.tz, l.sort_order as "sortOrder",
                l.menu_url as "menuUrl", l.ordering_url as "orderingUrl",
                l.pos, l.hours, l.org_id as "orgId"
           from location l
          where l.archived_at is null ${orgFilter}
          order by l.sort_order, l.name`,
        params
      ),
      // Courses follow their location: same tenant predicate via the join, so
      // the course list is exactly "courses of the returned locations".
      pool.query(
        t == null
          ? `select id, location_id as "locationId", name, theme,
                    hole_count as "holeCount", pars, sort_order as "sortOrder"
               from course
              where archived_at is null
              order by sort_order, name`
          : `select c.id, c.location_id as "locationId", c.name, c.theme,
                    c.hole_count as "holeCount", c.pars, c.sort_order as "sortOrder"
               from course c
               join location l on l.id = c.location_id
              where c.archived_at is null and l.archived_at is null ${orgFilter}
              order by c.sort_order, c.name`,
        params
      ),
    ]);
    return res.json({
      org: t
        ? {
            id: t.org.id,
            slug: t.org.slug,
            name: t.org.name,
            branding: sparseBranding(t.org.branding),
          }
        : null,
      locations: locations.rows,
      courses: courses.rows,
    });
  } catch (err) {
    console.error("[content] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
