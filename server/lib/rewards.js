// Rewards (punchlist #8 tier 1) — achievement computation + redemption codes.
//
// Achievements are granted server-side when a completed round first syncs
// (routes/rounds.js), one reward_grant row per (player, achievement). The
// player shows the short code at the counter; staff look it up in Master
// Control and mark it redeemed. Pure functions here so the rules are
// unit-testable without a DB.

// The venue-facing catalog. Labels are what staff see in Master Control; the
// player app carries its own copy of the same labels (src/features/rewards).
export const ACHIEVEMENTS = {
  hole_in_one: "Hole-in-One",
  under_par: "Under Par",
  hunt_master: "Hunt Master",
};

// Tickets a card claim pays per achievement — the SERVER-SIDE source of truth.
// The claim endpoint (routes/rewards.js) derives the payout from the stored
// grant's achievement, so a tampered request can't mint tickets without an
// achievement or over-pay one; the client never sends an amount.
export const ACHIEVEMENT_TICKETS = {
  hole_in_one: 100,
  under_par: 50,
  hunt_master: 75,
};

/** Tickets for an achievement (0 for an unknown/unpriced one → never paid). */
export function achievementTickets(achievement) {
  return ACHIEVEMENT_TICKETS[achievement] ?? 0;
}

/**
 * Score-based achievements for one synced round.
 * `scoreRows` is the validated [{playerIndex, hole, strokes}] list the rounds
 * route inserts; `pars` is the course's length-18 par array.
 * Returns [{playerIndex, achievement}] (hunt_master needs the DB — see
 * huntMasterIndexes in routes/rounds.js).
 */
export function scoreAchievements(scoreRows, playerCount, pars) {
  const coursePar = pars.reduce((a, b) => a + b, 0);
  const perPlayer = new Map(); // playerIndex -> { holes: number, total: number, ace: boolean }
  for (let p = 0; p < playerCount; p++) perPlayer.set(p, { holes: 0, total: 0, ace: false });
  for (const row of scoreRows) {
    const s = perPlayer.get(row.playerIndex);
    if (!s) continue;
    s.holes += 1;
    s.total += row.strokes;
    if (row.strokes === 1) s.ace = true;
  }
  const grants = [];
  for (const [playerIndex, s] of perPlayer) {
    if (s.ace) grants.push({ playerIndex, achievement: "hole_in_one" });
    // Under par only counts a FULL card — a partial round with a low total is
    // just an unfinished round, not a sub-par one.
    if (s.holes === pars.length && s.total < coursePar) {
      grants.push({ playerIndex, achievement: "under_par" });
    }
  }
  return grants;
}

// Short human redemption code: 6 chars from an unambiguous charset (no 0/O,
// 1/I/L) so it survives being read aloud over a counter. 30^6 ≈ 7.3e8 —
// collisions are handled by unique-retry at insert time.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ2345679";
export const CODE_LENGTH = 6;

export function newRewardCode() {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}
