// Shared location (venue) validation + timezone resolution, extracted from
// routes/locations.js so both the public POST /api/locations and the admin
// router (POST /api/admin/locations) validate identically.
import { tzFromCoords, isValidTz, friendlyTzLabel } from "./timezone.js";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Lowercase kebab: letters/digits in groups joined by single hyphens, no
// leading/trailing/double hyphen. e.g. "riverside", "north-40".
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Columns to return (and their JSON casing) — shared by insert RETURNING and the
// list SELECT so both responses have the same shape.
export const LOCATION_RETURN_COLS = `id, name, slug, lat, lng,
  geofence_km as "geofenceKm", tz, sort_order as "sortOrder",
  org_id as "orgId", archived_at as "archivedAt"`;

/** Add the derived friendly tz label so admin/consumers don't recompute it. */
export function withLabel(loc) {
  return { ...loc, tzLabel: loc.tz ? friendlyTzLabel(loc.tz) : null };
}

/**
 * Validate + normalize a location POST body into a DB row, resolving the tz.
 * `orgId` is accepted (admin path) and validated as a uuid when present.
 * @returns {{ row: object } | { error: string, status: number }}
 */
export function normalizeLocation(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a location object", status: 400 };
  }

  const { id, name, slug, orgId } = body;

  if (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) {
    return { error: "id must be a uuid when provided", status: 400 };
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return { error: "name is required (1..200 chars)", status: 400 };
  }
  if (typeof slug !== "string" || slug.length > 64 || !SLUG_RE.test(slug)) {
    return {
      error: "slug must be lowercase [a-z0-9-], no leading/trailing/double hyphen",
      status: 400,
    };
  }
  if (orgId !== undefined && orgId !== null && (typeof orgId !== "string" || !UUID_RE.test(orgId))) {
    return { error: "orgId must be a uuid when provided", status: 400 };
  }

  // Coordinates — optional, but range-checked when present.
  let lat = null;
  let lng = null;
  if (body.lat !== undefined && body.lat !== null) {
    if (!isFiniteNum(body.lat) || body.lat < -90 || body.lat > 90) {
      return { error: "lat must be a number in -90..90", status: 400 };
    }
    lat = body.lat;
  }
  if (body.lng !== undefined && body.lng !== null) {
    if (!isFiniteNum(body.lng) || body.lng < -180 || body.lng > 180) {
      return { error: "lng must be a number in -180..180", status: 400 };
    }
    lng = body.lng;
  }
  // A lone coordinate can't place the venue (or derive a zone) — require both.
  if ((lat === null) !== (lng === null)) {
    return { error: "lat and lng must be provided together", status: 400 };
  }

  let geofenceKm = null;
  if (body.geofenceKm !== undefined && body.geofenceKm !== null) {
    if (!isFiniteNum(body.geofenceKm) || body.geofenceKm <= 0) {
      return { error: "geofenceKm must be a positive number", status: 400 };
    }
    geofenceKm = body.geofenceKm;
  }

  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer", status: 400 };
    }
    sortOrder = body.sortOrder;
  }

  // Resolve the timezone. Explicit `tz` wins (validated); otherwise derive from
  // coordinates; otherwise leave null and let the leaderboard fall back to
  // VENUE_TZ. Onboarding normally sends just lat/lng and lets it derive.
  let tz = null;
  if (body.tz !== undefined && body.tz !== null) {
    if (!isValidTz(body.tz)) {
      return {
        error: `tz ${JSON.stringify(body.tz)} is not a valid IANA zone ` +
          `(use e.g. "America/Los_Angeles", not "PST")`,
        status: 400,
      };
    }
    tz = body.tz;
  } else if (lat !== null && lng !== null) {
    try {
      tz = tzFromCoords(lat, lng);
    } catch {
      return { error: "could not derive a timezone from lat/lng", status: 400 };
    }
  }

  return {
    row: {
      id,
      name: name.trim(),
      slug,
      lat,
      lng,
      geofenceKm,
      tz,
      sortOrder,
      orgId: orgId ?? null,
    },
  };
}
