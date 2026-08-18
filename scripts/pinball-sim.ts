// Offline balance harness for §12 Pinball. Not shipped — run with node:
//   npm run pinball:sim            (compare the shipped table against variants)
//   npm run pinball:sim -- --balls 4000
//
// The table's geometry and physics live in src/features/fun/pinballTable.ts, so
// the numbers below come from exactly the code the game runs — only the player
// is fake. A scripted flipper policy (reaction delay + miss rate) stands in for
// a human so two tables can be compared on the same terms; the absolute times
// mean little, the deltas between configs are the point.
import {
  BALL_R,
  DRAIN_Y,
  FLIP_LEN,
  H,
  PF_CX,
  PF_R,
  DT,
  freshGS,
  launchBall,
  step,
  type GS,
} from '../src/features/fun/pinballTable.ts';

// —— deterministic RNG ————————————————————————————————————————————————————————
// The sim itself calls Math.random (bounce jitter, sling wobble, stuck nudges),
// so seed it globally: every config then sees the same stream of luck and the
// comparison isn't measuring dice.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// —— the fake player ——————————————————————————————————————————————————————————
// Flips when a falling ball enters a flipper's reach, after a reaction delay,
// and misses a fixed fraction of chances outright. Deliberately crude: it is a
// measuring stick, not an opponent.
type Skill = { name: string; reaction: number; miss: number; hold: number };
// Three tiers, because a change that only helps one of them is a bad change:
// the table should get friendlier at the bottom without going limp at the top.
const SKILLS: Skill[] = [
  { name: 'first-timer', reaction: 0.2, miss: 0.5, hold: 0.15 },
  { name: 'casual', reaction: 0.13, miss: 0.28, hold: 0.15 },
  { name: 'sharp', reaction: 0.07, miss: 0.1, hold: 0.15 },
];

type Zone = { engaged: boolean; pressAt: number; skip: boolean };

/** Is the ball descending into this flipper's sweep? */
function inReach(gs: GS, side: 'L' | 'R'): boolean {
  const b = gs.ball;
  const f = side === 'L' ? gs.fL : gs.fR;
  if (b.vy <= 0) return false;
  const dx = side === 'L' ? b.x - f.px : f.px - b.x;
  return dx > -12 && dx < FLIP_LEN + 16 && b.y > f.py - 52 && b.y < f.py + 20;
}

type Outcome = {
  life: number; // seconds from launch to drain
  score: number;
  path: 'left outlane' | 'right outlane' | 'center' | 'past a flipper';
  flips: number;
  nudges: number; // stuck-ball watchdog fires — a table that jams is not "hard"
  saves: number; // ball-saver rescues before the drain that stuck
  drainX: number; // where it crossed the flipper line — feeds the drain histogram
};

/** Play one ball from the plunger to the drain. */
function playBall(rand: () => number, skill: Skill): Outcome {
  const gs = freshGS();
  gs.phase = 'play';
  // Players settle into a firm launch; vary it so lane entries differ.
  launchBall(gs, 0.62 + rand() * 0.38);
  const t0 = gs.time;
  const zones: Record<'L' | 'R', Zone> = {
    L: { engaged: false, pressAt: 0, skip: false },
    R: { engaged: false, pressAt: 0, skip: false },
  };
  let flips = 0;
  let nudges = 0;
  let saves = 0;
  let lastX = gs.ball.x;

  // 90 s is far past any real ball; it only stops a pathological stall.
  while (gs.time - t0 < 90) {
    for (const side of ['L', 'R'] as const) {
      const z = zones[side];
      const f = side === 'L' ? gs.fL : gs.fR;
      if (inReach(gs, side)) {
        if (!z.engaged) {
          z.engaged = true;
          z.pressAt = gs.time + skill.reaction;
          z.skip = rand() < skill.miss;
          if (!z.skip) flips++;
        }
        // A tap, not a held flipper: holding one up is itself a way to lose
        // the ball down the middle, and casual players do tap.
        f.pressed = !z.skip && gs.time >= z.pressAt && gs.time < z.pressAt + skill.hold;
      } else {
        z.engaged = false;
        f.pressed = false;
      }
    }
    if (gs.ball.y < 500) lastX = gs.ball.x; // x on the way past the flipper tips
    step(gs);
    for (const ev of gs.events) if (ev.kind === 'nudge') nudges++;
    gs.events.length = 0; // the game's frame loop drains these every frame

    const b = gs.ball;
    if (b.x > PF_R && b.y > 520 && Math.hypot(b.vx, b.vy) < 80) {
      // Weak launch fell back down the shooter lane — the game re-racks it.
      launchBall(gs, 0.62 + rand() * 0.38);
      continue;
    }
    if (b.y > DRAIN_Y) {
      if (gs.saveLeft > 0) {
        // Ball saver: the game re-racks and the player plunges again, so the
        // ball's life continues — that is the whole point of the saver.
        saves++;
        launchBall(gs, 0.62 + rand() * 0.38);
        continue;
      }
      const path =
        lastX < 36 + BALL_R
          ? 'left outlane'
          : lastX > 278 - BALL_R
            ? 'right outlane'
            : lastX > gs.fL.px + 20 && lastX < gs.fR.px - 20
              ? 'center'
              : 'past a flipper';
      return { life: gs.time - t0, score: gs.score, path, flips, nudges, saves, drainX: lastX };
    }
  }
  return { life: gs.time - t0, score: gs.score, path: 'center', flips, nudges, saves, drainX: lastX };
}

// —— reporting ————————————————————————————————————————————————————————————————
function pct(n: number, total: number) {
  return `${((100 * n) / total).toFixed(1)}%`;
}

function report(label: string, outs: Outcome[]) {
  const n = outs.length;
  const lives = outs.map((o) => o.life).sort((a, b) => a - b);
  const mean = lives.reduce((a, b) => a + b, 0) / n;
  const median = lives[Math.floor(n / 2)];
  const quick = outs.filter((o) => o.life < 5).length;
  const long = outs.filter((o) => o.life > 20).length;
  const score = outs.reduce((a, o) => a + o.score, 0) / n;
  const by = (p: Outcome['path']) => outs.filter((o) => o.path === p).length;
  console.log(`\n${label}  (${n} balls)`);
  console.log(
    `  life: mean ${mean.toFixed(1)}s · median ${median.toFixed(1)}s · ` +
      `under 5s ${pct(quick, n)} · over 20s ${pct(long, n)}`,
  );
  console.log(
    `  drains: center ${pct(by('center'), n)} · past a flipper ${pct(by('past a flipper'), n)} · ` +
      `left outlane ${pct(by('left outlane'), n)} · right outlane ${pct(by('right outlane'), n)}`,
  );
  const p90 = lives[Math.floor(n * 0.9)];
  console.log(
    `  score/ball ${score.toFixed(0)} · flips/ball ${(outs.reduce((a, o) => a + o.flips, 0) / n).toFixed(1)}` +
      ` · p90 life ${p90.toFixed(1)}s · saves/ball ${(outs.reduce((a, o) => a + o.saves, 0) / n).toFixed(2)}` +
      ` · nudges/ball ${(outs.reduce((a, o) => a + o.nudges, 0) / n).toFixed(2)}`,
  );
}

function histogram(outs: Outcome[]) {
  // Where balls cross the flipper line, in 20px columns — shows at a glance
  // whether the table bleeds down the middle or out the sides.
  const bins = new Array(17).fill(0);
  for (const o of outs) bins[Math.max(0, Math.min(16, Math.floor(o.drainX / 20)))]++;
  const max = Math.max(...bins);
  console.log('  drain x:');
  for (let i = 0; i < bins.length; i++) {
    if (!bins[i]) continue;
    const bar = '█'.repeat(Math.round((bins[i] / max) * 30));
    console.log(`    ${String(i * 20).padStart(3)}–${String(i * 20 + 19).padStart(3)} ${bar} ${pct(bins[i], outs.length)}`);
  }
}

const argBalls = process.argv.indexOf('--balls');
const BALLS_N = argBalls > -1 ? Number(process.argv[argBalls + 1]) : 1500;

const realRandom = Math.random;
for (const skill of SKILLS) {
  const outs: Outcome[] = [];
  for (let i = 0; i < BALLS_N; i++) {
    // Same seed per ball index across tiers and configs: every run sees the
    // same luck, so a delta in the numbers is a delta in the table.
    const rand = mulberry32(0x51fb + i * 2654435761);
    Math.random = rand;
    outs.push(playBall(rand, skill));
  }
  Math.random = realRandom;
  report(`${skill.name} (${(skill.miss * 100) | 0}% missed flips)`, outs);
  if (process.argv.includes('--hist')) histogram(outs);
}

console.log(
  `\n(geometry: ball ⌀${BALL_R * 2}, playfield ${H}px tall, centre ${PF_CX}, drain below y=${DRAIN_Y}, flipper ${FLIP_LEN}px)\n`,
);
