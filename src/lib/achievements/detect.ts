import type { ActivityMark, LocalRound } from '../../types';
import { COURSES, LOCATIONS } from '../../data/courses';
import { STROKE_CAP } from '../scoring';
import { venueDayWindow, type VenueHours } from '../venueHours';
import { ARCADE_GAME_COUNT } from './arcade';
import {
  ACHIEVEMENTS,
  CATEGORY_ORDER,
  type Achievement,
  type ReachContext,
} from './catalog';

// On-device achievement detection. Every rule here reads only completed rounds
// in IndexedDB, so the wall works with no account and no network — the same
// offline-first stance the rest of the round record takes.
//
// ── Whose achievements are these? ───────────────────────────────────────────
//
// The wall is per-device, and what "this device played" means depends on how
// the round was played:
//
//   pass-and-play  one phone, one group, everyone's scores typed on it — the
//                  device IS the group, so every slot counts.
//   shared game    each player is on their own phone with their own wall, and
//                  every device fetches the same roster — so only this device's
//                  own slot counts, or one player's ace would unlock the badge
//                  on all four phones.
//
// This mirrors the rule the old ticket-claim path used for exactly the same
// reason (it stopped one reward paying onto four cards); the payout is gone,
// but the question of whose round it was did not go with it.
//
// ── What is deliberately NOT here ───────────────────────────────────────────
//
// Earned state is RE-DERIVED on every visit rather than stored. That is the
// existing behaviour and it keeps a badge honest — it can never claim a round
// the device no longer has — but it also means clearing site data silently
// empties the wall. Persisting an earned-set (and syncing it to the account for
// signed-in players, so the wall follows them across devices) is the next piece
// of work; see ACHIEVEMENTS-BRAINSTORM.md.

/** One player's card inside one completed round — the unit every rule reads. */
export type PlayerRound = {
  roundId: string;
  courseId: string;
  locationId: string | null;
  pars: number[];
  /** This player's card. */
  strokes: (number | null)[];
  /** Every slot's card, this one included — the multi-player rules need it. */
  field: (number | null)[][];
  /** Every slot's tag, positionally aligned with `field`. */
  fieldTags: string[];
  /** True for a shared multi-device game (as opposed to pass-and-play). */
  isShared: boolean;
  slot: number;
  /**
   * The 3-char player tag. Tags repeat by design, so this is a weak identity —
   * but across ONE device's history it is the only handle on "the same person
   * again", and the career streaks below need one (see CAREER_RULES).
   */
  tag: string;
  /** When the round was STARTED — what the time-of-day badges are about. */
  createdAt: number;
  completedAt: number;
};

/**
 * The slice of the venue catalog these rules need. Passed in rather than read
 * off the COURSES global because that global boots EMPTY and is filled by the
 * first /api/content hydrate (see data/courses.ts) — a rule that closed over it
 * at import time would silently judge every round against no course at all.
 * Defaulting to the live catalog keeps call sites simple; naming it as a
 * parameter keeps every rule a pure function of its inputs.
 */
export type CourseInfo = { id: string; locationId: string | null; pars: number[] };

export function liveCatalog(): CourseInfo[] {
  return COURSES.map((c) => ({ id: c.id, locationId: c.locationId ?? null, pars: c.pars }));
}

/** A venue's clock, for the rules that care when a round started. */
export type VenueInfo = { id: string; tz: string | null; hours: VenueHours | null };

export function liveVenues(): VenueInfo[] {
  return LOCATIONS.map((l) => ({ id: l.id, tz: l.tz ?? null, hours: l.hours ?? null }));
}

/**
 * Everything the rules read besides the rounds themselves.
 * All optional: a caller with only rounds still gets every round-shaped badge.
 */
export type DetectContext = {
  catalog?: CourseInfo[];
  venues?: VenueInfo[];
  /** Device-local tallies for things rounds can't see (db.getActivity). */
  activity?: ActivityMark[];
  /** App state that is true-or-not rather than counted. */
  app?: { installed?: boolean; signedIn?: boolean; carded?: boolean };
  /** Badges already banked, so the meta rules can count them. */
  alreadyEarned?: Iterable<string>;
};

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const entered = (s: (number | null)[]) => s.filter((n): n is number => n != null);
const total = (s: (number | null)[]) => sum(entered(s));
const isFull = (s: (number | null)[], pars: number[]) => entered(s).length === pars.length;
const coursePar = (pars: number[]) => sum(pars);

/** Aces in this card. */
const aces = (s: (number | null)[]) => entered(s).filter((n) => n === 1).length;

/**
 * Flatten stored rounds into the per-player cards this device owns.
 * Rounds that are unfinished, or on a course this build doesn't know (so par is
 * unknowable), are skipped rather than guessed at.
 */
export function playerRounds(
  rounds: LocalRound[],
  catalog: CourseInfo[] = liveCatalog(),
): PlayerRound[] {
  const byId = new Map(catalog.map((c) => [c.id, c]));
  const out: PlayerRound[] = [];
  for (const r of rounds) {
    if (r.completedAt == null) continue;
    const course = byId.get(r.courseId);
    if (!course) continue;
    const slots = r.playerTags.map((_, i) => i);
    const field = slots.map((i) => r.scores[i] ?? []);
    const fieldTags = slots.map((i) => r.playerTags[i] ?? '');
    // Shared game: this device speaks only for its own seat (see the header).
    const owned = r.shared ? [r.shared.slot] : slots;
    for (const slot of owned) {
      const strokes = r.scores[slot];
      if (!strokes) continue;
      out.push({
        roundId: r.clientId,
        courseId: r.courseId,
        locationId: course.locationId,
        pars: course.pars,
        strokes,
        field,
        fieldTags,
        isShared: r.shared != null,
        slot,
        tag: r.playerTags[slot] ?? '',
        createdAt: r.createdAt,
        completedAt: r.completedAt,
      });
    }
  }
  return out.sort((a, b) => a.completedAt - b.completedAt);
}

// ── Multi-player helpers ────────────────────────────────────────────────────

/** Totals through hole index `upto`, or null if anyone has a gap that far. */
function runningTotals(field: (number | null)[][], upto: number): number[] | null {
  const totals: number[] = [];
  for (const card of field) {
    let t = 0;
    for (let h = 0; h <= upto; h++) {
      const v = card[h];
      if (v == null) return null;
      t += v;
    }
    totals.push(t);
  }
  return totals;
}

/** The index holding an OUTRIGHT lead (lowest, alone), or null if tied. */
function soleLeader(totals: number[]): number | null {
  let best = Infinity;
  let who = -1;
  let ties = 0;
  totals.forEach((t, i) => {
    if (t < best) {
      best = t;
      who = i;
      ties = 1;
    } else if (t === best) ties++;
  });
  return ties === 1 ? who : null;
}

const isMultiplayer = (r: PlayerRound) => r.field.length >= 2;
const allFull = (r: PlayerRound) => r.field.every((c) => isFull(c, r.pars));
/** Final totals when every player carded out, else null. */
const finalTotals = (r: PlayerRound) => (allFull(r) ? runningTotals(r.field, r.pars.length - 1) : null);

// ── Per-round rules ─────────────────────────────────────────────────────────
// Each answers "did THIS card, in THIS round, earn the badge?".

const ROUND_RULES: Record<string, (r: PlayerRound) => boolean> = {
  hole_in_one: (r) => aces(r.strokes) >= 1,
  double_ace: (r) => aces(r.strokes) >= 2,
  triple_ace: (r) => aces(r.strokes) >= 3,
  hot_start: (r) => r.strokes[0] === 1,
  closer: (r) => r.strokes[r.pars.length - 1] === 1,
  halfway_hero: (r) => r.strokes[8] === 1,
  bookends: (r) => r.strokes[0] === 1 && r.strokes[r.pars.length - 1] === 1,

  birdie: (r) => r.pars.some((p, i) => r.strokes[i] != null && r.strokes[i]! < p),
  birdie_streak: (r) => {
    let run = 0;
    for (let i = 0; i < r.pars.length; i++) {
      const s = r.strokes[i];
      if (s != null && s < r.pars[i]) {
        if (++run >= 3) return true;
      } else run = 0;
    }
    return false;
  },
  perfect_nine: (r) => {
    let run = 0;
    for (let i = 0; i < r.pars.length; i++) {
      const s = r.strokes[i];
      if (s != null && s <= r.pars[i]) {
        if (++run >= 9) return true;
      } else run = 0;
    }
    return false;
  },
  threading_it: (r) => {
    const fours = r.pars.map((p, i) => [p, i] as const).filter(([p]) => p === 4);
    if (fours.length === 0) return false;
    return fours.every(([p, i]) => r.strokes[i] != null && r.strokes[i]! < p);
  },

  under_par: (r) => isFull(r.strokes, r.pars) && total(r.strokes) < coursePar(r.pars),
  even_steven: (r) => isFull(r.strokes, r.pars) && total(r.strokes) === coursePar(r.pars),
  so_close: (r) => isFull(r.strokes, r.pars) && total(r.strokes) - coursePar(r.pars) === 1,
  deep_red: (r) => isFull(r.strokes, r.pars) && coursePar(r.pars) - total(r.strokes) >= 10,
  the_long_way: (r) => isFull(r.strokes, r.pars) && total(r.strokes) - coursePar(r.pars) >= 20,
  bogey_free: (r) =>
    isFull(r.strokes, r.pars) && r.pars.every((p, i) => r.strokes[i]! <= p),
  par_machine: (r) => isFull(r.strokes, r.pars) && r.pars.every((p, i) => r.strokes[i] === p),
  metronome: (r) =>
    isFull(r.strokes, r.pars) && r.pars.every((p, i) => Math.abs(r.strokes[i]! - p) <= 1),
  survivor: (r) =>
    isFull(r.strokes, r.pars) &&
    total(r.strokes) < coursePar(r.pars) &&
    entered(r.strokes).some((s) => s >= STROKE_CAP),

  front_nine: (r) => nineUnderPar(r, 0),
  back_nine: (r) => nineUnderPar(r, 9),
  comeback: (r) => {
    const front = nineSplit(r, 0);
    const back = nineSplit(r, 9);
    if (!front || !back) return false;
    return front.strokes - front.par >= 3 && back.strokes < back.par;
  },

  capped_out: (r) => entered(r.strokes).filter((s) => s >= STROKE_CAP).length >= 5,
  rock_bottom: (r) =>
    isFull(r.strokes, r.pars) && entered(r.strokes).every((s) => s >= STROKE_CAP),
  escape_artist: (r) =>
    r.pars.some((_, i) => r.strokes[i] != null && r.strokes[i]! >= STROKE_CAP && r.strokes[i + 1] === 1),
  rally_killer: (r) =>
    r.pars.some(
      (_, i) => r.strokes[i] === 1 && r.strokes[i + 1] != null && r.strokes[i + 1]! >= STROKE_CAP,
    ),

  // ── The field ─────────────────────────────────────────────────────────────
  party_of_four: (r) => r.field.length === 4 && allFull(r),
  // Read off the shared round itself, not off a join-time tally: the host and
  // the early joiners see a half-empty roster when they arrive, so only the
  // last person through the door would ever have recorded four.
  squad_goals: (r) => r.isShared && r.field.length === 4,
  // Seat 0 is the creator. Judged on the finished round rather than on the act
  // of creating one, because the badge is "other phones join" — opening a lobby
  // and walking away is not hosting a game.
  host: (r) => r.isShared && r.slot === 0 && r.field.length >= 2,
  full_house: (r) =>
    r.field.length === 4 &&
    allFull(r) &&
    r.field.every((c) => total(c) < coursePar(r.pars)),
  photo_finish: (r) => {
    const totals = finalTotals(r);
    if (!totals || !isMultiplayer(r) || soleLeader(totals) !== r.slot) return false;
    const others = totals.filter((_, i) => i !== r.slot);
    return Math.min(...others) - totals[r.slot] === 1;
  },
  ringer: (r) => {
    const totals = finalTotals(r);
    if (!totals || r.field.length !== 4 || soleLeader(totals) !== r.slot) return false;
    const others = totals.filter((_, i) => i !== r.slot);
    return Math.min(...others) - totals[r.slot] >= 10;
  },
  dead_heat: (r) => {
    const totals = finalTotals(r);
    if (!totals || !isMultiplayer(r)) return false;
    const best = Math.min(...totals);
    return totals[r.slot] === best && totals.filter((t) => t === best).length >= 2;
  },
  good_sport: (r) => {
    const totals = finalTotals(r);
    if (!totals || !isMultiplayer(r)) return false;
    const worst = Math.max(...totals);
    return totals[r.slot] === worst && totals.filter((t) => t === worst).length === 1;
  },
  clean_sweep: (r) => {
    if (!isMultiplayer(r) || !allFull(r)) return false;
    return r.pars.every((_, h) =>
      r.field.every((card, i) => i === r.slot || card[h]! > r.strokes[h]!),
    );
  },
  photo_bomb: (r) =>
    isMultiplayer(r) &&
    r.pars.some(
      (p, h) =>
        r.strokes[h] === 1 &&
        r.field.every((card, i) => i === r.slot || (card[h] != null && card[h]! > p)),
    ),
  wire_to_wire: (r) => {
    if (!isMultiplayer(r) || !allFull(r)) return false;
    return r.pars.every((_, h) => {
      const totals = runningTotals(r.field, h);
      return totals != null && soleLeader(totals) === r.slot;
    });
  },
  underdog: (r) => {
    const totals = finalTotals(r);
    if (!totals || !isMultiplayer(r) || soleLeader(totals) !== r.slot) return false;
    // Never held the outright lead at any point before the final hole.
    for (let h = 0; h < r.pars.length - 1; h++) {
      const running = runningTotals(r.field, h);
      if (running && soleLeader(running) === r.slot) return false;
    }
    return true;
  },
  come_from_behind: (r) => {
    const totals = finalTotals(r);
    if (!totals || !isMultiplayer(r) || soleLeader(totals) !== r.slot) return false;
    const penultimate = runningTotals(r.field, r.pars.length - 2);
    // Strictly behind the best score with one hole to play.
    return penultimate != null && penultimate[r.slot] > Math.min(...penultimate);
  },
};

// Round rules that additionally need the venue's clock. The window arrives as
// minutes-since-open plus the session's length, so an overnight session that
// straddles midnight is just a longer session (see venueHours.venueDayWindow).
const CLOCK_RULES: Record<string, (r: PlayerRound, w: { sinceOpen: number; length: number }) => boolean> = {
  early_bird: (_r, w) => w.sinceOpen < 60,
  night_owl: (_r, w) => w.sinceOpen >= w.length - 60,
};

/** Strokes-and-par for one nine, or null if it isn't fully carded. */
function nineSplit(r: PlayerRound, start: number): { strokes: number; par: number } | null {
  const holes = r.pars.slice(start, start + 9).map((p, i) => [p, start + i] as const);
  if (holes.length < 9) return null;
  if (holes.some(([, i]) => r.strokes[i] == null)) return null;
  return {
    strokes: sum(holes.map(([, i]) => r.strokes[i]!)),
    par: sum(holes.map(([p]) => p)),
  };
}
function nineUnderPar(r: PlayerRound, start: number): boolean {
  const nine = nineSplit(r, start);
  return nine != null && nine.strokes < nine.par;
}

// ── Career rules ────────────────────────────────────────────────────────────
// These read the whole history at once. `rs` arrives sorted oldest-first, and
// carries one entry PER SEAT — which is the trap these rules have to dodge.
//
// A pass-and-play round contributes every seat, so a naive scan over `rs` sees
// a four-player round as four rounds: "two rounds in a day" would fire on one
// afternoon foursome, and one player's win would break another's losing streak.
// So each rule below declares its unit:
//
//   byRound   device-scoped — "this device played five times at that venue".
//             Seats collapse; the round is counted once.
//   byTag     person-scoped — "you beat your own best". Continuity across
//             rounds matters, so entries are grouped by player tag.

/** One entry per round, keeping the seats that belong to it. */
function byRound(rs: PlayerRound[]): { round: PlayerRound; seats: PlayerRound[] }[] {
  const map = new Map<string, PlayerRound[]>();
  for (const r of rs) {
    const list = map.get(r.roundId) ?? [];
    list.push(r);
    map.set(r.roundId, list);
  }
  return [...map.values()]
    .map((seats) => ({ round: seats[0], seats }))
    .sort((a, b) => a.round.completedAt - b.round.completedAt);
}

/** Seats grouped by player tag, each list oldest-first. */
function byTag(rs: PlayerRound[]): PlayerRound[][] {
  const map = new Map<string, PlayerRound[]>();
  for (const r of rs) {
    const list = map.get(r.tag) ?? [];
    list.push(r);
    map.set(r.tag, list);
  }
  return [...map.values()];
}

const CAREER_RULES: Record<string, (rs: PlayerRound[], catalog: CourseInfo[]) => boolean> = {
  // The starter badge: the first course you finish is, by definition, one you
  // had never played.
  new_ground: (rs) => rs.length >= 1,

  road_trip: (rs) => new Set(rs.map((r) => r.locationId).filter(Boolean)).size >= 3,

  regular: (rs) => {
    const byVenue = new Map<string, number>();
    for (const { round } of byRound(rs)) {
      if (!round.locationId) continue;
      byVenue.set(round.locationId, (byVenue.get(round.locationId) ?? 0) + 1);
    }
    return [...byVenue.values()].some((n) => n >= 5);
  },

  marathon: (rs) => {
    const days = new Map<string, number>();
    for (const { round, seats } of byRound(rs)) {
      if (!seats.some((s) => isFull(s.strokes, s.pars))) continue;
      const day = new Date(round.completedAt).toDateString();
      days.set(day, (days.get(day) ?? 0) + 1);
    }
    return [...days.values()].some((n) => n >= 2);
  },

  course_collector: (rs, catalog) => {
    const played = new Set(rs.map((r) => r.courseId));
    return venuesWithCourses(catalog).some(
      (v) => v.courseIds.length > 0 && v.courseIds.every((id) => played.has(id)),
    );
  },

  grand_slam: (rs, catalog) => {
    const beaten = new Set(rs.filter((r) => ROUND_RULES.under_par(r)).map((r) => r.courseId));
    return venuesWithCourses(catalog).some(
      (v) => v.courseIds.length > 0 && v.courseIds.every((id) => beaten.has(id)),
    );
  },

  // Person-scoped: beating the stranger who used this phone last week is not a
  // personal best.
  personal_best: (rs) =>
    byTag(rs).some((seats) => {
      const best = new Map<string, number>();
      for (const r of seats) {
        if (!isFull(r.strokes, r.pars)) continue;
        const t = total(r.strokes);
        const prior = best.get(r.courseId);
        if (prior != null && t < prior) return true;
        if (prior == null || t < prior) best.set(r.courseId, t);
      }
      return false;
    }),

  // A course has to have beaten YOU at least twice before beating it back
  // counts as revenge.
  nemesis: (rs) =>
    byTag(rs).some((seats) => {
      const overPar = new Map<string, number>();
      for (const r of seats) {
        if (!isFull(r.strokes, r.pars)) continue;
        const diff = total(r.strokes) - coursePar(r.pars);
        const losses = overPar.get(r.courseId) ?? 0;
        if (diff < 0 && losses >= 2) return true;
        if (diff > 0) overPar.set(r.courseId, losses + 1);
      }
      return false;
    }),

  // Device-scoped, and counted once per round: capping the same hole twice in
  // ONE round is a bad afternoon, not a grudge.
  windmills_revenge: (rs) => {
    const seen = new Set<string>();
    for (const { seats } of byRound(rs)) {
      const thisRound = new Set<string>();
      for (const r of seats) {
        r.pars.forEach((_, h) => {
          if (r.strokes[h] != null && r.strokes[h]! >= STROKE_CAP) {
            thisRound.add(`${r.courseId}:${h}`);
          }
        });
      }
      for (const k of thisRound) {
        if (seen.has(k)) return true;
        seen.add(k);
      }
    }
    return false;
  },

  three_peat: (rs) =>
    new Set(byRound(rs).map(({ round }) => new Date(round.completedAt).toDateString())).size >= 3,

  weekend_warrior: (rs) => {
    // Saturday and Sunday of the SAME weekend — a Sunday and the following
    // Saturday are two different weekends and shouldn't count.
    const weekends = new Map<string, Set<number>>();
    for (const { round } of byRound(rs)) {
      const d = new Date(round.completedAt);
      const day = d.getDay(); // 0 Sun … 6 Sat
      if (day !== 0 && day !== 6) continue;
      // Key both days onto the Saturday that opens their weekend.
      const saturday = new Date(d);
      saturday.setDate(d.getDate() - (day === 0 ? 1 : 0));
      const key = saturday.toDateString();
      const days = weekends.get(key) ?? new Set<number>();
      days.add(day);
      weekends.set(key, days);
    }
    return [...weekends.values()].some((days) => days.size === 2);
  },

  century_club: (rs) =>
    byRound(rs).reduce(
      (holes, { seats }) =>
        holes + Math.max(...seats.map((s) => s.strokes.filter((v) => v != null).length), 0),
      0,
    ) >= 100,

  anniversary: (rs) => {
    const rounds = byRound(rs);
    if (rounds.length === 0) return false;
    const first = rounds[0].round.completedAt;
    const aYear = new Date(first);
    aYear.setFullYear(aYear.getFullYear() + 1);
    return rounds.some(({ round }) => round.completedAt >= aYear.getTime());
  },

  // Person-scoped: your OWN total repeating on a course is the joke.
  groundhog_day: (rs) =>
    byTag(rs).some((seats) => {
      const seen = new Set<string>();
      for (const r of seats) {
        if (!isFull(r.strokes, r.pars)) continue;
        const key = `${r.courseId}:${total(r.strokes)}`;
        if (seen.has(key)) return true;
        seen.add(key);
      }
      return false;
    }),

  // Three rounds sharing an opponent — counted per (me, them) TAG pair, so one
  // regular partner across three nights earns it and three strangers do not.
  // Slot position can't stand in for identity: seat 1 is a different person
  // every round.
  rivalry: (rs) => {
    const pairs = new Map<string, number>();
    for (const { seats } of byRound(rs)) {
      const seenThisRound = new Set<string>();
      for (const me of seats) {
        // Everyone else at the round is an opponent — including the other seats
        // of a pass-and-play game, which this device also owns.
        me.fieldTags.forEach((theirs, i) => {
          if (i === me.slot || !theirs || !me.tag) return;
          const key = `${me.tag}|${theirs}`;
          if (seenThisRound.has(key)) return; // one round counts once per pair
          seenThisRound.add(key);
          pairs.set(key, (pairs.get(key) ?? 0) + 1);
        });
      }
    }
    return [...pairs.values()].some((n) => n >= 3);
  },

  // Person-scoped: a streak belongs to whoever kept losing, and in
  // pass-and-play somebody comes last every single round.
  consolation_prize: (rs) =>
    byTag(rs).some((seats) => {
      let streak = 0;
      for (const r of seats) {
        if (!isMultiplayer(r) || !allFull(r)) continue;
        if (ROUND_RULES.good_sport(r)) {
          if (++streak >= 3) return true;
        } else streak = 0;
      }
      return false;
    }),
};

/** Courses grouped by the venue that owns them, from the live catalog. */
function venuesWithCourses(catalog: CourseInfo[]): { locationId: string; courseIds: string[] }[] {
  const byVenue = new Map<string, string[]>();
  for (const c of catalog) {
    if (!c.locationId) continue;
    const list = byVenue.get(c.locationId) ?? [];
    list.push(c.id);
    byVenue.set(c.locationId, list);
  }
  return [...byVenue].map(([locationId, courseIds]) => ({ locationId, courseIds }));
}

/** What this deployment's catalog can support — drives `Achievement.reach`. */
export function reachContext(catalog: CourseInfo[] = liveCatalog()): ReachContext {
  const venues = venuesWithCourses(catalog);
  return {
    venueCount: new Set(catalog.map((c) => c.locationId).filter(Boolean)).size,
    maxCoursesAtOneVenue: venues.reduce((m, v) => Math.max(m, v.courseIds.length), 0),
    hasParFourHole: catalog.some((c) => c.pars.includes(4)),
  };
}

/** The badges worth showing here — see the reachability note in catalog.ts. */
export function reachableAchievements(ctx = reachContext()): Achievement[] {
  return ACHIEVEMENTS.filter((a) => a.reach == null || a.reach(ctx));
}

// ── Secret round rules ──────────────────────────────────────────────────────

const SECRET_RULES: Record<string, (r: PlayerRound) => boolean> = {
  lucky_sevens: (r) => isFull(r.strokes, r.pars) && total(r.strokes) === 77,
  flatline: (r) => {
    if (!isFull(r.strokes, r.pars)) return false;
    const first = r.strokes[0];
    return r.strokes.every((s) => s === first);
  },
  palindrome: (r) => {
    if (!isFull(r.strokes, r.pars)) return false;
    const front = r.strokes.slice(0, 9);
    const back = r.strokes.slice(9, 18);
    return front.every((s, i) => s === back[8 - i]);
  },
  // Device-local wall clock, not the venue's: this is about the player's night,
  // and a round can be started before the app knows which venue it's at. Keyed
  // on the START — a round begun at eight and finished at ten isn't a late one.
  the_grind: (r) => new Date(r.createdAt).getHours() >= 21,
};

// ── Activity rules ──────────────────────────────────────────────────────────
// Read the device-local marks (db.markActivity) for things no round records.

type Marks = {
  count: (kind: ActivityMark['kind'], name: string) => number;
  best: (kind: ActivityMark['kind'], name: string) => number;
  distinct: (kind: ActivityMark['kind']) => number;
  totalOf: (kind: ActivityMark['kind']) => number;
};

function marksOf(activity: ActivityMark[]): Marks {
  const byId = new Map(activity.map((a) => [a.id, a]));
  return {
    count: (kind, name) => byId.get(`${kind}:${name}`)?.count ?? 0,
    best: (kind, name) => byId.get(`${kind}:${name}`)?.best ?? 0,
    distinct: (kind) => activity.filter((a) => a.kind === kind && a.count > 0).length,
    totalOf: (kind) =>
      activity.filter((a) => a.kind === kind).reduce((n, a) => n + a.count, 0),
  };
}

const ACTIVITY_RULES: Record<string, (m: Marks) => boolean> = {
  // Arcade
  arcade_rookie: (m) => m.distinct('game') >= 1,
  sampler: (m) => m.distinct('game') >= 5,
  completionist: (m) => m.distinct('game') >= ARCADE_GAME_COUNT,
  regular_player: (m) => m.totalOf('game') >= 50,
  big_payout: (m) => m.count('feat', 'ticket-ceiling') >= 1,
  trivia_buff: (m) => m.count('feat', 'trivia-perfect') >= 1,
  pinball_wizard: (m) => m.count('feat', 'pinball-million') >= 1,
  turkey: (m) => m.count('feat', 'turkey') >= 1,
  bullseye: (m) => m.count('feat', 'bullseye') >= 1,
  bell_ringer: (m) => m.count('feat', 'bell-ringer') >= 1,
  mole_patrol: (m) => m.count('feat', 'mole-streak') >= 1,
  sharpshooter_ii: (m) => m.count('feat', 'gallery-perfect') >= 1,
  // Three winning ROUNDS, not three prizes in one lucky round.
  claw_champ: (m) => m.count('feat', 'claw-win') >= 3,

  // Photo booth
  say_cheese: (m) => m.count('booth', 'photo') >= 1,
  photogenic: (m) => m.count('booth', 'photo') >= 5,
  sticker_bomb: (m) => m.best('booth', 'stickers') >= 10,
  framed: (m) => m.count('booth', 'frame') >= 1,
  directors_cut: (m) => m.count('booth', 'reedit') >= 1,

  // Playing together
  joiner: (m) => m.count('social', 'join') >= 1,

  // Regulars
  refueled: (m) => m.count('food', 'order') >= 1,
  turn_snack: (m) => m.count('food', 'mid-round') >= 1,
};

// ── Meta rules ──────────────────────────────────────────────────────────────
// Counted over the badges themselves, so they run LAST, after everything else
// has been resolved. They never count each other — a wall of nothing but meta
// badges would be a strange thing to be proud of.

const META_KEYS = new Set(['trophy_case', 'curator', 'legend']);

function metaEarned(earned: Set<string>, reachable: Achievement[]): string[] {
  const others = reachable.filter((a) => !META_KEYS.has(a.key));
  const got = others.filter((a) => earned.has(a.key)).length;
  const out: string[] = [];
  if (got >= 20) out.push('trophy_case');
  if (got === others.length && others.length > 0) out.push('legend');
  const complete = CATEGORY_ORDER.some((cat) => {
    const inCat = others.filter((a) => a.category === cat);
    return inCat.length > 0 && inCat.every((a) => earned.has(a.key));
  });
  if (complete) out.push('curator');
  return out;
}

/** Every locally-detectable badge this device's history has earned. */
export function detectEarned(rounds: LocalRound[], ctx: DetectContext = {}): Set<string> {
  const catalog = ctx.catalog ?? liveCatalog();
  const venues = ctx.venues ?? liveVenues();
  const cards = playerRounds(rounds, catalog);
  const earned = new Set<string>(ctx.alreadyEarned ?? []);

  for (const [key, rule] of Object.entries(ROUND_RULES)) {
    if (cards.some((c) => rule(c))) earned.add(key);
  }
  for (const [key, rule] of Object.entries(SECRET_RULES)) {
    if (cards.some((c) => rule(c))) earned.add(key);
  }
  for (const [key, rule] of Object.entries(CAREER_RULES)) {
    if (rule(cards, catalog)) earned.add(key);
  }

  // Clock rules need the venue that owns the course, and its configured hours.
  const venueById = new Map(venues.map((v) => [v.id, v]));
  for (const [key, rule] of Object.entries(CLOCK_RULES)) {
    const hit = cards.some((c) => {
      const venue = c.locationId ? venueById.get(c.locationId) : undefined;
      if (!venue) return false;
      // The badges say "start a round", so they judge createdAt: a round begun
      // just after opening still counts however long it ran, and one begun in
      // the afternoon doesn't become a Night Owl by finishing late.
      const window = venueDayWindow(venue.hours, venue.tz, new Date(c.createdAt));
      return window != null && rule(c, window);
    });
    if (hit) earned.add(key);
  }

  const marks = marksOf(ctx.activity ?? []);
  for (const [key, rule] of Object.entries(ACTIVITY_RULES)) {
    if (rule(marks)) earned.add(key);
  }

  if (ctx.app?.installed) earned.add('home_screen_hero');
  if (ctx.app?.signedIn) earned.add('made_it_official');
  if (ctx.app?.carded) earned.add('carded');

  for (const key of metaEarned(earned, reachableAchievements(reachContext(catalog)))) {
    earned.add(key);
  }
  return earned;
}
