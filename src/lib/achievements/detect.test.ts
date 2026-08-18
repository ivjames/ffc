import { describe, test, expect } from 'vitest';
import {
  detectEarned,
  playerRounds,
  reachContext,
  reachableAchievements,
  type CourseInfo,
  type VenueInfo,
} from './detect';
import { ACHIEVEMENTS } from './catalog';
import { ARCADE_GAME_KEYS } from './arcade';
import type { ActivityMark, LocalRound } from '../../types';

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

const earn = (rounds: LocalRound[]) => detectEarned(rounds, { catalog: CATALOG, venues: [] });
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

  test('host needs company, not just a lobby', () => {
    const shared = (players: number, slot: number) =>
      round(
        Array.from({ length: players }, () => card(3)),
        { shared: { gameId: 'g', participantToken: 't', slot } } as Partial<LocalRound>,
      );
    // Opening a lobby and walking away is not hosting a game.
    expect(has([shared(1, 0)], 'host')).toBe(false);
    expect(has([shared(2, 0)], 'host')).toBe(true);
    // Seat 0 is the creator; a joiner didn't host it.
    expect(has([shared(2, 1)], 'host')).toBe(false);
    // Pass-and-play isn't hosting either — nobody joined from another phone.
    expect(has([round([card(3), card(3)])], 'host')).toBe(false);
  });

  test('squad goals reads the shared round, not a join-time tally', () => {
    const shared = (players: number) =>
      round(
        Array.from({ length: players }, () => card(3)),
        { shared: { gameId: 'g', participantToken: 't', slot: 0 } } as Partial<LocalRound>,
      );
    // Every device in the game sees the finished four-seat roster, so the host
    // and the early joiners earn it too — not just whoever arrived last.
    expect(has([shared(4)], 'squad_goals')).toBe(true);
    expect(has([shared(3)], 'squad_goals')).toBe(false);
    // Pass-and-play with four players is a Party of Four, not a shared game.
    expect(has([round([card(3), card(3), card(3), card(3)])], 'squad_goals')).toBe(false);
  });

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


// ── The rest of the catalog ─────────────────────────────────────────────────

const mark = (
  kind: ActivityMark['kind'],
  name: string,
  count = 1,
  best = 0,
): ActivityMark => ({ id: `${kind}:${name}`, kind, name, count, best, firstAt: 1, lastAt: 1 });

const earnWith = (activity: ActivityMark[]) =>
  detectEarned([], { catalog: CATALOG, venues: [], activity });

describe('arcade', () => {
  test('counts distinct games, then the whole roster', () => {
    expect(earnWith([mark('game', 'bowling')]).has('arcade_rookie')).toBe(true);
    const five = ARCADE_GAME_KEYS.slice(0, 5).map((g) => mark('game', g));
    expect(earnWith(five).has('sampler')).toBe(true);
    expect(earnWith(five).has('completionist')).toBe(false);
    const all = ARCADE_GAME_KEYS.map((g) => mark('game', g));
    expect(earnWith(all).has('completionist')).toBe(true);
  });

  test('rounds played accumulate across games', () => {
    expect(earnWith([mark('game', 'bowling', 49)]).has('regular_player')).toBe(false);
    expect(
      earnWith([mark('game', 'bowling', 25), mark('game', 'darts', 25)]).has('regular_player'),
    ).toBe(true);
  });

  test('feats a game reports for itself', () => {
    expect(earnWith([mark('feat', 'ticket-ceiling')]).has('maxed_out')).toBe(true);
    expect(earnWith([mark('feat', 'trivia-perfect')]).has('trivia_buff')).toBe(true);
    expect(earnWith([mark('feat', 'pinball-million')]).has('pinball_wizard')).toBe(true);
    expect(earnWith([mark('feat', 'turkey')]).has('turkey')).toBe(true);
    expect(earnWith([mark('feat', 'bullseye')]).has('bullseye')).toBe(true);
    expect(earnWith([mark('feat', 'bell-ringer')]).has('bell_ringer')).toBe(true);
    expect(earnWith([mark('feat', 'mole-streak')]).has('mole_patrol')).toBe(true);
    expect(earnWith([mark('feat', 'gallery-perfect')]).has('sharpshooter_ii')).toBe(true);
    // Playing a game is not the same as pulling off its feat.
    expect(earnWith([mark('game', 'pinball', 5)]).has('pinball_wizard')).toBe(false);
    // The claw wants three winning rounds, not one.
    expect(earnWith([mark('feat', 'claw-win', 2)]).has('claw_champ')).toBe(false);
    expect(earnWith([mark('feat', 'claw-win', 3)]).has('claw_champ')).toBe(true);
  });
});

describe('photo booth', () => {
  test('photos counted, stickers measured at their high-water mark', () => {
    expect(earnWith([mark('booth', 'photo')]).has('say_cheese')).toBe(true);
    expect(earnWith([mark('booth', 'photo', 4)]).has('photogenic')).toBe(false);
    expect(earnWith([mark('booth', 'photo', 5)]).has('photogenic')).toBe(true);
    // Stickers are tallied under their OWN mark, which is what PhotoBooth
    // writes — reading the high-water off `booth:photo` (which only counts
    // saves) meant Sticker Bomb could never unlock.
    expect(earnWith([mark('booth', 'photo', 5, 99)]).has('sticker_bomb')).toBe(false);
    // Ten on ONE photo, not ten spread across several.
    expect(earnWith([mark('booth', 'stickers', 5, 3)]).has('sticker_bomb')).toBe(false);
    expect(earnWith([mark('booth', 'stickers', 1, 10)]).has('sticker_bomb')).toBe(true);
  });
});

describe('app state', () => {
  test('installed / signed in / carded are stated, not derived', () => {
    const none = detectEarned([], { catalog: CATALOG, venues: [] });
    expect(none.has('home_screen_hero')).toBe(false);
    expect(none.has('carded')).toBe(false);
    const all = detectEarned([], {
      catalog: CATALOG,
      venues: [],
      app: { installed: true, signedIn: true, carded: true },
    });
    expect(all.has('home_screen_hero')).toBe(true);
    expect(all.has('made_it_official')).toBe(true);
    expect(all.has('carded')).toBe(true);
  });
});

describe('the venue clock', () => {
  const VENUES: VenueInfo[] = [
    { id: 'v1', tz: 'UTC', hours: { mon: { open: '10:00', close: '22:00' } } },
  ];
  // 2026-08-03 is a Monday.
  const at = (hhmm: string) => new Date(`2026-08-03T${hhmm}:00Z`).getTime();
  const roundAt = (t: number) =>
    round([card(3)], { completedAt: t, createdAt: t, courseId: 'c1' });
  const clock = (t: number) =>
    detectEarned([roundAt(t)], { catalog: CATALOG, venues: VENUES });

  test('early bird is the first hour open; night owl the last before close', () => {
    expect(clock(at('10:30')).has('early_bird')).toBe(true);
    expect(clock(at('11:30')).has('early_bird')).toBe(false);
    expect(clock(at('21:30')).has('night_owl')).toBe(true);
    expect(clock(at('20:30')).has('night_owl')).toBe(false);
    // Closed-hours or unconfigured venues simply never award them.
    expect(detectEarned([roundAt(at('10:30'))], { catalog: CATALOG, venues: [] }).has('early_bird')).toBe(false);
  });

  test('an overnight session carries past midnight', () => {
    // Fri 20:00–02:00, Saturday closed. A round begun 01:30 Saturday belongs to
    // FRIDAY's session and is in its final hour — comparing raw clock times
    // would place it eighteen hours before opening instead of five after.
    const overnight: VenueInfo[] = [
      { id: 'v1', tz: 'UTC', hours: { fri: { open: '20:00', close: '02:00' }, sat: 'closed' } },
    ];
    const startedAt = (iso: string) => {
      const t = new Date(iso).getTime();
      return detectEarned([round([card(3)], { createdAt: t, completedAt: t, courseId: 'c1' })], {
        catalog: CATALOG,
        venues: overnight,
      });
    };
    // 2026-08-07 is a Friday.
    expect(startedAt('2026-08-07T20:30:00Z').has('early_bird')).toBe(true);
    expect(startedAt('2026-08-08T01:30:00Z').has('night_owl')).toBe(true);
    expect(startedAt('2026-08-08T01:30:00Z').has('early_bird')).toBe(false);
    // Midnight is mid-session, neither end of it.
    expect(startedAt('2026-08-08T00:15:00Z').has('night_owl')).toBe(false);
    expect(startedAt('2026-08-08T00:15:00Z').has('early_bird')).toBe(false);
    // Saturday proper is closed — nothing at all.
    expect(startedAt('2026-08-08T14:00:00Z').has('night_owl')).toBe(false);
  });

  test('they judge when the round STARTED, not when it ended', () => {
    // A round begun just after opening and played for three hours is still an
    // early one; judging it on completedAt would lose the badge and — worse —
    // hand it a Night Owl for finishing near close.
    const long = round([card(3)], {
      createdAt: at('10:30'),
      completedAt: at('21:30'),
      courseId: 'c1',
    });
    const earned = detectEarned([long], { catalog: CATALOG, venues: VENUES });
    expect(earned.has('early_bird')).toBe(true);
    expect(earned.has('night_owl')).toBe(false);
  });

  test('The Grind reads the start too', () => {
    const started9pm = round([card(3)], {
      createdAt: new Date('2026-08-03T21:30:00').getTime(),
      completedAt: new Date('2026-08-03T23:00:00').getTime(),
    });
    expect(has([started9pm], 'the_grind')).toBe(true);
    // Begun at six, finished after nine — not a late round.
    const startedEarly = round([card(3)], {
      createdAt: new Date('2026-08-03T18:00:00').getTime(),
      completedAt: new Date('2026-08-03T21:30:00').getTime(),
    });
    expect(has([startedEarly], 'the_grind')).toBe(false);
  });
});

describe('secrets', () => {
  test('exact totals and shapes', () => {
    // 18 fours is 72; five of them at five makes 77.
    const seventySeven = withHoles(4, { 0: 5, 1: 5, 2: 5, 3: 5, 4: 5 });
    const t = seventySeven.reduce((a: number, b) => a + (b ?? 0), 0);
    expect(t).toBe(77);
    expect(has([round([seventySeven])], 'lucky_sevens')).toBe(true);
    expect(has([round([card(3)])], 'lucky_sevens')).toBe(false);

    expect(has([round([card(3)])], 'flatline')).toBe(true);
    expect(has([round([withHoles(3, { 4: 2 })])], 'flatline')).toBe(false);
  });

  test('a palindrome mirrors the front nine on the back', () => {
    const front = [2, 3, 4, 3, 2, 5, 3, 3, 4];
    const mirrored = [...front, ...[...front].reverse()];
    expect(has([round([mirrored])], 'palindrome')).toBe(true);
    expect(has([round([[...front, ...front]])], 'palindrome')).toBe(false);
  });

  test('groundhog day is your own total, twice, on one course', () => {
    const score = (t: number, n: number, courseId = 'c1') =>
      round([card(n)], { completedAt: t, createdAt: t, courseId });
    expect(has([score(1, 3), score(2, 3)], 'groundhog_day')).toBe(true);
    expect(has([score(1, 3), score(2, 3, 'c2')], 'groundhog_day')).toBe(false);
    expect(has([score(1, 3), score(2, 4)], 'groundhog_day')).toBe(false);
  });
});

describe('regulars', () => {
  const on = (iso: string, over: Partial<LocalRound> = {}) => {
    const t = new Date(iso).getTime();
    return round([card(3)], { completedAt: t, createdAt: t, ...over });
  };

  test('three different days', () => {
    expect(has([on('2026-08-03T12:00'), on('2026-08-03T18:00')], 'three_peat')).toBe(false);
    expect(
      has(
        [on('2026-08-03T12:00'), on('2026-08-04T12:00'), on('2026-08-05T12:00')],
        'three_peat',
      ),
    ).toBe(true);
  });

  test('weekend warrior needs the SAME weekend', () => {
    // 2026-08-01 Sat, 2026-08-02 Sun — one weekend.
    expect(has([on('2026-08-01T12:00'), on('2026-08-02T12:00')], 'weekend_warrior')).toBe(true);
    // Sunday then the NEXT Saturday is two different weekends.
    expect(has([on('2026-08-02T12:00'), on('2026-08-08T12:00')], 'weekend_warrior')).toBe(false);
    expect(has([on('2026-08-03T12:00'), on('2026-08-04T12:00')], 'weekend_warrior')).toBe(false);
  });

  test('a hundred holes, counted once per round', () => {
    const five = [1, 2, 3, 4, 5].map((d) => on(`2026-08-0${d}T12:00`));
    expect(has(five, 'century_club')).toBe(false); // 90
    expect(has([...five, on('2026-08-06T12:00')], 'century_club')).toBe(true); // 108
    // A four-player round is still 18 holes played, not 72.
    const foursome = round([card(3), card(3), card(3), card(3)], {
      completedAt: 1,
      createdAt: 1,
    });
    expect(has(Array.from({ length: 5 }, () => foursome), 'century_club')).toBe(false);
  });

  test('anniversary is a year after the first round', () => {
    expect(has([on('2026-08-03T12:00'), on('2027-06-03T12:00')], 'anniversary')).toBe(false);
    expect(has([on('2026-08-03T12:00'), on('2027-08-04T12:00')], 'anniversary')).toBe(true);
  });

  test('rivalry follows an opponent tag, not a seat', () => {
    const vs = (t: number, theirTag: string) =>
      round([card(3), card(4)], {
        completedAt: t,
        createdAt: t,
        playerTags: ['ME1', theirTag],
      });
    expect(has([vs(1, 'YOU'), vs(2, 'YOU')], 'rivalry')).toBe(false);
    expect(has([vs(1, 'YOU'), vs(2, 'YOU'), vs(3, 'YOU')], 'rivalry')).toBe(true);
    // Three different opponents is not a rivalry.
    expect(has([vs(1, 'AAA'), vs(2, 'BBB'), vs(3, 'CCC')], 'rivalry')).toBe(false);
  });
});

describe('meta badges', () => {
  const catalogCtx = { catalog: CATALOG, venues: [] };

  test('count other badges, never each other', () => {
    const twenty = ACHIEVEMENTS.filter((a) => a.local && !['trophy_case', 'curator', 'legend'].includes(a.key))
      .slice(0, 20)
      .map((a) => a.key);
    const earned = detectEarned([], { ...catalogCtx, alreadyEarned: twenty });
    expect(earned.has('trophy_case')).toBe(true);
    expect(earned.has('legend')).toBe(false);

    // Meta badges must not count toward each other: nineteen real badges plus
    // all three meta ones is still nineteen, so Trophy Case stays locked.
    const nineteen = ACHIEVEMENTS.filter(
      (a) => a.local && !['trophy_case', 'curator', 'legend'].includes(a.key),
    )
      .slice(0, 19)
      .map((a) => a.key);
    const padded = detectEarned([], {
      ...catalogCtx,
      alreadyEarned: [...nineteen, 'curator', 'legend'],
    });
    expect(padded.has('trophy_case')).toBe(false);
  });

  test('curator completes one category', () => {
    const hunt = ACHIEVEMENTS.filter((a) => a.category === 'hunt').map((a) => a.key);
    expect(detectEarned([], { ...catalogCtx, alreadyEarned: hunt }).has('curator')).toBe(true);
    expect(detectEarned([], { ...catalogCtx, alreadyEarned: hunt.slice(0, 1) }).has('curator')).toBe(
      false,
    );
  });

  test('already-earned badges are carried forward, never dropped', () => {
    // The wall unions stored badges with freshly derived ones: a badge whose
    // proving round has been cleared must survive.
    const earned = detectEarned([], { ...catalogCtx, alreadyEarned: ['hole_in_one'] });
    expect(earned.has('hole_in_one')).toBe(true);
  });
});
