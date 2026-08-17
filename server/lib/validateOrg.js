// Shared org validation + return columns, extracted from routes/admin/orgs.js
// (the validateLocation.js / validateCourse.js precedent) so the org upsert
// route and the site-provisioning route validate identically.
import { UUID_RE, SLUG_RE } from "./validateLocation.js";
import { normalizeBranding } from "./branding.js";
import { isReservedOrgSlug } from "./reservedSlugs.js";

export const ORG_COLS = `id, name, slug, status, sort_order as "sortOrder",
  branding, archived_at as "archivedAt"`;

export function normalizeOrg(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be an org object", status: 400 };
  }
  const { id, name, slug } = body;
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
  // The slug becomes the org's subdomain label — infrastructure hostnames are
  // off limits (see lib/reservedSlugs.js). 400 not 409: a validation rule,
  // not a collision with another org.
  if (isReservedOrgSlug(slug)) {
    return { error: `slug "${slug}" is reserved for platform hostnames`, status: 400 };
  }
  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer", status: 400 };
    }
    sortOrder = body.sortOrder;
  }
  // Branding is optional on the upsert: null here means "not provided" — the
  // insert path defaults it to {}, the conflict-update path preserves what's
  // already stored (see the coalesce($n, org.branding) in the SQL).
  let branding = null;
  if (body.branding !== undefined && body.branding !== null) {
    const b = normalizeBranding(body.branding);
    if (b.error) return b;
    branding = b.branding;
  }
  return { row: { id, name: name.trim(), slug, sortOrder, branding } };
}
