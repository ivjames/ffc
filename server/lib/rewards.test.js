// Unit coverage for the reward rules (lib/rewards.js) — the score-based
// achievement logic and the payout pricing.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAchievements, achievementTickets, ACHIEVEMENTS } from "./rewards.js";

const PARS = Array(18).fill(3); // course par 54

const fullCard = (strokes, playerIndex = 0) =>
  Array.from({ length: 18 }, (_, i) => ({ playerIndex, hole: i + 1, strokes }));

test("achievementTickets prices every catalog achievement, 0 for unknown", () => {
  // Every achievement a round can grant must have a payout, or a card claim for
  // it would silently pay nothing.
  for (const key of Object.keys(ACHIEVEMENTS)) {
    assert.ok(achievementTickets(key) > 0, `${key} must have a payout`);
  }
  assert.equal(achievementTickets("hole_in_one"), 100);
  assert.equal(achievementTickets("under_par"), 50);
  assert.equal(achievementTickets("hunt_master"), 75);
  assert.equal(achievementTickets("nope"), 0);
});

test("a full card at par earns nothing", () => {
  assert.deepEqual(scoreAchievements(fullCard(3), 1, PARS), []);
});

test("a full card under par earns under_par", () => {
  assert.deepEqual(scoreAchievements(fullCard(2), 1, PARS), [
    { playerIndex: 0, achievement: "under_par" },
  ]);
});

test("an ace earns hole_in_one even on a partial card, but no under_par", () => {
  const rows = [{ playerIndex: 0, hole: 1, strokes: 1 }];
  assert.deepEqual(scoreAchievements(rows, 1, PARS), [
    { playerIndex: 0, achievement: "hole_in_one" },
  ]);
});

test("a full card of aces earns both, and players are independent", () => {
  const rows = [...fullCard(1, 0), ...fullCard(3, 1)];
  assert.deepEqual(scoreAchievements(rows, 2, PARS), [
    { playerIndex: 0, achievement: "hole_in_one" },
    { playerIndex: 0, achievement: "under_par" },
  ]);
});

test("stray score rows outside the roster are ignored", () => {
  const rows = [{ playerIndex: 3, hole: 1, strokes: 1 }];
  assert.deepEqual(scoreAchievements(rows, 1, PARS), []);
});
