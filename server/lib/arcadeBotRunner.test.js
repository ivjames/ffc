import { test } from "node:test";
import assert from "node:assert/strict";
import { captureArgs, replayArgs, CAPTURE_SCRIPT, REPLAY_SCRIPT, PROFILE_DIR } from "./arcadeBotRunner.js";

// The argv builders are the seam between validated form input and a spawned
// process, so they're worth pinning: a flag that silently stops being emitted
// turns into a run with the wrong parameters and no error anywhere.

test("captureArgs: emits the base flags in a shape the script accepts", () => {
  const args = captureArgs({ rounds: 5, seed: 7, skill: null, games: [] }, "http://127.0.0.1:5173");
  assert.deepEqual(args, ["--base", "http://127.0.0.1:5173", "--rounds", "5", "--seed", "7"]);
});

test("captureArgs: skill 0 is a real value, not 'unset'", () => {
  // 0 is the beginner end of the scale — a truthiness check here would drop it
  // and silently capture a mixed-skill profile instead.
  const args = captureArgs({ rounds: 1, seed: 1, skill: 0, games: [] }, "http://x");
  assert.ok(args.includes("--skill"));
  assert.equal(args[args.indexOf("--skill") + 1], "0");
});

test("captureArgs: one --game per selected game, plus --out", () => {
  const args = captureArgs(
    { rounds: 2, seed: 1, skill: 1, games: ["skeeball", "darts"], out: "/tmp/p.json" },
    "http://x"
  );
  const games = args.filter((a, i) => args[i - 1] === "--game");
  assert.deepEqual(games, ["skeeball", "darts"]);
  assert.equal(args[args.indexOf("--out") + 1], "/tmp/p.json");
});

test("replayArgs: always passes --yes (the child has no tty to confirm on)", () => {
  const args = replayArgs(
    { locationId: "loc", plays: 10, players: 2, concurrency: 4, seed: 1, games: [] },
    "/p/prof.json",
    "http://127.0.0.1:8060"
  );
  assert.ok(args.includes("--yes"));
  assert.equal(args[args.indexOf("--profile") + 1], "/p/prof.json");
  assert.equal(args[args.indexOf("--api") + 1], "http://127.0.0.1:8060");
  assert.equal(args[args.indexOf("--location") + 1], "loc");
});

test("replayArgs: players 0 is passed through (reuse cached sessions only)", () => {
  const args = replayArgs(
    { locationId: "loc", plays: 1, players: 0, concurrency: 1, seed: 1, games: [] },
    "/p",
    "http://x"
  );
  assert.equal(args[args.indexOf("--players") + 1], "0");
});

test("replayArgs: optional flags appear only when set", () => {
  const bare = replayArgs(
    { locationId: "l", plays: 1, players: 1, concurrency: 1, seed: 1, intervalMin: null, sweeps: null, dryRun: false, games: [] },
    "/p",
    "http://x"
  );
  assert.ok(!bare.includes("--interval-min"));
  assert.ok(!bare.includes("--sweeps"));
  assert.ok(!bare.includes("--dry-run"));

  const full = replayArgs(
    { locationId: "l", plays: 1, players: 1, concurrency: 1, seed: 1, intervalMin: 30, sweeps: 3, dryRun: true, games: ["trivia"] },
    "/p",
    "http://x"
  );
  assert.equal(full[full.indexOf("--interval-min") + 1], "30");
  assert.equal(full[full.indexOf("--sweeps") + 1], "3");
  assert.ok(full.includes("--dry-run"));
  assert.equal(full[full.indexOf("--game") + 1], "trivia");
});

test("script paths point at the two known scripts, and profiles live under data/", () => {
  assert.match(CAPTURE_SCRIPT, /scripts[/\\]arcade-bot\.mjs$/);
  assert.match(REPLAY_SCRIPT, /scripts[/\\]arcade-traffic\.mjs$/);
  assert.match(PROFILE_DIR, /data[/\\]arcade-profiles$/);
});
