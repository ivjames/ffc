import { test } from "node:test";
import assert from "node:assert/strict";
import { explainProbeFailure } from "./browserProbe.js";

// These messages are the point of the guard. It exists so an operator sees a
// sentence and a command instead of a Playwright stack trace in a log pane, so
// the mapping from failure to remedy is worth pinning.
//
// Deliberately NO test here launches a browser: the server suite is the deploy
// gate (bin/ffc run_server_tests), and it runs on API boxes that legitimately
// have no browser installed. A test that needed one would turn "this host can't
// capture" — a supported state — into a failed deploy.

test("missing browser binaries: names the install command, not the module", () => {
  // The real message from the staging box.
  const msg =
    "browserType.launch: Executable doesn't exist at " +
    "/root/.cache/ms-playwright/chromium_headless_shell-1194/chrome-linux/headless_shell";
  const out = explainProbeFailure(msg);
  assert.match(out, /binaries are not/);
  assert.match(out, /npx playwright install --with-deps chromium/);
  assert.doesNotMatch(out, /isn't installed on the API host/);
});

test("Playwright's own 'run npx playwright install' banner maps to the same remedy", () => {
  const out = explainProbeFailure("Please run the following command to download new browsers:\n\nnpx playwright install");
  assert.match(out, /binaries are not/);
  assert.match(out, /npx playwright install --with-deps chromium/);
});

test("missing npm package is a DIFFERENT remedy — install deps first", () => {
  const out = explainProbeFailure("Cannot find module '@playwright/test'");
  assert.match(out, /Playwright itself isn't installed/);
  assert.match(out, /npm ci/);
});

test("an unrecognised failure is passed through, not swallowed", () => {
  const out = explainProbeFailure("Target page, context or browser has been closed");
  assert.match(out, /could not be launched/);
  assert.match(out, /Target page, context or browser has been closed/);
});
