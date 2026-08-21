// Offline balance harness for §12 Bowling. Not shipped — run with node:
//   npm run bowling:sim              (benchmark three skill tiers)
//   npm run bowling:sim -- --map     (deterministic aim → pinfall map)
//   npm run bowling:sim -- --games 2000
//
// The lane's physics live in src/features/fun/bowlingPhysics.ts, so every
// number below comes from exactly the code the game runs — only the player is
// fake. The physics itself is deterministic; all the luck is injected here as
// seeded aim noise, so runs are reproducible and config deltas mean something.
// Targets: a well-thrown pocket hook should strike often (~half the time or
// better), a straight ball up the middle should split more than it strikes,
// and casual-tier games should land in the arcade-respectable 100s.
import {
  HEAD_Y,
  MAX_DRAG,
  PIN_GAP_X,
  START,
  W,
  freshBall,
  launch,
  makePins,
  pinsSettled,
  steadyPins,
  stepRoll,
  type Pin,
  type Vel,
} from '../src/features/fun/bowlingPhysics.ts';

// —— deterministic RNG ————————————————————————————————————————————————————————
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Box–Muller, one sample. */
function gauss(rand: () => number): number {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// —— one roll, start to settle ————————————————————————————————————————————————
const MAX_STEPS = 120 * 3; // mirrors the game's 3s roll cap

/** Roll one ball at the standing pins (mutates them). Returns pins downed. */
function roll(pins: Pin[], v: Vel): number {
  const before = pins.filter((p) => !p.down).length;
  const ball = freshBall();
  ball.vx = v.vx0;
  ball.vy = v.vy0;
  ball.spin = v.spin;
  ball.rolling = true;
  for (let i = 0; i < MAX_STEPS; i++) {
    stepRoll(ball, pins, false);
    const ballDone = ball.y < -20 || Math.hypot(ball.vx, ball.vy) < 0.06;
    if (ballDone && pinsSettled(pins)) break;
  }
  return before - pins.filter((p) => !p.down).length;
}

// —— the fake player ——————————————————————————————————————————————————————————
/** Find the drag dx that lands the ball's break at target x (secant search on
 *  the real ball physics, no pins). This is "perfect aim"; tiers add noise. */
function findAim(targetX: number, dragY: number): number {
  let lo = -MAX_DRAG;
  let hi = MAX_DRAG;
  const xAt = (dx: number): number => {
    const v = launch(dx, dragY);
    if (!v) return NaN;
    const b = freshBall();
    b.vx = v.vx0;
    b.vy = v.vy0;
    b.spin = v.spin;
    b.rolling = true;
    for (let i = 0; i < MAX_STEPS && b.y > HEAD_Y; i++) {
      stepRoll(b, [], false);
      if (b.gutter) return b.x < W / 2 ? -999 : 999;
    }
    return b.x;
  };
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const x = xAt(mid);
    if (Number.isNaN(x)) return 0;
    if (x < targetX) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

type Skill = { name: string; sigma: number; powerSigma: number };
const SKILLS: Skill[] = [
  { name: 'first-timer', sigma: 34, powerSigma: 50 },
  { name: 'casual', sigma: 16, powerSigma: 28 },
  { name: 'sharp', sigma: 7, powerSigma: 14 },
];

const DRAG_Y = -235; // a firm, mostly-full-power swipe
// The 1–3 pocket: just right of the head pin.
const POCKET_X = W / 2 + PIN_GAP_X * 0.5;

/** Standard 10-frame scoring (missing bonus balls count 0) — mirrors the
 *  game's computeScore; small enough to keep the harness self-contained. */
function computeScore(rolls: number[]): number {
  let score = 0;
  let i = 0;
  const at = (k: number) => rolls[k] ?? 0;
  for (let frame = 0; frame < 10 && i < rolls.length; frame++) {
    if (at(i) === 10) {
      score += 10 + at(i + 1) + at(i + 2);
      i += 1;
    } else if (at(i) + at(i + 1) === 10) {
      score += 10 + at(i + 2);
      i += 2;
    } else {
      score += at(i) + at(i + 1);
      i += 2;
    }
  }
  return score;
}

/** Pin numbers (1–10) still standing — makePins builds them in rack order. */
const leaveOf = (pins: Pin[]) =>
  pins
    .map((p, i) => (p.down ? 0 : i + 1))
    .filter(Boolean)
    .join('-');

type TierStats = {
  games: number[];
  strikes: number;
  firstBalls: number;
  spares: number;
  spareChances: number;
  gutters: number;
  rollsThrown: number;
  leaves: Map<string, number>;
};

function playGame(rand: () => number, skill: Skill, pocketDx: number, stats: TierStats): number {
  const rolls: number[] = [];
  for (let frame = 0; frame < 10; frame++) {
    let pins = makePins();
    let ballsLeft = frame === 9 ? 3 : 2;
    let firstOfRack = true;
    while (ballsLeft > 0) {
      const standing = pins.filter((p) => !p.down);
      // First ball of a rack goes at the pocket; clean-up balls aim at what's
      // left. Aim and power both wander by tier.
      const target = firstOfRack
        ? POCKET_X
        : standing.reduce((s, p) => s + p.x, 0) / standing.length;
      const idealDx = firstOfRack ? pocketDx : findAim(target, DRAG_Y);
      const dx = idealDx + gauss(rand) * skill.sigma;
      const dy = Math.min(-80, DRAG_Y + gauss(rand) * skill.powerSigma);
      const v = launch(dx, dy);
      const downed = v ? roll(pins, v) : 0;
      rolls.push(downed);
      stats.rollsThrown += 1;
      if (downed === 0) stats.gutters += 1;
      if (firstOfRack) {
        stats.firstBalls += 1;
        if (downed === 10) stats.strikes += 1;
        else {
          stats.spareChances += 1;
          stats.leaves.set(leaveOf(pins), (stats.leaves.get(leaveOf(pins)) ?? 0) + 1);
        }
      } else if (pins.every((p) => p.down)) {
        stats.spares += 1;
      }
      ballsLeft -= 1;
      const cleared = pins.every((p) => p.down);
      if (frame < 9) {
        if (cleared) break;
        if (!firstOfRack) break;
        firstOfRack = false;
        pins = pins.filter((p) => !p.down);
        steadyPins(pins);
      } else {
        // 10th frame: only strike/spare earns the extra balls; fresh rack on a clear.
        if (cleared) {
          if (rolls.length && firstOfRack && downed !== 10 && ballsLeft > 0) break;
          pins = makePins();
          firstOfRack = true;
        } else if (firstOfRack) {
          firstOfRack = false;
          pins = pins.filter((p) => !p.down);
          steadyPins(pins);
        } else if (ballsLeft === 1) {
          // Open after two balls: no fill ball.
          break;
        }
      }
    }
  }
  return computeScore(rolls);
}

// —— modes ————————————————————————————————————————————————————————————————————
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const num = (name: string, dflt: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : dflt;
};

if (flag('map')) {
  // Deterministic aim map: pinfall for a sweep of drag dx at fixed power.
  // The pocket window and the hook's shape fall straight out of this table.
  console.log(`drag dy = ${DRAG_Y}; x@pins = where the ball crosses the head-pin row`);
  console.log('  dx | x@pins | pinfall');
  for (let dx = -120; dx <= 120; dx += 8) {
    const v = launch(dx, DRAG_Y);
    if (!v) continue;
    const ghost = freshBall();
    ghost.vx = v.vx0;
    ghost.vy = v.vy0;
    ghost.spin = v.spin;
    ghost.rolling = true;
    for (let i = 0; i < MAX_STEPS && ghost.y > HEAD_Y && !ghost.gutter; i++) stepRoll(ghost, [], false);
    const pins = makePins();
    const downed = roll(pins, v);
    const mark = downed === 10 ? '  STRIKE' : downed === 0 ? '  gutter/miss' : `  leave ${leaveOf(pins)}`;
    console.log(
      `${String(dx).padStart(4)} | ${ghost.gutter ? ' out ' : ghost.x.toFixed(1).padStart(5)} | ${String(downed).padStart(2)}${mark}`,
    );
  }
  process.exit(0);
}

const GAMES = num('games', 500);
const pocketDx = findAim(POCKET_X, DRAG_Y);
console.log(`calibrated pocket aim: drag dx=${pocketDx.toFixed(1)} at dy=${DRAG_Y} (target x=${POCKET_X})`);
console.log(`${GAMES} games per tier\n`);

for (const skill of SKILLS) {
  const rand = mulberry32(0xb0d1e5 ^ skill.sigma);
  const stats: TierStats = {
    games: [],
    strikes: 0,
    firstBalls: 0,
    spares: 0,
    spareChances: 0,
    gutters: 0,
    rollsThrown: 0,
    leaves: new Map(),
  };
  for (let g = 0; g < GAMES; g++) stats.games.push(playGame(rand, skill, pocketDx, stats));
  stats.games.sort((a, b) => a - b);
  const avg = stats.games.reduce((a, b) => a + b, 0) / stats.games.length;
  const pct = (p: number) => stats.games[Math.floor((p / 100) * (stats.games.length - 1))];
  const topLeaves = [...stats.leaves.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([leave, n]) => `${leave || '(cleared)'}×${n}`)
    .join('  ');
  console.log(
    `${skill.name.padEnd(12)} avg ${avg.toFixed(1).padStart(6)}  p10 ${pct(10)}  p50 ${pct(50)}  p90 ${pct(90)}  max ${stats.games[stats.games.length - 1]}`,
  );
  console.log(
    `             strike ${((stats.strikes / stats.firstBalls) * 100).toFixed(1)}%  spare-conv ${((stats.spares / Math.max(1, stats.spareChances)) * 100).toFixed(1)}%  zero-pin balls ${((stats.gutters / stats.rollsThrown) * 100).toFixed(1)}%`,
  );
  console.log(`             common leaves: ${topLeaves}\n`);
}
