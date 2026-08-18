import { describe, it, expect } from 'vitest';
import {
  BALL_R,
  DRAIN_Y,
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
