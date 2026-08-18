// Achievements (punchlist #8 tier 1) — computation only.
//
// Achievements are granted server-side when a completed round first syncs
// (routes/rounds.js), one reward_grant row per (player, achievement). Pure
// functions here so the rules are unit-testable without a DB.
//
// Achievements PAY NOTHING. They are a status/collection layer, not a currency:
// no tickets, no loyalty-card credit, no redemption codes. Golf scores are
// entirely self-reported — the scorecard is a number pad on a device the group
// controls, with nothing verifying that a 1 was a 1 — so paying tickets against
// them was the weakest trust surface in the ticket economy, weaker even than
// the client-scored mini-games (which are at least capped server-side per
// round). Tickets now come only from the mini-game proxy (lib/gameRewards.js)
// and the one-time adoption bonuses (lib/adoptionBonus.js).
//
// A grant is therefore a pure record of "this round earned this", read by the
// player's summary and Master Control's issuance rollup.

// The venue-facing catalog. Labels are what staff see in Master Control; the
// player app carries its own copy of the same labels (src/features/rewards).
export const ACHIEVEMENTS = {
  hole_in_one: "Hole-in-One",
  under_par: "Under Par",
  hunt_master: "Hunt Master",
};

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

/**
 * Hunt achievements for one synced round, from that round's hunt_find rows.
 *
 * `finds` is every submission tied to the round (verified and not), each:
 *   { tag, itemId, verified, confidence, flagged, countable, createdAt }
 * `completedTags` is the set of tags that finished the course's hunt — the
 * Hunt Master condition, which several of these build on.
 *
 * Pure so the rules are unit-testable without a DB; the route supplies the
 * rows. Returns [{ tag, achievement }].
 */
export function huntAchievements(finds, { completedTags = new Set() } = {}) {
  const byTag = new Map();
  for (const f of finds) {
    const list = byTag.get(f.tag) ?? [];
    list.push(f);
    byTag.set(f.tag, list);
  }

  const out = [];
  for (const [tag, rows] of byTag) {
    const ordered = [...rows].sort((a, b) => a.createdAt - b.createdAt);
    const verified = ordered.filter((f) => f.verified);
    const add = (achievement) => out.push({ tag, achievement });

    if (verified.length > 0) add("first_find");
    if (verified.some((f) => (f.confidence ?? 0) >= 0.95)) add("eagle_eye");

    // Five verified in a row with no rejection in between — a rejected
    // submission resets the run, which is what "without a rejection" means.
    let run = 0;
    let streak = false;
    for (const f of ordered) {
      if (f.verified) {
        if (++run >= 5) streak = true;
      } else run = 0;
    }
    if (streak) add("sharpshooter");

    // Three failed attempts at one item, then landing it.
    const perItem = new Map();
    for (const f of ordered) {
      const st = perItem.get(f.itemId) ?? { fails: 0, wonAfter3: false };
      if (f.verified) {
        if (st.fails >= 3) st.wonAfter3 = true;
      } else st.fails += 1;
      perItem.set(f.itemId, st);
    }
    if ([...perItem.values()].some((st) => st.wonAfter3)) add("persistence");

    // Ten of a single countable item — the "find as many as you can" ones.
    const countable = new Map();
    for (const f of verified) {
      if (!f.countable) continue;
      countable.set(f.itemId, (countable.get(f.itemId) ?? 0) + 1);
    }
    if ([...countable.values()].some((n) => n >= 10)) add("hoarder");

    // The two "clean hunt" badges are distinct on purpose: one is about the
    // anti-cheat verdict, the other about ever being told no.
    if (completedTags.has(tag)) {
      if (!ordered.some((f) => f.flagged)) add("above_board");
      if (!ordered.some((f) => !f.verified)) add("naturalist");
    }
  }
  return out;
}
