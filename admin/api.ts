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
  menuUrl: string | null;
  orderingUrl: string | null;
  pos: PosConfig | null;
  orgId: string | null;
  archivedAt: string | null;
};

// POS integration add-on config (mirrors server normalizePos). Capabilities
// are decoupled — each names its own vendor. At least one block must be
// configured, else save null.
export type PosConfig = {
  ordering: { vendor: string; apiBase: string | null } | null;
  loyalty: {
    vendor: string;
    apiBase: string | null;
    gameRewards: boolean;
    gameRewardCaps?: GameRewardCaps | null;
  } | null;
};

/** Venue economy guardrails for app-earned tickets — enforced by the server's
 *  award proxy; both knobs only tighten the platform hard limits. */
export type GameRewardCaps = {
  dailyPerCard: number | null; // null = platform default
  perGame: Record<string, number>; // per-round ceiling overrides by game key
};

/** The game registry + platform limits the caps editor renders from. */
export type GameRewardsMeta = {
  games: { key: string; label: string }[];
  hardMaxPerRound: number;
  defaultDailyPerCard: number;
  maxDailyPerCard: number;
};

export type GameTicketUsageRow = {
  day: string;
  locationId: string;
  locationName: string;
  game: string;
  rounds: number;
  cappedRounds: number;
  /** Reservations whose vendor credit never confirmed — excluded from tickets. */
  pendingRounds: number;
  tickets: number;
  cards: number;
};

export type GameTicketTopCard = {
  locationId: string;
  locationName: string;
  playerId: string;
  rounds: number;
  tickets: number;
};

export type Announcement = {
  id: string;
  title: string;
  body: string | null;
  locationId: string | null;
  locationName?: string | null;
  startsAt: string | null;
  endsAt: string | null;
  sortOrder: number;
  archivedAt: string | null;
  createdAt: string;
  // View memory rollup (present on the admin list). Devices that have seen the
  // announcement, distinct signed-in accounts among them, total impressions,
  // and the most recent sighting (null if never seen).
  viewDeviceCount?: number;
  viewUserCount?: number;
  viewImpressions?: number;
  viewLastSeenAt?: string | null;
};

export type Reward = {
  id: string;
  code: string;
  playerIndex: number;
  playerTag: string;
  achievement: string;
  createdAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
  courseName: string;
  locationName: string | null;
};

// A stored photo-booth picture (the AI-free pipeline — no moderation verdict
// or people flags exist; staff review IS the moderation).
export type AdminBoothPhoto = {
  id: string;
  locationName: string | null;
  createdAt: string;
};

// A venue-uploaded SVG asset for the photo booth (Master Control → Booth
// stickers). `kind` sets how it's applied; `corner` places a watermark.
export type AdminStickerKind = 'sticker' | 'frame' | 'watermark';
export type AdminStickerCorner = 'tl' | 'tr' | 'bl' | 'br';
export type AdminVenueSticker = {
  id: string;
  label: string | null;
  width: number;
  height: number;
  kind: AdminStickerKind;
  corner: AdminStickerCorner;
  mediaType: string; // image/svg+xml | image/png
  sortOrder: number;
  active: boolean;
  createdAt: string;
};

export type AdminPhoto = {
  id: string;
  playerTag: string;
  itemName: string;
  courseName: string;
  locationName: string | null;
  createdAt: string;
  moderation: string | null;
  peoplePresent: boolean | null;
  minorsPresent: boolean | null;
};

// A scavenger-hunt item as the admin sees it (Master Control → Hunt):
// content fields + course/venue context + its vetting image set's size.
export type HuntItem = {
  id: string;
  courseId: string;
  slug: string;
  name: string;
  hint: string | null;
  /** Operator-written judging guidance appended to the vision verify prompt. */
  extraPrompt: string | null;
  sortOrder: number;
  active: boolean;
  countable: boolean;
  courseName: string;
  locationId: string | null;
  locationName: string | null;
  imageCount: number;
  thumbImageId: string | null;
};

/** A live course as listed by the Hunt section (items grouped under these). */
export type HuntCourseRef = {
  id: string;
  name: string;
  locationId: string | null;
  locationName: string | null;
};

export type HuntItemImage = {
  id: string;
  itemId: string;
  mediaType: string;
  /** The descriptor's label from the upload people-screen. */
  subject: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: string;
};

/** Billed usage of one upload people-screen call (surfaced per CLAUDE.md). */
export type ItemImageScan = {
  provider: string;
  inputTokens: number | null;
  outputTokens: number | null;
  cost: number | null;
};

export type SeriesBucket = {
  date: string; // YYYY-MM-DD in the admin timezone
  rounds: number;
  players: number;
  huntFinds: number;
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

  // Announcements (punchlist #1).
  listAnnouncements: (archived = false) =>
    req<Announcement[]>('GET', `/announcements${archived ? '?archived=1' : ''}`),
  saveAnnouncement: (a: Partial<Announcement>) =>
    req<{ ok: true; announcement: Announcement }>('POST', '/announcements', a),
  archiveAnnouncement: (id: string, archived: boolean) =>
    req<{ ok: true; announcement: Announcement }>(
      'POST',
      `/announcements/${id}/${archived ? 'archive' : 'unarchive'}`
    ),

  // Office reporting (punchlist #2).
  overviewSeries: (days = 30) =>
    req<{ days: number; tz: string; series: SeriesBucket[] }>('GET', `/overview/series?days=${days}`),
  // The CSV export needs the auth header, so it can't be a plain <a href> —
  // fetch it and hand the caller a Blob to download.
  exportRoundsCsv: async (opts: { from?: string; to?: string; locationId?: string } = {}) => {
    const q = new URLSearchParams();
    if (opts.from) q.set('from', opts.from);
    if (opts.to) q.set('to', opts.to);
    if (opts.locationId) q.set('locationId', opts.locationId);
    const s = q.toString();
    const res = await fetch(`/api/admin/export/rounds.csv${s ? `?${s}` : ''}`, {
      credentials: 'same-origin',
      headers: { 'x-app-token': getToken() },
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
      throw new AuthError('unauthorized');
    }
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
    return res.blob();
  },

  // Hunt-photo review (privacy: the operator surface for stored photos).
  // `before` (the previous page's last createdAt) keyset-paginates older
  // photos so the whole backlog stays reachable, page by page.
  listPhotos: (opts: { filter?: 'people' | 'minors'; before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.filter) q.set(opts.filter, '1');
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    const s = q.toString();
    return req<AdminPhoto[]>('GET', `/photos${s ? `?${s}` : ''}`);
  },
  removePhoto: (id: string) => req<{ ok: true }>('POST', `/photos/${id}/remove`),

  // Photo-booth review (routes/admin/boothPhotos.js) — the only moderation the
  // AI-free booth pipeline has. Same keyset pagination contract as listPhotos.
  listBoothPhotos: (opts: { before?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    const s = q.toString();
    return req<AdminBoothPhoto[]>('GET', `/booth-photos${s ? `?${s}` : ''}`);
  },
  removeBoothPhoto: (id: string) => req<{ ok: true }>('POST', `/booth-photos/${id}/remove`),

  // Venue booth stickers (Master Control → Booth stickers). The preview image
  // uses the PUBLIC player endpoint (/api/photos/stickers/:id/image) — these
  // are public branded assets, so no auth header is needed for the thumbnail.
  listBoothStickers: (locationId: string) =>
    req<AdminVenueSticker[]>('GET', `/booth-stickers?location=${encodeURIComponent(locationId)}`),
  // Upload an SVG (raw text via `svg`) or a PNG (`imageBase64` + mediaType).
  uploadBoothSticker: (body: {
    locationId: string;
    label?: string;
    kind?: AdminStickerKind;
    corner?: AdminStickerCorner;
    svg?: string;
    imageBase64?: string;
    mediaType?: 'image/png' | 'image/webp';
  }) => req<AdminVenueSticker>('POST', '/booth-stickers', body),
  removeBoothSticker: (id: string) => req<{ ok: true }>('POST', `/booth-stickers/${id}/remove`),

  fetchBoothPhotoImage: async (id: string) => {
    const res = await fetch(`/api/admin/booth-photos/${id}/image`, {
      credentials: 'same-origin',
      headers: { 'x-app-token': getToken() },
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
      throw new AuthError('unauthorized');
    }
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
    return res.blob();
  },
  // Like the CSV export, <img src> can't carry the auth header — fetch the
  // bytes and hand back a Blob for an object URL.
  fetchPhotoImage: async (id: string) => {
    const res = await fetch(`/api/admin/photos/${id}/image`, {
      credentials: 'same-origin',
      headers: { 'x-app-token': getToken() },
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
      throw new AuthError('unauthorized');
    }
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
    return res.blob();
  },

  // Scavenger-hunt items + vetting image sets (Master Control → Hunt).
  // `courses` includes item-less courses so the UI can offer "add the first
  // item" everywhere; `items` arrive in venue → course → item display order.
  listHuntItems: () => req<{ courses: HuntCourseRef[]; items: HuntItem[] }>('GET', '/hunt-items'),
  getHuntItem: (id: string) =>
    req<{ item: HuntItem; images: HuntItemImage[] }>('GET', `/hunt-items/${id}`),
  createHuntItem: (item: Partial<HuntItem>) =>
    req<{ ok: true; item: HuntItem }>('POST', '/hunt-items', item),
  patchHuntItem: (id: string, fields: Partial<HuntItem>) =>
    req<{ ok: true; item: HuntItem }>('PATCH', `/hunt-items/${id}`, fields),
  deleteHuntItem: (id: string) => req<{ ok: true }>('DELETE', `/hunt-items/${id}`),
  // Upload is people-screened server-side. A people-rejection (400 with
  // peoplePresent) is returned, NOT thrown: the screen call was still billed,
  // so the caller needs its `scan` usage for the burn tally either way.
  uploadHuntItemImage: async (
    id: string,
    body: { imageBase64: string; mediaType: string; note?: string }
  ): Promise<{ ok: boolean; image?: HuntItemImage; scan?: ItemImageScan; peoplePresent?: boolean; error?: string }> => {
    const res = await fetch(`/api/admin/hunt-items/${id}/images`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-app-token': getToken() },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => null);
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
      throw new AuthError((data && data.error) || 'unauthorized');
    }
    if (!res.ok && !(res.status === 400 && data?.peoplePresent)) {
      throw new ApiError((data && data.error) || `HTTP ${res.status}`);
    }
    return data;
  },
  deleteHuntItemImage: (imageId: string) =>
    req<{ ok: true }>('DELETE', `/hunt-items/images/${imageId}`),
  // Like fetchPhotoImage: <img src> can't carry the auth header, so fetch the
  // bytes and hand back a Blob for an object URL.
  fetchHuntItemImage: async (imageId: string) => {
    const res = await fetch(`/api/admin/hunt-items/images/${imageId}/image`, {
      credentials: 'same-origin',
      headers: { 'x-app-token': getToken() },
    });
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
      throw new AuthError('unauthorized');
    }
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
    return res.blob();
  },

  // Rewards (punchlist #8 tier 1).
  // Game ticket economy — caps metadata + the app-issued ticket rollup.
  gameRewardsMeta: () => req<GameRewardsMeta>('GET', '/game-rewards/meta'),
  gameRewardsUsage: (days = 30) =>
    req<{ days: number; rows: GameTicketUsageRow[]; topCards: GameTicketTopCard[] }>(
      'GET',
      `/game-rewards/usage?days=${days}`
    ),

  lookupReward: (code: string) => req<Reward[]>('GET', `/rewards?code=${encodeURIComponent(code)}`),
  listRewards: (redeemed = false) => req<Reward[]>('GET', `/rewards${redeemed ? '?redeemed=1' : ''}`),
  redeemReward: (id: string, redeemed: boolean) =>
    req<{ ok: true; reward: Reward }>('POST', `/rewards/${id}/${redeemed ? 'redeem' : 'unredeem'}`),
};
