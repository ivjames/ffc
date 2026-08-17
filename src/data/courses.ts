import { useSyncExternalStore } from 'react';
import type { CourseSeed, LocationSeed } from '../types';
import type {
  GeneratedCourse,
  GeneratedLocation,
  GeneratedOrg,
} from './content.generated';
import { getBranding, setOrg } from '../lib/branding';

// §4 White-label content. The DB (managed in Master Control) is the source of
// truth for the DATA of locations and courses — names, slugs, coords, tz,
// geofence, pars, themes, sort order, AND per-venue POS config. It reaches the
// app via GET /api/content (cached per origin in localStorage). This module
// merges the FRONTEND-ONLY styling that isn't in the DB — per-location/
// per-course accent colors and the themed Rules copy — on top of it, and
// re-exports the same `LOCATIONS` / `COURSES` / helper API the rest of the app
// already consumes.
//
// LIVE HYDRATION: on load we re-fetch GET /api/content and swap in the live
// catalog, so an operator's Master Control change (e.g. enabling a POS
// capability) reaches players on the next app open — no redeploy. The last
// good fetch is cached per origin for instant/offline starts; with no cache
// yet we boot EMPTY rather than from the baked snapshot (see the boot section
// below — the snapshot is the default org's data and must not flash on other
// tenants' subdomains). Read POS/venue state through the accessors below (not
// a captured snapshot) and subscribe with `useContentRevision()` to re-render
// on update.
//
// The payload also carries the tenant `org` (+ branding, MULTI-VENUE.md §3);
// this store forwards it to src/lib/branding.ts (`setOrg`) at boot and on
// every hydrate, so branding travels with the catalog — same fetch, same
// cache entry, same revision cycle.

// Stable site ids (mirror content.generated.ts / the Postgres seed).
const LOC_UPLAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC_TUKWILA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOC_WILSONVILLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Per-site brand accent (hex), keyed by location id. Frontend-only — not a DB
// column. New locations onboarded in Master Control fall back to the tenant's
// branding.accentColor (BRANDING_DEFAULTS carries the old DEFAULT_ACCENT
// #38bdf8) until an accent is added here.
const LOCATION_ACCENTS: Record<string, string> = {
  [LOC_UPLAND]: '#38bdf8',
  [LOC_TUKWILA]: '#f472b6',
  [LOC_WILSONVILLE]: '#facc15',
};

// Course accent (hex), keyed by course id, else by theme, else a sane default.
// Frontend-only, like the location accents.
const COURSE_ACCENTS_BY_ID: Record<string, string> = {
  'a1111111-1111-4111-8111-111111111111': '#3b82f6',
  'a2222222-2222-4222-8222-222222222222': '#22c55e',
  'a3333333-3333-4333-8333-333333333333': '#ea580c',
  'a4444444-4444-4444-8444-444444444444': '#b45309',
  'b1111111-1111-4111-8111-111111111111': '#3b82f6',
  'b2222222-2222-4222-8222-222222222222': '#22c55e',
  'b3333333-3333-4333-8333-333333333333': '#ef4444',
  'c1111111-1111-4111-8111-111111111111': '#3b82f6',
  'c2222222-2222-4222-8222-222222222222': '#22c55e',
};
const THEME_ACCENTS: Record<string, string> = {
  california: '#3b82f6',
  classic: '#22c55e',
  dragon: '#ea580c',
  western: '#b45309',
  blue: '#3b82f6',
  green: '#22c55e',
  red: '#ef4444',
};

// Per-course notes, keyed by theme (a course's `rules` is set from its theme).
// Short, themed flavor that reads on the Rules screen. A theme shares notes
// across locations, so a course only carries a distinct theme when its decor is
// actually its own: Upland's Blue Course is California-themed (`california`) and
// its Green Course is classic-mini-golf-themed (`classic`), while every other
// venue's Blue/Green course stays on the generic `blue`/`green` placeholder
// until the client supplies that venue's real per-course rules (§11).
const THEME_RULES: Record<string, string[]> = {
  // Generic placeholders — Blue/Green courses that aren't yet individually themed.
  blue: [
    'Fast blue felt — the banks run quick, so ease off your backswing.',
    'Water comes into play on the back nine: fish your ball out and add one stroke.',
    'Several two-tier greens reward a firm, confident first putt.',
  ],
  green: [
    'Our gentlest layout — a good warm-up and friendly to younger players.',
    'Hedgerows line the fairways; a ball lost in the greenery is replayed where it entered.',
    'Time your putt through the windmill — the gate opens on a slow, steady turn.',
  ],
  // Upland · Blue Course — California-themed: coast, redwoods, Golden State icons.
  california: [
    'Coast holes run past a mini Golden Gate — thread the ball between the towers while the span is clear.',
    'Pacific water hazards guard the back nine: fish your ball out and add one stroke.',
    'Redwood shade and beach sand steal a fast ball’s speed — a firm, confident putt holds its line.',
  ],
  // Upland · Green Course — classic mini-golf: the timeless windmill/loop/clown.
  classic: [
    'Time your putt through the spinning windmill — the gate opens on a slow, steady turn.',
    'The loop-the-loop needs pace: hit it firm or the ball rolls right back to your feet.',
    'Bank it past the clown’s mouth and the wishing well — the classic banks reward a scouting look.',
  ],
  dragon: [
    'The dragon guards the mid-course — putt through while its jaws are open.',
    'The cavern holes play in low light; give downhill putts extra room.',
    'Commit fully to the loop — a timid putt rolls right back to your feet.',
  ],
  western: [
    'The mine-cart tunnel splits three ways — the left track feeds nearest the cup.',
    'Saloon doors swing shut fast; a ball they block is replayed with no penalty.',
    'Sand plays as ground here — no penalty, but it will steal your speed.',
  ],
  red: [
    'Our championship layout — tight banks and blind breaks reward a scouting lap.',
    'The volcano kicks balls out at random; play the rebound where it lies.',
    'Ridged carpet near the finish makes long putts wander — short and straight wins.',
  ],
};

function courseAccent(c: GeneratedCourse): string {
  return COURSE_ACCENTS_BY_ID[c.id] ?? THEME_ACCENTS[c.theme] ?? getBranding().accentColor;
}

// Merge generated (DB) data + frontend styling into the app's LocationSeed/
// CourseSeed shapes. Pure so they can re-run against live content too.
function buildLocations(raw: GeneratedLocation[]): LocationSeed[] {
  return raw.map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    accent: LOCATION_ACCENTS[l.id] ?? getBranding().accentColor,
    lat: l.lat ?? 0,
    lng: l.lng ?? 0,
    geofenceKm: l.geofenceKm ?? undefined,
    sortOrder: l.sortOrder,
    tz: l.tz ?? undefined,
    hours: l.hours ?? undefined,
    menuUrl: l.menuUrl ?? undefined,
    orderingUrl: l.orderingUrl ?? undefined,
    pos: l.pos ?? undefined,
  }));
}

function buildCourses(raw: GeneratedCourse[]): CourseSeed[] {
  return raw.map((c) => ({
    id: c.id,
    locationId: c.locationId ?? '',
    name: c.name,
    theme: c.theme,
    holeCount: 18,
    pars: c.pars,
    accent: courseAccent(c),
    rules: THEME_RULES[c.theme],
  }));
}

// ---- live-hydrated content store -------------------------------------------

const CONTENT_CACHE_KEY = 'ffc.content';
type RawContent = {
  locations: GeneratedLocation[];
  courses: GeneratedCourse[];
  // Tenant org + branding (MULTI-VENUE.md §3). Optional: caches written before
  // the org rollout lack the key — that must read as "no org", not a crash.
  org?: GeneratedOrg | null;
  // Dark-sentinel marker (server/routes/content.js): this host serves NO venue
  // (unknown platform subdomain, suspended/archived org). Optional: live-org
  // payloads and older caches simply lack it, which must read as "available".
  unavailable?: boolean;
};

/** Strict read of the dead-end flag: only a literal `true` counts. Absent,
 *  malformed, or stale-cache shapes are "available" — the dead-end must never
 *  fire on a real tenant because of garbage in localStorage. */
function unavailableOf(c: RawContent): boolean {
  return c.unavailable === true;
}

/** The payload's org, or null when absent/malformed (pre-org cache, no-tenant
 *  server response). Branding falls back to BRANDING_DEFAULTS either way. */
function orgOf(c: RawContent): GeneratedOrg | null {
  const o = c.org;
  if (!o || typeof o.id !== 'string' || typeof o.slug !== 'string' || typeof o.name !== 'string') {
    return null;
  }
  return {
    id: o.id,
    slug: o.slug,
    name: o.name,
    branding: o.branding && typeof o.branding === 'object' ? o.branding : {},
  };
}

/** Shape-guard a parsed /api/content (or cache) before trusting it. A payload
 *  carrying the `org` key (the tenant-aware shape, MULTI-VENUE.md §3) is valid
 *  even with ZERO locations: a brand-new tenant, or one whose venues are all
 *  archived, legitimately serves an empty catalog, and rejecting it would keep
 *  the previously cached/baked catalog — ANOTHER tenant's venues and branding —
 *  on that tenant's subdomain. Zero-location payloads WITHOUT the org key stay
 *  rejected: legacy/garbled shapes where empty only ever meant a broken fetch. */
export function isValidContent(c: unknown): c is RawContent {
  const v = c as RawContent | null;
  return (
    !!v &&
    typeof v === 'object' &&
    Array.isArray(v.locations) &&
    Array.isArray(v.courses) &&
    (v.locations.length > 0 || 'org' in v) &&
    v.locations.every((l) => l && typeof l.id === 'string' && typeof l.name === 'string') &&
    v.courses.every((cs) => cs && typeof cs.id === 'string' && Array.isArray(cs.pars))
  );
}

function readCache(): RawContent | null {
  try {
    const raw = localStorage.getItem(CONTENT_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isValidContent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Start from this ORIGIN's cached live fetch — and from nothing at all when
// there is no cache yet. The baked GENERATED_* snapshot is deliberately NOT a
// boot fallback anymore: it is the DEFAULT org's catalog + org, and booting it
// on a never-hydrated origin (a fresh client subdomain, first visit) briefly
// showed another tenant's venues and branding until /api/content answered.
// Booting empty is safe (the zero-location guards from the empty-catalog work
// cover every fallback) and honest: the first successful hydrate populates and
// caches, typically well under a second — and a FIRST visit can't be offline
// anyway, since the service worker that would serve the app shell offline
// isn't installed yet. Every later visit has the cache. The generated module
// stays for its compile-time types (and as the exporter's target shape).
//
// `let` (not `const`) so hydration can swap in live data and importers of
// LOCATIONS/COURSES that read at call-time see it (ES live bindings).
const cached = readCache();
// Branding first (document title/theme-color + the accent fallback the builds
// below read). The org decision travels with the cache: a cached catalog means
// a cached org too — even a missing one (pre-org cache → null → defaults) —
// and no cache means no org (pure defaults) until the hydrate lands.
setOrg(cached ? orgOf(cached) : null);
export let LOCATIONS: LocationSeed[] = cached ? buildLocations(cached.locations) : [];
export let COURSES: CourseSeed[] = cached ? buildCourses(cached.courses) : [];

// Dead-end state (MULTI-VENUE.md §1/§3): true when this host's /api/content
// answered with the dark sentinel's `unavailable: true` — the app root renders
// the TenantUnavailable screen instead of the router. Booted from the cache so
// a repeat visit dead-ends instantly (no flash of the empty app); a later
// hydrate WITHOUT the flag (org unsuspended, org created for the slug) clears
// it, restoring the app on the next revision tick.
let tenantUnavailable = cached ? unavailableOf(cached) : false;

/** Whether this origin serves no venue (dark sentinel). Read at call time and
 *  subscribe via useContentRevision() — the flag rides the content revisions. */
export function isTenantUnavailable(): boolean {
  return tenantUnavailable;
}

let revision = 0;
const listeners = new Set<() => void>();

function applyContent(raw: RawContent): void {
  // Org first: the accent fallback inside the builds reads the live branding.
  setOrg(orgOf(raw));
  LOCATIONS = buildLocations(raw.locations);
  COURSES = buildCourses(raw.courses);
  // Strict-true, so any payload without the flag CLEARS a stale dead-end.
  tenantUnavailable = unavailableOf(raw);
  revision += 1;
  listeners.forEach((cb) => cb());
}

/** Re-fetch the live catalog (venues, courses, POS config) and swap it in, so a
 *  Master Control change reaches players without a redeploy. Best-effort: on any
 *  failure the current (cached or baked) content stands. Call once at app boot. */
export async function hydrateContent(): Promise<void> {
  try {
    const base = (import.meta.env.VITE_API_BASE ?? '').replace(/\/$/, '');
    const res = await fetch(`${base}/api/content`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return;
    const data = (await res.json()) as unknown;
    if (!isValidContent(data)) return;
    try {
      // The dead-end flag is persisted ONLY when set: a subsequent visit then
      // boots straight to the dead-end page, and a normal payload's cache
      // (flagless) clears it for the next boot too.
      localStorage.setItem(
        CONTENT_CACHE_KEY,
        JSON.stringify({
          locations: data.locations,
          courses: data.courses,
          org: orgOf(data),
          ...(unavailableOf(data) ? { unavailable: true } : {}),
        }),
      );
    } catch {
      // Non-fatal for the catalog: we just won't have an instant/offline copy
      // next launch. But a FLAGLESS payload is a recovery signal — if the
      // replacement can't be written (quota), the stale `unavailable: true`
      // entry would resurrect the dead-end on every boot, so drop it outright
      // (removeItem still works at quota; losing the offline copy is the
      // lesser harm).
      if (!unavailableOf(data)) {
        try {
          localStorage.removeItem(CONTENT_CACHE_KEY);
        } catch {
          // Storage wholly unusable — module state from applyContent below
          // still restores this session.
        }
      }
    }
    applyContent(data);
  } catch {
    // Offline or server down — keep the current content.
  }
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

/** Subscribe a component to live-content updates — re-renders when the catalog
 *  (including POS config) is hydrated. The returned number is opaque. */
export function useContentRevision(): number {
  return useSyncExternalStore(subscribe, getRevision, getRevision);
}

export function courseById(id: string): CourseSeed | undefined {
  return COURSES.find((c) => c.id === id);
}

export function locationById(id: string): LocationSeed | undefined {
  return LOCATIONS.find((l) => l.id === id);
}

/** Courses that belong to a given location (distinct per location). */
export function coursesByLocation(locationId: string): CourseSeed[] {
  return COURSES.filter((c) => c.locationId === locationId);
}
