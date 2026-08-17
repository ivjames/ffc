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

// Per-org white-label branding (MULTI-VENUE.md §2). Every key is optional —
// a missing key means "use the platform default" — and the PATCH endpoint
// takes the FULL object with replace (not merge) semantics, so {} resets an
// org to all defaults. Server-side validation rejects unknown keys, enforces
// #rrggbb on the color fields, and requires URL fields to start "/" or
// "https://".
export type Branding = {
  appName?: string;
  shortName?: string;
  themeColor?: string;
  backgroundColor?: string;
  accentColor?: string;
  logoUrl?: string;
  logoBadgeUrl?: string;
  logoWordmarkUrl?: string;
  icon192Url?: string;
  icon512Url?: string;
  shareFooter?: string;
};

/** The uploadable branding asset kinds — one per branding URL field
 *  (logoUrl → 'logo', …, icon512Url → 'icon512'). The two icon kinds must be
 *  PNG at exactly 192×192 / 512×512 (server-enforced from the PNG's IHDR). */
export type BrandingAssetKind = 'logo' | 'logoBadge' | 'logoWordmark' | 'icon192' | 'icon512';

export type Org = {
  id: string;
  name: string;
  slug: string;
  status: string;
  sortOrder: number;
  archivedAt: string | null;
  locationCount?: number;
  /** Stored branding overrides only (defaults NOT merged in). Optional while
   *  the multi-venue server rollout is in flight. */
  branding?: Branding;
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
  hours: VenueHours | null;
  orgId: string | null;
  archivedAt: string | null;
};

// Weekly business hours (mirrors server/lib/venueHours.js normalizeHours).
// Keys are any subset of the 7 weekday keys; a day missing from the object is
// treated as closed by the server. `hours` itself is null when unset.
export const HOURS_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type HoursDayKey = (typeof HOURS_DAY_KEYS)[number];
export type DayHours = { open: string; close: string } | 'closed';
export type VenueHours = Partial<Record<HoursDayKey, DayHours>>;

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

// Golf achievement rewards reporting (admin `/rewards/summary`). Since #157 the
// app pays achievements straight to a loyalty card as tickets and shows no
// counter codes, so Master Control reports on issuance instead of redeeming it.
export type RewardAchievementTotal = {
  achievement: string;
  granted: number; // achievements earned in the window
  cardClaims: number; // banked to a card with the vendor credit confirmed
  pending: number; // banked but the vendor credit hasn't confirmed yet
  unclaimed: number; // earned but not yet banked to a card
  tickets: number; // tickets paid out across the confirmed card claims
};

export type RewardSummaryRow = {
  day: string;
  locationId: string | null;
  locationName: string | null;
  achievement: string;
  granted: number;
  cardClaims: number;
  pending: number;
  tickets: number;
};

export type RewardSummary = {
  days: number;
  byAchievement: RewardAchievementTotal[];
  rows: RewardSummaryRow[];
};

// A stored photo-booth picture (the AI-free pipeline — no moderation verdict
// or people flags exist; staff review IS the moderation).
export type AdminBoothPhoto = {
  id: string;
  locationName: string | null;
  createdAt: string;
};

// A reviewer's note filed from inside the player app (routes/feedback.js).
// The context fields are stamped by the client, so a note always says which
// screen and which build it is about without the reviewer typing either.
export type AdminFeedbackStatus = 'open' | 'resolved';
export type AdminFeedback = {
  id: string;
  body: string;
  screenPath: string | null;
  reviewer: string | null;
  appBuild: string | null;
  userAgent: string | null;
  status: AdminFeedbackStatus;
  createdAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
  hasScreenshot: boolean;
  locationName: string | null;
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

// --- Synthetic load bot (Master Control → Synthetic) ------------------------
// A live course as the bot sees it, plus its venue's open-now / weekly-open
// state (mirrors server/routes/admin/syntheticBot.js loadCourses).
export type SyntheticCourse = {
  courseId: string;
  courseName: string;
  locationId: string;
  locationName: string;
  tz: string | null;
  hours: VenueHours | null;
  parsKnown: boolean;
  openNow: boolean;
  weeklyOpenHours: number;
};

// The cadence knobs — shared by the projection preview and the actual launch.
export type SyntheticBotParams = {
  playsPerCourse: number;
  intervalMin: number;
  maxPlayers: number;
  concurrency?: number;
  locationId?: string | null;
  ignoreHours?: boolean;
};

export type SyntheticRunner = {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  params: Required<SyntheticBotParams> | null;
  lastExit: { at: string; code: number | null; signal: string | null } | null;
  logs: { at: string; line: string }[];
};

export type SyntheticStatus = {
  keySet: boolean;
  /** true only for super_admins — start/stop are hidden otherwise. */
  canControl: boolean;
  policy: { countsOnBoard: boolean; mintsRewards: boolean };
  courses: SyntheticCourse[];
  syntheticRounds: { total: number; last24h: number };
  runner: SyntheticRunner;
};

type VolumePair = { roundsPerYear: number; playersPerYear: number };
export type SyntheticProjection = {
  courseCount: number;
  avgPlayers: number;
  max: VolumePair; // 24/7 ceiling
  gated: VolumePair; // realistic, only-while-open
  effective: VolumePair; // whichever the ignoreHours flag selects
};

// One-shot site provisioning (Master Control → Provision site, super_admin
// only). The server creates the org + branding + first venue + courses (+
// optionally the org admin) atomically — any slug/email conflict fails the
// whole thing with an ApiError like "org slug already in use".
export type ProvisionPayload = {
  org: { name: string; slug: string; sortOrder?: number };
  branding?: {
    appName?: string;
    shortName?: string;
    themeColor?: string;
    accentColor?: string;
    backgroundColor?: string;
    shareFooter?: string;
  };
  location: {
    name: string;
    slug: string;
    lat?: number;
    lng?: number;
    geofenceKm?: number;
    hours?: Record<string, { open: string; close: string } | 'closed'>;
    pos?: unknown;
    sortOrder?: number;
  };
  courses: Array<{ name: string; theme: string; pars: number[]; sortOrder?: number }>;
  adminUser?: { email: string; password: string };
};

export type ProvisionResult = {
  ok: true;
  site: {
    org: Org;
    location: Location;
    courses: Course[];
    adminUser: { id: string; email: string; role: string; orgId: string } | null;
    /** null in dev; the SPA falls back to slug + stripped hostname. */
    playerUrl: string | null;
  };
};

export type CurrentUser = {
  id: string | null;
  email: string | null;
  role: 'super_admin' | 'org_admin';
  orgId: string | null;
  /** true when authenticated via the shared APP_TOKEN rather than a real login. */
  viaToken: boolean;
};

/** Read a File's bytes as base64 (data: prefix stripped) — same pattern as the
 *  booth-sticker uploader; the server ships image bytes through JSON base64. */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error('Could not read the file'));
    r.onload = () => {
      const s = String(r.result);
      const c = s.indexOf(',');
      resolve(c >= 0 ? s.slice(c + 1) : s);
    };
    r.readAsDataURL(file);
  });
}

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
  provisionSite: (p: ProvisionPayload) => req<ProvisionResult>('POST', '/provision', p),
  archiveOrg: (id: string, archived: boolean) =>
    req<{ ok: true; org: Org }>('POST', `/orgs/${id}/${archived ? 'archive' : 'unarchive'}`),
  // Full-replace semantics: send the complete branding object every time
  // (omitted keys revert to platform defaults; {} = all defaults). Allowed
  // for super_admin or the org's own org_admin.
  updateOrgBranding: (id: string, branding: Branding) =>
    req<{ ok: true; org: Org }>('PATCH', `/orgs/${id}/branding`, branding),
  // Upload a logo/icon file for a branding URL field. Returns the served
  // /api/brand-assets/... URL to put in the matching field — the endpoint does
  // NOT modify org.branding, so Save keeps its full-replace semantics.
  uploadBrandingAsset: async (orgId: string, kind: BrandingAssetKind, file: File) =>
    req<{ ok: true; url: string }>('POST', `/orgs/${orgId}/branding/assets`, {
      kind,
      filename: file.name,
      data: await fileToBase64(file),
    }),

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

  // Reviewer commentary (routes/admin/feedback.js). Same keyset pagination
  // contract as the photo lists; `status` narrows to open or resolved.
  listFeedback: (
    opts: { before?: string; limit?: number; status?: AdminFeedbackStatus } = {}
  ) => {
    const q = new URLSearchParams();
    if (opts.before) q.set('before', opts.before);
    if (opts.limit) q.set('limit', String(opts.limit));
    if (opts.status) q.set('status', opts.status);
    const s = q.toString();
    return req<AdminFeedback[]>('GET', `/feedback${s ? `?${s}` : ''}`);
  },
  setFeedbackStatus: (id: string, status: AdminFeedbackStatus) =>
    req<{ ok: true; status: AdminFeedbackStatus; resolvedAt: string | null; resolvedBy: string | null }>(
      'POST',
      `/feedback/${id}/status`,
      { status }
    ),
  removeFeedback: (id: string) => req<{ ok: true }>('POST', `/feedback/${id}/remove`),
  fetchFeedbackScreenshot: async (id: string) => {
    const res = await fetch(`/api/admin/feedback/${id}/screenshot`, {
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

  // Rewards & usage reporting (punchlist #8 tier 1).
  // Golf achievement rewards — per-achievement + per-day issuance rollup.
  rewardsSummary: (days = 30) => req<RewardSummary>('GET', `/rewards/summary?days=${days}`),
  // Game ticket economy — caps metadata + the app-issued ticket rollup.
  gameRewardsMeta: () => req<GameRewardsMeta>('GET', '/game-rewards/meta'),
  gameRewardsUsage: (days = 30) =>
    req<{ days: number; rows: GameTicketUsageRow[]; topCards: GameTicketTopCard[] }>(
      'GET',
      `/game-rewards/usage?days=${days}`
    ),

  // Synthetic load/soak bot control plane. status + projection are readable by
  // any admin (org-scoped); start + stop are super_admin only (the server
  // enforces this too — the UI just hides the controls when canControl:false).
  syntheticStatus: () => req<SyntheticStatus>('GET', '/synthetic-bot/status'),
  syntheticProjection: (params: SyntheticBotParams) =>
    req<SyntheticProjection>('POST', '/synthetic-bot/projection', params),
  syntheticStart: (params: SyntheticBotParams) =>
    req<{ ok: true; runner: SyntheticRunner }>('POST', '/synthetic-bot/start', params),
  syntheticStop: () => req<{ ok: true; runner: SyntheticRunner }>('POST', '/synthetic-bot/stop'),
};
