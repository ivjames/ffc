import type { DrawnIcon } from '../../ui/icons/registry';

// The achievement catalog — the single definition of every badge the app can
// show. ACHIEVEMENTS-BRAINSTORM.md is where these were chosen and argued;
// this is the shipped subset.
//
// Achievements PAY NOTHING (see server/lib/rewards.js). They are a collection
// layer, so the catalog is a product decision, not a venue-economics one, and
// nothing here needs server agreement to change.
//
// ── The naming rule ─────────────────────────────────────────────────────────
//
// No badge names a course, a venue, or a theme. The app is white-label: one
// client owns several venues with their own courses, and the next client's are
// different, so a "Dragon Slayer" badge is dead weight wherever there is no
// Dragon's Hollow, with no sensible fallback text. A badge may describe what a
// player DID, never where they did it. The generic form also scales — "beat
// your own best on that course" needs no editing when a venue re-themes a
// course or opens a new one.
//
// ── Reachability ────────────────────────────────────────────────────────────
//
// The naming rule keeps venue *names* out; `reach` handles venue *shape*. A
// single-venue deployment can never earn Road Trip, and showing it permanently
// grey reads as broken rather than aspirational — so a badge whose predicate
// fails is omitted from the wall and from its "n of m" count. Evaluated
// against the deployment's own catalog, so nobody edits this file per client.

export type AchievementCategory = 'scoring' | 'drama' | 'wipeouts' | 'courses' | 'hunt';

/** What a deployment's catalog looks like, for `reach` (see lib/achievements). */
export type ReachContext = {
  venueCount: number;
  /** Most courses any single venue has — 1 means "collect them all" is trivial. */
  maxCoursesAtOneVenue: number;
  hasParFourHole: boolean;
};

export type Achievement = {
  key: string;
  label: string;
  /** One line telling the player how to earn it. Shown under the label. */
  how: string;
  icon: DrawnIcon;
  category: AchievementCategory;
  /**
   * Detected on-device from stored rounds. `false` means the server is the only
   * place it can be known (the hunt lives in hunt_find, not the round record),
   * so the wall shows it as earnable rather than auto-unlocking it.
   */
  local: boolean;
  /** Hidden behind "???" until earned — discovery is half the point. */
  secret?: boolean;
  /** Omit the badge entirely where a deployment can't reach it. */
  reach?: (ctx: ReachContext) => boolean;
};

export const CATEGORY_LABELS: Record<AchievementCategory, string> = {
  scoring: 'Scoring',
  drama: 'The field',
  wipeouts: 'Wipeouts',
  courses: 'Courses & venues',
  hunt: 'Scavenger hunt',
};

/** Render order for the wall — best-known first, humour before the long tail. */
export const CATEGORY_ORDER: AchievementCategory[] = [
  'scoring',
  'drama',
  'courses',
  'hunt',
  'wipeouts',
];

export const ACHIEVEMENTS: Achievement[] = [
  // ── Scoring & skill ───────────────────────────────────────────────────────
  { key: 'hole_in_one', label: 'Hole-in-One', how: 'Sink any hole in a single stroke.', icon: 'award.hole-in-one', category: 'scoring', local: true },
  { key: 'under_par', label: 'Under Par', how: 'Finish a full round below the course par.', icon: 'award.under-par', category: 'scoring', local: true },
  { key: 'double_ace', label: 'Double Trouble', how: 'Two hole-in-ones in one round.', icon: 'score.hole-in-one', category: 'scoring', local: true },
  { key: 'triple_ace', label: 'Ace Triple', how: 'Three hole-in-ones in one round.', icon: 'state.celebrate', category: 'scoring', local: true },
  { key: 'birdie', label: 'Birdie', how: 'Beat par on any single hole.', icon: 'score.birdie', category: 'scoring', local: true },
  { key: 'birdie_streak', label: 'On a Roll', how: 'Beat par on three holes in a row.', icon: 'score.eagle', category: 'scoring', local: true },
  { key: 'bogey_free', label: 'Bogey-Free', how: 'Play a full round without going over par on any hole.', icon: 'state.done', category: 'scoring', local: true },
  { key: 'even_steven', label: 'Even Steven', how: 'Finish a full round exactly at course par.', icon: 'score.par', category: 'scoring', local: true },
  { key: 'par_machine', label: 'Par Machine', how: 'Score exactly par on all 18 holes.', icon: 'score.par', category: 'scoring', local: true },
  { key: 'metronome', label: 'Metronome', how: 'Finish a round with every hole within one stroke of par.', icon: 'state.timer', category: 'scoring', local: true },
  { key: 'front_nine', label: 'Front Nine Fire', how: 'Play holes 1–9 under par.', icon: 'score.birdie', category: 'scoring', local: true },
  { key: 'back_nine', label: 'Back Nine Boss', how: 'Play holes 10–18 under par.', icon: 'score.birdie', category: 'scoring', local: true },
  { key: 'comeback', label: 'Comeback Kid', how: 'Turn three or more over par, then play the back nine under par.', icon: 'state.win', category: 'scoring', local: true },
  { key: 'hot_start', label: 'Hot Start', how: 'Ace the first hole.', icon: 'score.hole-in-one', category: 'scoring', local: true },
  { key: 'closer', label: 'The Closer', how: 'Ace the last hole.', icon: 'state.finish', category: 'scoring', local: true },
  { key: 'halfway_hero', label: 'Halfway Hero', how: 'Ace the ninth hole.', icon: 'score.hole-in-one', category: 'scoring', local: true },
  { key: 'bookends', label: 'Bookends', how: 'Ace both the first and the last hole of one round.', icon: 'award.hole-in-one', category: 'scoring', local: true },
  { key: 'escape_artist', label: 'Escape Artist', how: 'Max out a hole, then ace the next one.', icon: 'state.celebrate', category: 'scoring', local: true },
  { key: 'survivor', label: 'Survivor', how: 'Max out a hole and still finish the round under par.', icon: 'state.win', category: 'scoring', local: true },
  { key: 'deep_red', label: 'Deep Red', how: 'Finish a round ten or more under par.', icon: 'award.under-par', category: 'scoring', local: true },
  { key: 'threading_it', label: 'Threading It', how: 'Beat par on every par-4 hole of a round.', icon: 'score.eagle', category: 'scoring', local: true, reach: (c) => c.hasParFourHole },
  { key: 'perfect_nine', label: 'Perfect Nine', how: 'Play nine holes in a row at or under par.', icon: 'score.par', category: 'scoring', local: true },

  // ── The field (multi-player) ──────────────────────────────────────────────
  { key: 'party_of_four', label: 'Party of Four', how: 'Finish a full round with four players.', icon: 'state.teams', category: 'drama', local: true },
  { key: 'photo_finish', label: 'Photo Finish', how: 'Win a round by exactly one stroke.', icon: 'action.leaderboard', category: 'drama', local: true },
  { key: 'clean_sweep', label: 'Clean Sweep', how: 'Win every single hole of a round outright.', icon: 'award.trophy', category: 'drama', local: true },
  { key: 'wire_to_wire', label: 'Wire to Wire', how: 'Lead a round outright from the first hole to the last.', icon: 'state.finish', category: 'drama', local: true },
  { key: 'ringer', label: 'The Ringer', how: 'Win a four-player round by ten strokes or more.', icon: 'award.trophy', category: 'drama', local: true },
  { key: 'full_house', label: 'Full House', how: 'Play a four-player round where everyone finishes under par.', icon: 'state.teams', category: 'drama', local: true },
  { key: 'dead_heat', label: 'Dead Heat', how: 'Finish a round tied for the lead.', icon: 'action.leaderboard', category: 'drama', local: true },
  { key: 'come_from_behind', label: 'Come From Behind', how: 'Trail after seventeen holes, then win on the last.', icon: 'state.win', category: 'drama', local: true },
  { key: 'underdog', label: 'Underdog', how: 'Win a round you never led until the final hole.', icon: 'state.win', category: 'drama', local: true },
  { key: 'photo_bomb', label: 'Photo Bomb', how: 'Ace a hole everyone else goes over par on.', icon: 'award.hole-in-one', category: 'drama', local: true },

  // ── Courses & venues ──────────────────────────────────────────────────────
  { key: 'new_ground', label: 'New Ground', how: 'Finish a round on a course you have never played.', icon: 'nav.golf', category: 'courses', local: true },
  { key: 'course_collector', label: 'Course Collector', how: 'Play every course at one venue.', icon: 'action.scorecard', category: 'courses', local: true, reach: (c) => c.maxCoursesAtOneVenue >= 2 },
  { key: 'grand_slam', label: 'Grand Slam', how: 'Finish under par on every course at one venue.', icon: 'award.trophy', category: 'courses', local: true, reach: (c) => c.maxCoursesAtOneVenue >= 2 },
  { key: 'road_trip', label: 'Road Trip', how: 'Play a round at three different venues.', icon: 'nav.locations', category: 'courses', local: true, reach: (c) => c.venueCount >= 3 },
  { key: 'personal_best', label: 'Personal Best', how: 'Beat your own best score on a course.', icon: 'action.leaderboard', category: 'courses', local: true },
  { key: 'nemesis', label: 'Nemesis', how: 'Finally finish under par on a course that keeps beating you.', icon: 'state.win', category: 'courses', local: true },
  { key: 'marathon', label: 'Marathon', how: 'Finish two full rounds in one day.', icon: 'state.timer', category: 'courses', local: true },
  { key: 'regular', label: 'Regular', how: 'Play five rounds at the same venue.', icon: 'state.located', category: 'courses', local: true },

  // ── Scavenger hunt ────────────────────────────────────────────────────────
  // Server-granted: verified finds live in hunt_find, not the round record, so
  // there is nothing on-device to detect this from.
  { key: 'hunt_master', label: 'Hunt Master', how: "Complete a course's scavenger hunt during a round.", icon: 'award.hunt-master', category: 'hunt', local: false },

  // ── Wipeouts ──────────────────────────────────────────────────────────────
  // These only work BECAUSE achievements pay nothing: a badge for playing badly
  // would be perverse if it minted tickets, and is a joke worth having when it
  // doesn't. These are family venues; leaning into the bad rounds suits the room.
  { key: 'capped_out', label: 'Capped Out', how: 'Max out the stroke cap on five holes in one round.', icon: 'score.over-par', category: 'wipeouts', local: true },
  { key: 'so_close', label: 'So Close', how: 'Finish a full round exactly one stroke over par.', icon: 'score.bogey', category: 'wipeouts', local: true },
  { key: 'the_long_way', label: 'The Long Way', how: 'Finish a round twenty or more over par.', icon: 'score.bogey', category: 'wipeouts', local: true },
  { key: 'good_sport', label: 'Good Sport', how: 'Finish last and still card all eighteen holes.', icon: 'state.lose', category: 'wipeouts', local: true },
  { key: 'rally_killer', label: 'Rally Killer', how: 'Max out the hole straight after an ace.', icon: 'score.water-hazard', category: 'wipeouts', local: true, secret: true },
  { key: 'windmills_revenge', label: "Windmill's Revenge", how: 'Max out the same hole on the same course in two different rounds.', icon: 'score.water-hazard', category: 'wipeouts', local: true, secret: true },
  { key: 'consolation_prize', label: 'Consolation Prize', how: 'Finish last three rounds in a row.', icon: 'award.medal', category: 'wipeouts', local: true, secret: true },
  { key: 'rock_bottom', label: 'Rock Bottom', how: 'Max out the stroke cap on every hole of a round.', icon: 'score.over-par', category: 'wipeouts', local: true, secret: true },
];

export const ACHIEVEMENTS_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));
