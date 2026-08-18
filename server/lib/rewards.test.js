// Unit coverage for the achievement rules (lib/rewards.js) — the score-based
// grant logic. There is no payout to cover: achievements pay no tickets.
import { test } from "node:test";
import assert from "node:assert/strict";
import { huntAchievements, scoreAchievements, ACHIEVEMENTS } from "./rewards.js";

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

// --- Hunt achievements ------------------------------------------------------

const find = (over = {}) => ({
  tag: "AAA",
  itemId: "i1",
  verified: true,
  confidence: 0.7,
  flagged: false,
  countable: false,
  createdAt: 1,
  hole: null,
  ...over,
});

test("first_find and eagle_eye key off a verified find and its confidence", () => {
  const keys = (finds, opts) =>
    huntAchievements(finds, opts).map((g) => g.achievement);
  assert.deepEqual(keys([find({ verified: false })]), []);
  assert.deepEqual(keys([find()]), ["first_find"]);
  assert.ok(keys([find({ confidence: 0.96 })]).includes("eagle_eye"));
  assert.ok(!keys([find({ confidence: 0.94 })]).includes("eagle_eye"));
});

test("sharpshooter needs five verified in a row; a rejection resets the run", () => {
  const run = (flags) =>
    huntAchievements(
      flags.map((verified, i) => find({ verified, itemId: `i${i}`, createdAt: i })),
    ).map((g) => g.achievement);
  assert.ok(run([true, true, true, true, true]).includes("sharpshooter"));
  assert.ok(!run([true, true, true, true]).includes("sharpshooter"));
  // Four, a miss, then four more is never five in a row.
  assert.ok(
    !run([true, true, true, true, false, true, true, true, true]).includes("sharpshooter"),
  );
});

test("persistence needs three failures at ONE item, then landing it", () => {
  const attempts = (rows) => huntAchievements(rows).map((g) => g.achievement);
  const fail = (itemId, at) => find({ verified: false, itemId, createdAt: at });
  assert.ok(
    attempts([fail("i1", 1), fail("i1", 2), fail("i1", 3), find({ createdAt: 4 })]).includes(
      "persistence",
    ),
  );
  // Two failures isn't persistence.
  assert.ok(
    !attempts([fail("i1", 1), fail("i1", 2), find({ createdAt: 3 })]).includes("persistence"),
  );
  // Three failures spread across different items isn't either.
  assert.ok(
    !attempts([fail("i1", 1), fail("i2", 2), fail("i3", 3), find({ createdAt: 4 })]).includes(
      "persistence",
    ),
  );
});

test("hoarder counts ten of ONE countable item", () => {
  const many = (n, countable) =>
    huntAchievements(
      Array.from({ length: n }, (_, i) => find({ countable, createdAt: i })),
    ).map((g) => g.achievement);
  assert.ok(many(10, true).includes("hoarder"));
  assert.ok(!many(9, true).includes("hoarder"));
  // A non-countable item can only be found once anyway, so it never qualifies.
  assert.ok(!many(10, false).includes("hoarder"));
});

test("the clean-hunt badges need the hunt finished, and are distinct", () => {
  const done = new Set(["AAA"]);
  const keys = (rows, completedTags = done) =>
    huntAchievements(rows, { completedTags }).map((g) => g.achievement);

  assert.ok(keys([find()]).includes("above_board"));
  assert.ok(keys([find()]).includes("naturalist"));
  // A flagged photo loses above_board but not naturalist (nothing was rejected).
  const flagged = keys([find({ flagged: true })]);
  assert.ok(!flagged.includes("above_board"));
  assert.ok(flagged.includes("naturalist"));
  // A rejected photo loses naturalist but not above_board (nothing was flagged).
  const rejected = keys([find(), find({ verified: false, createdAt: 2 })]);
  assert.ok(rejected.includes("above_board"));
  assert.ok(!rejected.includes("naturalist"));
  // Neither is granted to someone who didn't finish the hunt.
  const unfinished = keys([find()], new Set());
  assert.ok(!unfinished.includes("above_board"));
  assert.ok(!unfinished.includes("naturalist"));
});

test("quick draw needs every find on the front nine, and a KNOWN hole", () => {
  const done = new Set(["AAA"]);
  const keys = (rows) => huntAchievements(rows, { completedTags: done }).map((g) => g.achievement);
  assert.ok(keys([find({ hole: 3 }), find({ hole: 9, itemId: "i2" })]).includes("quick_draw"));
  assert.ok(!keys([find({ hole: 3 }), find({ hole: 10, itemId: "i2" })]).includes("quick_draw"));
  // An unknown hole must not be read as an early one: the venue hunt has no
  // round, and an older client sends nothing — either would earn it for free.
  assert.ok(!keys([find({ hole: 3 }), find({ hole: null, itemId: "i2" })]).includes("quick_draw"));
  assert.ok(!keys([find({ hole: undefined })]).includes("quick_draw"));
  // And it still requires finishing the hunt at all.
  assert.ok(
    !huntAchievements([find({ hole: 2 })], { completedTags: new Set() })
      .map((g) => g.achievement)
      .includes("quick_draw")
  );
});

test("quick draw ignores optional countable finds made later", () => {
  const done = new Set(["AAA"]);
  const keys = (rows) => huntAchievements(rows, { completedTags: done }).map((g) => g.achievement);
  // The required list was finished on the front nine; the player then carried
  // on collecting a countable item into the back nine. Still a quick draw.
  assert.ok(
    keys([
      find({ hole: 4 }),
      find({ hole: 8, itemId: "i2" }),
      find({ hole: 14, itemId: "many", countable: true, createdAt: 5 }),
    ]).includes("quick_draw")
  );
  // A REQUIRED item found on the back nine is not.
  assert.ok(
    !keys([find({ hole: 4 }), find({ hole: 12, itemId: "i2" })]).includes("quick_draw")
  );
  // Countable finds alone can't earn it — there are no required finds to judge.
  assert.ok(
    !keys([find({ hole: 3, itemId: "many", countable: true })]).includes("quick_draw")
  );
});

test("each player's finds are judged separately", () => {
  const grants = huntAchievements(
    [find({ tag: "AAA" }), find({ tag: "BBB", verified: false, createdAt: 2 })],
    { completedTags: new Set(["AAA"]) },
  );
  const forTag = (tag) => grants.filter((g) => g.tag === tag).map((g) => g.achievement);
  assert.ok(forTag("AAA").includes("first_find"));
  assert.deepEqual(forTag("BBB"), []);
});
