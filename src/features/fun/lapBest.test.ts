import { describe, expect, test } from 'vitest';
import { recordLap, type LapBests } from './lapBest';

// The invariant: what gets SUBMITTED is what the current race drove. The
// screen's running personal best is for celebration and the picker, and must
// never leak into the score.

const fresh = (pb = Infinity): LapBests => ({ best: Infinity, pb });

describe('lap bests', () => {
  test('the first lap of a race sets that race\'s best', () => {
    const bests = fresh();
    expect(recordLap(bests, 12_400)).toEqual({ raceBest: true, personalBest: true });
    expect(bests.best).toBe(12_400);
  });

  test('a slower rerun submits its own lap, not the earlier race\'s', () => {
    // Race one: a quick lap, which becomes the personal best.
    const one = fresh();
    recordLap(one, 11_000);

    // Race two on the same track, driven badly. `pb` carries over — that is
    // what the picker shows — but the race starts with no lap of its own.
    const two = fresh(one.pb);
    const outcome = recordLap(two, 14_500);

    expect(two.best).toBe(14_500);
    expect(outcome.raceBest).toBe(true);
    expect(outcome.personalBest).toBe(false); // no fanfare, it was slower
    expect(two.pb).toBe(11_000); // the picker still shows the good one
  });

  test('a genuine improvement moves both', () => {
    const bests = fresh(11_000);
    recordLap(bests, 12_000); // this race's first lap, still off the pb
    const outcome = recordLap(bests, 10_500);
    expect(outcome).toEqual({ raceBest: true, personalBest: true });
    expect(bests.best).toBe(10_500);
    expect(bests.pb).toBe(10_500);
  });

  test('a lap slower than this race\'s best changes nothing', () => {
    const bests = fresh(11_000);
    recordLap(bests, 12_000);
    expect(recordLap(bests, 12_800)).toEqual({ raceBest: false, personalBest: false });
    expect(bests.best).toBe(12_000);
  });

  test('a retire leaves nothing to submit', () => {
    // The end screen guards on Infinity: a race with no completed lap has no
    // lap time, and must not fall back to whatever the screen remembers.
    expect(fresh(11_000).best).toBe(Infinity);
  });
});
