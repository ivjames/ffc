import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAllowPhotoOfPhoto } from "./huntAntiCheat.js";

function withWarnings(fn) {
  const warnings = [];
  const result = fn((msg) => warnings.push(msg));
  return { result, warnings };
}

test("flag unset: bypass off, no warning, in any env", () => {
  for (const nodeEnv of [undefined, "development", "production"]) {
    const { result, warnings } = withWarnings((warn) =>
      resolveAllowPhotoOfPhoto({ rawFlag: undefined, nodeEnv, warn })
    );
    assert.equal(result, false);
    assert.equal(warnings.length, 0);
  }
});

test("flag truthy outside production: bypass on, no warning (test workflow preserved)", () => {
  const { result, warnings } = withWarnings((warn) =>
    resolveAllowPhotoOfPhoto({ rawFlag: "true", nodeEnv: "development", warn })
  );
  assert.equal(result, true);
  assert.equal(warnings.length, 0);
});

test("flag truthy with NODE_ENV=production: forced off, loud warning logged", () => {
  const { result, warnings } = withWarnings((warn) =>
    resolveAllowPhotoOfPhoto({ rawFlag: "true", nodeEnv: "production", warn })
  );
  assert.equal(result, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /HUNT_ALLOW_PHOTO_OF_PHOTO/);
  assert.match(warnings[0], /production/i);
});

for (const truthy of ["1", "yes", "on", "TRUE", "On"]) {
  test(`flag=${truthy} with NODE_ENV=production is treated as truthy and forced off`, () => {
    const { result, warnings } = withWarnings((warn) =>
      resolveAllowPhotoOfPhoto({ rawFlag: truthy, nodeEnv: "production", warn })
    );
    assert.equal(result, false);
    assert.equal(warnings.length, 1);
  });
}

for (const falsy of ["0", "false", "no", "off", "", "garbage"]) {
  test(`flag=${JSON.stringify(falsy)} in production stays off without a warning`, () => {
    const { result, warnings } = withWarnings((warn) =>
      resolveAllowPhotoOfPhoto({ rawFlag: falsy, nodeEnv: "production", warn })
    );
    assert.equal(result, false);
    assert.equal(warnings.length, 0);
  });
}

test("defaults warn to console.warn when not injected (smoke test)", () => {
  const original = console.warn;
  let called = false;
  console.warn = () => {
    called = true;
  };
  try {
    resolveAllowPhotoOfPhoto({ rawFlag: "true", nodeEnv: "production" });
  } finally {
    console.warn = original;
  }
  assert.equal(called, true);
});
