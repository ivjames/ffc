// Shared location (venue) validation + timezone resolution, extracted from
// routes/locations.js so both the public POST /api/locations and the admin
// router (POST /api/admin/locations) validate identically.
import { tzFromCoords, isValidTz, friendlyTzLabel } from "./timezone.js";
import { normalizeHours } from "./venueHours.js";
import {
  isKnownGame,
  HARD_MAX_PER_ROUND,
  MAX_DAILY_PER_CARD,
} from "./gameRewards.js";
import { ADOPTION_BONUS_KINDS, MAX_ADOPTION_BONUS } from "./adoptionBonus.js";

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Lowercase kebab: letters/digits in groups joined by single hyphens, no
// leading/trailing/double hyphen. e.g. "riverside", "north-40".
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isFiniteNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}

// Columns to return (and their JSON casing) — shared by insert RETURNING and the
// list SELECT so both responses have the same shape.
export const LOCATION_RETURN_COLS = `id, name, slug, lat, lng,
  geofence_km as "geofenceKm", tz, sort_order as "sortOrder",
  menu_url as "menuUrl", ordering_url as "orderingUrl", pos, hours, hunt,
  org_id as "orgId", archived_at as "archivedAt"`;

// POS vendors the platform has an adapter for. Onboarding a new vendor means
// an entry here plus an adapter in the player app (src/lib/pos/) — the config
// shape itself is vendor-neutral.
export const POS_VENDORS = ["centeredge"];

/**
 * Validate an optional http(s) URL field (food & drink links). Returns the
 * normalized value (string or null) or an { error } — a plain http/https URL
 * only, so a stored link can never be a javascript:/data: payload when the
 * player app renders it as an <a href>.
 */
function normalizeHttpUrl(value, field) {
  if (value === undefined || value === null || value === "") return { value: null };
  if (typeof value !== "string" || value.length > 500) {
    return { error: `${field} must be an http(s) URL (max 500 chars)` };
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { error: `${field} must be a valid absolute URL` };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { error: `${field} must use http or https` };
  }
  return { value };
}

/**
 * Validate the optional POS-integration add-on config. `null`/`undefined`/`{}`
 * all mean "no integration" (stored NULL — the default for every venue).
 *
 * The two capabilities are DELIBERATELY decoupled — each names its own vendor,
 * so a venue can run e.g. CenterEdge loyalty next to a different ordering
 * system. Canonical stored shape (both keys always present):
 *   { ordering: { vendor, apiBase } | null,
 *     loyalty:  { vendor, apiBase, gameRewards } | null }
 * Rules: at least one capability must be configured (otherwise clear the
 * config instead); each block's vendor must be a known adapter; gameRewards
 * rides inside loyalty because app-earned tickets have nowhere to land
 * without a loyalty balance; apiBase is an optional per-venue http(s)
 * override for that vendor's API endpoint. Credentials are deliberately not
 * part of this shape — they never ship to the player app.
 * @returns {{ value: object | null } | { error: string }}
 */
export function normalizePos(value) {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "pos must be an object or null" };
  }
  if (Object.keys(value).length === 0) return { value: null };

  const block = (field, raw) => {
    if (raw === undefined || raw === null) return { value: null };
    if (typeof raw !== "object" || Array.isArray(raw)) {
      return { error: `pos.${field} must be an object or null` };
    }
    if (!POS_VENDORS.includes(raw.vendor)) {
      return { error: `pos.${field}.vendor must be one of: ${POS_VENDORS.join(", ")}` };
    }
    const apiBase = normalizeHttpUrl(raw.apiBase, `pos.${field}.apiBase`);
    if (apiBase.error) return { error: apiBase.error };
    return { value: { vendor: raw.vendor, apiBase: apiBase.value } };
  };

  const ordering = block("ordering", value.ordering);
  if (ordering.error) return { error: ordering.error };
  const loyalty = block("loyalty", value.loyalty);
  if (loyalty.error) return { error: loyalty.error };

  if (!ordering.value && !loyalty.value) {
    return { error: "pos must configure at least one capability (ordering or loyalty) — send null to remove the integration" };
  }

  const gameRewards = value.loyalty?.gameRewards;
  if (gameRewards !== undefined && typeof gameRewards !== "boolean") {
    return { error: "pos.loyalty.gameRewards must be a boolean" };
  }
  if (gameRewards === true && !loyalty.value) {
    return { error: "pos.loyalty.gameRewards requires a configured loyalty block (tickets need a loyalty balance to land in)" };
  }

  // Game-reward caps — the venue's economy guardrails, enforced by the award
  // proxy (routes/gameRewards.js). Both knobs only ever TIGHTEN the platform
  // hard limits in lib/gameRewards.js. Canonical stored shape when present:
  //   { dailyPerCard: int | null, perGame: { <gameKey>: int, ... } }
  // dailyPerCard null/absent = the platform default; perGame holds only the
  // games the venue overrides (absent games use the hard per-round max).
  const rawCaps = value.loyalty?.gameRewardCaps;
  let gameRewardCaps = null;
  if (rawCaps !== undefined && rawCaps !== null) {
    if (typeof rawCaps !== "object" || Array.isArray(rawCaps)) {
      return { error: "pos.loyalty.gameRewardCaps must be an object or null" };
    }
    if (!loyalty.value || gameRewards !== true) {
      return { error: "pos.loyalty.gameRewardCaps requires gameRewards to be enabled" };
    }
    let dailyPerCard = null;
    if (rawCaps.dailyPerCard !== undefined && rawCaps.dailyPerCard !== null) {
      if (
        !Number.isInteger(rawCaps.dailyPerCard) ||
        rawCaps.dailyPerCard < 1 ||
        rawCaps.dailyPerCard > MAX_DAILY_PER_CARD
      ) {
        return {
          error: `pos.loyalty.gameRewardCaps.dailyPerCard must be an integer 1..${MAX_DAILY_PER_CARD} (or null for the default)`,
        };
      }
      dailyPerCard = rawCaps.dailyPerCard;
    }
    const perGame = {};
    if (rawCaps.perGame !== undefined && rawCaps.perGame !== null) {
      if (typeof rawCaps.perGame !== "object" || Array.isArray(rawCaps.perGame)) {
        return { error: "pos.loyalty.gameRewardCaps.perGame must be an object" };
      }
      for (const [key, cap] of Object.entries(rawCaps.perGame)) {
        if (!isKnownGame(key)) {
          return { error: `pos.loyalty.gameRewardCaps.perGame: unknown game ${JSON.stringify(key)}` };
        }
        if (!Number.isInteger(cap) || cap < 1 || cap > HARD_MAX_PER_ROUND) {
          return {
            error: `pos.loyalty.gameRewardCaps.perGame.${key} must be an integer 1..${HARD_MAX_PER_ROUND}`,
          };
        }
        perGame[key] = cap;
      }
    }
    // All-default caps normalize away entirely (stored as no caps at all).
    if (dailyPerCard !== null || Object.keys(perGame).length > 0) {
      gameRewardCaps = { dailyPerCard, perGame };
    }
  }

  // Adoption bonuses — the one-time install/sign-in ticket rewards
  // (lib/adoptionBonus.js), enforced by the /bonus endpoint. Like the caps,
  // these need the loyalty ticket economy on; each milestone is an integer
  // 0..MAX (0 disables it). Absent milestones fall back to the platform
  // default at award time, so we store only what the venue set.
  const rawBonus = value.loyalty?.adoptionBonus;
  let adoptionBonus = null;
  if (rawBonus !== undefined && rawBonus !== null) {
    if (typeof rawBonus !== "object" || Array.isArray(rawBonus)) {
      return { error: "pos.loyalty.adoptionBonus must be an object or null" };
    }
    if (!loyalty.value || gameRewards !== true) {
      return { error: "pos.loyalty.adoptionBonus requires gameRewards to be enabled" };
    }
    const normalized = {};
    for (const [kind, amount] of Object.entries(rawBonus)) {
      if (!ADOPTION_BONUS_KINDS.includes(kind)) {
        return { error: `pos.loyalty.adoptionBonus: unknown milestone ${JSON.stringify(kind)}` };
      }
      if (!Number.isInteger(amount) || amount < 0 || amount > MAX_ADOPTION_BONUS) {
        return {
          error: `pos.loyalty.adoptionBonus.${kind} must be an integer 0..${MAX_ADOPTION_BONUS}`,
        };
      }
      normalized[kind] = amount;
    }
    if (Object.keys(normalized).length > 0) adoptionBonus = normalized;
  }

  return {
    value: {
      ordering: ordering.value,
      loyalty: loyalty.value
        ? {
            ...loyalty.value,
            gameRewards: gameRewards === true,
            ...(gameRewardCaps ? { gameRewardCaps } : {}),
            ...(adoptionBonus ? { adoptionBonus } : {}),
          }
        : null,
    },
  };
}

/**
 * Validate the per-venue hunt spend config (location.hunt jsonb) — the
 * gameRewardCaps idiom applied to vision spend. Canonical stored shape:
 *   { dailyScanCap: int >= 0 }   (key present only when the venue set it)
 * dailyScanCap bounds the venue's billed hunt vision calls over a rolling 24h
 * window (enforced in routes/hunt.js); 0 disables the hunt at that venue
 * entirely (the per-client kill switch). null/absent key = unlimited — only
 * the env-global HUNT_SCAN_CAP/HUNT_ATTEMPT_CAP bounds apply, exactly the
 * pre-config behavior. `null`/`undefined`/`{}` bodies all normalize to `{}`
 * (the column default), so omitting the field changes nothing.
 * @returns {{ value: object } | { error: string }}
 */
export function normalizeHunt(value) {
  if (value === undefined || value === null) return { value: {} };
  if (typeof value !== "object" || Array.isArray(value)) {
    return { error: "hunt must be an object or null" };
  }
  // Reject unknown keys (the branding rule): a typo'd cap key must not
  // silently store as "unlimited".
  for (const key of Object.keys(value)) {
    if (key !== "dailyScanCap") {
      return { error: `hunt: unknown key ${JSON.stringify(key)}` };
    }
  }
  const normalized = {};
  if (value.dailyScanCap !== undefined && value.dailyScanCap !== null) {
    if (!Number.isInteger(value.dailyScanCap) || value.dailyScanCap < 0) {
      return {
        error: "hunt.dailyScanCap must be an integer >= 0 (0 disables the hunt; null/absent for unlimited)",
      };
    }
    normalized.dailyScanCap = value.dailyScanCap;
  }
  return { value: normalized };
}

/** Add the derived friendly tz label so admin/consumers don't recompute it. */
export function withLabel(loc) {
  return { ...loc, tzLabel: loc.tz ? friendlyTzLabel(loc.tz) : null };
}

/**
 * Validate + normalize a location POST body into a DB row, resolving the tz.
 * `orgId` is accepted (admin path) and validated as a uuid when present.
 * @returns {{ row: object } | { error: string, status: number }}
 */
export function normalizeLocation(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { error: "body must be a location object", status: 400 };
  }

  const { id, name, slug, orgId } = body;

  if (id !== undefined && (typeof id !== "string" || !UUID_RE.test(id))) {
    return { error: "id must be a uuid when provided", status: 400 };
  }
  if (typeof name !== "string" || name.trim().length === 0 || name.length > 200) {
    return { error: "name is required (1..200 chars)", status: 400 };
  }
  if (typeof slug !== "string" || slug.length > 64 || !SLUG_RE.test(slug)) {
    return {
      error: "slug must be lowercase [a-z0-9-], no leading/trailing/double hyphen",
      status: 400,
    };
  }
  if (orgId !== undefined && orgId !== null && (typeof orgId !== "string" || !UUID_RE.test(orgId))) {
    return { error: "orgId must be a uuid when provided", status: 400 };
  }

  // Coordinates — optional, but range-checked when present.
  let lat = null;
  let lng = null;
  if (body.lat !== undefined && body.lat !== null) {
    if (!isFiniteNum(body.lat) || body.lat < -90 || body.lat > 90) {
      return { error: "lat must be a number in -90..90", status: 400 };
    }
    lat = body.lat;
  }
  if (body.lng !== undefined && body.lng !== null) {
    if (!isFiniteNum(body.lng) || body.lng < -180 || body.lng > 180) {
      return { error: "lng must be a number in -180..180", status: 400 };
    }
    lng = body.lng;
  }
  // A lone coordinate can't place the venue (or derive a zone) — require both.
  if ((lat === null) !== (lng === null)) {
    return { error: "lat and lng must be provided together", status: 400 };
  }

  let geofenceKm = null;
  if (body.geofenceKm !== undefined && body.geofenceKm !== null) {
    if (!isFiniteNum(body.geofenceKm) || body.geofenceKm <= 0) {
      return { error: "geofenceKm must be a positive number", status: 400 };
    }
    geofenceKm = body.geofenceKm;
  }

  let sortOrder = 0;
  if (body.sortOrder !== undefined && body.sortOrder !== null) {
    if (!Number.isInteger(body.sortOrder)) {
      return { error: "sortOrder must be an integer", status: 400 };
    }
    sortOrder = body.sortOrder;
  }

  // Food & drink links — optional http(s) deep links to the venue's menu and
  // online-ordering system. Empty string clears the link (stored as null).
  const menuUrl = normalizeHttpUrl(body.menuUrl, "menuUrl");
  if (menuUrl.error) return { error: menuUrl.error, status: 400 };
  const orderingUrl = normalizeHttpUrl(body.orderingUrl, "orderingUrl");
  if (orderingUrl.error) return { error: orderingUrl.error, status: 400 };

  // POS integration add-on (see normalizePos above). Omitted/null clears it.
  const pos = normalizePos(body.pos);
  if (pos.error) return { error: pos.error, status: 400 };

  // Business hours (see lib/venueHours.js). Omitted/null clears it.
  const hours = normalizeHours(body.hours);
  if (hours.error) return { error: hours.error, status: 400 };

  // Per-venue hunt spend config (see normalizeHunt above). Omitted/null
  // clears it back to `{}` (unlimited) — the pos/hours replace-not-merge rule.
  const hunt = normalizeHunt(body.hunt);
  if (hunt.error) return { error: hunt.error, status: 400 };

  // Resolve the timezone. Explicit `tz` wins (validated); otherwise derive from
  // coordinates; otherwise leave null and let the leaderboard fall back to
  // VENUE_TZ. Onboarding normally sends just lat/lng and lets it derive.
  let tz = null;
  if (body.tz !== undefined && body.tz !== null) {
    if (!isValidTz(body.tz)) {
      return {
        error: `tz ${JSON.stringify(body.tz)} is not a valid IANA zone ` +
          `(use e.g. "America/Los_Angeles", not "PST")`,
        status: 400,
      };
    }
    tz = body.tz;
  } else if (lat !== null && lng !== null) {
    try {
      tz = tzFromCoords(lat, lng);
    } catch {
      return { error: "could not derive a timezone from lat/lng", status: 400 };
    }
  }

  return {
    row: {
      id,
      name: name.trim(),
      slug,
      lat,
      lng,
      geofenceKm,
      tz,
      sortOrder,
      menuUrl: menuUrl.value,
      orderingUrl: orderingUrl.value,
      pos: pos.value,
      hours: hours.value,
      hunt: hunt.value,
      orgId: orgId ?? null,
    },
  };
}
