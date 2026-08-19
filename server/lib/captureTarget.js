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
    const res = await fetch(base, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    // Any HTTP answer means something is serving here. Content is not our
    // business: a redirect or a 404 at the root can still be a working SPA
    // host, and the run itself will say so far more precisely than we can.
    return { ok: true, status: res.status };
  } catch (err) {
    return { ok: false, why: String(err?.cause?.code || err?.name || err?.message || err) };
  }
}

async function probeAll(candidates) {
  // Probe in parallel, then pick by PRIORITY — so the ordering above decides,
  // not whichever host happened to answer first, and the whole check costs one
  // timeout rather than one per candidate.
  const results = await Promise.all(candidates.map((c) => reach(c.base)));
  const tried = candidates.map((c, i) => ({
    base: c.base,
    why: c.why,
    ok: results[i].ok,
    detail: results[i].ok ? `HTTP ${results[i].status}` : results[i].why,
  }));

  const hit = tried.find((t) => t.ok);
  if (hit) return { reachable: true, base: hit.base, status: null, why: hit.why, tried };

  return {
    reachable: false,
    base: candidates[0]?.base ?? null,
    status: null,
    tried,
    reason:
      "no player app is answering. Capture opens the PLAYER APP — the Vite dev server on a dev " +
      "box, nginx on a deployed one — never the API port. Tried: " +
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
  inFlight = probeAll(candidates)
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
