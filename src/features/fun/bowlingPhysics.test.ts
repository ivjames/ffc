import { describe, expect, it } from 'vitest';
import {
  FLAT,
  HEAD_Y,
  LANE_L,
  LANE_R,
  PIN_R,
  PIT_Y,
  TIP,
  W,
  freshBall,
  ghostPath,
  launch,
  makePins,
  pinsSettled,
  steadyPins,
  stepRoll,
  type Ball,
  type Pin,
  type Vel,
} from './bowlingPhysics';

const lean = (p: Pin) => Math.hypot(p.lx, p.ly);

function thrownBall(v: Vel): Ball {
  const b = freshBall();
  b.vx = v.vx0;
  b.vy = v.vy0;
  b.spin = v.spin;
  b.rolling = true;
  return b;
}

/** Run a roll to rest (or the step cap) and return the ball. */
function runRoll(ball: Ball, pins: Pin[], bumpers = false, maxSteps = 360): Ball {
  for (let i = 0; i < maxSteps; i++) {
    stepRoll(ball, pins, bumpers);
    const done = ball.y < -20 || Math.hypot(ball.vx, ball.vy) < 0.06;
    if (done && pinsSettled(pins)) break;
  }
  return ball;
}

describe('launch', () => {
  it('rejects short and too-flat swipes', () => {
    expect(launch(3, -4)).toBeNull();
    expect(launch(120, -10)).toBeNull(); // nearly sideways
  });

  it('loads revs against the swipe angle, so the ball hooks back', () => {
    const right = launch(80, -220)!;
    expect(right.vx0).toBeGreaterThan(0);
    expect(right.spin).toBeLessThan(0);
    const left = launch(-80, -220)!;
    expect(left.spin).toBeGreaterThan(0);
    expect(launch(0, -220)!.spin).toBeCloseTo(0);
  });
});

describe('ball on the lane', () => {
  it('an angled ball breaks back toward center once it leaves the oil', () => {
    // Same launch angle with and without revs: the spin version must end up
    // meaningfully further back toward center at the pins.
    const v = launch(70, -230)!;
    const straight = thrownBall({ ...v, spin: 0 });
    const hooked = thrownBall(v);
    while (straight.y > HEAD_Y && !straight.gutter) stepRoll(straight, [], false);
    while (hooked.y > HEAD_Y && !hooked.gutter) stepRoll(hooked, [], false);
    expect(hooked.x).toBeLessThan(straight.x - 8);
  });

  it('a wide ball drops into the gutter and stays out of the pins', () => {
    const pins = makePins();
    const ball = runRoll(thrownBall(launch(-150, -200)!), pins);
    expect(ball.gutter).toBe(true);
    expect(pins.every((p) => !p.down)).toBe(true);
  });

  it('bumpers bank the same ball back onto the lane instead', () => {
    let bumped = false;
    const ball = thrownBall(launch(-150, -200)!);
    for (let i = 0; i < 360 && ball.y > -20; i++) {
      if (stepRoll(ball, [], true).bump) bumped = true;
    }
    expect(bumped).toBe(true);
    expect(ball.gutter).toBe(false);
  });
});

describe('pin bodies', () => {
  it('a flush pocket-speed hit topples the pin through a real fall, not a snap', () => {
    const pins = makePins().slice(0, 1); // just the head pin
    const ball = thrownBall(launch(0, -240)!);
    let steps = 0;
    let sawMidTopple = false;
    while (!pins[0].down && steps++ < 360) {
      stepRoll(ball, pins, false);
      const L = lean(pins[0]);
      if (L > TIP && L < FLAT) sawMidTopple = true;
    }
    expect(pins[0].down).toBe(true);
    expect(sawMidTopple).toBe(true); // it passed through the topple, frame by frame
  });

  it('a gentle nudge makes a pin wobble and recover upright', () => {
    const pins = makePins().slice(0, 1);
    const p = pins[0];
    p.lvx = 0.012; // a brush: below what it takes to reach the balance point
    const ball = freshBall();
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      stepRoll(ball, pins, false);
      peak = Math.max(peak, lean(p));
    }
    expect(peak).toBeGreaterThan(0.02); // it visibly rocked…
    expect(peak).toBeLessThan(TIP); // …but never past the balance point
    expect(p.down).toBe(false);
    expect(lean(p)).toBeLessThan(0.01); // and it settled back upright
    expect(pinsSettled(pins)).toBe(true);
  });

  it('pinsSettled waits out a wobble even at the swing peak, where angular velocity is ~0', () => {
    const pins = makePins().slice(0, 1);
    pins[0].lx = TIP * 0.5; // leaning mid-wobble…
    pins[0].lvx = 0; // …caught exactly at the peak of the swing
    expect(pinsSettled(pins)).toBe(false);
    const ball = freshBall();
    for (let i = 0; i < 900; i++) stepRoll(ball, pins, false);
    expect(pins[0].down).toBe(false);
    expect(pinsSettled(pins)).toBe(true); // recovered upright, then settled
  });

  it('pinsSettled waits out a mid-topple pin', () => {
    const pins = makePins().slice(0, 1);
    pins[0].lx = TIP * 1.5; // past the balance point, still falling
    expect(pinsSettled(pins)).toBe(false);
    const ball = freshBall();
    for (let i = 0; i < 600 && !pins[0].down; i++) stepRoll(ball, pins, false);
    expect(pins[0].down).toBe(true);
    expect(pinsSettled(pins)).toBe(true);
  });

  it('kickbacks keep deck pins on the boards; the pit swallows the back', () => {
    const pins = makePins().slice(0, 1);
    const p = pins[0];
    p.x = LANE_R - PIN_R - 30; // near the right kickback…
    p.vx = 8; // …flung sideways at deck height
    const ball = freshBall();
    let bounced = false;
    for (let i = 0; i < 240; i++) {
      stepRoll(ball, pins, false);
      if (p.vx < 0) bounced = true;
      expect(p.x).toBeGreaterThanOrEqual(LANE_L + PIN_R - 0.001);
      expect(p.x).toBeLessThanOrEqual(LANE_R - PIN_R + 0.001);
      if (p.pit) break;
    }
    expect(bounced).toBe(true);

    const back = makePins().slice(0, 1);
    back[0].vy = -12; // driven hard, straight into the pit
    for (let i = 0; i < 240 && !back[0].pit; i++) stepRoll(freshBall(), back, false);
    expect(back[0].pit).toBe(true);
    expect(back[0].down).toBe(true);
    expect(back[0].y).toBeLessThan(PIT_Y + 1);
  });

  it('a hard hit puts a pin in the air and it comes back down', () => {
    const pins = makePins().slice(0, 1);
    const ball = thrownBall(launch(0, -260)!); // full power, dead flush
    let flew = false;
    for (let i = 0; i < 360; i++) {
      stepRoll(ball, pins, false);
      if (pins[0].z > 0) flew = true;
      if (pins[0].pit) break;
    }
    expect(flew).toBe(true);
    expect(pins[0].pit ? 0 : pins[0].z).toBe(0); // grounded (or gone) by the end
    expect(pins[0].down).toBe(true);
  });

  it('a full-rack pocket hit carries most of the deck', () => {
    const pins = makePins();
    runRoll(thrownBall(launch(8, -235)!), pins);
    expect(pins.filter((p) => p.down).length).toBeGreaterThanOrEqual(8);
  });

  it('steadyPins stands survivors fully upright for the next ball', () => {
    const pins = makePins();
    runRoll(thrownBall(launch(-20, -200)!), pins);
    const survivors = pins.filter((p) => !p.down);
    steadyPins(survivors);
    for (const p of survivors) {
      expect(lean(p)).toBe(0);
      expect(Math.hypot(p.vx, p.vy)).toBe(0);
      expect(p.z).toBe(0);
    }
  });
});

describe('ghostPath', () => {
  it('traces the aim guide from the start up the lane, curving with the revs', () => {
    const pts = ghostPath(launch(70, -230)!, false);
    expect(pts.length).toBeGreaterThan(4);
    expect(pts[0].x).toBe(W / 2);
    // Monotonically up the lane…
    for (let i = 1; i < pts.length; i++) expect(pts[i].y).toBeLessThan(pts[i - 1].y);
    // …drifting right off the launch angle within the guide's reach.
    expect(pts[pts.length - 1].x).toBeGreaterThan(pts[0].x);
  });
});
