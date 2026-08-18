// Lap bookkeeping for the go-karts, kept out of the render loop so it can be
// reasoned about (and tested) on its own.
//
// A race screen holds TWO bests and they answer different questions:
//
//   raceBest — the quickest lap of the race being driven right now. This is
//              the only figure that may be submitted: it is what this session
//              id actually earned.
//   personalBest — the quickest lap across every race played on this screen,
//              per track. It exists to decide whether a lap deserves the
//              brighter celebration, and to label the track picker.
//
// Conflating them is not cosmetic. Seeding the race's best from the personal
// best means a slower rerun still holds the earlier race's time, and the end
// screen submits it under a fresh session id — so the boards record a lap
// against a race that never drove it, and a head-to-head round can be won with
// a lap set before the challenge was accepted.

export type LapBests = { best: number; pb: number };

export type LapOutcome = {
  /** The lap improved THIS race — the submittable figure moved. */
  raceBest: boolean;
  /** The lap improved the screen's best on this track — play the big FX. */
  personalBest: boolean;
};

/**
 * Fold a completed lap into both bests, in place.
 *
 * `Infinity` is the "no lap yet" value on either field, so the first lap of a
 * race always sets the race best, and the first lap on a track always sets the
 * personal best.
 */
export function recordLap(bests: LapBests, lapMs: number): LapOutcome {
  const raceBest = lapMs < bests.best;
  const personalBest = lapMs < bests.pb;
  if (raceBest) bests.best = lapMs;
  if (personalBest) bests.pb = lapMs;
  return { raceBest, personalBest };
}
