// Player model for the arcade bot.
//
// The bot does NOT sample scores from an invented distribution. It solves each
// game's own physics for the gesture that would hit a chosen target, then
// perturbs that gesture's AIM before committing to it — the same way a real
// player misjudges a line and only finds out when the ball lands. Everything
// downstream (the bounce, the ring it drops into, the pins it leaves standing)
// is the game's real code reacting to a slightly-wrong input.
//
// That is the whole reason this is worth doing in a browser: score realism is
// derived from the shipped game rather than hand-authored next to it, so the
// distributions cannot silently drift when someone retunes a game's constants.
//
// `skill` is one number in [0,1]: 0 is a first-timer, 1 is the regular who has
// the machine solved. It drives both how precisely the bot executes a line and
// how ambitious a target it picks — weak players correctly prefer the fat
// middle rings to the corner 100s.

/** Deterministic PRNG (mulberry32) — a run is replayable from its seed. */
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Standard normal via Box–Muller. */
export function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * Aim scatter in a game's logical units for a given skill.
 * `loose` is the sigma of a beginner, `tight` the sigma of an expert.
 *
 * Skill is eased so the top of the range stays genuinely hard to reach —
 * without any easing, mid-skill bots play almost as well as experts and the
 * score histogram collapses onto the high end. The exponent is 1.5 rather than
 * 2: at squared easing a 0.65-skill player still had beginner-width scatter
 * (measured: skill 0.65 scoring below skill 0.39 on Skee-Ball), which reads as
 * noise rather than as a skill gradient.
 */
export function sigmaFor(skill, loose, tight) {
  return lerp(loose, tight, clamp(skill, 0, 1) ** 1.5);
}

/** Jitter a logical point by an isotropic Gaussian of the given sigma. */
export function jitter(rng, pt, sigma) {
  return { x: pt.x + gauss(rng) * sigma, y: pt.y + gauss(rng) * sigma };
}

/**
 * A population of players, so a traffic run looks like a venue rather than one
 * person. Most arcade play is casual; a thin tail is genuinely good. Beta-ish
 * shape built from two uniforms (cheap, and we only need the silhouette).
 */
export function sampleSkill(rng) {
  const u = (rng() + rng() + rng()) / 3; // → bell around 0.5
  return clamp(u * 0.9 + rng() * 0.12, 0, 1);
}

/** Pick from `weights` (parallel to `items`) — used for target selection. */
export function pickWeighted(rng, items, weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
