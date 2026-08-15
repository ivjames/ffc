// The games the bot can play, keyed by the SERVER's registry key
// (server/lib/gameRewards.js GAME_REWARD_GAMES) so a captured profile lines up
// with what /api/game-rewards/award will accept.
//
// Only aim-and-release and timing games live here — the ones whose outcome is a
// function of the gesture, so the bot can play them without reading live game
// state. The reactive games (whack-a-mole, shooting gallery, air hockey,
// batting cages, pinball, go-karts, water gun, bumper) need to see moving
// entities frame by frame; they are deliberately out of scope for now and are
// listed in UNSUPPORTED so `--list` can say so out loud rather than quietly
// omitting them.
import skeeball from './games/skeeball.mjs';
import ringtoss from './games/ringtoss.mjs';
import highstriker from './games/highstriker.mjs';
import popashot from './games/popashot.mjs';
import axethrow from './games/axethrow.mjs';
import darts from './games/darts.mjs';
import whackamole from './games/whackamole.mjs';
import bowling from './games/bowling.mjs';
import shootinggallery from './games/shootinggallery.mjs';

export const GAMES = [skeeball, ringtoss, popashot, highstriker, axethrow, darts, whackamole, bowling, shootinggallery];

export const BY_KEY = new Map(GAMES.map((g) => [g.key, g]));

/** Server-registry games with no policy yet, and why. */
export const UNSUPPORTED = [
  ['airhockey', 'reactive — tracks a live puck'],
  ['battingcages', 'reactive — pitch timing'],
  ['bumperboats', 'reactive — continuous steering'],
  ['bumpercars', 'reactive — continuous steering'],
  ['clawmachine', 'timing — but prize positions come from a physics pile'],
  ['gokarts', 'reactive — continuous steering'],
  ['milkbottle', 'physics — topple cascade is a sim, so no closed-form aim'],
  ['pinball', 'reactive — flipper timing on a live ball'],
  ['trivia', 'knowledge — answers are bundled content, not a gesture'],
  ['watergunrace', 'reactive — sustained aim on a moving target'],
];

export function resolve(keys) {
  if (!keys || keys.length === 0) return GAMES;
  const out = [];
  for (const k of keys) {
    const g = BY_KEY.get(k);
    if (!g) throw new Error(`unknown game "${k}" (have: ${[...BY_KEY.keys()].join(', ')})`);
    out.push(g);
  }
  return out;
}
