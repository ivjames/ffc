// §12 "While You Wait" content — bundled, offline-first line entertainment for
// the family-fun-center app. Three data-driven mechanics share this file:
//
//   • Fun facts       — a rotating deck of bite-size facts (FunFacts screen).
//   • Trivia          — multiple-choice questions with one correct answer.
//   • Challenge spinner — a wheel of quick, kid-safe group dares/challenges.
//
// All content is static and bundled (no network), so every screen works
// offline exactly like the scorecard. Content is intentionally generic and
// white-label — family-fun-center flavor (arcade, mini golf, go-karts, snacks)
// rather than any one venue's branding — so it reads at every location.

/** A single fun fact — a short headline and the fact body. */
export type FunFact = {
  emoji: string;
  text: string;
};

/** One multiple-choice trivia question. `answer` indexes into `choices`. */
export type TriviaQuestion = {
  q: string;
  choices: string[];
  answer: number; // index of the correct choice in `choices`
};

/** One entry on the challenge spinner wheel. */
export type Challenge = {
  emoji: string;
  text: string;
};

// —— Fun facts ——————————————————————————————————————————————————————————
// Keep each fact to one or two short sentences — it has to read at a glance
// while someone waits in line. Family-friendly, broadly verifiable trivia.
export const FUN_FACTS: FunFact[] = [
  { emoji: '⛳️', text: 'The first miniature golf courses appeared in the 1860s in Scotland, built so that ladies of the era could putt without the "unladylike" full swing.' },
  { emoji: '🎳', text: 'A bowling "turkey" — three strikes in a row — got its name in the 1800s, when bowling alleys handed out a live turkey to players who pulled it off.' },
  { emoji: '🏎️', text: 'Modern go-kart racing was invented in 1956 in California by Art Ingels, who built the first kart out of scrap and a lawnmower engine.' },
  { emoji: '🕹️', text: 'Skee-Ball is over 100 years old — it was patented in 1908, making it older than sliced bread, which arrived in 1928.' },
  { emoji: '🏒', text: 'Air hockey was invented in the late 1960s by a group of Brunswick engineers who set out to build a game around a frictionless surface.' },
  { emoji: '🪓', text: 'Competitive axe throwing has its own world governing bodies, and a regulation target scores a bullseye at five points.' },
  { emoji: '🎯', text: 'The bullseye on a dartboard is only about half an inch across — smaller than most bottle caps.' },
  { emoji: '🚗', text: 'Bumper cars were originally called "Dodgem" cars — and the whole point was that you were supposed to dodge, not crash into, the others.' },
  { emoji: '⚾️', text: 'A fastball from a batting-cage pitching machine can cross the plate in under half a second, which is why hitting one feels so hard.' },
  { emoji: '🍿', text: 'Popcorn pops because each kernel holds a tiny drop of water that flashes to steam and bursts the shell — at up to 180°C inside.' },
  { emoji: '🎟️', text: 'The classic redemption arcade ticket was designed to be exactly the width it is so the counting machines could feed thousands per minute.' },
  { emoji: '🧠', text: 'Playing fast reaction games briefly sharpens your reflexes — your brain can register a visual cue and start reacting in about a quarter of a second.' },
  { emoji: '🌈', text: 'The stripes on a classic mini-golf windmill are there for a reason: the high contrast helps your eye judge the moving blade and time your putt.' },
  { emoji: '🎈', text: 'Helium makes balloons float because it is about seven times lighter than the air around them.' },
  { emoji: '🏆', text: 'The word "arcade" comes from the arched walkways where coin-operated games were first set up over a century ago.' },
];

// —— Trivia ——————————————————————————————————————————————————————————————
// Four choices each; keep questions kid-approachable but not trivial. The
// Trivia screen shuffles both the order of questions and the order of choices,
// so `answer` is the index into `choices` as written here.
export const TRIVIA: TriviaQuestion[] = [
  {
    q: 'In golf, what do you call a score of one stroke under par on a hole?',
    choices: ['Birdie', 'Eagle', 'Bogey', 'Ace'],
    answer: 0,
  },
  {
    q: 'How many pins are set up at the end of a bowling lane?',
    choices: ['9', '10', '12', '15'],
    answer: 1,
  },
  {
    q: 'What do three strikes in a row in bowling get called?',
    choices: ['A hat trick', 'A turkey', 'A triple', 'A hot streak'],
    answer: 1,
  },
  {
    q: 'In air hockey, what is the puck-blocking paddle usually called?',
    choices: ['A mallet', 'A racket', 'A bat', 'A stick'],
    answer: 0,
  },
  {
    q: 'What everyday machine engine powered the very first go-karts?',
    choices: ['A motorcycle engine', 'A lawnmower engine', 'A jet engine', 'A boat engine'],
    answer: 1,
  },
  {
    q: 'A hole-in-one in mini golf means you sank the ball in how many strokes?',
    choices: ['Zero', 'One', 'Two', 'Under par'],
    answer: 1,
  },
  {
    q: 'What gas is used to make party balloons float?',
    choices: ['Oxygen', 'Hydrogen', 'Helium', 'Carbon dioxide'],
    answer: 2,
  },
  {
    q: 'In Skee-Ball, which ring is usually worth the most points?',
    choices: ['The biggest outer ring', 'The middle ring', 'The small corner holes', 'They are all equal'],
    answer: 2,
  },
  {
    q: 'Bumper cars were first marketed under what catchy name?',
    choices: ['Crash-Ems', 'Dodgem', 'Bump-a-lots', 'Smash Karts'],
    answer: 1,
  },
  {
    q: 'What makes a popcorn kernel actually pop?',
    choices: ['Melting sugar', 'Trapped water turning to steam', 'Static electricity', 'Air pumped inside'],
    answer: 1,
  },
  {
    q: 'How many colored dots (holes) does a standard bullseye have in its very center?',
    choices: ['One', 'Two', 'Three', 'Four'],
    answer: 0,
  },
  {
    q: 'Which of these games is played on a frictionless cushion of air?',
    choices: ['Foosball', 'Air hockey', 'Skee-Ball', 'Pinball'],
    answer: 1,
  },
];

// —— Challenge spinner ————————————————————————————————————————————————————
// Quick, kid-safe group challenges — the kind of thing a family can do on the
// spot while waiting for a lane or a kart. Nothing that needs equipment.
export const CHALLENGES: Challenge[] = [
  { emoji: '🕺', text: 'Everyone does their best victory dance for 5 seconds!' },
  { emoji: '😜', text: 'Make the silliest face you can — hold it for 3 seconds.' },
  { emoji: '🦶', text: 'Balance on one foot until it is your turn.' },
  { emoji: '🎤', text: 'Sing your favorite song title in your most dramatic voice.' },
  { emoji: '🤝', text: 'Give everyone in your group a high five.' },
  { emoji: '🐧', text: 'Waddle like a penguin to the nearest wall and back.' },
  { emoji: '😐', text: 'Try not to laugh while someone tells their worst joke.' },
  { emoji: '💪', text: 'Show off your strongest superhero pose.' },
  { emoji: '🗣️', text: 'Talk in a robot voice until your next turn.' },
  { emoji: '🎨', text: 'Name three things you can see that are the same color.' },
  { emoji: '🙌', text: 'Do 5 air-high-fives with an imaginary teammate.' },
  { emoji: '🐸', text: 'Take 3 giant frog hops in place.' },
  { emoji: '🤔', text: 'Guess who in your group will win the next game.' },
  { emoji: '🎉', text: 'Start a 5-second cheer for the whole group.' },
];
