// §12 "While You Wait" content — bundled, offline-first line entertainment for
// the family-fun-center app. Three data-driven mechanics share this file:
//
//   • Fun facts       — a rotating deck of bite-size facts (FunFacts screen).
//   • Trivia          — multiple-choice questions with one correct answer.
//   • Challenge spinner — a wheel that mixes silly next-shot gameplay handicaps
//     with quick, kid-safe group dares (Spinner screen).
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
  /**
   * How the challenge lands:
   *   • 'gameplay' — a handicap that bends the rules of your NEXT shot
   *     (close your eyes, wrong end of the club…). Meaningful mid-round.
   *   • 'dare'     — a just-for-fun stunt anyone can do in line, no game needed.
   * Roughly half the wheel is each kind; the Spinner colors and labels them.
   */
  kind: 'gameplay' | 'dare';
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
  { emoji: '🔫', text: 'The first commercial laser tag arena, Photon, opened in 1984 in Texas — years before laser tag became a mall-and-arcade staple.' },
  { emoji: '🤸', text: 'The modern trampoline was invented in 1936 by gymnast George Nissen, who named it after the Spanish word "trampolín," meaning diving board.' },
  { emoji: '🎰', text: 'Pinball was actually banned in New York City for over 30 years — from 1942 until 1976 — because officials considered it a game of chance.' },
  { emoji: '🧸', text: 'Claw machines have been tempting players since the 1890s, when the earliest "crane" games were themed around the digging machines of the Panama Canal.' },
  { emoji: '⚽️', text: 'Foosball, or table football, was patented back in the 1920s so fans could play a miniature match indoors any time of year.' },
  { emoji: '🍭', text: 'Cotton candy was co-invented in 1897 by a dentist — William Morrison — who helped build the first machine to spin sugar into fluff.' },
  { emoji: '🧀', text: 'Nachos were invented in 1943 by a cook named Ignacio "Nacho" Anaya, who threw together tortillas and cheese for hungry guests after hours.' },
  { emoji: '🥨', text: 'The twisted shape of a pretzel is said to represent arms folded across the chest — a very old symbol tied to its monastery origins.' },
  { emoji: '🎢', text: 'America\'s first roller coaster, the Switchback Railway, opened at Coney Island in 1884 and cost just a nickel to ride.' },
  { emoji: '🎡', text: 'The very first Ferris wheel was built for the 1893 Chicago World\'s Fair by engineer George Ferris, who gave the ride its name.' },
  { emoji: '👻', text: 'Pac-Man launched in 1980, and its designer said the round, wedge-shaped hero was inspired by a pizza with one slice missing.' },
  { emoji: '🧩', text: 'Tetris was created in 1984 by Alexey Pajitnov, and its name blends the Greek word for "four" with his favorite sport, tennis.' },
  { emoji: '🎳', text: 'A perfect game in ten-pin bowling is a score of 300 — twelve strikes thrown in a row without a single miss.' },
  { emoji: '🎯', text: 'All the numbers around a standard dartboard add up to exactly 210, and the biggest single-dart score you can hit is 60.' },
  { emoji: '🏓', text: 'A regulation table-tennis ball weighs just 2.7 grams — about the same as a single U.S. penny.' },
  { emoji: '🍦', text: 'The ice cream cone was popularized at the 1904 World\'s Fair in St. Louis when a waffle vendor rolled up his waffles to hold a neighbor\'s ice cream.' },
  { emoji: '🥤', text: 'The frozen slushy drink was born by accident in the 1950s when Omar Knedlik\'s soda machine broke and his bottles froze into a slush.' },
  { emoji: '🎈', text: 'Bubble gum is traditionally pink for a simple reason: pink was the only food dye its inventor, Walter Diemer, had on hand in 1928.' },
  { emoji: '🎾', text: 'Tennis balls turned fluorescent yellow in the 1970s so they would show up better for viewers watching matches on color television.' },
  { emoji: '🛼', text: 'Roller skates are older than you might think — the first known pair was demonstrated in London back in the 1760s.' },
  { emoji: '🍄', text: 'The character we know as Mario first appeared in the 1981 arcade game Donkey Kong, where he was simply called "Jumpman."' },
  { emoji: '👾', text: 'Space Invaders was such a hit in 1978 that it sparked a widely repeated legend of a coin shortage in Japan.' },
  { emoji: '🎲', text: 'A standard deck has 52 playing cards split into four suits — one popular theory links them to the 52 weeks in a year.' },
  { emoji: '🧊', text: 'That sudden "brain freeze" from a cold treat has a real medical name: sphenopalatine ganglioneuralgia.' },
  { emoji: '🟥', text: 'Neon signs glow because electricity excites the neon gas inside the tube, and pure neon always shines a warm red-orange.' },
  { emoji: '🔨', text: 'Whac-A-Mole first popped up in arcades in the 1970s and has been testing players\' reflexes with a padded mallet ever since.' },
  { emoji: '🧩', text: 'The Rubik\'s Cube, invented in 1974, has more than 43 quintillion possible arrangements but only one solved state.' },
  { emoji: '🏁', text: 'Recreational go-karts often top out around 15 to 30 mph, but sitting just inches off the ground makes it feel far faster.' },
  { emoji: '🍿', text: 'Americans munch through billions of quarts of popcorn every year, making it one of the country\'s favorite snacks.' },
  { emoji: '🎠', text: 'On a classic carousel, the single most decorated horse is traditionally called the "lead horse" and marks where the ride begins.' },
  { emoji: '🕹️', text: 'Donkey Kong helped launch the golden age of arcades in the early 1980s, a stretch when new coin-op games seemed to arrive every week.' },
  { emoji: '🥁', text: 'Rhythm and music arcade games reward timing down to a fraction of a second — hitting a note "on beat" can mean a window of well under a tenth of a second.' },
  { emoji: '🎱', text: 'A standard pool set has 15 numbered balls plus the cue ball, and the solids and stripes split neatly into two groups of seven.' },
  { emoji: '🧲', text: 'The puck in air hockey rides on a thin cushion of air pushed up through hundreds of tiny holes in the table\'s surface.' },
  { emoji: '🍬', text: 'Marshmallows were originally made from the sap of the marsh-mallow plant, which is where the treat got its name.' },
  { emoji: '🐶', text: 'The classic first balloon animal most people learn to twist is the dog — it uses just a few simple bubbles.' },
  { emoji: '⛳️', text: 'The windmill has been a mini-golf icon since the 1920s, when themed obstacles first turned putting into a whole adventure.' },
  { emoji: '🥇', text: 'The word "jackpot" comes from an old version of poker in which the pot could only be opened with a pair of jacks or better.' },
  { emoji: '🫧', text: 'The fizz in soda is carbon dioxide gas that was dissolved into the liquid under pressure, then escapes as bubbles when you open it.' },
  { emoji: '🎤', text: 'Karaoke means roughly "empty orchestra" in Japanese, because the singer supplies the vocals the recording leaves out.' },
  { emoji: '🚦', text: 'A drag-racing "Christmas tree" starting light gives racers a countdown, and top reaction times are measured in thousandths of a second.' },
  { emoji: '🧠', text: 'Your reaction time gets a little quicker when you\'re expecting a signal versus reacting to a surprise — anticipation gives your brain a head start.' },
  { emoji: '🎟️', text: 'Many arcades have swapped paper tickets for digital game cards, but the classic ticket-eating counting machines can still tally thousands per minute.' },
  { emoji: '🌭', text: 'The hot dog on a bun became popular fair and ballpark food in the early 1900s, prized because you could eat it while walking around.' },
  { emoji: '🦖', text: 'The famous no-internet dinosaur game hides in a web browser, and its cactus-jumping runner has no actual finish line — it just speeds up forever.' },
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
  {
    q: 'What is the highest possible score in a single game of ten-pin bowling?',
    choices: ['100', '200', '300', '500'],
    answer: 2,
  },
  {
    q: 'In golf, what is a score of two strokes under par on a hole called?',
    choices: ['Birdie', 'Eagle', 'Albatross', 'Bogey'],
    answer: 1,
  },
  {
    q: 'How many holes are on a standard full-size golf course?',
    choices: ['9', '12', '18', '24'],
    answer: 2,
  },
  {
    q: 'What shape is the hero of the classic arcade game Pac-Man?',
    choices: ['A ghost', 'A pizza with a slice missing', 'A star', 'A coin'],
    answer: 1,
  },
  {
    q: 'Which falling-block puzzle game was created in 1984 by Alexey Pajitnov?',
    choices: ['Tetris', 'Bejeweled', 'Candy Crush', 'Dr. Mario'],
    answer: 0,
  },
  {
    q: 'What was the character Mario originally called in the game Donkey Kong?',
    choices: ['Super Mario', 'Jumpman', 'Luigi', 'Mr. Video'],
    answer: 1,
  },
  {
    q: 'In darts, what is the highest score you can get with a single dart?',
    choices: ['50', '60', '100', '180'],
    answer: 1,
  },
  {
    q: 'What flavor treat is made by spinning heated sugar into fine fluffy threads?',
    choices: ['Cotton candy', 'Caramel', 'Taffy', 'Marshmallow'],
    answer: 0,
  },
  {
    q: 'What gas gives most soda and slushies their fizzy bubbles?',
    choices: ['Oxygen', 'Helium', 'Carbon dioxide', 'Nitrogen'],
    answer: 2,
  },
  {
    q: 'What is the puck in air hockey floating on while it slides across the table?',
    choices: ['Water', 'A cushion of air', 'Ice', 'Oil'],
    answer: 1,
  },
  {
    q: 'Roughly how many balls are used in a standard game of pool, not counting the cue ball?',
    choices: ['10', '13', '15', '20'],
    answer: 2,
  },
  {
    q: 'The Rubik\'s Cube was invented in which decade?',
    choices: ['The 1950s', 'The 1970s', 'The 1990s', 'The 2000s'],
    answer: 1,
  },
  {
    q: 'What playground favorite did George Nissen help invent in 1936?',
    choices: ['The trampoline', 'The seesaw', 'The swing set', 'The slide'],
    answer: 0,
  },
  {
    q: 'Which arcade game challenges you to bonk pop-up critters with a soft mallet?',
    choices: ['Skee-Ball', 'Whac-A-Mole', 'Pinball', 'Air hockey'],
    answer: 1,
  },
  {
    q: 'What is the sudden headache from eating something cold too fast commonly called?',
    choices: ['Sugar rush', 'Brain freeze', 'Cold snap', 'Ice ache'],
    answer: 1,
  },
  {
    q: 'What color are modern tennis balls, a change made to help them show up on TV?',
    choices: ['White', 'Orange', 'Fluorescent yellow', 'Red'],
    answer: 2,
  },
  {
    q: 'A giant spinning wheel ride with seats around the rim is named after which engineer?',
    choices: ['George Ferris', 'Walt Disney', 'Henry Ford', 'Thomas Edison'],
    answer: 0,
  },
  {
    q: 'What snack pops when the water trapped inside its kernel turns to steam?',
    choices: ['Pretzels', 'Popcorn', 'Chips', 'Crackers'],
    answer: 1,
  },
  {
    q: 'How many cards are in a standard deck of playing cards?',
    choices: ['48', '50', '52', '54'],
    answer: 2,
  },
  {
    q: 'Which classic mini-golf obstacle has spinning blades you must putt past?',
    choices: ['A drawbridge', 'A windmill', 'A loop', 'A tunnel'],
    answer: 1,
  },
  {
    q: 'What food did Ignacio "Nacho" Anaya famously invent in 1943?',
    choices: ['Tacos', 'Nachos', 'Quesadillas', 'Burritos'],
    answer: 1,
  },
  {
    q: 'What does the Japanese word "karaoke" roughly translate to?',
    choices: ['Loud singing', 'Empty orchestra', 'Happy voice', 'Music box'],
    answer: 1,
  },
  {
    q: 'Which team game is played on a table with rows of spinning rods and little figures?',
    choices: ['Foosball', 'Shuffleboard', 'Billiards', 'Ping pong'],
    answer: 0,
  },
  {
    q: 'What is the standard maximum weight of a ten-pin bowling ball?',
    choices: ['12 pounds', '14 pounds', '16 pounds', '20 pounds'],
    answer: 2,
  },
  {
    q: 'Which of these treats was originally made from the root sap of a real plant?',
    choices: ['Gummy bears', 'Marshmallows', 'Licorice', 'Jelly beans'],
    answer: 1,
  },
  {
    q: 'In bowling, what is a single roll that knocks down all the pins called?',
    choices: ['A spare', 'A strike', 'A split', 'A frame'],
    answer: 1,
  },
  {
    q: 'When you knock down all remaining pins on your second roll, what is that called?',
    choices: ['A strike', 'A spare', 'A turkey', 'A gutter'],
    answer: 1,
  },
  {
    q: 'What is the very first balloon animal most people learn to twist?',
    choices: ['A cat', 'A dog', 'A giraffe', 'A snake'],
    answer: 1,
  },
  {
    q: 'A ball rolled into the channel beside a bowling lane goes into the what?',
    choices: ['Gutter', 'Pocket', 'Alley', 'Pit'],
    answer: 0,
  },
  {
    q: 'Which arcade shooter from 1978 featured rows of aliens marching down the screen?',
    choices: ['Asteroids', 'Space Invaders', 'Galaga', 'Centipede'],
    answer: 1,
  },
  {
    q: 'What lightweight gas is used to fill balloons that float upward?',
    choices: ['Helium', 'Carbon dioxide', 'Steam', 'Oxygen'],
    answer: 0,
  },
  {
    q: 'What glowing gas is famous for making bright red-orange signs?',
    choices: ['Argon', 'Neon', 'Xenon', 'Krypton'],
    answer: 1,
  },
  {
    q: 'Which frozen dessert was popularized at the 1904 World\'s Fair in a rolled-up waffle?',
    choices: ['The milkshake', 'The ice cream cone', 'The sundae', 'The popsicle'],
    answer: 1,
  },
  {
    q: 'In go-kart racing, where do you sit compared to a normal car?',
    choices: ['Much higher up', 'Just inches off the ground', 'The same height', 'Facing backward'],
    answer: 1,
  },
  {
    q: 'What everyday small object weighs about the same as a table-tennis ball?',
    choices: ['A golf ball', 'A U.S. penny', 'A baseball', 'A brick'],
    answer: 1,
  },
  {
    q: 'Which of these is a classic arcade game where you roll balls up a ramp into rings?',
    choices: ['Skee-Ball', 'Foosball', 'Pinball', 'Pac-Man'],
    answer: 0,
  },
  {
    q: 'What is the name for the little scoring flippers you control in a game of pinball?',
    choices: ['Paddles', 'Flippers', 'Mallets', 'Bumpers'],
    answer: 1,
  },
  {
    q: 'The traditional twisted shape of a pretzel is said to look like what?',
    choices: ['A pair of folded arms', 'A knot in a rope', 'A figure eight', 'A crown'],
    answer: 0,
  },
  {
    q: 'Which classic ride features hand-painted horses that go up and down as it spins?',
    choices: ['The bumper cars', 'The carousel', 'The Ferris wheel', 'The teacups'],
    answer: 1,
  },
  {
    q: 'What color is bubble gum traditionally, thanks to the dye its inventor happened to have?',
    choices: ['Blue', 'Green', 'Pink', 'Yellow'],
    answer: 2,
  },
  {
    q: 'In laser tag, players usually score points by tagging what on their opponents?',
    choices: ['Their shoes', 'Sensors on their vest', 'Their helmet only', 'The floor'],
    answer: 1,
  },
  {
    q: 'What is the maximum weight, in grams, closest to a regulation table-tennis ball?',
    choices: ['Less than 3 grams', 'About 10 grams', 'About 25 grams', 'About 50 grams'],
    answer: 0,
  },
  {
    q: 'Which game asks you to slide weighted discs down a long smooth table toward a scoring zone?',
    choices: ['Shuffleboard', 'Foosball', 'Air hockey', 'Skee-Ball'],
    answer: 0,
  },
  {
    q: 'What do you call it in mini golf when your ball goes in on the very first stroke?',
    choices: ['A birdie', 'A hole-in-one', 'A par', 'A gimme'],
    answer: 1,
  },
  {
    q: 'Which puzzle toy has more than 43 quintillion possible arrangements but only one solved state?',
    choices: ['A jigsaw', 'The Rubik\'s Cube', 'A maze', 'Dominoes'],
    answer: 1,
  },
];

// —— Challenge spinner ————————————————————————————————————————————————————
// Each wheel mixes two flavors, roughly half and half (see `Challenge.kind`):
//   • Gameplay handicaps — silly rule-benders for your NEXT shot. These shine
//     when the spinner is opened mid-round from the scorecard: use the wrong
//     end of your club, putt with your eyes closed, and so on.
//   • Just-for-fun dares — quick, kid-safe stunts anyone can do on the spot
//     while waiting for a lane or a kart. Nothing that needs equipment.
// Every set interleaves the two kinds so the wheel reads as a balanced mix.
//
// PER-COURSE SETS: the spinner picks a set by the current course's THEME (the
// same `theme` key used for `THEME_RULES` in data/courses.ts), so a dragon
// course spins dragon-flavored dares. A course whose theme has no set — or the
// spinner opened outside a round — falls back to `DEFAULT_CHALLENGES`. Use
// `challengesForTheme()` rather than reaching into these tables directly.

// The generic wheel: works on any course and anywhere in the app (Fun Zone,
// direct link). Also the fallback when a course theme has no dedicated set.
export const DEFAULT_CHALLENGES: Challenge[] = [
  { kind: 'gameplay', emoji: '🙈', text: 'Close your eyes for your entire next shot — no peeking!' },
  { kind: 'dare', emoji: '🕺', text: 'Everyone does their best victory dance for 5 seconds!' },
  { kind: 'gameplay', emoji: '🔄', text: 'Take your next shot with the wrong end of your club.' },
  { kind: 'dare', emoji: '😜', text: 'Make the silliest face you can — hold it for 3 seconds.' },
  { kind: 'gameplay', emoji: '🦵', text: 'Putt croquet-style — club between your legs, facing the hole.' },
  { kind: 'dare', emoji: '🎤', text: 'Sing your favorite song title in your most dramatic voice.' },
  { kind: 'gameplay', emoji: '🤙', text: 'Play your next shot with only your weaker hand on the club.' },
  { kind: 'dare', emoji: '🤝', text: 'Give everyone in your group a high five.' },
  { kind: 'gameplay', emoji: '👣', text: 'Line up and take your next shot balancing on one foot.' },
  { kind: 'dare', emoji: '🐧', text: 'Waddle like a penguin to the nearest wall and back.' },
  { kind: 'gameplay', emoji: '🔙', text: 'Turn your back to the hole and putt facing backward.' },
  { kind: 'dare', emoji: '🤖', text: 'Talk in a robot voice until your next turn.' },
  { kind: 'gameplay', emoji: '🗣️', text: 'Call your shot out loud before you hit — say where it will stop.' },
  { kind: 'dare', emoji: '🐸', text: 'Take 3 giant frog hops in place.' },
  { kind: 'gameplay', emoji: '🌀', text: 'Spin around once, then putt right away — no lining it up again.' },
  { kind: 'dare', emoji: '🎉', text: 'Start a 5-second cheer for the whole group.' },
];

// Per-course sets, keyed by course theme. Each is a self-contained, balanced
// wheel themed to that course concept. Themes without an entry fall back to
// DEFAULT_CHALLENGES via `challengesForTheme()`.
export const CHALLENGE_SETS: Record<string, Challenge[]> = {
  // Blue — fast felt and water hazards. A cool, splashy set.
  blue: [
    { kind: 'gameplay', emoji: '🙈', text: 'Close your eyes for your entire next shot — no peeking!' },
    { kind: 'dare', emoji: '🌊', text: 'Do your best two-armed ocean wave for the group.' },
    { kind: 'gameplay', emoji: '🧊', text: 'Putt as gently as you can — pretend the green is thin ice.' },
    { kind: 'dare', emoji: '🐬', text: 'Make a dolphin squeak everyone can hear.' },
    { kind: 'gameplay', emoji: '🤙', text: 'Play your next shot with only your weaker hand on the club.' },
    { kind: 'dare', emoji: '🏊', text: 'Mime swimming all the way to the next hole.' },
    { kind: 'gameplay', emoji: '⏸️', text: 'Freeze for 3 seconds at the top of your backswing, then putt.' },
    { kind: 'dare', emoji: '🎤', text: 'Sing your favorite song title like a sea shanty.' },
    { kind: 'gameplay', emoji: '👣', text: 'Line up and take your next shot balancing on one foot.' },
    { kind: 'dare', emoji: '🫧', text: 'Blow an imaginary bubble, then "pop" it dramatically.' },
    { kind: 'gameplay', emoji: '🐟', text: 'Name a fish out loud, then putt before you forget it.' },
    { kind: 'dare', emoji: '🤝', text: 'Give everyone in your group a splashy high five.' },
  ],
  // Green — the gentle garden layout with windmills and hedges.
  green: [
    { kind: 'gameplay', emoji: '🙈', text: 'Close your eyes for your entire next shot — no peeking!' },
    { kind: 'dare', emoji: '🌻', text: 'Strike your tallest "growing sunflower" stretch.' },
    { kind: 'gameplay', emoji: '🌬️', text: 'Putt in one smooth motion — pretend the windmill gate is closing.' },
    { kind: 'dare', emoji: '🐝', text: 'Buzz like a bee all the way to the next tee.' },
    { kind: 'gameplay', emoji: '🤙', text: 'Play your next shot with only your weaker hand on the club.' },
    { kind: 'dare', emoji: '🦋', text: 'Flap like a butterfly for 5 seconds.' },
    { kind: 'gameplay', emoji: '🐢', text: 'Take the slowest, calmest backswing you can, then putt.' },
    { kind: 'dare', emoji: '🎤', text: 'Sing your favorite song title softly, like a lullaby.' },
    { kind: 'gameplay', emoji: '👣', text: 'Line up and take your next shot balancing on one foot.' },
    { kind: 'dare', emoji: '🐸', text: 'Take 3 giant frog hops in place.' },
    { kind: 'gameplay', emoji: '🌼', text: 'Name a flower out loud before you putt.' },
    { kind: 'dare', emoji: '🤝', text: 'Give everyone in your group a gentle high five.' },
  ],
  // Dragon — the fantasy cavern course. Brave, roaring flavor.
  dragon: [
    { kind: 'gameplay', emoji: '🐉', text: 'Roar like a dragon, THEN take your next shot.' },
    { kind: 'dare', emoji: '🐲', text: 'Stomp like a dragon all the way to the next hole.' },
    { kind: 'gameplay', emoji: '🙈', text: "Close your eyes for your next shot — brave the dragon's dark." },
    { kind: 'dare', emoji: '🔥', text: 'Breathe pretend fire at the sky for 3 seconds.' },
    { kind: 'gameplay', emoji: '🔄', text: 'Take your next shot with the wrong end of your club — a "tail swing".' },
    { kind: 'dare', emoji: '🦇', text: 'Flap like a cavern bat for 5 seconds.' },
    { kind: 'gameplay', emoji: '🤙', text: 'Play your next shot with your weaker "claw" only.' },
    { kind: 'dare', emoji: '🎤', text: 'Sing your favorite song title in your mightiest dragon voice.' },
    { kind: 'gameplay', emoji: '🔙', text: 'Turn your back to the hole and putt facing backward.' },
    { kind: 'dare', emoji: '🛡️', text: 'Strike your bravest knight pose and hold it.' },
    { kind: 'gameplay', emoji: '🗡️', text: "Call your shot like a hero's vow before you strike." },
    { kind: 'dare', emoji: '👑', text: 'Bow to the whole group like royalty.' },
  ],
  // Western — the mine-cart and saloon course. Yeehaw energy.
  western: [
    { kind: 'gameplay', emoji: '🤠', text: "Putt like you're drawing a six-shooter — quick, no lining it up." },
    { kind: 'dare', emoji: '🐴', text: 'Gallop like a horse to the next tee.' },
    { kind: 'gameplay', emoji: '🙈', text: 'Close your eyes for your entire next shot — no peeking!' },
    { kind: 'dare', emoji: '🎩', text: 'Tip your imaginary hat to the whole group.' },
    { kind: 'gameplay', emoji: '🔄', text: 'Take your next shot with the wrong end of your club.' },
    { kind: 'dare', emoji: '🪕', text: 'Do a 3-second hoedown dance.' },
    { kind: 'gameplay', emoji: '🦵', text: 'Putt croquet-style, straddling the club like a horse.' },
    { kind: 'dare', emoji: '🎤', text: 'Sing your favorite song title like an old cowboy ballad.' },
    { kind: 'gameplay', emoji: '🤙', text: 'Play your next shot with only your weaker hand on the club.' },
    { kind: 'dare', emoji: '💥', text: 'Strike your best "quick draw" pose and freeze.' },
    { kind: 'gameplay', emoji: '🔙', text: 'Turn your back to the hole and putt facing backward.' },
    { kind: 'dare', emoji: '🌵', text: 'Stand as still as a cactus for 5 seconds.' },
  ],
  // Red — the championship layout. Big-stage, high-pressure flavor.
  red: [
    { kind: 'gameplay', emoji: '🙈', text: 'Close your eyes for your entire next shot — championship pressure!' },
    { kind: 'dare', emoji: '🏆', text: 'Take a champion\'s victory lap around your group.' },
    { kind: 'gameplay', emoji: '🎯', text: 'Call your shot out loud before you hit — pro style.' },
    { kind: 'dare', emoji: '📣', text: 'Give a 5-second acceptance speech for winning.' },
    { kind: 'gameplay', emoji: '🔄', text: 'Take your next shot with the wrong end of your club.' },
    { kind: 'dare', emoji: '🕺', text: 'Everyone does their best victory dance for 5 seconds!' },
    { kind: 'gameplay', emoji: '🤙', text: 'Play your next shot with only your weaker hand on the club.' },
    { kind: 'dare', emoji: '🎤', text: 'Sing your favorite song title like a stadium anthem.' },
    { kind: 'gameplay', emoji: '👣', text: 'Line up and take your next shot balancing on one foot.' },
    { kind: 'dare', emoji: '🙌', text: 'Start a slow clap that builds up for the group.' },
    { kind: 'gameplay', emoji: '🌀', text: 'Spin around once, then putt right away — no lining it up again.' },
    { kind: 'dare', emoji: '🔥', text: 'Strike your fiercest "game face" for 3 seconds.' },
  ],
};

/**
 * The challenge wheel for a given course theme. Falls back to the generic
 * DEFAULT_CHALLENGES when no theme is given or the theme has no dedicated set
 * (e.g. the spinner opened from the Fun Zone rather than a round).
 */
export function challengesForTheme(theme?: string): Challenge[] {
  return (theme && CHALLENGE_SETS[theme]) || DEFAULT_CHALLENGES;
}
