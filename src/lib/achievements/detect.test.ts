import { describe, test, expect } from 'vitest';
import { detectEarned, playerRounds, reachContext, reachableAchievements, type CourseInfo } from './detect';
import { ACHIEVEMENTS } from './catalog';
import type { LocalRound } from '../../types';

// A flat par-3 course: par 54 over 18 holes. Every scoring rule below is stated
// against it, so the numbers in the tests are easy to hold in your head.
const PARS = Array(18).fill(3);
const PAR4S = [...Array(17).fill(3), 4]; // one par-4, for threading_it

const CATALOG: CourseInfo[] = [
  { id: 'c1', locationId: 'v1', pars: PARS },
  { id: 'c2', locationId: 'v1', pars: PARS },
  { id: 'c3', locationId: 'v2', pars: PARS },
  { id: 'c4', locationId: 'v3', pars: PAR4S },
];

let seq = 0;
/** A completed round. `cards` is one stroke array per player. */
function round(cards: (number | null)[][], over: Partial<LocalRound> = {}): LocalRound {
  const scores: Record<number, (number | null)[]> = {};
  cards.forEach((c, i) => (scores[i] = c));
  return {
    clientId: `r${++seq}`,
    courseId: 'c1',
    playerTags: cards.map((_, i) => `P${i}0`),
    scores,
    createdAt: 1_700_000_000_000,
    completedAt: 1_700_000_000_000,
    syncState: 'synced',
    ...over,
  } as LocalRound;
}

const card = (n: number) => Array(18).fill(n);
/** A full card of `base`, with `patch` applied by hole index. */
const withHoles = (base: number, patch: Record<number, number | null>) => {
  const c: (number | null)[] = card(base);
  for (const [h, v] of Object.entries(patch)) c[Number(h)] = v;
  return c;
};

const earn = (rounds: LocalRound[]) => detectEarned(rounds, CATALOG);
const has = (rounds: LocalRound[], key: string) => earn(rounds).has(key);

describe('playerRounds', () => {
  test('skips unfinished rounds and unknown courses', () => {
    expect(playerRounds([round([card(3)], { completedAt: null })], CATALOG)).toEqual([]);
    expect(playerRounds([round([card(3)], { courseId: 'nope' })], CATALOG)).toEqual([]);
  });

  test('pass-and-play counts every seat; a shared game counts only this device', () => {
    const cards = [card(3), card(2)];
    expect(playerRounds([round(cards)], CATALOG)).toHaveLength(2);
    const shared = round(cards, {
      shared: { gameId: 'g', participantToken: 't', slot: 0 },
    } as Partial<LocalRound>);
    const mine = playerRounds([shared], CATALOG);
    expect(mine).toHaveLength(1);
    expect(mine[0].slot).toBe(0);
  });

  test("a shared game does not credit another player's ace to this device", () => {
    // Slot 1 aces every hole; this device is slot 0 and earns nothing for it.
    const shared = round([card(3), card(1)], {
      shared: { gameId: 'g', participantToken: 't', slot: 0 },
    } as Partial<LocalRound>);
    expect(has([shared], 'hole_in_one')).toBe(false);
    // The same cards pass-and-play DO count — one device, one group.
    expect(has([round([card(3), card(1)])], 'hole_in_one')).toBe(true);
  });
});

describe('scoring', () => {
  test('aces: one, two, three', () => {
    expect(has([round([withHoles(3, { 5: 1 })])], 'hole_in_one')).toBe(true);
    expect(has([round([withHoles(3, { 5: 1 })])], 'double_ace')).toBe(false);
    expect(has([round([withHoles(3, { 5: 1, 6: 1 })])], 'double_ace')).toBe(true);
    expect(has([round([withHoles(3, { 5: 1, 6: 1 })])], 'triple_ace')).toBe(false);
    expect(has([round([withHoles(3, { 5: 1, 6: 1, 7: 1 })])], 'triple_ace')).toBe(true);
  });

  test('positional aces', () => {
    expect(has([round([withHoles(3, { 0: 1 })])], 'hot_start')).toBe(true);
    expect(has([round([withHoles(3, { 17: 1 })])], 'closer')).toBe(true);
    expect(has([round([withHoles(3, { 8: 1 })])], 'halfway_hero')).toBe(true);
    expect(has([round([withHoles(3, { 0: 1, 17: 1 })])], 'bookends')).toBe(true);
    expect(has([round([withHoles(3, { 0: 1 })])], 'bookends')).toBe(false);
  });

  test('birdie and streaks', () => {
    expect(has([round([withHoles(3, { 4: 2 })])], 'birdie')).toBe(true);
    expect(has([round([card(3)])], 'birdie')).toBe(false);
    expect(has([round([withHoles(3, { 4: 2, 5: 2 })])], 'birdie_streak')).toBe(false);
    expect(has([round([withHoles(3, { 4: 2, 5: 2, 6: 2 })])], 'birdie_streak')).toBe(true);
    // Nine at-or-under in a row, but not the whole card.
    expect(has([round([withHoles(3, { 0: 4, 1: 4 })])], 'perfect_nine')).toBe(true);
    expect(has([round([withHoles(3, { 9: 4 })])], 'perfect_nine')).toBe(true);
    expect(
      has([round([withHoles(3, { 2: 4, 5: 4, 9: 4, 13: 4 })])], 'perfect_nine'),
    ).toBe(false);
  });

  test('full-card totals', () => {
    expect(has([round([card(2)])], 'under_par')).toBe(true);
    expect(has([round([card(3)])], 'under_par')).toBe(false);
    expect(has([round([card(3)])], 'even_steven')).toBe(true);
    expect(has([round([withHoles(3, { 0: 4 })])], 'so_close')).toBe(true);
    expect(has([round([card(2)])], 'deep_red')).toBe(true); // 36 vs 54
    expect(has([round([withHoles(3, { 0: 2 })])], 'deep_red')).toBe(false);
    expect(has([round([card(6)])], 'the_long_way')).toBe(true); // 108 vs 54
  });

  test('a partial card is an unfinished round, not a good one', () => {
    const partial = withHoles(2, { 10: null, 11: null, 12: null });
    expect(has([round([partial])], 'under_par')).toBe(false);
    expect(has([round([partial])], 'even_steven')).toBe(false);
  });

  test('shape-of-the-card rules', () => {
    expect(has([round([card(3)])], 'bogey_free')).toBe(true);
    expect(has([round([withHoles(3, { 4: 4 })])], 'bogey_free')).toBe(false);
    expect(has([round([card(3)])], 'par_machine')).toBe(true);
    expect(has([round([withHoles(3, { 4: 2 })])], 'par_machine')).toBe(false);
    expect(has([round([withHoles(3, { 4: 2, 5: 4 })])], 'metronome')).toBe(true);
    expect(has([round([withHoles(3, { 4: 5 })])], 'metronome')).toBe(false);
  });

  test('nines and the comeback', () => {
    expect(has([round([withHoles(3, { 0: 2 })])], 'front_nine')).toBe(true);
    expect(has([round([withHoles(3, { 0: 2 })])], 'back_nine')).toBe(false);
    expect(has([round([withHoles(3, { 9: 2 })])], 'back_nine')).toBe(true);
    // +3 at the turn, then a birdie on the back.
    const comeback = withHoles(3, { 0: 4, 1: 4, 2: 4, 9: 2 });
    expect(has([round([comeback])], 'comeback')).toBe(true);
    expect(has([round([withHoles(3, { 0: 4, 9: 2 })])], 'comeback')).toBe(false); // only +1
  });

  test('the stroke cap', () => {
    const capped = withHoles(3, { 0: 6, 1: 6, 2: 6, 3: 6, 4: 6 });
    expect(has([round([capped])], 'capped_out')).toBe(true);
    expect(has([round([withHoles(3, { 0: 6, 1: 6 })])], 'capped_out')).toBe(false);
    expect(has([round([card(6)])], 'rock_bottom')).toBe(true);
    expect(has([round([withHoles(6, { 0: 3 })])], 'rock_bottom')).toBe(false);
    expect(has([round([withHoles(3, { 4: 6, 5: 1 })])], 'escape_artist')).toBe(true);
    expect(has([round([withHoles(3, { 4: 1, 5: 6 })])], 'rally_killer')).toBe(true);
    expect(has([round([withHoles(3, { 4: 6, 5: 1 })])], 'rally_killer')).toBe(false);
    // Capped a hole and still beat the course.
    expect(has([round([withHoles(2, { 0: 6 })])], 'survivor')).toBe(true); // 40 vs 54
    expect(has([round([withHoles(3, { 0: 6 })])], 'survivor')).toBe(false);
  });

  test('threading it needs every par-4 beaten', () => {
    expect(has([round([withHoles(3, { 17: 3 })], { courseId: 'c4' })], 'threading_it')).toBe(true);
    expect(has([round([withHoles(3, { 17: 4 })], { courseId: 'c4' })], 'threading_it')).toBe(false);
    // A course with no par-4 can't earn it.
    expect(has([round([card(2)])], 'threading_it')).toBe(false);
  });
});

describe('the field', () => {
  const loser = card(4);

  test('party of four and full house need four full cards', () => {
    expect(has([round([card(3), card(3), card(3), card(3)])], 'party_of_four')).toBe(true);
    expect(has([round([card(3), card(3), card(3)])], 'party_of_four')).toBe(false);
    expect(has([round([card(2), card(2), card(2), card(2)])], 'full_house')).toBe(true);
    expect(has([round([card(2), card(2), card(2), card(3)])], 'full_house')).toBe(false);
  });

  test('margins', () => {
    // 54 vs 55 — one stroke.
    expect(has([round([card(3), withHoles(3, { 0: 4 })])], 'photo_finish')).toBe(true);
    expect(has([round([card(3), withHoles(3, { 0: 4, 1: 4 })])], 'photo_finish')).toBe(false);
    // 36 vs 54 across four players — eighteen clear.
    expect(has([round([card(2), card(3), card(3), card(3)])], 'ringer')).toBe(true);
    expect(has([round([card(2), card(3), card(3)])], 'ringer')).toBe(false); // 3 players
  });

  test('ties and last place', () => {
    expect(has([round([card(3), card(3)])], 'dead_heat')).toBe(true);
    expect(has([round([card(3), loser])], 'dead_heat')).toBe(false);
    expect(has([round([card(3), loser])], 'good_sport')).toBe(true);
    expect(has([round([card(3), card(3)])], 'good_sport')).toBe(false); // tied last isn't last
  });

  test('clean sweep needs every hole won outright', () => {
    expect(has([round([card(2), card(3)])], 'clean_sweep')).toBe(true);
    // Tied on one hole is not a sweep.
    expect(has([round([withHoles(2, { 7: 3 }), card(3)])], 'clean_sweep')).toBe(false);
    expect(has([round([card(3)])], 'clean_sweep')).toBe(false); // solo
  });

  test('photo bomb: an ace where the rest go over', () => {
    expect(has([round([withHoles(3, { 4: 1 }), withHoles(3, { 4: 5 })])], 'photo_bomb')).toBe(true);
    // Everyone else made par — impressive, but not a bomb.
    expect(has([round([withHoles(3, { 4: 1 }), card(3)])], 'photo_bomb')).toBe(false);
  });

  test('wire to wire, underdog and the comeback win are distinct', () => {
    // Led from hole 1 to the end.
    expect(has([round([card(2), card(3)])], 'wire_to_wire')).toBe(true);
    expect(has([round([card(2), card(3)])], 'underdog')).toBe(false);

    // Trailing the whole way, winning only on 18: 17 pars then an ace (52)
    // against 17 birdies then a max (40)... build it explicitly instead.
    const me = withHoles(3, { 17: 1 }); // 17*3 + 1 = 52
    const them = withHoles(3, { 17: 6 }); // 17*3 + 6 = 57
    // Through 17 they're level, so "underdog" (never led) holds but
    // "come from behind" (strictly trailing) does not.
    expect(has([round([me, them])], 'underdog')).toBe(true);
    expect(has([round([me, them])], 'come_from_behind')).toBe(false);

    // Now strictly behind with one to play: they're 2 better through 17.
    const behind = withHoles(3, { 17: 1 }); // 52
    const ahead = withHoles(3, { 0: 2, 1: 2, 17: 6 }); // 15+... = 55
    expect(has([round([behind, ahead])], 'come_from_behind')).toBe(true);
    expect(has([round([behind, ahead])], 'underdog')).toBe(true);
  });
});

describe('career', () => {
  const at = (t: number, over: Partial<LocalRound> = {}) =>
    round([card(3)], { completedAt: t, createdAt: t, ...over });

  test('new ground is the starter badge', () => {
    expect(has([], 'new_ground')).toBe(false);
    expect(has([at(1)], 'new_ground')).toBe(true);
  });

  test('road trip needs three venues', () => {
    expect(has([at(1), at(2, { courseId: 'c2' })], 'road_trip')).toBe(false); // both v1
    expect(has([at(1), at(2, { courseId: 'c3' })], 'road_trip')).toBe(false);
    expect(
      has([at(1), at(2, { courseId: 'c3' }), at(3, { courseId: 'c4' })], 'road_trip'),
    ).toBe(true);
  });

  test('regular counts five rounds at one venue', () => {
    const four = [at(1), at(2), at(3), at(4)];
    expect(has(four, 'regular')).toBe(false);
    expect(has([...four, at(5)], 'regular')).toBe(true);
    // Spread across venues doesn't count.
    expect(has([at(1), at(2), at(3), at(4), at(5, { courseId: 'c3' })], 'regular')).toBe(false);
  });

  test('a single multi-player round is one round, not several', () => {
    // Every seat of a pass-and-play round lands in the same history, so career
    // rules that count ROUNDS have to collapse them. A four-player afternoon is
    // one round on one day, and four seats at one venue is not five visits.
    const day = new Date('2026-08-01T18:00:00Z').getTime();
    const foursome = round([card(3), card(3), card(3), card(3)], {
      completedAt: day,
      createdAt: day,
    });
    expect(has([foursome], 'marathon')).toBe(false);
    expect(has([foursome], 'regular')).toBe(false);
  });

  test('marathon is two full rounds in one day', () => {
    const day = new Date('2026-08-01T18:00:00Z').getTime();
    const sameDay = new Date('2026-08-01T20:00:00Z').getTime();
    const nextDay = new Date('2026-08-02T18:00:00Z').getTime();
    expect(has([at(day), at(nextDay)], 'marathon')).toBe(false);
    expect(has([at(day), at(sameDay)], 'marathon')).toBe(true);
  });

  test('course collector and grand slam need every course at one venue', () => {
    expect(has([at(1)], 'course_collector')).toBe(false);
    expect(has([at(1), at(2, { courseId: 'c2' })], 'course_collector')).toBe(true);
    // v3 has a single course, so playing it collects that venue.
    expect(has([at(1, { courseId: 'c4' })], 'course_collector')).toBe(true);

    const underPar = (t: number, courseId: string) =>
      round([card(2)], { completedAt: t, createdAt: t, courseId });
    expect(has([underPar(1, 'c1')], 'grand_slam')).toBe(false);
    expect(has([underPar(1, 'c1'), underPar(2, 'c2')], 'grand_slam')).toBe(true);
  });

  test("one player's round does not break or make another's streak", () => {
    // In pass-and-play somebody comes last every round, so the losing streak
    // has to follow a player, not the device.
    const three = [1, 2, 3].map((t) =>
      round([card(4), card(3)], { completedAt: t, createdAt: t }),
    );
    expect(has(three, 'consolation_prize')).toBe(true); // seat 0 lost all three
    // Same three rounds, but the seats swap each time: nobody lost three in a
    // row, so nobody earns it.
    const swapped = [
      round([card(4), card(3)], { completedAt: 1, createdAt: 1 }),
      round([card(3), card(4)], { completedAt: 2, createdAt: 2 }),
      round([card(4), card(3)], { completedAt: 3, createdAt: 3 }),
    ];
    expect(has(swapped, 'consolation_prize')).toBe(false);
  });

  test('personal best is measured against your own history, not the phone\'s', () => {
    // Two players on one device: P00 gets worse, P10 gets better. Only a real
    // improvement by the SAME tag counts, so comparing across seats must not
    // manufacture one.
    const a = round([card(3), card(4)], { completedAt: 1, createdAt: 1 });
    const b = round([card(4), card(3)], { completedAt: 2, createdAt: 2 });
    expect(has([a, b], 'personal_best')).toBe(true); // P10: 72 -> 54
    // P00 alone, getting steadily worse, earns nothing.
    const worse = [
      round([card(3)], { completedAt: 1, createdAt: 1 }),
      round([card(4)], { completedAt: 2, createdAt: 2 }),
    ];
    expect(has(worse, 'personal_best')).toBe(false);
  });

  test('personal best needs an improvement on the same course', () => {
    const score = (t: number, n: number, courseId = 'c1') =>
      round([card(n)], { completedAt: t, createdAt: t, courseId });
    expect(has([score(1, 3)], 'personal_best')).toBe(false);
    expect(has([score(1, 3), score(2, 4)], 'personal_best')).toBe(false); // got worse
    expect(has([score(1, 3), score(2, 2)], 'personal_best')).toBe(true);
    // A better score on a DIFFERENT course is not a personal best.
    expect(has([score(1, 3), score(2, 2, 'c2')], 'personal_best')).toBe(false);
  });

  test('nemesis needs the course to have won twice first', () => {
    const score = (t: number, n: number) => round([card(n)], { completedAt: t, createdAt: t });
    expect(has([score(1, 4), score(2, 2)], 'nemesis')).toBe(false); // beaten once
    expect(has([score(1, 4), score(2, 4), score(3, 2)], 'nemesis')).toBe(true);
    // Revenge has to come AFTER the losses.
    expect(has([score(1, 2), score(2, 4), score(3, 4)], 'nemesis')).toBe(false);
  });

  test("windmill's revenge is the same hole on the same course, twice", () => {
    const capAt = (t: number, hole: number, courseId = 'c1') =>
      round([withHoles(3, { [hole]: 6 })], { completedAt: t, createdAt: t, courseId });
    expect(has([capAt(1, 4)], 'windmills_revenge')).toBe(false);
    expect(has([capAt(1, 4), capAt(2, 5)], 'windmills_revenge')).toBe(false);
    expect(has([capAt(1, 4), capAt(2, 4, 'c2')], 'windmills_revenge')).toBe(false);
    expect(has([capAt(1, 4), capAt(2, 4)], 'windmills_revenge')).toBe(true);
    // Twice in ONE round is one round's misfortune, not a grudge.
    const twiceInOne = round([withHoles(3, { 4: 6 })], { completedAt: 1 });
    expect(has([twiceInOne], 'windmills_revenge')).toBe(false);
  });

  test('consolation prize needs three losses in a row', () => {
    const lost = (t: number) =>
      round([card(4), card(3)], { completedAt: t, createdAt: t });
    const won = (t: number) => round([card(2), card(3)], { completedAt: t, createdAt: t });
    expect(has([lost(1), lost(2)], 'consolation_prize')).toBe(false);
    expect(has([lost(1), lost(2), lost(3)], 'consolation_prize')).toBe(true);
    expect(has([lost(1), won(2), lost(3), lost(4)], 'consolation_prize')).toBe(false);
  });
});

describe('reachability', () => {
  test('reads the deployment catalog', () => {
    expect(reachContext(CATALOG)).toEqual({
      venueCount: 3,
      maxCoursesAtOneVenue: 2,
      hasParFourHole: true,
    });
  });

  test('drops badges a deployment cannot reach', () => {
    const oneVenue: CourseInfo[] = [{ id: 'c1', locationId: 'v1', pars: PARS }];
    const keys = reachableAchievements(reachContext(oneVenue)).map((a) => a.key);
    expect(keys).not.toContain('road_trip'); // needs three venues
    expect(keys).not.toContain('course_collector'); // needs a venue with two courses
    expect(keys).not.toContain('threading_it'); // no par-4 anywhere
    expect(keys).toContain('hole_in_one');
    // The full catalog is reachable on a deployment shaped like ours.
    expect(reachableAchievements(reachContext(CATALOG))).toHaveLength(ACHIEVEMENTS.length);
  });
});

describe('catalog integrity', () => {
  test('keys are unique', () => {
    const keys = ACHIEVEMENTS.map((a) => a.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('detection only ever reports badges the catalog declares local', () => {
    // A rule whose key is not a `local: true` achievement can never render — it
    // would unlock a badge the wall does not know about. Silent, so assert it.
    const detectable = new Set(ACHIEVEMENTS.filter((a) => a.local).map((a) => a.key));
    const everything = earn([
      round([card(1)]),
      round([card(2), card(3), card(3), card(3)]),
      round([card(6), card(4)]),
    ]);
    expect(everything.size).toBeGreaterThan(0);
    for (const key of everything) expect(detectable.has(key)).toBe(true);
  });

  test('the server-granted badge is never claimed locally', () => {
    // hunt_master lives in hunt_find, not the round record. Nothing on-device
    // may unlock it, however the rounds look.
    expect(earn([round([card(1)]), round([card(2), card(2)])]).has('hunt_master')).toBe(false);
  });

  test('a fresh device has earned nothing', () => {
    expect(earn([]).size).toBe(0);
  });
});
