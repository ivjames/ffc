// Where does the capture bot point its browser, and is anything answering?
//
// Capture drives the PLAYER APP, not the API. On a dev box that's the Vite dev
// server on :5173; on a deployed box there is no dev server at all — nginx
// serves the built app (current/dist) on the venue vhost, and :5173 is nothing.
// Defaulting to the dev port meant a staging capture connection-refused its way
// through all 19 games and wrote a profile with zero rounds in it.
//
// The API already knows the app's origin: PUBLIC_APP_URL, the same value
// lib/appOrigin.js builds emailed links from. So that is the default, with
// FFC_APP_BASE as an explicit override for the cases it can't know (a capture
// pointed at a dev server, or at a vhost that isn't the configured one).
//
// Reachability is then PROBED rather than assumed, for the same reason the
// browser is: refusing with "nothing is answering at <url>" beats spawning a
// run that discovers it 19 times.
import { configuredAppUrl } from "./appOrigin.js";

const PROBE_TIMEOUT_MS = 5_000;
const TTL_OK_MS = 5 * 60_000;
const TTL_FAIL_MS = 30_000;

/** The origin capture should open, trailing slash stripped. */
export function captureAppBase() {
  const override = (process.env.FFC_APP_BASE || "").trim();
  return (override || configuredAppUrl()).replace(/\/$/, "");
}

let cache = null; // { base, value, expires }
let inFlight = null;

async function probeOnce(base) {
  try {
    const res = await fetch(base, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Any HTTP answer means something is serving here. Content is not our
    // business: a redirect or a 404 at the root can still be a working SPA
    // host, and the run itself will say so far more precisely than we can.
    return { reachable: true, base, status: res.status };
  } catch (err) {
    const why = String(err?.cause?.code || err?.name || err?.message || err);
    const refused = /ECONNREFUSED/i.test(why);
    return {
      reachable: false,
      base,
      status: null,
      reason: refused
        ? `nothing is listening at ${base}. Capture opens the PLAYER APP, which on a ` +
          "deployed box is served by nginx — not the Vite dev server. Set PUBLIC_APP_URL " +
          "to the app's origin (or FFC_APP_BASE to override just this tool), then restart the API."
        : `${base} did not answer (${why}). Capture opens the player app there; ` +
          "set PUBLIC_APP_URL, or FFC_APP_BASE to override just this tool.",
    };
  }
}

/** Cached reachability for the current base; concurrent callers share a probe. */
export async function appBaseStatus() {
  const base = captureAppBase();
  if (cache && cache.base === base && cache.expires > Date.now()) return cache.value;
  if (inFlight) return inFlight;
  inFlight = probeOnce(base)
    .then((value) => {
      cache = { base, value, expires: Date.now() + (value.reachable ? TTL_OK_MS : TTL_FAIL_MS) };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

/** Test seam / post-fix nudge: forget the cached answer. */
export function resetAppBaseStatus() {
  cache = null;
}
