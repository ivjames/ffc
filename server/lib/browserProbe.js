// "Can this host actually run a headless browser?" — answered by launching one.
//
// The arcade bot's capture half drives real Chromium, and an API box has no
// reason to ship one, so the admin refuses capture rather than spawning a run
// that dies with a Playwright stack trace. The question is how to KNOW.
//
// The first version of this checked whether a browsers DIRECTORY existed
// (PLAYWRIGHT_BROWSERS_PATH, /opt/pw-browsers, ~/.cache/ms-playwright) and
// said "available" if one did. That is not the same question, and it said yes
// on a staging box where ~/.cache/ms-playwright existed but held no usable
// build — capture started and died on "Executable doesn't exist at
// .../chromium_headless_shell-1194/chrome-linux/headless_shell", which is
// precisely the failure the guard existed to prevent.
//
// Nor is checking `chromium.executablePath()` enough: that names the HEADED
// chrome binary, while a headless launch uses the separate headless-shell
// build, whose path Playwright does not expose. A host can have one and not
// the other — as that box did.
//
// So: launch one and close it. That is exactly what capture does, so the check
// cannot drift from the thing it is checking. Two details make it affordable:
//
//   - it runs in a SHORT-LIVED CHILD, so a ~100MB Playwright module graph
//     never loads into the long-lived API process, and
//   - the answer is CACHED, because installing a browser is a rare event and
//     the admin page polls this every 4s while a bot runs.
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

// Long enough for a cold chromium start on a loaded box; short enough that a
// wedged probe doesn't hold the status endpoint open.
const PROBE_TIMEOUT_MS = 30_000;
// Re-probe occasionally so installing a browser takes effect without a
// restart. Failures re-probe sooner: an operator who just ran the install
// command is watching this page for it to clear.
const TTL_OK_MS = 30 * 60_000;
const TTL_FAIL_MS = 60_000;

// The probe body. Resolving the path AND launching covers both failure shapes
// with different remedies: the npm package missing (MODULE_NOT_FOUND) vs the
// package present but its browser binaries never downloaded.
const PROBE = `
const { chromium } = require('@playwright/test');
chromium.launch({ headless: true })
  .then((b) => b.close())
  .then(() => { console.log(JSON.stringify({ ok: true, at: chromium.executablePath() })); })
  .catch((e) => { console.log(JSON.stringify({ ok: false, message: String(e && e.message || e) })); });
`;

let cache = null; // { value, expires }
let inFlight = null;

/** Turn a probe failure into something an operator can act on. Exported for
 *  tests: these messages ARE the feature — a guard that says "no" without
 *  saying what to run is barely better than the stack trace it replaced. */
export function explainProbeFailure(message) {
  const install = "cd " + ROOT + " && npx playwright install --with-deps chromium";
  if (/Cannot find module|MODULE_NOT_FOUND/i.test(message)) {
    return (
      "Playwright itself isn't installed on the API host, so capture can't run here. " +
      `Install the repo's dev dependencies (npm ci in ${ROOT}), then: ${install}`
    );
  }
  if (/Executable doesn't exist|playwright install/i.test(message)) {
    return (
      "Playwright is installed but its browser binaries are not — they download separately " +
      `and no deploy step fetches them. On the API host run: ${install}`
    );
  }
  return `A headless browser could not be launched on the API host: ${message}`;
}

function probeOnce() {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      ["-e", PROBE],
      { cwd: ROOT, timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        // A timeout or a crash before the probe printed anything is its own
        // answer — "we could not get a browser" — not a reason to claim one.
        let parsed = null;
        try {
          parsed = JSON.parse(String(stdout).trim().split("\n").pop() || "");
        } catch {
          /* fall through to the error shape below */
        }
        if (parsed?.ok) return resolve({ available: true, at: parsed.at ?? null });
        const message = parsed?.message ?? err?.message ?? "the browser probe produced no answer";
        return resolve({ available: false, at: null, reason: explainProbeFailure(message) });
      }
    );
  });
}

/**
 * Cached answer. Concurrent callers share one probe — the admin page polls
 * every 4s, and a cold cache must not fan out into a browser launch per poll.
 */
export async function browserStatus() {
  if (cache && cache.expires > Date.now()) return cache.value;
  if (inFlight) return inFlight;
  inFlight = probeOnce()
    .then((value) => {
      cache = { value, expires: Date.now() + (value.available ? TTL_OK_MS : TTL_FAIL_MS) };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam / post-install nudge: forget the cached answer. */
export function resetBrowserStatus() {
  cache = null;
}
