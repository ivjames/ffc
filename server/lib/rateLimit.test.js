import { test } from "node:test";
import assert from "node:assert/strict";
import { makeRateLimit } from "./rateLimit.js";

function run(middleware, req = { ip: "1.2.3.4" }) {
  let status = 200;
  let nexted = false;
  const res = {
    headers: {},
    set(k, v) { this.headers[k] = v; return this; },
    status(s) { status = s; return this; },
    json() { return this; },
  };
  middleware(req, res, () => { nexted = true; });
  return { status, nexted, res };
}

test("allows up to max hits then 429s with Retry-After", () => {
  const limit = makeRateLimit({ windowMs: 60_000, max: 2, name: "test limit" });
  assert.equal(run(limit).nexted, true);
  assert.equal(run(limit).nexted, true);
  const third = run(limit);
  assert.equal(third.nexted, false);
  assert.equal(third.status, 429);
  assert.ok(Number(third.res.headers["Retry-After"]) >= 1);
});

test("buckets are independent per key", () => {
  const limit = makeRateLimit({ windowMs: 60_000, max: 1 });
  assert.equal(run(limit, { ip: "a" }).nexted, true);
  assert.equal(run(limit, { ip: "b" }).nexted, true);
  assert.equal(run(limit, { ip: "a" }).nexted, false);
});

test("custom keyFn buckets by its return value and skips on falsy", () => {
  const limit = makeRateLimit({ windowMs: 60_000, max: 1, keyFn: (req) => req.body?.email || null });
  assert.equal(run(limit, { body: { email: "x@y.co" } }).nexted, true);
  assert.equal(run(limit, { body: { email: "x@y.co" } }).nexted, false);
  // No email -> no bucket -> never limited.
  assert.equal(run(limit, { body: {} }).nexted, true);
  assert.equal(run(limit, { body: {} }).nexted, true);
});

test("reset() clears all buckets", () => {
  const limit = makeRateLimit({ windowMs: 60_000, max: 1 });
  assert.equal(run(limit).nexted, true);
  assert.equal(run(limit).nexted, false);
  limit.reset();
  assert.equal(run(limit).nexted, true);
});
