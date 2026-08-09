// Game ticket economy — the server-side source of truth for what the app's
// mini-games are ALLOWED to pay. The award endpoint (routes/gameRewards.js)
// validates every request against this registry, so a tampered client can
// never mint more than a legitimate perfect round: ticket math in the browser
// is a display convenience, and these numbers are the contract.
//
// Venues tune DOWN from here in Master Control (pos.loyalty.gameRewardCaps —
// see validateLocation.js normalizePos): per-game per-round ceilings and the
// per-card daily cap. They can never raise a cap above the hard limits below.

// Every mini-game key that may earn tickets, with its Master Control label.
// Mirrors the `game=` props under src/features/fun/ — a key missing here makes
// that game's awards 400 server-side, so keep the two in sync when adding a
// game. Chance-based games (clawmachine, coinpusher) are deliberately absent:
// they never earn (see the skill-only decision, PR #140).
export const GAME_REWARD_GAMES = [
  { key: "airhockey", label: "Air Hockey" },
  { key: "axethrow", label: "Axe Throw" },
  { key: "battingcages", label: "Batting Cages" },
  { key: "bowling", label: "Bowling" },
  { key: "bumperboats", label: "Bumper Boats" },
  { key: "bumpercars", label: "Bumper Cars" },
  { key: "darts", label: "Darts" },
  { key: "gokarts", label: "Go-Karts" },
  { key: "highstriker", label: "High Striker" },
  { key: "milkbottle", label: "Milk Bottle Toss" },
  { key: "pinball", label: "Pinball" },
  { key: "popashot", label: "Pop-a-Shot" },
  { key: "ringtoss", label: "Ring Toss" },
  { key: "shootinggallery", label: "Shooting Gallery" },
  { key: "skeeball", label: "Skee-Ball" },
  { key: "trivia", label: "Trivia" },
  { key: "watergunrace", label: "Water Gun Race" },
  { key: "whackamole", label: "Whack-a-Mole" },
];

const GAME_KEYS = new Set(GAME_REWARD_GAMES.map((g) => g.key));

// Hard per-round ceiling, any game. The richest client formula tops out at
// 100 (most clamp there explicitly), so anything above this is a forged
// request, not a great round.
export const HARD_MAX_PER_ROUND = 100;

// Per-card daily cap when the venue hasn't set one. Sized as "a nice perk,
// not a shift's wages": ~5 strong rounds a day per card.
export const DEFAULT_DAILY_PER_CARD = 500;
// Master Control can raise the daily cap to at most this.
export const MAX_DAILY_PER_CARD = 10_000;

export function isKnownGame(game) {
  return GAME_KEYS.has(game);
}

/**
 * Effective caps for one venue+game, from the venue's (already-normalized)
 * pos config. Venue settings only ever tighten the hard limits.
 * @returns {{ perRound: number, dailyPerCard: number }}
 */
export function effectiveCaps(pos, game) {
  const caps = pos?.loyalty?.gameRewardCaps ?? null;
  const venuePerRound = caps?.perGame?.[game];
  const perRound = Math.min(
    HARD_MAX_PER_ROUND,
    Number.isInteger(venuePerRound) && venuePerRound >= 1 ? venuePerRound : HARD_MAX_PER_ROUND
  );
  const venueDaily = caps?.dailyPerCard;
  const dailyPerCard = Math.min(
    MAX_DAILY_PER_CARD,
    Number.isInteger(venueDaily) && venueDaily >= 1 ? venueDaily : DEFAULT_DAILY_PER_CARD
  );
  return { perRound, dailyPerCard };
}
