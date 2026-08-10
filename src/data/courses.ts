import { useSyncExternalStore } from 'react';
import type { CourseSeed, LocationSeed } from '../types';
import {
  GENERATED_LOCATIONS,
  GENERATED_COURSES,
  type GeneratedCourse,
  type GeneratedLocation,
} from './content.generated';

// §4 White-label content. The DB (managed in Master Control) is the source of
// truth for the DATA of locations and courses — names, slugs, coords, tz,
// geofence, pars, themes, sort order, AND per-venue POS config. That data lives
// in `content.generated.ts`, regenerated at build time from the API. This
// module merges the FRONTEND-ONLY styling that isn't in the DB — per-location/
// per-course accent colors and the themed Rules copy — on top of it, and
// re-exports the same `LOCATIONS` / `COURSES` / helper API the rest of the app
// already consumes.
//
// LIVE HYDRATION: the generated file is only the build-time snapshot + offline
// fallback. On load we re-fetch GET /api/content and swap in the live catalog,
// so an operator's Master Control change (e.g. enabling a POS capability) reaches
// players on the next app open — no redeploy. The last good fetch is cached for
// instant/offline starts. Read POS/venue state through the accessors below (not
// a captured snapshot) and subscribe with `useContentRevision()` to re-render on
// update.

// Stable site ids (mirror content.generated.ts / the Postgres seed).
const LOC_UPLAND = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const LOC_TUKWILA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const LOC_WILSONVILLE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Per-site brand accent (hex), keyed by location id. Frontend-only — not a DB
// column. New locations onboarded in Master Control fall back to DEFAULT_ACCENT
// until an accent is added here.
const DEFAULT_ACCENT = '#38bdf8';
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
  return COURSE_ACCENTS_BY_ID[c.id] ?? THEME_ACCENTS[c.theme] ?? DEFAULT_ACCENT;
}

// Merge generated (DB) data + frontend styling into the app's LocationSeed/
// CourseSeed shapes. Pure so they can re-run against live content too.
function buildLocations(raw: GeneratedLocation[]): LocationSeed[] {
  return raw.map((l) => ({
    id: l.id,
    name: l.name,
    slug: l.slug,
    accent: LOCATION_ACCENTS[l.id] ?? DEFAULT_ACCENT,
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
type RawContent = { locations: GeneratedLocation[]; courses: GeneratedCourse[] };

/** Shape-guard a parsed /api/content (or cache) before trusting it. Requires at
 *  least one location: `getCurrentLocationId()` falls back to `LOCATIONS[0].id`,
 *  so an empty catalog (fresh DB, or every venue archived) would crash every
 *  catalog consumer — and caching it would poison later offline reloads too. The
 *  build-time exporter rejects zero locations for the same reason; match it. */
export function isValidContent(c: unknown): c is RawContent {
  const v = c as RawContent | null;
  return (
    !!v &&
    Array.isArray(v.locations) &&
    v.locations.length > 0 &&
    Array.isArray(v.courses) &&
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

// Start from the freshest available: a cached live fetch, else the baked
// snapshot. `let` (not `const`) so hydration can swap in live data and importers
// of LOCATIONS/COURSES that read at call-time see it (ES live bindings).
const cached = readCache();
export let LOCATIONS: LocationSeed[] = buildLocations(cached?.locations ?? GENERATED_LOCATIONS);
export let COURSES: CourseSeed[] = buildCourses(cached?.courses ?? GENERATED_COURSES);

let revision = 0;
const listeners = new Set<() => void>();

function applyContent(raw: RawContent): void {
  LOCATIONS = buildLocations(raw.locations);
  COURSES = buildCourses(raw.courses);
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
      localStorage.setItem(
        CONTENT_CACHE_KEY,
        JSON.stringify({ locations: data.locations, courses: data.courses }),
      );
    } catch {
      // Non-fatal: we just won't have an instant/offline copy next launch.
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
