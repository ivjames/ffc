// JS Golf — code-golf puzzles. Each puzzle asks the player to write the
// shortest JavaScript function that passes every test. Your stroke count is the
// number of characters in your code; "par" is a comfortable target we picked by
// hand. Beat par for a birdie or better.
//
// The convention: the player's code must evaluate to a function (usually an
// arrow function like `n=>n*2`). It's called once per test with `args` spread
// as arguments, and the return value is compared (deep-equal) to `expect`.

export type GolfTest = {
  args: unknown[];
  expect: unknown;
};

export type GolfPuzzle = {
  id: string;
  title: string;
  /** One-line brief shown under the title. */
  brief: string;
  /** Character target. Match it for par; fewer is under par. */
  par: number;
  /** Signature hint, e.g. "n => …" so players know the shape. */
  hint: string;
  tests: GolfTest[];
};

// Ordered easy → hard. Pars are generous enough to be reachable but reward
// genuinely tight code.
export const PUZZLES: GolfPuzzle[] = [
  {
    id: 'double',
    title: 'Double or Nothing',
    brief: 'Return the number, doubled.',
    par: 6,
    hint: 'n => …',
    tests: [
      { args: [0], expect: 0 },
      { args: [4], expect: 8 },
      { args: [-3], expect: -6 },
      { args: [21], expect: 42 },
    ],
  },
  {
    id: 'fizzbuzz-one',
    title: 'Water Hazard',
    brief: '"Fizz" if divisible by 3, "Buzz" by 5, "FizzBuzz" by both, else the number as a string.',
    par: 46,
    hint: 'n => …',
    tests: [
      { args: [1], expect: '1' },
      { args: [3], expect: 'Fizz' },
      { args: [5], expect: 'Buzz' },
      { args: [15], expect: 'FizzBuzz' },
      { args: [30], expect: 'FizzBuzz' },
      { args: [7], expect: '7' },
    ],
  },
  {
    id: 'reverse',
    title: 'Backswing',
    brief: 'Reverse a string.',
    par: 22,
    hint: 's => …',
    tests: [
      { args: ['golf'], expect: 'flog' },
      { args: [''], expect: '' },
      { args: ['a'], expect: 'a' },
      { args: ['racecar'], expect: 'racecar' },
    ],
  },
  {
    id: 'sum',
    title: 'Add Them Up',
    brief: 'Sum an array of numbers.',
    par: 24,
    hint: 'a => …',
    tests: [
      { args: [[]], expect: 0 },
      { args: [[5]], expect: 5 },
      { args: [[1, 2, 3, 4]], expect: 10 },
      { args: [[-1, 1, -2, 2]], expect: 0 },
    ],
  },
  {
    id: 'max',
    title: 'Long Drive',
    brief: 'Return the largest number in an array.',
    par: 18,
    hint: 'a => …',
    tests: [
      { args: [[1]], expect: 1 },
      { args: [[3, 1, 4, 1, 5]], expect: 5 },
      { args: [[-7, -3, -9]], expect: -3 },
      { args: [[10, 10, 2]], expect: 10 },
    ],
  },
  {
    id: 'vowels',
    title: 'Count the Cups',
    brief: 'Count the vowels (a, e, i, o, u) in a lowercase string.',
    par: 28,
    hint: 's => …',
    tests: [
      { args: ['hole in one'], expect: 5 },
      { args: [''], expect: 0 },
      { args: ['xyz'], expect: 0 },
      { args: ['aeiou'], expect: 5 },
    ],
  },
  {
    id: 'palindrome',
    title: 'Round Trip',
    brief: 'Return true if the string reads the same forwards and backwards.',
    par: 30,
    hint: 's => …',
    tests: [
      { args: ['racecar'], expect: true },
      { args: ['golf'], expect: false },
      { args: [''], expect: true },
      { args: ['abba'], expect: true },
    ],
  },
  {
    id: 'range',
    title: 'The Front Nine',
    brief: 'Return [1, 2, …, n] as an array.',
    par: 34,
    hint: 'n => …',
    tests: [
      { args: [1], expect: [1] },
      { args: [3], expect: [1, 2, 3] },
      { args: [5], expect: [1, 2, 3, 4, 5] },
      { args: [0], expect: [] },
    ],
  },
];

/** Golf scoring: how a stroke count compares to par. */
export function scoreLabel(strokes: number, par: number): { label: string; emoji: string } {
  const d = strokes - par;
  if (d <= -3) return { label: 'Albatross', emoji: '🦅' };
  if (d === -2) return { label: 'Eagle', emoji: '🦅' };
  if (d === -1) return { label: 'Birdie', emoji: '🐦' };
  if (d === 0) return { label: 'Par', emoji: '⛳️' };
  if (d === 1) return { label: 'Bogey', emoji: '😬' };
  if (d === 2) return { label: 'Double bogey', emoji: '😵' };
  return { label: `+${d}`, emoji: '💥' };
}
