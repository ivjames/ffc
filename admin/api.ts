// Typed client for the Master Control admin API. A call authenticates either
// via the operator's APP_TOKEN (`x-app-token` header, sent on every request —
// harmless when empty) or a logged-in admin_user session (an httpOnly cookie
// the server sets; `credentials: 'same-origin'` is what makes the browser
// attach it, since the admin SPA and the API it proxies to are same-origin —
// see server/README.md's "Admin accounts & sessions"). A 401 throws AuthError
// so the shell can bounce back to the sign-in gate.

const TOKEN_KEY = 'ffc_admin_token';

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}
export function setToken(t: string) {
  sessionStorage.setItem(TOKEN_KEY, t);
}
export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export class AuthError extends Error {}
export class ApiError extends Error {}

async function req<T>(
  method: string,
  path: string,
  body?: unknown,
  opts: { quiet401?: boolean } = {}
): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin', // send/receive the admin_user session cookie
    headers: {
      'content-type': 'application/json',
      'x-app-token': getToken(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (res.status === 401) {
    // quiet401 is for calls where a 401 is a normal, EXPECTED, locally-handled
    // outcome — the on-load "am I already signed in?" check, and a login
    // attempt's own wrong-password/unknown-email response — not "you were
    // signed in and got kicked out," so it must not fire the global
    // sign-out event or swallow the real server message behind a generic one.
    if (!opts.quiet401) {
      // Tell the shell to drop back to the sign-in gate, deterministically
      // (callers catch errors, so an unhandledrejection listener wouldn't fire).
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
    }
    throw new AuthError((data && data.error) || 'unauthorized');
  }
  if (!res.ok) {
    throw new ApiError((data && data.error) || `HTTP ${res.status}`);
  }
  return data as T;
}

// --- Types ------------------------------------------------------------------
export type Org = {
  id: string;
  name: string;
  slug: string;
  status: string;
  sortOrder: number;
  archivedAt: string | null;
  locationCount?: number;
};

export type Location = {
  id: string;
  name: string;
  slug: string;
  lat: number | null;
  lng: number | null;
  geofenceKm: number | null;
  tz: string | null;
  tzLabel: string | null;
  sortOrder: number;
  orgId: string | null;
  archivedAt: string | null;
};

export type Course = {
  id: string;
  name: string;
  theme: string;
  holeCount: number;
  pars: number[];
  locationId: string | null;
  sortOrder: number;
  archivedAt: string | null;
};

export type Overview = {
  totals: {
    orgs: number;
    locations: number;
    courses: number;
    roundsActive: number;
    rounds7d: number;
    rounds30d: number;
    huntFinds: number;
  };
  perLocation: { id: string; name: string; slug: string; courses: number; rounds30d: number }[];
};

export type CurrentUser = {
  id: string | null;
  email: string | null;
  role: 'super_admin' | 'org_admin';
  orgId: string | null;
  /** true when authenticated via the shared APP_TOKEN rather than a real login. */
  viaToken: boolean;
};

// --- Endpoints --------------------------------------------------------------
export const api = {
  overview: () => req<Overview>('GET', '/overview'),

  // quiet401: a wrong password / unknown email is a normal login failure to
  // show inline, not a "you got signed out" event.
  login: (email: string, password: string) =>
    req<{ ok: true; user: Omit<CurrentUser, 'viaToken'> }>(
      'POST',
      '/login',
      { email, password },
      { quiet401: true }
    ),
  logout: () => req<{ ok: true }>('POST', '/logout'),
  // quiet401: called on every page load to check for an existing session —
  // "not logged in" is the expected common case, not an auth failure to react to.
  me: () => req<{ ok: true; user: CurrentUser }>('GET', '/me', undefined, { quiet401: true }),

  listOrgs: (archived = false) => req<Org[]>('GET', `/orgs${archived ? '?archived=1' : ''}`),
  getOrg: (id: string) => req<{ org: Org; locations: Location[] }>('GET', `/orgs/${id}`),
  saveOrg: (org: Partial<Org>) => req<{ ok: true; org: Org }>('POST', '/orgs', org),
  archiveOrg: (id: string, archived: boolean) =>
    req<{ ok: true; org: Org }>('POST', `/orgs/${id}/${archived ? 'archive' : 'unarchive'}`),

  listLocations: (opts: { orgId?: string; archived?: boolean } = {}) => {
    const q = new URLSearchParams();
    if (opts.orgId) q.set('orgId', opts.orgId);
    if (opts.archived) q.set('archived', '1');
    const s = q.toString();
    return req<Location[]>('GET', `/locations${s ? `?${s}` : ''}`);
  },
  getLocation: (id: string) => req<{ location: Location; courses: Course[] }>('GET', `/locations/${id}`),
  // archived=1 returns live + archived; callers filter to the archived ones.
  listLocationCourses: (id: string, archived = false) =>
    req<Course[]>('GET', `/locations/${id}/courses${archived ? '?archived=1' : ''}`),
  saveLocation: (loc: Partial<Location>) => req<{ ok: true; location: Location }>('POST', '/locations', loc),
  archiveLocation: (id: string, archived: boolean) =>
    req<{ ok: true; location: Location }>('POST', `/locations/${id}/${archived ? 'archive' : 'unarchive'}`),

  saveCourse: (course: Partial<Course>) => req<{ ok: true; course: Course }>('POST', '/courses', course),
  patchCourse: (id: string, fields: Partial<Course>) =>
    req<{ ok: true; course: Course }>('PATCH', `/courses/${id}`, fields),
  archiveCourse: (id: string, archived: boolean) =>
    req<{ ok: true; course: Course }>('POST', `/courses/${id}/${archived ? 'archive' : 'unarchive'}`),
};
