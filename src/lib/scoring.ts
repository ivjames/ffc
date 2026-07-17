// §5.1 scoring helpers — totals, over/under par, winner, stroke cap.

export const HOLE_COUNT = 18;

// §5.1 Optional per-hole max stroke cap (common in mini golf). Configurable
// constant, not hard-coded UI. Default on.
export const STROKE_CAP_ENABLED = true;
export const STROKE_CAP = 6;

/** Clamp a stroke value to the sane range (and the cap, if enabled). */
export function clampStrokes(value: number): number {
  const max = STROKE_CAP_ENABLED ? STROKE_CAP : 99;
  return Math.max(1, Math.min(max, Math.round(value)));
}

/** Sum of entered strokes for one player (nulls = unentered, skipped). */
export function playerTotal(scores: (number | null)[]): number {
  return scores.reduce<number>((sum, s) => sum + (s ?? 0), 0);
}

/** How many holes this player has actually entered. */
export function holesEntered(scores: (number | null)[]): number {
  return scores.reduce<number>((n, s) => n + (s == null ? 0 : 1), 0);
}

/** Par summed only over holes the player has entered — for a fair running +/-. */
export function parForEntered(pars: number[], scores: (number | null)[]): number {
  return pars.reduce<number>((sum, par, i) => sum + (scores[i] == null ? 0 : par), 0);
}

/** Running over/under par across entered holes (negative = under par). */
export function overUnderEntered(pars: number[], scores: (number | null)[]): number {
  return playerTotal(scores) - parForEntered(pars, scores);
}

/** Total par for the whole course. */
export function coursePar(pars: number[]): number {
  return pars.reduce((a, b) => a + b, 0);
}

/** Format an over/under value: "E" for even, "+3", "-2". */
export function formatOverUnder(diff: number): string {
  if (diff === 0) return 'E';
  return diff > 0 ? `+${diff}` : `${diff}`;
}

/** True once every player has entered all 18 holes. */
export function isRoundComplete(scores: Record<number, (number | null)[]>, playerCount: number): boolean {
  for (let p = 0; p < playerCount; p++) {
    const row = scores[p];
    if (!row) return false;
    for (let h = 0; h < HOLE_COUNT; h++) if (row[h] == null) return false;
  }
  return true;
}

/** Player indexes with the lowest completed total (ties → multiple winners). */
export function winners(scores: Record<number, (number | null)[]>, playerCount: number): number[] {
  let best = Infinity;
  let result: number[] = [];
  for (let p = 0; p < playerCount; p++) {
    const total = playerTotal(scores[p] ?? []);
    if (total < best) {
      best = total;
      result = [p];
    } else if (total === best) {
      result.push(p);
    }
  }
  return result;
}
