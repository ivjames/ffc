// Unit tests for the fail-closed APP_TOKEN guard (server/lib/adminAuth.js).
// isAuthorized/requireAppToken are pure w.r.t. req + process.env.APP_TOKEN, so
// these run with mock req/res and no real database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAuthorized, requireAppToken } from "./adminAuth.js";

function mockReq(headers = {}) {
  return { get: (name) => headers[name.toLowerCase()] };
}

function mockRes() {
  const res = { statusCode: null, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
}

function withEnv(value, fn) {
  const prev = process.env.APP_TOKEN;
  if (value === undefined) delete process.env.APP_TOKEN;
  else process.env.APP_TOKEN = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.APP_TOKEN;
    else process.env.APP_TOKEN = prev;
  }
}

test("isAuthorized denies every request when APP_TOKEN is unset (fail closed)", () => {
  withEnv(undefined, () => {
    assert.equal(isAuthorized(mockReq()), false);
    assert.equal(isAuthorized(mockReq({ "x-app-token": "" })), false);
    assert.equal(isAuthorized(mockReq({ "x-app-token": "anything" })), false);
  });
});

test("isAuthorized denies every request when APP_TOKEN is an empty string (fail closed)", () => {
  withEnv("", () => {
    assert.equal(isAuthorized(mockReq({ "x-app-token": "" })), false);
  });
});

test("isAuthorized allows a request with the matching token once APP_TOKEN is set", () => {
  withEnv("secret123", () => {
    assert.equal(isAuthorized(mockReq({ "x-app-token": "secret123" })), true);
  });
});

test("isAuthorized rejects a missing or wrong token once APP_TOKEN is set (no regression)", () => {
  withEnv("secret123", () => {
    assert.equal(isAuthorized(mockReq()), false);
    assert.equal(isAuthorized(mockReq({ "x-app-token": "wrong" })), false);
  });
});

test("requireAppToken middleware: 401 + no next() when unauthorized", () => {
  withEnv(undefined, () => {
    const req = mockReq();
    const res = mockRes();
    let nextCalled = false;
    requireAppToken(req, res, () => {
      nextCalled = true;
    });
    assert.equal(res.statusCode, 401);
    assert.equal(res.body.ok, false);
    assert.equal(nextCalled, false);
  });
});

test("requireAppToken middleware: calls next() when authorized", () => {
  withEnv("secret123", () => {
    const req = mockReq({ "x-app-token": "secret123" });
    const res = mockRes();
    let nextCalled = false;
    requireAppToken(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, null); // untouched
  });
});
