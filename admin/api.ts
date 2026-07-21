// Typed client for the Master Control admin API. Every call carries the
// operator's APP_TOKEN as `x-app-token`. A 401 throws AuthError so the shell can
// bounce back to the token gate.

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

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      'x-app-token': getToken(),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    // Tell the shell to drop back to the token gate, deterministically (callers
    // catch errors, so an unhandledrejection listener wouldn't fire).
    window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
    throw new AuthError('unauthorized');
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
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

// --- Endpoints --------------------------------------------------------------
export const api = {
  overview: () => req<Overview>('GET', '/overview'),

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
  saveLocation: (loc: Partial<Location>) => req<{ ok: true; location: Location }>('POST', '/locations', loc),
  archiveLocation: (id: string, archived: boolean) =>
    req<{ ok: true; location: Location }>('POST', `/locations/${id}/${archived ? 'archive' : 'unarchive'}`),

  saveCourse: (course: Partial<Course>) => req<{ ok: true; course: Course }>('POST', '/courses', course),
  patchCourse: (id: string, fields: Partial<Course>) =>
    req<{ ok: true; course: Course }>('PATCH', `/courses/${id}`, fields),
  archiveCourse: (id: string, archived: boolean) =>
    req<{ ok: true; course: Course }>('POST', `/courses/${id}/${archived ? 'archive' : 'unarchive'}`),
};
