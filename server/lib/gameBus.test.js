import { test } from "node:test";
import assert from "node:assert/strict";
import { subscribe, publish, sseSend, subscriberCount } from "./gameBus.js";

function fakeRes() {
  return {
    chunks: [],
    write(chunk) {
      this.chunks.push(chunk);
    },
  };
}

test("publish reaches every subscriber of that game and no other", () => {
  const a1 = fakeRes();
  const a2 = fakeRes();
  const b = fakeRes();
  const offA1 = subscribe("game-a", a1);
  const offA2 = subscribe("game-a", a2);
  const offB = subscribe("game-b", b);

  publish("game-a", "score", { slot: 0, hole: 1, strokes: 2 });
  assert.equal(a1.chunks.length, 1);
  assert.equal(a2.chunks.length, 1);
  assert.equal(b.chunks.length, 0);
  assert.match(a1.chunks[0], /^event: score\ndata: \{"slot":0/);

  offA1();
  offA2();
  offB();
});

test("unsubscribe removes the connection and empties the channel", () => {
  const res = fakeRes();
  const off = subscribe("game-c", res);
  assert.equal(subscriberCount("game-c"), 1);
  off();
  assert.equal(subscriberCount("game-c"), 0);
  publish("game-c", "score", {}); // no throw, nothing delivered
  assert.equal(res.chunks.length, 0);
});

test("publish to a game with no subscribers is a no-op", () => {
  publish("nobody-home", "score", {});
});

test("a subscriber whose write throws doesn't break the fan-out", () => {
  const broken = {
    write() {
      throw new Error("EPIPE");
    },
  };
  const healthy = fakeRes();
  const offBroken = subscribe("game-d", broken);
  const offHealthy = subscribe("game-d", healthy);
  publish("game-d", "score", { hole: 3 });
  assert.equal(healthy.chunks.length, 1);
  offBroken();
  offHealthy();
});

test("sseSend formats the SSE wire shape", () => {
  const res = fakeRes();
  sseSend(res, "snapshot", { a: 1 });
  assert.equal(res.chunks[0], 'event: snapshot\ndata: {"a":1}\n\n');
});
