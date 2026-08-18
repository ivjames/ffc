// Runtime policy for synthetic (bot-generated) rounds.
//
// A synthetic round travels the exact same /api/rounds path as a real one and,
// by default, behaves identically — it counts on leaderboards and mints reward
// grants — so the load/soak + demo-seed bot (scripts/course-bot.mjs) exercises
// the full production code path. What the `synthetic` flag always buys you is
// IDENTIFICATION: every bot round is tagged in the DB and lives under a
// reserved client_id namespace, so it is findable and bulk-deletable no matter
// how the policy below is set.
//
// Two independent, env-gated levers let an operator dial the behaviour down
// without a code change (both default ON — "we're testing, hit the real path"):
//
//   SYNTHETIC_MINT_REWARDS   (default "true")
//     false → grantRewards() is skipped for synthetic rounds, so a bot run
//     never mints loyalty-card tickets. Real rounds are never affected.
//
//   SYNTHETIC_COUNT_ON_BOARD (default "true")
//     false → synthetic rounds are excluded from every leaderboard and admin
//     rollup query (via boardSyntheticFilter). Real rounds are never affected.
//
// And one privileged-flag guard:
//
//   SYNTHETIC_BOT_KEY        (default unset → feature OFF)
//     The shared secret the bot sends as `x-synthetic-key`. Marking a round
//     synthetic is an operator capability, not something any anonymous device
//     may self-assert: if this is unset, or the header doesn't match, an
//     inbound `synthetic: true` is rejected. So production is opt-in — no key,
//     no synthetic rounds — and a bypassed client can't flag its own rounds to
//     dodge a board (which would matter the moment COUNT_ON_BOARD is off).

import { timingSafeEqual } from "node:crypto";

// Parse a boolean env var with an explicit default. Only "false"/"0"/"no"/"off"
// (case-insensitive) turn a defaulted-true flag off; anything else keeps it on.
function envBool(raw, dflt) {
  if (raw === undefined || raw === null || raw === "") return dflt;
  return !["false", "0", "no", "off"].includes(String(raw).trim().toLowerCase());
}

/** True if synthetic rounds should mint reward grants (default true). */
export function syntheticMintsRewards(env = process.env) {
  return envBool(env.SYNTHETIC_MINT_REWARDS, true);
}

/** True if synthetic rounds should count on leaderboards/rollups (default true). */
export function syntheticCountsOnBoard(env = process.env) {
  return envBool(env.SYNTHETIC_COUNT_ON_BOARD, true);
}

/**
 * SQL fragment to drop into a board/rollup WHERE clause to honour the
 * COUNT_ON_BOARD policy. Returns "" when synthetic rounds count (the default —
 * board queries are byte-for-byte unchanged), or `and not <alias>.synthetic`
 * when they must be excluded. `alias` is the round table's alias in the query
 * (e.g. "r"). No user input flows in — alias is a caller-chosen literal.
 */
export function boardSyntheticFilter(alias = "r", env = process.env) {
  return syntheticCountsOnBoard(env) ? "" : `and not ${alias}.synthetic`;
}

/**
 * The x-synthetic-key gate on its own: `{ ok: true }` when the feature is
 * enabled AND the provided header matches, `{ ok: false, error }` otherwise.
 * Shared by resolveSynthetic (POST /api/rounds) and the bot's cross-tenant
 * discovery feed (routes/synthetic.js), so both speak the same policy.
 * Compared in constant time — length is not secret, the bytes are.
 */
export function syntheticKeyOk(providedKey, env = process.env) {
  const expected = env.SYNTHETIC_BOT_KEY;
  if (!expected) {
    return { ok: false, error: "synthetic rounds are not enabled (SYNTHETIC_BOT_KEY unset)" };
  }
  const bad = { ok: false, error: "invalid or missing x-synthetic-key for synthetic round" };
  if (typeof providedKey !== "string") return bad;
  const a = Buffer.from(providedKey);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return bad;
  return { ok: true };
}

/**
 * Decide whether an inbound request may mark its round synthetic.
 *   { ok: true,  synthetic: false } — not requested; a normal real round.
 *   { ok: true,  synthetic: true  } — requested and authorised.
 *   { ok: false, error }           — requested but not authorised (→ 403).
 * `requested` is the raw body value; `providedKey` is the x-synthetic-key header.
 */
export function resolveSynthetic(requested, providedKey, env = process.env) {
  if (requested !== true) return { ok: true, synthetic: false };
  const gate = syntheticKeyOk(providedKey, env);
  if (!gate.ok) return gate;
  return { ok: true, synthetic: true };
}
