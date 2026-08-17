// Hostname labels that may never become org slugs. An org slug IS the first
// DNS label of <slug>.<platform-domain> (MULTI-VENUE.md §1), so a slug that
// matches platform infrastructure would shadow — or be shadowed by — a real
// host: admin.<fqdn> is Master Control (protected today only by nginx
// exact-match precedence), and "ffc"/"infinicade" are the platform apex's own
// first labels, which tenant resolution sees on every bare-apex request.
// Enforced app-layer in the org routes (location slugs are not hostnames).
export const RESERVED_ORG_SLUGS = new Set([
  "admin",
  "api",
  "app",
  "ffc",
  "infinicade",
  "landing",
  "mail",
  "www",
]);

export function isReservedOrgSlug(slug) {
  return RESERVED_ORG_SLUGS.has(slug);
}
