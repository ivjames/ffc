// À la carte modules — the venue-level switches for what this client actually
// bought, separated from the vendor plumbing that makes each one work.
//
// Until now "does this venue have rewards?" was answered by "did someone put a
// POS vendor in location.pos.loyalty?" That conflates two different questions:
//
//   WIRING     — can we reach a ticket system for this venue? (credentials,
//                vendor, endpoint; set once during integration)
//   ENTITLEMENT— is this venue's plan supposed to include the rewards surface?
//                (a commercial decision, flipped independently and often)
//
// Conflating them means the only way to switch a module off is to rip out the
// integration's credentials and put them back later, and it makes "rewards" and
// "F&B ordering" invisible as the separately-sellable line items they are.
// So: `location.modules` holds the entitlement, `location.pos` keeps the wiring,
// and a module is live only when BOTH agree.
//
// Back-compat is the load-bearing property here. A location with no `modules`
// object at all — every location today — resolves exactly as it did before,
// derived from its existing config. Nothing changes until an operator sets a
// module explicitly, which is what makes this safe to ship to live venues.

/**
 * @typedef {Object} ModuleDef
 * @property {string} key
 * @property {string} label
 * @property {string} blurb        one line, for the Master Control panel
 * @property {'ordering'|'loyalty'|null} needsVendor
 *   Which pos block must be configured for this module to function. A module
 *   whose wiring is missing resolves OFF however it is toggled — an entitlement
 *   can't conjure a ticket system — and Master Control flags it as "needs
 *   wiring" rather than showing it as live.
 * @property {string|null} requires  another module that must also be live
 */

/** @type {readonly ModuleDef[]} */
export const MODULES = Object.freeze([
  {
    key: "arcade",
    label: "Arcade",
    blurb: "Browser-native mini-games, trivia, and the high score boards.",
    needsVendor: null,
    requires: null,
  },
  {
    key: "hunt",
    label: "AI scavenger hunt",
    blurb: "Photo hunts verified by a vision model, with anti-cheat.",
    needsVendor: null,
    requires: null,
  },
  {
    key: "ordering",
    label: "Food & drink ordering",
    blurb: "Native in-app F&B ordering against the venue's POS.",
    needsVendor: "ordering",
    requires: null,
  },
  {
    key: "rewards",
    label: "Rewards card",
    blurb: "Player card balances, tickets, and redemption in the app.",
    needsVendor: "loyalty",
    requires: null,
  },
  {
    key: "gameTickets",
    label: "Game ticket payouts",
    blurb: "Mini-games credit real tickets to the player's card.",
    needsVendor: "loyalty",
    requires: "rewards",
  },
]);

export const MODULE_KEYS = Object.freeze(MODULES.map((m) => m.key));

const BY_KEY = new Map(MODULES.map((m) => [m.key, m]));

/**
 * What a location's modules resolve to WITHOUT an explicit `modules` object —
 * i.e. what the app did before this layer existed. Every rule here is a
 * statement about the old behavior, not a new policy:
 *   - arcade and hunt shipped to every venue, ungated.
 *   - ordering rendered iff pos.ordering named a vendor.
 *   - rewards rendered iff pos.loyalty named a vendor.
 *   - game tickets paid iff pos.loyalty.gameRewards was true.
 */
function legacyDefaults(pos) {
  return {
    arcade: true,
    hunt: true,
    ordering: pos?.ordering != null,
    rewards: pos?.loyalty != null,
    gameTickets: pos?.loyalty?.gameRewards === true,
  };
}

/** Is this module's vendor wiring present? */
function wired(def, pos) {
  if (def.needsVendor === null) return true;
  return pos?.[def.needsVendor] != null;
}

/**
 * The live module set for one venue — the single answer every surface reads.
 *
 * @param {{ pos?: object|null, modules?: object|null }} location
 * @returns {Record<string, boolean>}
 */
export function resolveModules(location) {
  const pos = location?.pos ?? null;
  const stored = location?.modules ?? null;
  const defaults = legacyDefaults(pos);

  const resolved = {};
  for (const def of MODULES) {
    // Explicit entitlement wins; absent falls back to the pre-modules behavior.
    const entitled =
      stored && typeof stored[def.key] === "boolean" ? stored[def.key] : defaults[def.key];
    resolved[def.key] = entitled && wired(def, pos);
  }
  // Dependencies collapse AFTER the first pass: game tickets without the
  // rewards surface would credit a card the player has no way to see.
  for (const def of MODULES) {
    if (def.requires && !resolved[def.requires]) resolved[def.key] = false;
  }
  return resolved;
}

/**
 * Per-module status for Master Control: not just on/off, but WHY. An operator
 * looking at a module that isn't live needs to know whether it's unsold or
 * unwired, because those have completely different next steps.
 *
 * @returns {{ key, label, blurb, live, entitled, wired, requires, blockedBy }[]}
 */
export function moduleStatus(location) {
  const pos = location?.pos ?? null;
  const stored = location?.modules ?? null;
  const defaults = legacyDefaults(pos);
  const resolved = resolveModules(location);

  return MODULES.map((def) => {
    const entitled =
      stored && typeof stored[def.key] === "boolean" ? stored[def.key] : defaults[def.key];
    const isWired = wired(def, pos);
    return {
      key: def.key,
      label: def.label,
      blurb: def.blurb,
      live: resolved[def.key],
      entitled,
      wired: isWired,
      needsVendor: def.needsVendor,
      requires: def.requires,
      // The first reason this module isn't live, or null when it is.
      blockedBy: resolved[def.key]
        ? null
        : !entitled
          ? "not-enabled"
          : !isWired
            ? "not-wired"
            : def.requires && !resolved[def.requires]
              ? "requires"
              : null,
      /** True when this venue has never been given an explicit setting, so the
       *  value shown is the derived legacy default rather than a decision. */
      inherited: !(stored && typeof stored[def.key] === "boolean"),
    };
  });
}

/**
 * Is one module live at this venue? The server-side half of the entitlement,
 * for write paths that must not accept work for a module the venue's plan
 * doesn't include — recording an arcade score, opening a trivia session,
 * issuing a challenge.
 *
 * A route guard in the client (features/shared/ModuleGate.tsx) keeps players
 * out of the UI; this keeps a hand-rolled request out of the data. Neither is
 * load-bearing alone: hiding a nav tile does nothing about a bookmark, and a
 * client-side redirect does nothing about curl.
 *
 * @param {{ pos?: object|null, modules?: object|null }} location
 * @param {string} key
 */
export function moduleLive(location, key) {
  return resolveModules(location)[key] === true;
}

/**
 * The same test, for a handler that holds an activity id rather than a
 * location row — an open challenge, a running trivia session.
 *
 * Entitlements have to be rechecked on every MUTATION, not just at creation.
 * A challenge lives for a week and a trivia room for a night, so checking only
 * the create handler leaves an activity that outlives the module: rounds keep
 * scoring and players keep joining something the venue switched off days ago.
 *
 * `q` is a pool or a transaction client, so a caller already holding a row
 * lock can read inside it.
 *
 * Fails CLOSED: a location that has vanished resolves to "not entitled".
 */
export async function locationModuleLive(q, locationId, key) {
  if (!locationId) return false;
  const result = await q.query(`select pos, modules from location where id = $1`, [locationId]);
  return result.rows[0] ? moduleLive(result.rows[0], key) : false;
}

/**
 * Validate + normalize a `modules` object from an admin write. Sparse and
 * replace-not-merge, matching how pos/hours/branding already behave: only the
 * keys an operator set are stored, and an absent key keeps deriving from the
 * venue's existing config rather than being pinned to a value nobody chose.
 *
 * @returns {{ value: object|null } | { error: string }}
 */
export function normalizeModules(input) {
  if (input === undefined || input === null) return { value: null };
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "modules must be an object or null" };
  }
  const value = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!BY_KEY.has(key)) {
      return { error: `unknown module '${key}' (known: ${MODULE_KEYS.join(", ")})` };
    }
    // null drops the key back to the derived default — the branding idiom.
    if (raw === null || raw === undefined) continue;
    if (typeof raw !== "boolean") {
      return { error: `modules.${key} must be a boolean or null` };
    }
    value[key] = raw;
  }
  return { value: Object.keys(value).length === 0 ? null : value };
}
