// Shared hunt-item validation for the admin router (routes/admin/huntItems.js),
// following the normalizeCourse convention: returns { row } or { error }.

import { UUID_RE } from "./validateLocation.js";

export const HUNT_ITEM_RETURN_COLS = `id, course_id as "courseId", slug, name,
  hint, extra_prompt as "extraPrompt", sort_order as "sortOrder", active, countable`;

// Same shape as the seeded slugs: lowercase, digits, hyphens, no leading/trailing
// hyphen ambiguity beyond "starts alphanumeric".
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

const MAX_NAME = 120;
const MAX_HINT = 500;
// Roomy: this is judge guidance prose, but it rides every verify call's input
// tokens for the item, so it's still bounded.
const MAX_EXTRA_PROMPT = 2000;

/** Trim a string field; '' becomes null. Returns undefined when not a string. */
function optionalText(value, max) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.length > max) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Validate a full hunt-item shape (create, or an existing row merged with a
 * PATCH body); returns { row } or { error }.
 */
export function normalizeHuntItem(body) {
  if (body == null || typeof body !== "object") {
    return { error: "body must be an object" };
  }
  const { courseId, slug, name } = body;

  if (typeof courseId !== "string" || !UUID_RE.test(courseId)) {
    return { error: "courseId must be a uuid" };
  }
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    return { error: "slug must be 1..40 chars of a-z, 0-9, and hyphens" };
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > MAX_NAME) {
    return { error: `name is required (max ${MAX_NAME} chars)` };
  }

  const hint = optionalText(body.hint, MAX_HINT);
  if (hint === undefined) {
    return { error: `hint must be a string of at most ${MAX_HINT} chars` };
  }
  const extraPrompt = optionalText(body.extraPrompt, MAX_EXTRA_PROMPT);
  if (extraPrompt === undefined) {
    return { error: `extraPrompt must be a string of at most ${MAX_EXTRA_PROMPT} chars` };
  }

  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer" };
    }
    sortOrder = body.sortOrder;
  }

  for (const flag of ["active", "countable"]) {
    if (body[flag] !== undefined && typeof body[flag] !== "boolean") {
      return { error: `${flag} must be a boolean` };
    }
  }

  return {
    row: {
      courseId,
      slug,
      name: name.trim(),
      hint,
      extraPrompt,
      sortOrder,
      active: body.active ?? true,
      countable: body.countable ?? false,
    },
  };
}
