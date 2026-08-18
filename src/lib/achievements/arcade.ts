// The arcade roster the achievement rules count against.
//
// This is a THIRD copy of a list that already exists twice — the fun-zone tiles
// (src/features/fun/FunZone.tsx) and the server's ticket registry
// (server/lib/gameRewards.js GAME_REWARD_GAMES, which is the authority on what
// may PAY). Neither is usable here: the tiles carry routes, not game keys, and
// the server list isn't importable from the client bundle.
//
// So it's duplicated, and guarded instead: arcade.test.ts reads every
// `game="..."` prop out of src/features/fun/ and asserts this list matches it
// exactly. Add a game without adding it here and that test fails, rather than
// "played them all" quietly becoming unearnable.
export const ARCADE_GAME_KEYS = [
  'airhockey',
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
