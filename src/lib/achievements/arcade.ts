// The arcade roster the achievement rules count against.
//
// This is a THIRD copy of a list that already exists twice — the fun-zone tiles
// (src/features/fun/FunZone.tsx) and the server's ticket registry
// (server/lib/gameRewards.js GAME_REWARD_GAMES, which is the authority on what
// may PAY). Neither is usable here: the tiles carry routes, not game keys, and
// the server list isn't importable from the client bundle.
//
// So it's duplicated, and guarded instead: arcade.test.ts reads every
// `game="..."` prop out of the arcade screens and asserts this list matches it
// exactly. Add a game without adding it here and that test fails, rather than
// "played them all" quietly becoming unearnable.
//
// Note this is the roster the ARCADE SHOWS, not the one that earns tickets.
// Arcade Putt pays nothing and so is absent from the server's reward registry,
// but a player who finishes it has plainly played an arcade game — defining the
// roster by ticket eligibility would have made "play them all" earnable without
// touching it.
export const ARCADE_GAME_KEYS = [
  'airhockey',
  'arcadeputt',
  'axethrow',
  'battingcages',
  'bowling',
  'bumperboats',
  'bumpercars',
  'clawmachine',
  'darts',
  'gokarts',
  'highstriker',
  'milkbottle',
  'pinball',
  'popashot',
  'ringtoss',
  'shootinggallery',
  'skeeball',
  'trivia',
  'watergunrace',
  'whackamole',
] as const;

export const ARCADE_GAME_COUNT = ARCADE_GAME_KEYS.length;
