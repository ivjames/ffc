import { describe, it, expect } from 'vitest';
import { flockSteer, limitSpeed, SHEEP_PARAMS, type Boid } from './flocking';

// Pins the behavioral contract flocking.ts documents: sheep follow the FLOW
// of their local neighbors and are never reeled in toward a center of mass.
// Each test here corresponds to a rule in the module header; if one fails,
// the on-screen symptom is sheep beelining for the middle of the herd again.

const at = (x: number, y: number, vx = 0, vy = 0): Boid => ({ x, y, vx, vy });

describe('flockSteer', () => {
  it('feels nothing from boids beyond its local radius — no flock-wide centroid', () => {
    // A whole second group parked far across the field. Global-center-of-mass
    // cohesion would pull toward it; local cohesion must not know it exists.
    const self = at(0, 0);
    const farGroup = [at(300, 0), at(310, 10), at(320, -10)];
    expect(flockSteer(self, farGroup, null, SHEEP_PARAMS)).toEqual({ ax: 0, ay: 0 });
  });

  it('leaves a calm, comfortably-spaced flock alone — no creep toward the middle', () => {
    // Neighbors at rest inside cohRadius but nearer than comfortDist: the
    // sheep is IN the group, so nothing may pull it further in. Distance 30
    // also exceeds sepRadius, so the net force is exactly zero.
    const self = at(0, 0);
    const flock = [at(30, 0), at(-21, 21), at(0, -30)];
    expect(flockSteer(self, flock, null, SHEEP_PARAMS)).toEqual({ ax: 0, ay: 0 });
  });

  it('goes with the flow: a moving group recruits heading, not position', () => {
    // Neighbors sit toward +x but are all running toward +y. The old bug
    // steered toward the group (+x); the contract steers with the flow (+y).
    const self = at(0, 0);
    const flock = [at(30, 0, 0, 40), at(30, 20, 0, 40)];
    const { ax, ay } = flockSteer(self, flock, null, SHEEP_PARAMS);
    expect(ay).toBeGreaterThan(0); // matches the group's velocity
    expect(ax).toBe(0); // nearest neighbor is within comfort → no inward pull
  });

  it('still gathers a straggler, but flow outweighs the gather', () => {
    // Same moving group, now beyond comfortDist: cohesion may engage, yet its
    // constant magnitude stays well below the velocity-matching pull, so the
    // straggler angles into the stream instead of cutting to the middle.
    const self = at(0, 0);
    const flock = [at(40, 0, 0, 40), at(56, 0, 0, 40)];
    const { ax, ay } = flockSteer(self, flock, null, SHEEP_PARAMS);
    expect(ax).toBeGreaterThan(0); // some pull back toward the group…
    expect(ay).toBeGreaterThan(ax * 2); // …but the flow direction dominates
  });

  it('pushes crowded sheep apart harder than anything pulls them together', () => {
    const self = at(0, 0);
    const crowd = [at(8, 0)];
    const { ax, ay } = flockSteer(self, crowd, null, SHEEP_PARAMS);
    expect(ax).toBeLessThan(-60);
    expect(ay).toBe(0);
  });

  it('flees straight away from the dog, harder the closer it is', () => {
    const self = at(0, 0);
    const near = flockSteer(self, [], { x: 10, y: 0 }, SHEEP_PARAMS);
    const far = flockSteer(self, [], { x: 80, y: 0 }, SHEEP_PARAMS);
    expect(near.ax).toBeLessThan(0);
    expect(near.ay).toBe(0);
    expect(far.ax).toBeLessThan(0);
    expect(near.ax).toBeLessThan(far.ax); // more negative = stronger push
    // Outside the flee radius the dog is just scenery.
    expect(flockSteer(self, [], { x: 200, y: 0 }, SHEEP_PARAMS)).toEqual({ ax: 0, ay: 0 });
  });

  it('skips itself when the caller passes the whole flock', () => {
    const self = at(0, 0);
    const flock = [self, at(30, 0, 0, 40)];
    const withSelf = flockSteer(self, flock, null, SHEEP_PARAMS);
    const withoutSelf = flockSteer(self, [flock[1]], null, SHEEP_PARAMS);
    expect(withSelf).toEqual(withoutSelf);
  });
});

describe('limitSpeed', () => {
  it('caps only what exceeds the limit', () => {
    expect(limitSpeed(3, 4, 10)).toEqual({ vx: 3, vy: 4 });
    const capped = limitSpeed(30, 40, 10);
    expect(Math.hypot(capped.vx, capped.vy)).toBeCloseTo(10);
    expect(capped.vx / capped.vy).toBeCloseTo(3 / 4);
  });
});
