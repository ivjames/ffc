// Arcade high-score registry — the server-side source of truth for WHAT a
// score means in each mini-game. Until now the arcade persisted nothing at all:
// a round's score lived in React state and died with the end screen, and
// game_ticket_award recorded only what the round PAID, never what it scored.
//
// The one thing a shared board can't be generic about is ranking, because the
// arcade's games don't share a play style:
//
//   high  — bigger is better. The default: points, pins, baskets, bumps.
//   low   — smaller is better. Timed games (a go-kart lap) and stroke games
//           (arcade putt). Ranking these with the `high` comparator would put
//           the WORST run on top, so direction is per game, never per board.
//
// `unit` is a display contract, not a ranking one — it tells the client how to
// render the stored integer (12840 -> "12.84s"), so the board can format a lap
// time and a pin count without knowing either game.
//
// Scores are stored as INTEGERS in the unit's base (ms for time), so ordering
// is exact — no float comparison decides whose lap was faster.
//
// Keep this list in sync with the `game=` props under src/features/fun/: a key
// missing here makes that game's score submissions 400, exactly like the ticket
// registry (lib/gameRewards.js). The two lists overlap but are NOT identical —
// Arcade Putt and the coin pusher never earn tickets, yet Putt is a stroke game
// with a perfectly meaningful board, so it appears here and not there. (The
// coin pusher is pure chance, so it's in neither: a chance board ranks luck.)

/**
 * @typedef {Object} ScoredGame
 * @property {string} key        wire key, matches the client's `game=` prop
 * @property {string} label      Master Control / board heading
 * @property {'high'|'low'} direction  which end of the sort wins
 * @property {'points'|'ms'|'strokes'|'count'} unit  how to render the integer
 * @property {string} noun       what one unit is, for the board's subtitle
 * @property {readonly {key: string, label: string}[]} [variants]  sub-boards
 */

// Some games are not comparable to themselves. A go-kart lap on the Boomerang
// (deliberately the longest circuit in the set) says nothing about one on the
// Speedway, and an endless Arcade Putt run has no fixed hole count to score
// against a course round — so ranking either on one merged board would rank
// the track choice, not the driving. Those games declare their variants here
// and get one board EACH; every other game runs a single board keyed ''.
//
// Go-kart variant keys are the Track ids in src/features/fun/GoKarts.tsx —
// a submission naming a variant not listed here is refused, so the two lists
// have to stay in step (a new track needs a line here before it can score).

/** @type {readonly ScoredGame[]} */
export const SCORED_GAMES = Object.freeze([
  { key: "airhockey", label: "Air Hockey", direction: "high", unit: "count", noun: "goal margin" },
  // Only the fixed courses are ranked: an endless run generates holes as you
  // go, so its stroke total measures how long you kept playing, not how well.
  // Variant keys are the Course keys in src/features/putt/courses.ts — a new
  // course needs a line here before its rounds can score. 'course' is the
  // original nine's historical key; it predates there being other courses.
  {
    key: "arcadeputt",
    label: "Arcade Putt",
    direction: "low",
    unit: "strokes",
    noun: "strokes",
    variants: [
      { key: "course", label: "The Classic" },
      { key: "creekside", label: "Creekside" },
      { key: "dunes", label: "The Dunes" },
      { key: "gauntlet", label: "The Gauntlet" },
    ],
  },
  { key: "axethrow", label: "Axe Throw", direction: "high", unit: "points", noun: "points" },
  { key: "battingcages", label: "Batting Cages", direction: "high", unit: "points", noun: "runs" },
  { key: "bowling", label: "Bowling", direction: "high", unit: "points", noun: "pins" },
  { key: "bumperboats", label: "Bumper Boats", direction: "high", unit: "count", noun: "bumps" },
  { key: "bumpercars", label: "Bumper Cars", direction: "high", unit: "count", noun: "bumps" },
  { key: "clawmachine", label: "Claw Machine", direction: "high", unit: "count", noun: "prizes" },
  { key: "darts", label: "Darts", direction: "high", unit: "points", noun: "points" },
  // The only true time game: ranked on BEST LAP, not total race time, so a
  // botched first lap doesn't bury an otherwise blistering run.
  {
    key: "gokarts",
    label: "Go-Karts",
    direction: "low",
    unit: "ms",
    noun: "best lap",
    variants: [
      { key: "speedway", label: "Speedway" },
      { key: "sunset", label: "Sunset Loop" },
      { key: "boomerang", label: "Boomerang" },
      { key: "hourglass", label: "Hourglass" },
      { key: "esses", label: "The Esses" },
      { key: "grand-prix", label: "Grand Prix" },
      { key: "serpent", label: "Serpent" },
    ],
  },
  { key: "highstriker", label: "High Striker", direction: "high", unit: "points", noun: "power" },
  { key: "milkbottle", label: "Milk Bottle Toss", direction: "high", unit: "points", noun: "points" },
  { key: "pinball", label: "Pinball", direction: "high", unit: "points", noun: "points" },
  { key: "popashot", label: "Pop-a-Shot", direction: "high", unit: "count", noun: "baskets" },
  { key: "ringtoss", label: "Ring Toss", direction: "high", unit: "points", noun: "points" },
  { key: "sheepdrive", label: "Sheep Drive", direction: "high", unit: "points", noun: "points" },
  { key: "shootinggallery", label: "Shooting Gallery", direction: "high", unit: "points", noun: "points" },
  { key: "skeeball", label: "Skee-Ball", direction: "high", unit: "points", noun: "points" },
  { key: "trivia", label: "Trivia", direction: "high", unit: "count", noun: "correct" },
  { key: "watergunrace", label: "Water Gun Race", direction: "high", unit: "count", noun: "wins" },
  { key: "whackamole", label: "Whack-a-Mole", direction: "high", unit: "points", noun: "points" },
]);

const BY_KEY = new Map(SCORED_GAMES.map((g) => [g.key, g]));

/** Hard bound on a stored score, both directions. Generous enough for a ms lap
 *  time (an hour) and any points formula, tight enough that a forged score
 *  can't sort as ±Infinity or overflow the client's number formatting. */
export const MAX_SCORE = 3_600_000;

export function isScoredGame(game) {
  return BY_KEY.has(game);
}

/**
 * Validate a submitted variant against its game. A game WITHOUT variants
 * accepts only the empty board key; a game WITH them requires one of its own —
 * a typo'd track must not silently open a private board nobody else is on.
 * @returns {{ variant: string } | { error: string }}
 */
export function normalizeVariant(game, raw) {
  const entry = scoredGame(game);
  const variants = entry?.variants ?? null;
  const value = raw === undefined || raw === null ? "" : raw;
  if (typeof value !== "string") return { error: "variant must be a string" };
  if (!variants) {
    if (value !== "") return { error: `${game} has no variants` };
    return { variant: "" };
  }
  if (!variants.some((v) => v.key === value)) {
    return { error: `variant must be one of: ${variants.map((v) => v.key).join(", ")}` };
  }
  return { variant: value };
}

/**
 * Every (game, variant) pair that has its own board — the arcade-wide screen
 * iterates this, not SCORED_GAMES, so a variant game contributes one entry per
 * sub-board instead of one merged (and meaningless) board.
 */
export function allBoards() {
  return SCORED_GAMES.flatMap((g) =>
    g.variants
      ? g.variants.map((v) => ({ ...g, variant: v.key, variantLabel: v.label }))
      : [{ ...g, variant: "", variantLabel: null }]
  );
}

/** @returns {ScoredGame | null} */
export function scoredGame(game) {
  return BY_KEY.get(game) ?? null;
}

/**
 * The SQL sort direction for one game's board. Returns a caller-chosen literal
 * ("asc"/"desc") — never interpolated user input — because a sort direction
 * can't be a bound parameter in Postgres.
 */
export function sortDirection(game) {
  return scoredGame(game)?.direction === "low" ? "asc" : "desc";
}

/**
 * Is `candidate` a better score than `previous` for this game? `previous` of
 * null (no prior score) makes anything an improvement. Used for the "new
 * personal best" flag the end screen celebrates.
 */
export function isBetter(game, candidate, previous) {
  if (previous === null || previous === undefined) return true;
  return scoredGame(game)?.direction === "low" ? candidate < previous : candidate > previous;
}
