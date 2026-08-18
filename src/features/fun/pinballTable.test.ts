import { describe, it, expect } from 'vitest';
import {
  BALL_R,
  DRAIN_Y,
  FLIP_LEN,
  FLIP_PIVOT_Y,
  INLANE_X,
  INLANE_Y,
  L_REST,
  OUT_BOT_Y,
  OUT_MOUTH_X,
  OUT_X,
  PF_L,
  PF_R,
  DT,
  FLIP_R,
  SAVE_S,
  TIP_L,
  TIP_R,
  mirrorX,
  WALL_PAD,
  freshGS,
  launchBall,
  step,
} from './pinballTable';

// The table's geometry carries invariants that are easy to break by nudging a
// number: a gap that looks fine on screen can be too narrow for the ball to
// pass (dead table) or wide enough to swallow it (drain highway). These pin the
// ones the comments in pinballTable.ts warn about. Balance numbers themselves —
// how long a ball survives — are measured with `npm run pinball:sim`.

const BALL_W = 2 * (BALL_R + FLIP_R); // clearance the ball needs between blades
const LANE_W = 2 * (BALL_R + WALL_PAD); // ...and between two walls

/** Where the ball's centre travels as it rolls down an inlane ramp: the guide
 *  segment offset by the ball's radius plus the wall's half-thickness. */
function rampPath(side: 'L' | 'R'): Array<{ x: number; y: number }> {
  const a = { x: side === 'L' ? OUT_X : mirrorX(OUT_X), y: OUT_BOT_Y };
  const b = { x: side === 'L' ? INLANE_X : mirrorX(INLANE_X), y: INLANE_Y };
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const d = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  const n = { x: d.y * (side === 'L' ? 1 : -1), y: -d.x * (side === 'L' ? 1 : -1) };
  const pts = [];
  for (let t = 0; t <= len; t += 0.25) {
    pts.push({
      x: a.x + d.x * t + n.x * (BALL_R + WALL_PAD),
      y: a.y + d.y * t + n.y * (BALL_R + WALL_PAD),
    });
  }
  return pts;
}

/** Distance from a point to a flipper's resting capsule centerline. */
function distToBlade(p: { x: number; y: number }, side: 'L' | 'R'): number {
  const px = side === 'L' ? INLANE_X : mirrorX(INLANE_X);
  const dir = side === 'L' ? L_REST : Math.PI - L_REST;
  const bx = px + Math.cos(dir) * FLIP_LEN;
  const by = FLIP_PIVOT_Y + Math.sin(dir) * FLIP_LEN;
  const abx = bx - px;
  const aby = by - FLIP_PIVOT_Y;
  let t = ((p.x - px) * abx + (p.y - FLIP_PIVOT_Y) * aby) / (abx * abx + aby * aby);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (px + abx * t), p.y - (FLIP_PIVOT_Y + aby * t));
}

describe('pinball table geometry', () => {
  it('leaves the center drain passable but tight', () => {
    const gap = TIP_R - TIP_L;
    expect(gap).toBeGreaterThan(BALL_W); // the table must be able to drain
    expect(gap).toBeLessThan(BALL_W + 8); // ...but not down an open corridor
  });

  it('drains a ball that comes down dead center with the flippers at rest', () => {
    const gs = freshGS();
    gs.phase = 'play';
    gs.live = true;
    gs.ball = { x: (TIP_L + TIP_R) / 2, y: 460, vx: 0, vy: 220 };
    let t = 0;
    while (t < 5 && gs.ball.y <= DRAIN_Y) {
      step(gs);
      t += DT;
    }
    expect(gs.ball.y).toBeGreaterThan(DRAIN_Y);
  });

  it('pinches the outlane mouths without wedging the channel', () => {
    const mouth = OUT_MOUTH_X - PF_L;
    const channel = OUT_X - PF_L;
    expect(mouth).toBeGreaterThan(LANE_W); // a ball can still get in
    expect(mouth - LANE_W).toBeLessThan(8); // but has to thread the post
    expect(channel).toBeGreaterThan(mouth); // and the lane widens below it
    // The right outlane is the mirror, measured against the shooter-lane wall.
    expect(PF_R - mirrorX(OUT_MOUTH_X)).toBe(mouth);
    expect(PF_R - mirrorX(OUT_X)).toBe(channel);
  });

  it('hangs each flipper below the inlane ramp that feeds it', () => {
    // The pivot end of the blade is a 7px knuckle. Level with the ramp's end it
    // pokes up through the ramp's ball path and the ball jams in the V between
    // them; it has to hang below, so the ball is handed off with a drop rather
    // than a ledge. Negative clearance here IS the stall.
    for (const side of ['L', 'R'] as const) {
      const clearance = Math.min(...rampPath(side).map((p) => distToBlade(p, side))) - (BALL_R + FLIP_R);
      expect(clearance).toBeGreaterThan(0);
      expect(clearance).toBeLessThan(6); // ...but still a ramp onto the blade, not a cliff
    }
  });

  it('rolls a ball down the inlane onto the flipper without it sticking', () => {
    // A grid over the bottom half of each ramp at dribble speeds — the ball
    // arriving slowly at the very end is the case that used to wedge. With the
    // pivot level with the ramp's end, 14 of these 48 stick fast.
    for (const side of ['L', 'R'] as const) {
      const path = rampPath(side);
      for (let frac = 0.5; frac < 1.001; frac += 0.1) {
        for (const speed of [0, 20, 40, 80]) {
          const p = path[Math.min(path.length - 1, Math.round(frac * (path.length - 1)))];
          const dir = side === 'L' ? 1 : -1;
          const gs = freshGS();
          gs.phase = 'play';
          gs.live = true;
          // Rolling down the ramp: the guide falls 22px over 68px of run.
          gs.ball = { x: p.x, y: p.y, vx: dir * speed * 0.951, vy: speed * 0.308 };
          let nudged = false;
          let t = 0;
          while (t < 6 && gs.ball.y <= DRAIN_Y) {
            step(gs);
            nudged ||= gs.events.some((e) => e.kind === 'nudge');
            gs.events.length = 0;
            t += DT;
          }
          const where = `${side} ramp ${(frac * 100) | 0}% at ${speed}u/s`;
          expect(nudged, `stuck-ball watchdog fired: ${where}`).toBe(false);
          expect(gs.ball.y, `ball never left the flippers: ${where}`).toBeGreaterThan(DRAIN_Y);
        }
      }
    }
  });

  it('spends the ball saver instead of re-arming it on every launch', () => {
    const gs = freshGS();
    gs.phase = 'play';
    expect(gs.saveLeft).toBe(SAVE_S);
    launchBall(gs, 1);
    for (let t = 0; t < 1; t += DT) step(gs);
    const left = gs.saveLeft;
    expect(left).toBeLessThan(SAVE_S);
    launchBall(gs, 1); // a saved ball comes back with what is left, not a fresh window
    expect(gs.saveLeft).toBeCloseTo(left, 5);
  });

  it('never traps a ball: every unattended ball reaches the drain', () => {
    // No flipper input at all, so the only outcome is the drain. A ball still
    // in play after 60s means the table grew a pocket the stuck-ball watchdog
    // cannot shake it out of.
    for (let i = 0; i < 40; i++) {
      const gs = freshGS();
      gs.phase = 'play';
      launchBall(gs, i / 40);
      let t = 0;
      while (t < 60) {
        step(gs);
        gs.events.length = 0;
        t += DT;
        if (gs.ball.y > DRAIN_Y) break;
        if (gs.ball.x > 306 && gs.ball.y > 520 && Math.hypot(gs.ball.vx, gs.ball.vy) < 80) {
          launchBall(gs, 1); // weak launch fell back down the lane; re-plunge
        }
      }
      expect(t).toBeLessThan(60);
    }
  });
});
