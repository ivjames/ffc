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
  createdAt?: string;
  /** List-only rollups (GET /orgs). Absent on the single-org GET. */
  locationCount?: number;
  adminCount?: number;
  /** Stored branding overrides only (defaults NOT merged in). Optional while
   *  the multi-venue server rollout is in flight. */
  branding?: Branding;
};

/** A Master Control account. super_admin accounts are platform-wide (orgId
 *  null); an org_admin is pinned to exactly one org and only ever sees it. */
export type AdminUser = {
  id: string;
  email: string;
  role: 'super_admin' | 'org_admin';
  orgId: string | null;
  createdAt: string;
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
  /** À la carte module entitlements (server/lib/modules.js). SPARSE and
   *  replace-not-merge, like pos/hours/branding: only the modules an operator
   *  set explicitly appear, and an absent key keeps deriving from the venue's
   *  existing config rather than being pinned to a value nobody chose. */
  modules: Record<string, boolean> | null;
  hours: VenueHours | null;
  hunt: HuntConfig | null;
  orgId: string | null;
  archivedAt: string | null;
};

/** One module's computed state for a venue (server/lib/modules.js
 *  moduleStatus). Not just on/off but WHY: an operator looking at a module
 *  that isn't live needs to know whether it's unsold or unwired, because those
 *  have completely different next steps. */
export type ModuleStatus = {
  key: string;
  label: string;
  blurb: string;
  /** The answer every player-facing surface reads. */
  live: boolean;
  /** Bought/switched on — before wiring and dependencies are considered. */
  entitled: boolean;
  /** This module's POS vendor block is configured (always true when it needs none). */
  wired: boolean;
  needsVendor: 'ordering' | 'loyalty' | null;
  requires: string | null;
  /** Why it isn't live: 'not-enabled' | 'not-wired' | 'requires', else null. */
  blockedBy: string | null;
  /** True when this venue has no explicit setting, so the value shown is the
   *  derived legacy default rather than a decision anyone made. */
  inherited: boolean;
};

/** Per-venue hunt config (location.hunt jsonb — mirrors
 *  server/lib/validateLocation.js normalizeHunt). dailyScanCap bounds the
 *  venue's billed hunt scans over a rolling 24h window; 0 disables the hunt
 *  at that venue entirely; key absent (the column defaults to {}) = unlimited.
 *  venueMode switches on the course-free venue hunt (absent = off, which is
 *  every venue until one opts in); the cap applies to it just the same. */
export type HuntConfig = { dailyScanCap?: number; venueMode?: boolean };

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

// Golf achievement issuance reporting (admin `/rewards/summary`). Achievements
// pay nothing — no tickets, no card credit, no counter codes — so this reports
// only on what players are earning. There is no claimed/unclaimed state and no
// ticket column: a grant carries no value to bank.
export type RewardAchievementTotal = {
  achievement: string;
  /** Staff-facing name, from the server's catalog (server/lib/rewards.js). */
  label: string;
  granted: number; // achievements earned in the window
};

export type RewardSummaryRow = {
  day: string;
  locationId: string | null;
  locationName: string | null;
  achievement: string;
  label: string;
  granted: number;
};

export type RewardSummary = {
  days: number;
  byAchievement: RewardAchievementTotal[];
  rows: RewardSummaryRow[];
};

// A stored photo-booth picture (the AI-free pipeline — no moderation verdict
// or people flags exist; staff review IS the moderation).
// A row in the live-trivia question bank. `source` is null when a person wrote
// it — by hand here, or in the House Pack seed — and names the bulk import
// otherwise ('opentriviaqa'), which is what lets the UI mark a row as donated
// and carry its CC BY-SA credit.
export type TriviaQuestion = {
  id: string;
  orgId: string | null;
  locationId: string | null;
  category: string;
  prompt: string;
  choices: string[];
  answer: number;
  difficulty: number;
  active: boolean;
  source: string | null;
  archivedAt: string | null;
  createdAt: string;
};

export type TriviaPage = {
  questions: TriviaQuestion[];
  total: number;
  limit: number;
  offset: number;
};

export type TriviaCategory = { category: string; n: number };

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
  /**
   * An item belongs to exactly one owner, and which one decides where it's
   * played: a COURSE (the on-course hunt) or a LOCATION (the course-free venue
   * hunt). Exactly one of these is set — the other is null.
   */
  courseId: string | null;
  ownerLocationId: string | null;
  slug: string;
  name: string;
  hint: string | null;
  /** Operator-written judging guidance appended to the vision verify prompt. */
  extraPrompt: string | null;
  sortOrder: number;
  active: boolean;
  countable: boolean;
  /** Null for a venue item — there's no course, the venue name identifies it. */
  courseName: string | null;
  /** The venue the item lives at, whichever owner it hangs off. */
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

/** A live venue, for its course-free hunt list. */
export type HuntVenueRef = {
  id: string;
  name: string;
  /** Whether the venue has switched the course-free hunt on for players. */
  venueMode: boolean;
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
  // Owning org — a super_admin's list spans every client, and venue names are
  // not unique across them. Null for an org-less legacy venue.
  orgName: string | null;
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


// —— Arcade bot (Ops → Arcade bot) ——————————————————————————————————————————
// Two halves of one tool: `capture` plays the games in a browser and writes a
// score profile; `replay` posts the awards that profile implies. They run as
// independent processes, so each has its own runner state.
export type ArcadeRunner = {
  running: boolean;
  pid: number | null;
  startedAt: string | null;
  params: Record<string, unknown> | null;
  lastExit: { at: string; code: number | null; signal: string | null } | null;
  logs: { at: string; line: string }[];
};

/** A profile's summary is what it will REPLAY as: replay draws from the
 *  recorded samples, so a fixed-skill capture produces that same standard of
 *  play forever. null when the file couldn't be read as one of ours. */
export type ArcadeProfileSummary = {
  games: number;
  /** The games this profile can actually replay (captured with samples). */
  gameKeys: string[];
  samples: number;
  skillMin: number | null;
  skillMax: number | null;
  skillMean: number | null;
  capturedAt?: string | null;
};

export type ArcadeProfile = {
  name: string;
  bytes: number;
  modifiedAt: string;
  summary: ArcadeProfileSummary | null;
};

export type ArcadeVenue = {
  id: string;
  name: string;
  orgName: string | null;
  orgSlug: string | null;
  /** Awards 403 unless BOTH the pos loyalty flag and the gameTickets module
   *  are on — resolved server-side exactly as the award route does. */
  gameRewards: boolean;
};

export type ArcadeStatus = {
  canControl: boolean;
  /** The server's earning registry — every one of these has a bot policy.
   *  estRoundMs is the bot's own per-round estimate (null if unreadable);
   *  lowerIsBetter marks time-scored games (Go-Karts), where "best" = min. */
  games: { key: string; label: string; estRoundMs: number | null; lowerIsBetter: boolean }[];
  /** Capture drives a real browser; an API host may not have one. Null for an
   *  org-scoped admin — capture is a super_admin tool. */
  browser: { available: boolean; at: string | null; reason?: string } | null;
  /** …and it drives the PLAYER APP, which on a deployed box is nginx on a
   *  per-org vhost, not the dev server. The origin is DERIVED (PLATFORM_FQDN +
   *  org slug) and probed, so no URL has to be configured by hand; `tried`
   *  shows the candidates when none answered. Null for an org-scoped admin. */
  app: {
    reachable: boolean;
    base: string | null;
    status: number | null;
    why?: string;
    reason?: string;
    tried: { base: string; why: string; ok: boolean; detail: string }[];
  } | null;
  profiles: ArcadeProfile[];
  venues: ArcadeVenue[];
  syntheticAwards: { total: number; last24h: number; tickets: number };
  capture: ArcadeRunner;
  replay: ArcadeRunner;
};

/** A profile's full samples — what /status summarises, for charting. */
export type ArcadeProfileDetail = {
  ok: true;
  name: string;
  capturedAt: string | null;
  base: string | null;
  /** Wall clock + worker count, recorded by newer captures (null on old ones —
   *  then only aggregate browser time can be shown, and must say so). */
  wallMs: number | null;
  workers: number | null;
  games: {
    key: string;
    label: string;
    rounds: number;
    stats: { mean: number; p10: number; p50: number; p90: number; max: number; min: number; meanRoundMs: number } | null;
    samples: { score: number; tickets: number; skill: number | null }[];
  }[];
};

/** Synthetic award aggregates — bucketed in SQL, never row-by-row. */
export type ArcadeTraffic = {
  ok: true;
  days: number;
  /** 'hour' for a short window, 'day' once hours would be thousands of points. */
  unit: 'hour' | 'day';
  buckets: { at: string; awards: number; requested: number; awarded: number }[];
  byGame: {
    game: string;
    awards: number;
    requested: number;
    /** Confirmed credits only (status='awarded') — a pending row is a
     *  reservation whose POS credit never settled, not a payment. */
    awarded: number;
    capped: number;
    pending: number;
  }[];
  totals: {
    awards: number;
    requested: number;
    awarded: number;
    /** Unsettled reservations: rows stuck in status='pending'. */
    pending: number;
    pending_tickets: number;
    cards: number;
    runs: number;
    capped: number;
    first_at: string | null;
    last_at: string | null;
  };
};

export type ArcadeCaptureParams = {
  rounds: number;
  seed: number;
  skill: number | null;
  /** Concurrent browser pages. Timing games verified unaffected up to 4. */
  workers: number;
  games: string[];
};

export type ArcadeReplayParams = {
  locationId: string;
  profile: string;
  plays: number;
  players: number;
  concurrency: number;
  seed: number;
  intervalMin: number | null;
  sweeps: number | null;
  dryRun: boolean;
  games: string[];
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
  adminUser?: { email: string };
};

export type ProvisionResult = {
  ok: true;
  site: {
    org: Org;
    location: Location;
    courses: Course[];
    adminUser: {
      id: string;
      email: string;
      role: string;
      orgId: string;
      inviteSent: boolean;
      /** The set-password link itself — non-null ONLY while the server has no
       *  real mail provider (pre-Resend window), so the operator can relay it
       *  by hand. */
      inviteLink: string | null;
    } | null;
    /** null in dev; the SPA falls back to slug + stripped hostname. */
    playerUrl: string | null;
  };
};

// Hunt vision-spend rollup (GET /api/admin/hunt-usage — the invoice view).
// `rows` is per month + venue; `orgSummary` pre-aggregates per month + org.
// verify/screenCostUsd arrive rounded to 4 decimals (sub-cent screen spend
// stays visible); apiCostUsd is the invoice line, rounded to the cent.
export type HuntUsageOrgSummary = {
  month: string;
  orgId: string | null;
  orgName: string | null;
  huntRounds: number;
  scans: number;
  verifyScans: number;
  screenScans: number;
  inputTokens: number;
  outputTokens: number;
  verifyCostUsd: number;
  screenCostUsd: number;
  apiCostUsd: number;
};

export type HuntUsageRow = HuntUsageOrgSummary & {
  locationId: string | null;
  locationName: string | null;
  locationSlug: string | null;
};

export type HuntUsage = {
  /** The verify-side list rates costs were computed at (screen rows carry
   *  their own per-call stored cost). */
  pricing: { model: string; inputUsdPerMTok: number; outputUsdPerMTok: number };
  months: number;
  rows: HuntUsageRow[];
  orgSummary: HuntUsageOrgSummary[];
};

// Landing-page launch signup (POST /api/launch-signup on the public site;
// these two admin endpoints are the super_admin read side).
export type LaunchSignup = {
  id: string;
  email: string;
  consent: boolean;
  source: string;
  createdAt: string;
  updatedAt: string;
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

// --- Voice bench (Polly TTS bake-off) ---------------------------------------
// super_admin only; /run spends on the AWS key in the server's environment.
export type TtsVenue = { id: string; name: string; slug: string; orgId: string | null; orgName: string | null };
export type TtsLine = { label: string; text: string };
export type TtsEngineTotals = { clips: number; chars: number; usd: number };
export type TtsPlan = {
  venue: TtsVenue;
  lines: TtsLine[];
  clips: number;
  chars: number;
  usd: number;
  byEngine: Record<string, TtsEngineTotals>;
  usdPerM: number;
  /** False when AWS_REGION has no generative engine — the lineup is neural
   *  only, and the estimate already reflects that. */
  generative: boolean;
  region: string;
};
export type TtsClip = {
  lineLabel: string;
  text: string;
  voice: string;
  engine: string;
  styleLabel: string;
  file: string;
  chars: number;
  billed?: number;
  usd?: number;
  error?: string;
};
export type TtsRun = {
  runId: string;
  venue?: string;
  createdAt: string;
  clips: TtsClip[];
  billed: number;
  usd: number;
  errors: number;
};
export type TtsRunSummary = {
  runId: string;
  createdAt: string;
  venue: string | null;
  clips: number;
  billed: number;
  usd: number;
  errors: number;
};

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

  // Self-serve password flow. All three are quiet401: they run on pre-auth
  // screens (the sign-in gate's forgot mode and the emailed /set-password
  // link), which must never trip the global unauthorized force-lock.
  forgotPassword: (email: string) =>
    req<{ ok: true }>('POST', '/password/forgot', { email }, { quiet401: true }),
  checkPasswordToken: (token: string) =>
    req<{ ok: true; email: string }>('POST', '/password/token-check', { token }, { quiet401: true }),
  setPassword: (token: string, password: string) =>
    req<{ ok: true; user: Omit<CurrentUser, 'viaToken'> }>(
      'POST',
      '/password/set',
      { token, password },
      { quiet401: true }
    ),
  // Self-service password change. quiet401: a wrong CURRENT password comes
  // back as a 401 that the form shows inline — it must not fire the global
  // sign-out event (the session is still perfectly valid).
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: true }>('POST', '/me/password', { currentPassword, newPassword }, { quiet401: true }),

  // Master Control accounts. super_admin only, server-side — every one of
  // these 403s for an org_admin, so the callers gate on the role rather than
  // rendering a panel that can only fail.
  listUsers: () => req<AdminUser[]>('GET', '/users'),
  // Password omitted on purpose: the server emails a set-password invite, so
  // no operator ever knows (or has to transmit) someone else's password.
  // `inviteSent: false` means the account exists but the mail failed —
  // recoverable with "Forgot password", never a reason to retry the create.
  inviteUser: (user: { email: string; role: AdminUser['role']; orgId: string | null }) =>
    req<{ ok: true; user: AdminUser; inviteSent?: boolean; inviteLink?: string | null }>(
      'POST',
      '/users',
      user
    ),
  updateUser: (id: string, fields: Partial<Pick<AdminUser, 'email' | 'role' | 'orgId'>>) =>
    req<{ ok: true; user: AdminUser }>('PATCH', `/users/${id}`, fields),
  // Re-mail a set-password link. NOT the public /password/forgot endpoint:
  // minting a token kills the user's outstanding one, and the public endpoint
  // discards the link it generates (it must — it is unauthenticated), so
  // resending through it would invalidate a hand-relayed link and return
  // nothing to replace it. This route is super_admin-gated and so may hand the
  // link back, like the invite. `kind` is 'invite' for an account that never
  // set a password (7-day link), 'reset' for an active one (2 hours).
  resendUserInvite: (id: string) =>
    req<{ ok: true; kind: 'invite' | 'reset'; sent: boolean; inviteLink: string | null }>(
      'POST',
      `/users/${id}/resend-invite`
    ),
  deleteUser: (id: string) => req<{ ok: true }>('DELETE', `/users/${id}`),

  listOrgs: (archived = false) => req<Org[]>('GET', `/orgs${archived ? '?archived=1' : ''}`),
  getOrg: (id: string) => req<{ org: Org; locations: Location[] }>('GET', `/orgs/${id}`),
  saveOrg: (org: Partial<Org>) => req<{ ok: true; org: Org }>('POST', '/orgs', org),
  provisionSite: (p: ProvisionPayload) => req<ProvisionResult>('POST', '/provision', p),
  archiveOrg: (id: string, archived: boolean) =>
    req<{ ok: true; org: Org }>('POST', `/orgs/${id}/${archived ? 'archive' : 'unarchive'}`),
  // Lifecycle switch (super_admin only): a suspended org keeps all its data
  // but its subdomain goes dark for players. Suspending the DEFAULT org 400s
  // server-side unless ?force=1 — the UI deliberately never sends force; that
  // error surfaces inline for the operator to read.
  suspendOrg: (id: string) => req<{ ok: true; org: Org }>('POST', `/orgs/${id}/suspend`),
  unsuspendOrg: (id: string) => req<{ ok: true; org: Org }>('POST', `/orgs/${id}/unsuspend`),
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
  getLocation: (id: string) =>
    req<{ location: Location; modules: ModuleStatus[]; courses: Course[] }>(
      'GET',
      `/locations/${id}`
    ),
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

  // Live-trivia question bank. The list is PAGED and returns `total` — the
  // platform pack alone runs to ~48,000 rows after the OpenTriviaQA import, so
  // there is no "fetch them all" call here on purpose.
  listTriviaQuestions: (opts: {
    category?: string;
    q?: string;
    orgId?: string;
    includeArchived?: boolean;
    limit?: number;
    offset?: number;
  } = {}) => {
    const p = new URLSearchParams();
    if (opts.category) p.set('category', opts.category);
    if (opts.q) p.set('q', opts.q);
    if (opts.orgId) p.set('orgId', opts.orgId);
    if (opts.includeArchived) p.set('includeArchived', '1');
    if (opts.limit !== undefined) p.set('limit', String(opts.limit));
    if (opts.offset) p.set('offset', String(opts.offset));
    const s = p.toString();
    return req<TriviaPage>('GET', `/trivia/questions${s ? `?${s}` : ''}`);
  },
  listTriviaCategories: (orgId?: string) =>
    req<{ categories: TriviaCategory[] }>(
      'GET',
      `/trivia/categories${orgId ? `?orgId=${encodeURIComponent(orgId)}` : ''}`
    ),
  saveTriviaQuestion: (q: Partial<TriviaQuestion>) =>
    req<{ ok: true; question: TriviaQuestion }>('POST', '/trivia/questions', q),
  archiveTriviaQuestion: (id: string, archived: boolean) =>
    req<{ ok: true; question: TriviaQuestion }>(
      'POST',
      `/trivia/questions/${id}/${archived ? 'archive' : 'unarchive'}`
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

  // Launch signups (super_admin): the landing page's early-access list.
  listLaunchSignups: () => req<LaunchSignup[]>('GET', '/launch-signups'),
  // Same auth-header constraint as exportRoundsCsv — fetch and hand back a Blob.
  exportLaunchSignupsCsv: async () => {
    const res = await fetch('/api/admin/launch-signups/export.csv', {
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
  // `courses` and `venues` include item-less targets so the UI can offer "add
  // the first item" everywhere; `items` arrive in venue → course → item
  // display order, each venue's own list ahead of its courses'.
  listHuntItems: () =>
    req<{ courses: HuntCourseRef[]; venues: HuntVenueRef[]; items: HuntItem[] }>(
      'GET',
      '/hunt-items'
    ),
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

  // Hunt vision-spend rollup (the invoice view — CLAUDE.md's cost-visibility
  // rule). months = calendar months back including the current one (server
  // clamps to 1..24, default 6). org_admins get only their own org's data.
  huntUsage: (months = 6) => req<HuntUsage>('GET', `/hunt-usage?months=${months}`),

  // Synthetic load/soak bot control plane. status + projection are readable by
  // any admin (org-scoped); start + stop are super_admin only (the server
  // enforces this too — the UI just hides the controls when canControl:false).
  syntheticStatus: () => req<SyntheticStatus>('GET', '/synthetic-bot/status'),
  syntheticProjection: (params: SyntheticBotParams) =>
    req<SyntheticProjection>('POST', '/synthetic-bot/projection', params),
  syntheticStart: (params: SyntheticBotParams) =>
    req<{ ok: true; runner: SyntheticRunner }>('POST', '/synthetic-bot/start', params),
  syntheticStop: () => req<{ ok: true; runner: SyntheticRunner }>('POST', '/synthetic-bot/stop'),

  // Arcade bot. status is org-scoped and readable by any admin; capture/replay
  // are super_admin only (enforced server-side — the UI just hides them).
  arcadeStatus: () => req<ArcadeStatus>('GET', '/arcade-bot/status'),
  arcadeCapture: (params: ArcadeCaptureParams) =>
    req<{ ok: true; profile: string; runner: ArcadeRunner }>('POST', '/arcade-bot/capture', params),
  arcadeReplay: (params: ArcadeReplayParams) =>
    req<{ ok: true; runner: ArcadeRunner }>('POST', '/arcade-bot/replay', params),
  arcadeProfile: (name: string) =>
    req<ArcadeProfileDetail>('GET', `/arcade-bot/profile/${encodeURIComponent(name)}`),
  arcadeTraffic: (days: number) => req<ArcadeTraffic>('GET', `/arcade-bot/traffic?days=${days}`),
  arcadeRecheckBrowser: () =>
    req<{ ok: true; browser: ArcadeStatus['browser']; app: ArcadeStatus['app'] }>(
      'POST',
      '/arcade-bot/recheck-browser'
    ),
  arcadeStop: (slot: 'capture' | 'replay') =>
    req<{ ok: true; runner: ArcadeRunner }>('POST', '/arcade-bot/stop', { slot }),

  // Voice bench — Polly bake-off for live trivia's read-aloud. `plan` prices a
  // run and spends nothing; `run` is the one that bills.
  ttsVenues: () => req<{ venues: TtsVenue[] }>('GET', '/tts-bakeoff/venues'),
  ttsPlan: (body: { locationId: string; questions: number }) =>
    req<TtsPlan>('POST', '/tts-bakeoff/plan', body),
  ttsRun: (body: { locationId: string; questions: number }) =>
    req<{ run: TtsRun }>('POST', '/tts-bakeoff/run', body),
  ttsRuns: () => req<{ runs: TtsRunSummary[] }>('GET', '/tts-bakeoff/runs'),
  ttsRunGet: (runId: string) =>
    req<{ run: TtsRun }>('GET', `/tts-bakeoff/runs/${encodeURIComponent(runId)}`),
  // An <audio src> can't carry the auth header, same constraint as the photo
  // thumbnails — fetch the bytes and hand back a Blob for an object URL.
  fetchTtsClip: async (runId: string, file: string) => {
    const res = await fetch(
      `/api/admin/tts-bakeoff/audio/${encodeURIComponent(runId)}/${encodeURIComponent(file)}`,
      { credentials: 'same-origin', headers: { 'x-app-token': getToken() } }
    );
    if (res.status === 401) {
      window.dispatchEvent(new CustomEvent('ffc-admin-unauthorized'));
      throw new AuthError('unauthorized');
    }
    if (!res.ok) throw new ApiError(`HTTP ${res.status}`);
    return res.blob();
  },
};
