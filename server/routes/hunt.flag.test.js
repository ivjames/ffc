// Verifies HUNT_ALLOW_PHOTO_OF_PHOTO's production fail-safe: the module-level
// flag is computed once at import time, so each case here re-imports hunt.js
// fresh (cache-busted via a query string) under a different env combination.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL ||= "postgres://ignored:ignored@localhost:5432/ignored";

let caseCounter = 0;
async function importHuntWith(env) {
  const prevValues = {};
  for (const key of ["NODE_ENV", "HUNT_ALLOW_PHOTO_OF_PHOTO"]) {
    prevValues[key] = process.env[key];
    if (env[key] === undefined) delete process.env[key];
    else process.env[key] = env[key];
  }
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args.join(" "));
  try {
    await import(`./hunt.js?case=${caseCounter++}`);
  } finally {
    console.warn = originalWarn;
    for (const key of Object.keys(prevValues)) {
      if (prevValues[key] === undefined) delete process.env[key];
      else process.env[key] = prevValues[key];
    }
  }
  return { warnings };
}

test("flag unset in production: no warning (default anti-cheat-active path)", async () => {
  const { warnings } = await importHuntWith({ NODE_ENV: "production" });
  assert.equal(warnings.length, 0);
});

test("flag truthy in a non-production env: no warning (test workflow preserved)", async () => {
  const { warnings } = await importHuntWith({
    NODE_ENV: "development",
    HUNT_ALLOW_PHOTO_OF_PHOTO: "true",
  });
  assert.equal(warnings.length, 0);
});

test("flag truthy with NODE_ENV=production: forced off, loud warning logged", async () => {
  const { warnings } = await importHuntWith({
    NODE_ENV: "production",
    HUNT_ALLOW_PHOTO_OF_PHOTO: "true",
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HUNT_ALLOW_PHOTO_OF_PHOTO/);
  assert.match(warnings[0], /production/i);
});

for (const truthy of ["1", "yes", "on", "TRUE"]) {
  test(`flag=${truthy} with NODE_ENV=production is treated as truthy and forced off`, async () => {
    const { warnings } = await importHuntWith({
      NODE_ENV: "production",
      HUNT_ALLOW_PHOTO_OF_PHOTO: truthy,
    });
    assert.equal(warnings.length, 1);
  });
}

test("flag=false-ish values (e.g. '0') stay off in production without a warning", async () => {
  const { warnings } = await importHuntWith({
    NODE_ENV: "production",
    HUNT_ALLOW_PHOTO_OF_PHOTO: "0",
  });
  assert.equal(warnings.length, 0);
});
