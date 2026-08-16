// §4 White-label branding. Each org (tenant) carries a `branding` jsonb blob
// (MULTI-VENUE.md §2) that rides in the same GET /api/content payload as the
// catalog. Every key is optional server-side; this module is the ONE
// client-side home of the defaults (mirroring server/lib/branding.js), so a
// missing key — or no org at all — always resolves to the current hardcoded
// Bullwinkle's look and an empty branding object changes nothing.
//
// The org is pushed in by the content store (src/data/courses.ts) — at module
// boot from the baked snapshot / localStorage cache, then again on live
// hydration — via `setOrg()`. Read through `getBranding()` at call time (not a
// captured snapshot) and subscribe with `useBrandingRevision()` to re-render on
// update, exactly like the catalog's `useContentRevision()`. The store lives
// here (not reusing the catalog's) so branding consumers like logo.ts don't
// have to import the catalog module, which itself needs `getBranding()` for
// its accent fallback — a cycle that would trip TDZ at boot.

import { useSyncExternalStore } from 'react';

export type Branding = {
  appName: string;
  shortName: string;
  themeColor: string;
  backgroundColor: string;
  accentColor: string;
  logoUrl: string;
  logoBadgeUrl: string;
  logoWordmarkUrl: string;
  icon192Url: string;
  icon512Url: string;
  shareFooter: string;
};

// The org row as delivered in /api/content (and the generated snapshot).
// `branding` is a partial overlay; unknown keys are ignored on merge.
export type OrgInfo = {
  id: string;
  slug: string;
  name: string;
  branding: Record<string, string>;
};

// Canonical client-side defaults — MULTI-VENUE.md §2, kept in lockstep with
// server/lib/branding.js BRANDING_DEFAULTS. These ARE today's hardcoded values
// (share footer, logo paths, PWA colors), so a tenant with empty branding is
// pixel-identical to the pre-org app.
export const BRANDING_DEFAULTS: Branding = {
  appName: 'Mini Golf Scorecard',
  shortName: 'MiniGolf',
  themeColor: '#15803d',
  backgroundColor: '#052e16',
  accentColor: '#38bdf8',
  logoUrl: '/brand/logo.png',
  logoBadgeUrl: '/brand/logo-badge.png',
  logoWordmarkUrl: '/brand/logo-wordmark.png',
  icon192Url: '/icons/icon-192.png',
  icon512Url: '/icons/icon-512.png',
  shareFooter: "Bullwinkle's · come beat this score",
};

// Merge an org's (partial) branding over the defaults. Only known keys with
// non-empty string values are taken — the payload is network input, and a
// stale cache may carry shapes from older builds.
function merge(overrides: Record<string, unknown> | null | undefined): Branding {
  const out: Branding = { ...BRANDING_DEFAULTS };
  if (overrides && typeof overrides === 'object') {
    for (const k of Object.keys(BRANDING_DEFAULTS) as (keyof Branding)[]) {
      const v = overrides[k];
      if (typeof v === 'string' && v) out[k] = v;
    }
  }
  return out;
}

let org: OrgInfo | null = null;
let branding: Branding = BRANDING_DEFAULTS;
let revision = 0;
const listeners = new Set<() => void>();

/** The resolved branding — defaults overlaid with the current org's values.
 *  Read at call time; the object is replaced (never mutated) on `setOrg`. */
export function getBranding(): Branding {
  return branding;
}

/** The current tenant org, or null (no tenant → pure defaults). */
export function getOrg(): OrgInfo | null {
  return org;
}

// Reflect the resolved branding into the document chrome. Idempotent; no-op
// under node (server-side tests import game modules with no DOM). The
// theme-color meta is created if index.html ever ships without one.
function applyToDocument(): void {
  if (typeof document === 'undefined') return;
  document.title = branding.appName;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta && document.head) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  if (meta) meta.setAttribute('content', branding.themeColor);
}

/** Swap in the tenant org (null = defaults). Called by the content store at
 *  boot and on every hydrate — not by components. Re-resolves the branding,
 *  applies title/theme-color, and notifies subscribers. */
export function setOrg(next: OrgInfo | null): void {
  org = next;
  branding = merge(next?.branding);
  applyToDocument();
  revision += 1;
  listeners.forEach((cb) => cb());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getRevision(): number {
  return revision;
}

/** Subscribe a component to branding updates — re-renders when the org (or its
 *  branding) hydrates. The returned number is opaque. */
export function useBrandingRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}
