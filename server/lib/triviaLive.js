// Live trivia rules — the pure parts: config validation, question shaping, and
// scoring. Kept out of the route so the scoring curve can be tested without a
// socket, a session, or a room full of phones.

/** Question count bounds for one game. Ten is a round; forty is a long night. */
export const MIN_QUESTIONS = 3;
export const MAX_QUESTIONS = 40;
export const DEFAULT_QUESTIONS = 10;

/** How long a question stays open, in seconds. */
// How long the answer stays up before the next question, and how long the
// lobby waits after the first player arrives. A room runs itself on these two
// — the host's buttons only ever move it along EARLY.
export const DEFAULT_REVEAL_SECONDS = 8;
export const MIN_LOBBY_SECONDS = 10;
export const MAX_LOBBY_SECONDS = 900;
export const DEFAULT_LOBBY_SECONDS = 90;

export const MIN_SECONDS = 5;
export const MAX_SECONDS = 120;
export const DEFAULT_SECONDS = 20;

/** Base points for a correct answer, before any speed bonus. */
export const BASE_POINTS = 100;
/** Most a fast answer can add on top of the base. */
export const MAX_SPEED_BONUS = 50;

export const MAX_ENTRANT_NAME = 32;
/** A room, not a stadium. Also bounds the SSE fan-out per session. */
export const MAX_ENTRANTS = 200;

/**
 * Score one answer.
 *
 * Wrong answers score zero — no partial credit, because a bar-trivia board
 * that rewards wrong-but-fast is a board nobody trusts.
 *
 * The speed bonus decays LINEARLY across the question's own window rather than
 * ranking answers against each other. Rank-based bonuses ("first correct gets
 * most") punish the table that's furthest from the wifi access point, and they
 * can't be computed until everyone has answered — which means the phone that
 * just answered can't be told what it scored.
 *
 * @param {boolean} correct
 * @param {number} msElapsed  server-measured ms since the question opened
 * @param {{questionSeconds: number, speedBonus: boolean}} config
 */
export function scoreAnswer(correct, msElapsed, config) {
  if (!correct) return 0;
  if (!config.speedBonus) return BASE_POINTS;
  const windowMs = config.questionSeconds * 1000;
  // Clamp both ends: a negative elapsed (clock skew) must not pay more than a
  // perfect answer, and an answer past the buzzer still scores the base.
  const elapsed = Math.min(Math.max(msElapsed, 0), windowMs);
  const remaining = 1 - elapsed / windowMs;
  return BASE_POINTS + Math.round(MAX_SPEED_BONUS * remaining);
}

/**
 * Validate + normalize a host's session config. Every field optional.
 * @returns {{ config: object } | { error: string }}
 */
export function normalizeConfig(input) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input)) {
    return { error: "config must be an object" };
  }
  const questionSeconds = input.questionSeconds ?? DEFAULT_SECONDS;
  if (!Number.isInteger(questionSeconds) || questionSeconds < MIN_SECONDS || questionSeconds > MAX_SECONDS) {
    return { error: `config.questionSeconds must be an integer ${MIN_SECONDS}..${MAX_SECONDS}` };
  }
  const speedBonus = input.speedBonus ?? true;
  if (typeof speedBonus !== "boolean") return { error: "config.speedBonus must be a boolean" };
  const teams = input.teams ?? true;
  if (typeof teams !== "boolean") return { error: "config.teams must be a boolean" };
  const revealSeconds = input.revealSeconds ?? DEFAULT_REVEAL_SECONDS;
  if (!Number.isInteger(revealSeconds) || revealSeconds < MIN_SECONDS || revealSeconds > MAX_SECONDS) {
    return { error: `config.revealSeconds must be an integer ${MIN_SECONDS}..${MAX_SECONDS}` };
  }
  const lobbySeconds = input.lobbySeconds ?? DEFAULT_LOBBY_SECONDS;
  if (!Number.isInteger(lobbySeconds) || lobbySeconds < MIN_LOBBY_SECONDS || lobbySeconds > MAX_LOBBY_SECONDS) {
    return {
      error: `config.lobbySeconds must be an integer ${MIN_LOBBY_SECONDS}..${MAX_LOBBY_SECONDS}`,
    };
  }
  return { config: { questionSeconds, speedBonus, teams, revealSeconds, lobbySeconds } };
}

/**
 * The question as anyone may see it while it is OPEN — with the answer
 * stripped.
 *
 * This is the one projection that must never leak. Note "anyone", host
 * included: the host used to be handed the answer from the moment the question
 * opened, on the reasoning that an MC reads it out. They don't need it then —
 * they announce it at the reveal, which is when everybody gets it — and that
 * one unnecessary privilege was what made hosting a room worth stealing. A
 * single spread of the DB row into a payload is the whole exploit, so every
 * open question goes through this function and nothing else.
 */
export function publicQuestion(row, index, total) {
  return {
    index,
    total,
    category: row.category,
    prompt: row.prompt,
    choices: row.choices,
  };
}

/** The same question WITH the answer — the reveal and the final board only. */
export function revealedQuestion(row, index, total) {
  return { ...publicQuestion(row, index, total), answer: row.answer };
}

/**
 * Validate a question bank row from an admin write.
 * @returns {{ row: object } | { error: string }}
 */
export function normalizeQuestion(body) {
  const prompt = typeof body?.prompt === "string" ? body.prompt.trim() : "";
  if (prompt.length < 3 || prompt.length > 300) {
    return { error: "prompt must be 3..300 characters" };
  }
  const choices = body?.choices;
  if (!Array.isArray(choices) || choices.length < 2 || choices.length > 6) {
    return { error: "choices must be an array of 2..6 options" };
  }
  const cleaned = [];
  for (const choice of choices) {
    if (typeof choice !== "string" || choice.trim() === "" || choice.length > 120) {
      return { error: "each choice must be a non-empty string up to 120 characters" };
    }
    cleaned.push(choice.trim());
  }
  // Duplicate options make the "right" answer ambiguous even when the index is
  // valid — two identical choices mean one of them is marked wrong.
  if (new Set(cleaned.map((c) => c.toLowerCase())).size !== cleaned.length) {
    return { error: "choices must be distinct" };
  }
  const answer = body?.answer;
  if (!Number.isInteger(answer) || answer < 0 || answer >= cleaned.length) {
    return { error: "answer must be an index into choices" };
  }
  const category =
    typeof body?.category === "string" && body.category.trim() !== ""
      ? body.category.trim().slice(0, 40)
      : "General";
  const difficulty = body?.difficulty ?? 2;
  if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 3) {
    return { error: "difficulty must be 1, 2 or 3" };
  }
  const active = body?.active ?? true;
  if (typeof active !== "boolean") return { error: "active must be a boolean" };

  return { row: { prompt, choices: cleaned, answer, category, difficulty, active } };
}

/** Validate an entrant (player or team) name. */
export function normalizeEntrantName(input) {
  if (typeof input !== "string") return null;
  // Collapse internal whitespace so " The  Quiz  Team " and "The Quiz Team"
  // can't both sit on the board as if they were different tables.
  const name = input.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > MAX_ENTRANT_NAME) return null;
  return name;
}
