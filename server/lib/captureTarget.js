// Where does the capture bot point its browser, and is anything answering?
//
// Capture drives the PLAYER APP, not the API. On a dev box that's the Vite dev
// server on :5173; on a deployed box there is no dev server at all — nginx
// serves the built app on a per-org vhost, `<org-slug>.<PLATFORM_FQDN>` (see
// bin/ffc, which prints "Player app: https://$DEFAULT_ORG_HOST" on setup).
// Defaulting to the dev port meant a staging capture connection-refused its way
// through all 19 games and wrote a profile with zero rounds in it.
//
// DERIVE IT, DON'T ASK FOR IT. Everything needed is already here: PLATFORM_FQDN
// is in the API's environment and the org slugs are rows in `org`, so the venue
// origins can be computed rather than hand-configured. Asking an operator to
// paste a URL the software can work out is the kind of setup step that is
// wrong on day one and silently wrong forever after.
//
// So: build the candidate origins in priority order, probe them, and use the
// first that answers. An explicit FFC_APP_BASE still wins — that is the escape
// hatch for a capture pointed somewhere unusual (a dev server, a staging vhost
// that isn't derivable) — and PUBLIC_APP_URL is honoured next, since a
// single-tenant deploy sets it and it is the same value emailed links use.
import { configuredAppUrl } from "./appOrigin.js";

const PROBE_TIMEOUT_MS = 5_000;
const TTL_OK_MS = 5 * 60_000;
const TTL_FAIL_MS = 30_000;

const DEV_BASE = "http://127.0.0.1:5173";

// A real player route, not `/`. It proves the two things capture needs: that
// something is serving, AND that deep SPA paths fall back to index.html — the
// bot navigates straight to /arcade/<game> and never touches the root.
const PROBE_PATH = "/arcade/skeeball";

// Markers that identify THE PLAYER APP specifically. "Something answered HTTP"
// is not the question: point this at the API and a JSON 404 would pass, capture
// would be enabled, and every game would then fail on a missing canvas — errors
// that are not net::ERR_* and so slip past the run's fail-fast, burning ~15s per
// game. Both markers live in index.html and survive the build; neither appears
// in the admin bundle, so an admin vhost is rejected too.
const APP_MARKERS = ["/api/manifest.webmanifest", "ffc-skin"];
// index.html is ~2KB. Anything vastly larger is not it, and is not worth
// reading into the API process to find out.
const MAX_BODY_BYTES = 512 * 1024;

const strip = (u) => String(u || "").trim().replace(/\/$/, "");

/**
 * Candidate player-app origins, best first, each with why it's a candidate so
 * the admin can show what was tried when none of them answer.
 * @param {string[]} orgSlugs live org slugs, preferred order
 */
export function appBaseCandidates(orgSlugs = []) {
  const out = [];
  const seen = new Set();
  const add = (url, why) => {
    const u = strip(url);
    if (!u || seen.has(u)) return;
    seen.add(u);
    out.push({ base: u, why });
  };

  add(process.env.FFC_APP_BASE, "FFC_APP_BASE");
  // configuredAppUrl() falls back to a localhost default when PUBLIC_APP_URL is
  // unset; only take it when it was actually configured, or every deployed box
  // would rank a dev URL above its own derived vhost.
  if ((process.env.PUBLIC_APP_URL || "").trim()) add(configuredAppUrl(), "PUBLIC_APP_URL");

  const platform = (process.env.PLATFORM_FQDN || "").trim().toLowerCase();
  if (platform) {
    const preferred = (process.env.DEFAULT_ORG_SLUG || "bullwinkles").trim().toLowerCase();
    const slugs = [...orgSlugs].sort((a, b) => Number(b === preferred) - Number(a === preferred));
    for (const slug of slugs) {
      if (slug) add(`https://${slug}.${platform}`, `org vhost (${slug}.${platform})`);
    }
    // No orgs to go on: the default slug is still the documented vhost.
    if (slugs.length === 0) add(`https://${preferred}.${platform}`, "default org vhost");
  }

  add(DEV_BASE, "dev server");
  return out;
}

let cache = null; // { key, value, expires }
let inFlight = null;

async function reach(base) {
  try {
    // `follow`, not `manual`: a deployed vhost may 301 http→https or apex→org,
    // and landing on the app after a redirect is a pass.
    const res = await fetch(base + PROBE_PATH, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (res.status >= 400) return { ok: false, why: `HTTP ${res.status}`, answered: true };

    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BODY_BYTES) return { ok: false, why: "not the player app", answered: true };
    const body = (await res.text()).slice(0, MAX_BODY_BYTES);
    if (!APP_MARKERS.some((m) => body.includes(m))) {
      return { ok: false, why: "not the player app", answered: true };
    }
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, why: String(err?.cause?.code || err?.name || err?.message || err) };
  }
}

/**
 * Probe a candidate list and pick by priority. Exported for tests: the real
 * candidate list always ends with the dev-server fallback, so a test that
 * goes through appBaseStatus() inherits whatever happens to be listening on
 * :5173 — on a dev box with vite up, a "reject the wrong app" test would find
 * the real app via the fallback and fail. Tests probe exactly their stubs.
 */
export async function probeAppBases(candidates) {
  // Probe in parallel, then pick by PRIORITY — so the ordering above decides,
  // not whichever host happened to answer first, and the whole check costs one
  // timeout rather than one per candidate.
  const results = await Promise.all(candidates.map((c) => reach(c.base)));
  const tried = candidates.map((c, i) => ({
    base: c.base,
    why: c.why,
    ok: results[i].ok,
    answered: results[i].answered === true,
    detail: results[i].ok ? `HTTP ${results[i].status}` : results[i].why,
  }));

  const hit = tried.find((t) => t.ok);
  if (hit) return { reachable: true, base: hit.base, status: null, why: hit.why, tried };

  // "Something answered but it wasn't the app" is a different mistake from
  // "nothing answered", and it has a different fix — so say which.
  const wrongApp = tried.some((t) => t.answered);
  return {
    reachable: false,
    base: candidates[0]?.base ?? null,
    status: null,
    tried,
    reason:
      (wrongApp
        ? "no player app found. Something is serving, but it isn't the player app — the API and " +
          "the admin site both answer without being it. "
        : "no player app is answering. ") +
      "Capture opens the PLAYER APP — the Vite dev server on a dev box, nginx on a deployed one — " +
      `never the API port. Tried ${PROBE_PATH} on: ` +
      tried.map((t) => `${t.base} (${t.detail})`).join(", ") +
      ". Set PLATFORM_FQDN so the org vhosts can be derived, or FFC_APP_BASE to point this tool " +
      "at a specific origin.",
  };
}

/** Cached reachability. Concurrent callers share one probe. */
export async function appBaseStatus(orgSlugs = []) {
  const candidates = appBaseCandidates(orgSlugs);
  const key = candidates.map((c) => c.base).join("|");
  if (cache && cache.key === key && cache.expires > Date.now()) return cache.value;
  if (inFlight) return inFlight;
  inFlight = probeAppBases(candidates)
    .then((value) => {
      cache = { key, value, expires: Date.now() + (value.reachable ? TTL_OK_MS : TTL_FAIL_MS) };
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
