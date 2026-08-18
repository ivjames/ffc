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

export type AchievementCategory =
  | 'scoring'
  | 'drama'
  | 'courses'
  | 'hunt'
  | 'arcade'
  | 'booth'
  | 'social'
  | 'habit'
  | 'wipeouts'
  | 'secret';

/** What a deployment's catalog looks like, for `reach` (see lib/achievements). */
export type ReachContext = {
  venueCount: number;
  /** Most courses any single venue has — 1 means "collect them all" is trivial. */
  maxCoursesAtOneVenue: number;
  hasParFourHole: boolean;
  /**
   * Modules live at ANY venue in the deployment. A capability switched off
   * everywhere isn't a locked badge, it's a section of the app that doesn't
   * exist — the routes are gated, so the player can never reach the thing the
   * badge describes. Whole categories drop out on this.
   */
  modules: { arcade: boolean; ordering: boolean; hunt: boolean };
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
  courses: 'Courses & venues',
  hunt: 'Scavenger hunt',
  arcade: 'Arcade',
  booth: 'Photo booth',
  social: 'Playing together',
  habit: 'Regulars',
  wipeouts: 'Wipeouts',
  secret: 'Secrets',
};

/** Render order for the wall — best-known first, humour before the long tail. */
export const CATEGORY_ORDER: AchievementCategory[] = [
  'scoring',
  'drama',
  'courses',
  'hunt',
  'arcade',
  'booth',
  'social',
  'habit',
  'wipeouts',
  'secret',
];

/** Categories that only exist where a venue module is live. */
const MODULE_GATED: Partial<Record<AchievementCategory, (c: ReachContext) => boolean>> = {
  arcade: (c) => c.modules.arcade,
  // The hunt module alone isn't enough. Every hunt badge is granted in the
  // round-completion path, which matches finds to the round's COURSE — so a
  // deployment running only the course-free venue hunt (no golf at all) can
  // never earn one, however enabled the module is. Granting them from venue
  // sessions is real work and a real feature; until then, don't advertise a
  // category this deployment cannot reach.
  hunt: (c) => c.modules.hunt && c.maxCoursesAtOneVenue >= 1,
};

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
  { key: 'first_find', label: 'First Find', how: 'Get one hunt photo verified.', icon: 'nav.hunt', category: 'hunt', local: false },
  { key: 'eagle_eye', label: 'Eagle Eye', how: 'Nail a find the verifier is certain about.', icon: 'action.hint', category: 'hunt', local: false },
  { key: 'sharpshooter', label: 'Sharpshooter', how: 'Get five finds verified without a single rejection.', icon: 'game.darts', category: 'hunt', local: false },
  { key: 'persistence', label: 'Persistence', how: 'Land a find after three failed attempts at it.', icon: 'action.refresh', category: 'hunt', local: false },
  { key: 'above_board', label: 'Above Board', how: 'Finish a hunt with every photo above suspicion.', icon: 'state.done', category: 'hunt', local: false },
  { key: 'hoarder', label: 'Hoarder', how: 'Find ten of something there are many of.', icon: 'state.celebrate', category: 'hunt', local: false },
  { key: 'multitasker', label: 'Multitasker', how: 'Finish the hunt and beat par in the same round.', icon: 'award.trophy', category: 'hunt', local: false },
  { key: 'grand_hunter', label: 'Grand Hunter', how: "Complete every course's hunt at one venue.", icon: 'nav.locations', category: 'hunt', local: false, reach: (c) => c.maxCoursesAtOneVenue >= 2 },
  { key: 'naturalist', label: 'Naturalist', how: 'Complete a hunt without a single rejected photo.', icon: 'award.medal', category: 'hunt', local: false },

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

  // ── Arcade ────────────────────────────────────────────────────────────────
  // The fun-zone games score themselves in the browser, which is exactly why
  // the server caps what they may PAY. As status badges that objection is moot
  // — nothing is minted — so the arcade is fair game here. Counted from
  // device-local activity marks; nothing is sent anywhere.
  { key: 'arcade_rookie', label: 'Arcade Rookie', how: 'Play any arcade game.', icon: 'nav.arcade', category: 'arcade', local: true },
  { key: 'sampler', label: 'Sampler', how: 'Play five different arcade games.', icon: 'game.challenge-spinner', category: 'arcade', local: true },
  { key: 'completionist', label: 'Completionist', how: 'Play every game in the arcade.', icon: 'award.trophy', category: 'arcade', local: true },
  // Named for what can actually be observed. The obvious badge — "hit THIS
  // game's maximum" — needs each game's own ceiling, and most top out well below
  // the platform limit (trivia at 50, high striker at 60), so a single global
  // comparison would have made it unearnable on most of the roster while
  // claiming otherwise. A hundred tickets from one round is a real thing that
  // happens, and it is a thing this can see.
  { key: 'big_payout', label: 'Big Payout', how: 'Earn a hundred tickets from a single arcade round.', icon: 'award.ticket', category: 'arcade', local: true },
  { key: 'regular_player', label: 'Frequent Flyer', how: 'Play fifty arcade rounds.', icon: 'state.timer', category: 'arcade', local: true },
  { key: 'trivia_buff', label: 'Trivia Buff', how: 'Answer every trivia question correctly.', icon: 'game.trivia', category: 'arcade', local: true },
  // Per-game skill feats. Each game reports its own through GameTicketAward's
  // `feat` prop, because only that game knows what the moment was.
  { key: 'turkey', label: 'Turkey', how: 'Bowl three strikes in a row.', icon: 'game.bowling', category: 'arcade', local: true },
  { key: 'bullseye', label: 'Bullseye', how: 'Land a dart in the inner bull.', icon: 'game.darts', category: 'arcade', local: true },
  { key: 'bell_ringer', label: 'Bell Ringer', how: 'Ring the bell on the high striker.', icon: 'game.high-striker', category: 'arcade', local: true },
  { key: 'claw_champ', label: 'Claw Champ', how: 'Win a prize from the claw machine three times.', icon: 'game.claw-machine', category: 'arcade', local: true },
  { key: 'mole_patrol', label: 'Mole Patrol', how: 'Bop ten in a row without hitting a bomb.', icon: 'game.whack-a-mole', category: 'arcade', local: true },
  { key: 'sharpshooter_ii', label: 'Dead Eye', how: 'Clear a shooting gallery round without missing a shot.', icon: 'game.shooting-gallery', category: 'arcade', local: true },
  { key: 'pinball_wizard', label: 'Pinball Wizard', how: 'Break a million on the pinball table.', icon: 'game.pinball', category: 'arcade', local: true },

  // ── Photo booth ───────────────────────────────────────────────────────────
  { key: 'say_cheese', label: 'Say Cheese', how: 'Save your first photo-booth picture.', icon: 'action.take-photo', category: 'booth', local: true },
  { key: 'photogenic', label: 'Photogenic', how: 'Save five booth photos.', icon: 'nav.photos', category: 'booth', local: true },
  { key: 'sticker_bomb', label: 'Sticker Bomb', how: 'Put ten or more stickers on one photo.', icon: 'state.celebrate', category: 'booth', local: true },
  { key: 'framed', label: 'Framed', how: 'Finish a booth photo with a venue frame.', icon: 'action.edit', category: 'booth', local: true },
  { key: 'directors_cut', label: "Director's Cut", how: 'Re-open a saved photo and change it.', icon: 'action.refresh', category: 'booth', local: true },

  // ── Playing together ──────────────────────────────────────────────────────
  { key: 'host', label: 'Host', how: 'Start a shared game other phones join.', icon: 'action.play-together', category: 'social', local: true },
  { key: 'joiner', label: 'Crashed the Party', how: "Join someone else's shared game.", icon: 'state.teams', category: 'social', local: true },
  { key: 'squad_goals', label: 'Squad Goals', how: 'Fill all four seats of a shared game.', icon: 'state.teams', category: 'social', local: true },
  { key: 'rivalry', label: 'Rivalry', how: 'Play three rounds against the same opponent.', icon: 'action.leaderboard', category: 'social', local: true },
  // Granted server-side off the shared game's roster (two members of one team
  // in the same game), not from a team picker — the app has no screen that ties
  // a round to a team, and playing alongside a teammate is the same thing.
  { key: 'team_player', label: 'Team Player', how: 'Play a shared game alongside a teammate.', icon: 'state.teams', category: 'social', local: false },

  // ── Regulars ──────────────────────────────────────────────────────────────
  { key: 'home_screen_hero', label: 'Home Screen Hero', how: 'Install the app on your home screen.', icon: 'nav.install', category: 'habit', local: true },
  { key: 'made_it_official', label: 'Made It Official', how: 'Create an account.', icon: 'state.account', category: 'habit', local: true },
  { key: 'carded', label: 'Carded', how: 'Link your rewards card.', icon: 'nav.rewards', category: 'habit', local: true },
  { key: 'three_peat', label: 'Three-Peat', how: 'Play on three different days.', icon: 'state.timer', category: 'habit', local: true },
  { key: 'weekend_warrior', label: 'Weekend Warrior', how: 'Play on both days of the same weekend.', icon: 'state.celebrate', category: 'habit', local: true },
  { key: 'century_club', label: 'Century Club', how: 'Play a hundred holes.', icon: 'award.medal', category: 'habit', local: true },
  { key: 'anniversary', label: 'Anniversary', how: 'Play a round a year after your first.', icon: 'state.celebrate', category: 'habit', local: true },
  { key: 'refueled', label: 'Refueled', how: 'Order food from the app.', icon: 'nav.food', category: 'habit', local: true, reach: (c) => c.modules.ordering },
  { key: 'turn_snack', label: 'Turn Snack', how: 'Order food in the middle of a round.', icon: 'order.cart', category: 'habit', local: true, reach: (c) => c.modules.ordering },
  { key: 'night_owl', label: 'Night Owl', how: 'Start a round in the last hour before close.', icon: 'control.theme-dark', category: 'habit', local: true },
  { key: 'early_bird', label: 'Early Bird', how: 'Start a round in the first hour after opening.', icon: 'control.theme-light', category: 'habit', local: true },

  // ── Secrets ───────────────────────────────────────────────────────────────
  // Hidden until earned, so the how-to is never a spoiler.
  { key: 'lucky_sevens', label: 'Lucky Sevens', how: 'Card exactly 77 for a round.', icon: 'state.celebrate', category: 'secret', local: true, secret: true },
  { key: 'palindrome', label: 'Palindrome', how: 'Play a round whose back nine mirrors its front nine.', icon: 'action.refresh', category: 'secret', local: true, secret: true },
  { key: 'flatline', label: 'Flatline', how: 'Score exactly the same on all eighteen holes.', icon: 'score.par', category: 'secret', local: true, secret: true },
  { key: 'the_grind', label: 'The Grind', how: 'Start a round after nine at night.', icon: 'control.theme-dark', category: 'secret', local: true, secret: true },
  { key: 'groundhog_day', label: 'Groundhog Day', how: 'Card the identical total twice on the same course.', icon: 'action.refresh', category: 'secret', local: true, secret: true },
  { key: 'trophy_case', label: 'Trophy Case', how: 'Earn twenty other badges.', icon: 'award.trophy', category: 'secret', local: true },
  { key: 'curator', label: 'Curator', how: 'Complete any one category.', icon: 'award.medal', category: 'secret', local: true },
  { key: 'legend', label: 'Legend', how: 'Earn every other badge.', icon: 'brand.mark', category: 'secret', local: true },
];

export const ACHIEVEMENTS_BY_KEY = new Map(ACHIEVEMENTS.map((a) => [a.key, a]));

/**
 * Is this badge worth showing in this deployment? Its own `reach` predicate,
 * plus the module gate its category sits behind. Kept here rather than in each
 * entry so a new arcade badge inherits the gate without anyone remembering to.
 */
export function isReachable(a: Achievement, ctx: ReachContext): boolean {
  const gate = MODULE_GATED[a.category];
  if (gate && !gate(ctx)) return false;
  return a.reach == null || a.reach(ctx);
}
