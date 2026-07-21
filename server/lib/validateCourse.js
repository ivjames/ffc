// Shared course validation, extracted from routes/seed.js so both the legacy
// POST /api/seed (array seed) and the admin router (POST /api/admin/courses,
// PATCH /api/admin/courses/:id) validate identically.

export const COURSE_RETURN_COLS = `id, name, theme, hole_count as "holeCount",
  pars, location_id as "locationId", sort_order as "sortOrder",
  archived_at as "archivedAt"`;

/**
 * Validate a single course seed; returns { row } or { error }.
 * `idx` is only used to make array-seed error messages point at the bad entry.
 */
export function normalizeCourse(seed, idx = 0) {
  if (seed == null || typeof seed !== "object") {
    return { error: `seed[${idx}] must be an object` };
  }
  const { id, name, theme, locationId } = seed;
  const holeCount = seed.holeCount ?? 18;
  const pars = seed.pars;

  if (typeof name !== "string" || name.length === 0) {
    return { error: `seed[${idx}].name is required` };
  }
  if (typeof theme !== "string" || theme.length === 0) {
    return { error: `seed[${idx}].theme is required` };
  }
  if (!Number.isInteger(holeCount) || holeCount < 1) {
    return { error: `seed[${idx}].holeCount must be a positive integer` };
  }
  if (!Array.isArray(pars) || pars.length !== 18) {
    return { error: `seed[${idx}].pars must be an array of length 18` };
  }
  for (const p of pars) {
    if (!Number.isInteger(p) || p < 2 || p > 4) {
      return { error: `seed[${idx}].pars values must be integers 2..4` };
    }
  }
  if (id !== undefined && (typeof id !== "string" || id.length === 0)) {
    return { error: `seed[${idx}].id must be a uuid string when provided` };
  }
  if (
    locationId !== undefined &&
    locationId !== null &&
    (typeof locationId !== "string" || locationId.length === 0)
  ) {
    return { error: `seed[${idx}].locationId must be a uuid string when provided` };
  }

  let sortOrder = 0;
  if (seed.sortOrder !== undefined && seed.sortOrder !== null) {
    if (!Number.isInteger(seed.sortOrder)) {
      return { error: `seed[${idx}].sortOrder must be an integer` };
    }
    sortOrder = seed.sortOrder;
  }

  return {
    row: {
      id,
      name,
      theme,
      holeCount,
      pars,
      locationId: locationId ?? null,
      sortOrder,
    },
  };
}
