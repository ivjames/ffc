// Unit coverage for the achievement rules (lib/rewards.js) — the score-based
// grant logic. There is no payout to cover: achievements pay no tickets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { scoreAchievements, ACHIEVEMENTS } from "./rewards.js";

const PARS = Array(18).fill(3); // course par 54

const fullCard = (strokes, playerIndex = 0) =>
  Array.from({ length: 18 }, (_, i) => ({ playerIndex, hole: i + 1, strokes }));

test("the catalog labels every achievement a round can grant", () => {
  // The catalog is what Master Control and the player app render a grant as, so
  // an achievement missing here would surface as a raw key.
  assert.deepEqual(Object.keys(ACHIEVEMENTS).sort(), [
    "hole_in_one",
    "hunt_master",
    "under_par",
  ]);
  for (const label of Object.values(ACHIEVEMENTS)) {
    assert.ok(label.length > 0);
  }
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
