// Adoption bonuses — a one-time ticket reward for installing the app and for
// signing in (the two funnels we're growing). They ride the same trusted POS
// credit path as game rewards (lib/posLoyalty.js) but are a DISTINCT economy:
// milestone rewards, one per card per kind, deliberately NOT counted against
// the mini-game daily cap (a one-time perk shouldn't eat a player's daily
// game-earning budget). Amounts are venue-tunable in Master Control
// (pos.loyalty.adoptionBonus); 0 disables that milestone.

export const ADOPTION_BONUS_KINDS = ["install", "signin"];

// Modest defaults — "a nice welcome, not a jackpot" — applied when the venue
// hasn't configured its own. A venue with the loyalty ticket economy enabled
// gets these by default (set to 0 to switch a milestone off).
export const DEFAULT_ADOPTION_BONUS = { install: 50, signin: 50 };

// Hard ceiling per milestone — a venue can tune up to here, never above.
export const MAX_ADOPTION_BONUS = 1000;

export function isBonusKind(kind) {
  return ADOPTION_BONUS_KINDS.includes(kind);
}

/** Effective per-milestone bonus for a venue, from its normalized pos config.
 *  Venue override or the platform default, clamped to [0, MAX]. */
export function effectiveAdoptionBonus(pos) {
  const cfg = pos?.loyalty?.adoptionBonus ?? null;
  const pick = (kind) => {
    const v = cfg?.[kind];
    if (Number.isInteger(v) && v >= 0) return Math.min(v, MAX_ADOPTION_BONUS);
    return DEFAULT_ADOPTION_BONUS[kind];
  };
  return { install: pick("install"), signin: pick("signin") };
}
