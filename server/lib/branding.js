// Per-org white-label branding (MULTI-VENUE.md §2) — the canonical server-side
// defaults + validation. Stored shape is SPARSE: only the keys an operator set
// live in org.branding; readers merge through resolveBranding() so an empty
// object renders the neutral platform look. The client keeps its own copy of
// these defaults (src/lib/branding.ts) for pre-hydration rendering.
//
// The defaults are deliberately venue-neutral: no client's name or assets may
// leak onto another tenant through the merge. The logo trio has NO platform
// default at all — an org without an uploaded logo gets none anywhere (the
// player app's placements fall back to neutral chrome/emoji) — so those keys
// are simply absent here and resolveBranding() leaves them undefined. The
// default client (Bullwinkle's) keeps its look via its OWN org branding row,
// seeded in schema.sql.

export const BRANDING_DEFAULTS = Object.freeze({
  appName: "Mini Golf Scorecard",
  shortName: "MiniGolf",
  themeColor: "#15803d",
  backgroundColor: "#052e16",
  accentColor: "#38bdf8",
  icon192Url: "/icons/icon-192.png",
  icon512Url: "/icons/icon-512.png",
  shareFooter: "Come beat this score",
});

// Field vocabularies — every branding key is exactly one of these three kinds.
const TEXT_MAX = { appName: 80, shortName: 30, shareFooter: 120 };
const HEX_KEYS = ["themeColor", "backgroundColor", "accentColor"];
const URL_KEYS = ["logoUrl", "logoBadgeUrl", "logoWordmarkUrl", "icon192Url", "icon512Url"];
const URL_MAX = 300;

// Every storable branding key — a superset of Object.keys(BRANDING_DEFAULTS)
// because the logo trio is storable but has no default. Readers that project
// or merge stored branding (resolveBranding below, the /api/content sparse
// projection) must iterate THIS list, not the defaults' keys, or an org's
// explicit logo would never surface.
export const BRANDING_KEYS = Object.freeze([...Object.keys(TEXT_MAX), ...HEX_KEYS, ...URL_KEYS]);

const HEX_RE = /^#[0-9a-f]{6}$/i; // #rrggbb only — no shorthand, no alpha

/**
 * Validate + normalize a branding object (the FULL replacement value — this is
 * replace-not-merge, so callers send every key they want kept). All keys are
 * optional; `null` drops a key back to its default. Unknown keys are rejected
 * rather than stored, so a typo'd key can't silently no-op.
 * @returns {{ branding: object } | { error: string, status: number }}
 */
export function normalizeBranding(input) {
  if (input == null || typeof input !== "object" || Array.isArray(input)) {
    return { error: "branding must be an object", status: 400 };
  }
  const branding = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === undefined) continue; // explicit null = use the default
    if (Object.hasOwn(TEXT_MAX, key)) {
      const max = TEXT_MAX[key];
      if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
        return { error: `branding.${key} must be a string (1..${max} chars)`, status: 400 };
      }
      branding[key] = value;
    } else if (HEX_KEYS.includes(key)) {
      if (typeof value !== "string" || !HEX_RE.test(value)) {
        return { error: `branding.${key} must be a #rrggbb hex color`, status: 400 };
      }
      branding[key] = value.toLowerCase(); // canonical lowercase in storage
    } else if (URL_KEYS.includes(key)) {
      // Same-origin path or https only. "//host/..." is excluded from the path
      // branch — protocol-relative URLs would leave our origin when rendered.
      const ok =
        typeof value === "string" &&
        value.length <= URL_MAX &&
        (value.startsWith("https://") || (value.startsWith("/") && !value.startsWith("//")));
      if (!ok) {
        return {
          error: `branding.${key} must start with "/" or "https://" (max ${URL_MAX} chars)`,
          status: 400,
        };
      }
      branding[key] = value;
    } else {
      return { error: `branding: unknown key ${JSON.stringify(key)}`, status: 400 };
    }
  }
  return { branding };
}

/**
 * Merge a stored (sparse, already-validated) branding object over the platform
 * defaults. Tolerates garbage — a non-object or junk value just yields the
 * defaults — so readers never have to guard. Keys with no platform default
 * (the logo trio) stay ABSENT unless the org set them: no logo is a real,
 * supported state, not a fallback to anyone's assets.
 */
export function resolveBranding(raw) {
  const resolved = { ...BRANDING_DEFAULTS };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const key of BRANDING_KEYS) {
      if (typeof raw[key] === "string" && raw[key].length > 0) resolved[key] = raw[key];
    }
  }
  return resolved;
}
