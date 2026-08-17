// Which origin does a link we EMAIL point at?
//
// Every venue is its own subdomain (MULTI-VENUE.md), but magic-link and
// team-invite URLs were built from one global PUBLIC_APP_URL. On a multi-venue
// instance that is broken, not merely untidy:
//
//   1. The session cookie is host-only (no Domain attribute — lib/userAuth.js).
//      /api/auth/magic sets it for the host the LINK was opened on, then
//      redirected to PUBLIC_APP_URL. A player at tukwila.<platform> clicking
//      their own sign-in link landed on bullwinkles.<platform>, signed in
//      THERE, and was still signed out at their own venue.
//   2. They'd be looking at another client's brand, catalog, and boards.
//
// So the link has to be built from the request the player actually made. The
// catch is that Host is attacker-controlled: accepting it blindly turns any
// "email me a sign-in link" form into a phishing generator (send
// `Host: evil.example`, and OUR mail server delivers a link to evil.example
// carrying a valid token). Classic host-header injection.
//
// Hence an allow-list, not trust. A request's host is used only when it is one
// of:
//   - the configured PUBLIC_APP_URL's own host (the single-tenant case), or
//   - the platform apex or www.<apex>, or
//   - a subdomain of PLATFORM_FQDN (which is exactly the set of venue hosts).
// Anything else falls back to PUBLIC_APP_URL. An unknown host therefore
// degrades to today's behavior instead of minting a link to it.
//
// Scheme comes from X-Forwarded-Proto (nginx sets it; app.js trusts one proxy
// hop), because the Node process itself only ever sees plain HTTP.

const DEFAULT_APP_URL = "http://localhost:5173";

/** The configured fallback origin, trailing slash stripped. */
export function configuredAppUrl() {
  return (process.env.PUBLIC_APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
}

/** Host of PUBLIC_APP_URL, lowercased and port-stripped; null if unparseable. */
function configuredHost() {
  try {
    return new URL(configuredAppUrl()).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Is `host` a host we are willing to put in an outbound email?
 * Exported for the tests — the allow-list IS the security boundary here.
 */
export function isAllowedHost(host) {
  const h = String(host || "")
    .toLowerCase()
    .replace(/:\d+$/, "");
  if (!h) return false;
  if (h === configuredHost()) return true;
  const platform = (process.env.PLATFORM_FQDN || "").trim().toLowerCase();
  if (platform === "") return false; // single-tenant deploy: only the configured host
  return h === platform || h === `www.${platform}` || h.endsWith(`.${platform}`);
}

/**
 * The origin to build emailed links (and post-sign-in redirects) against, for
 * this request. Falls back to PUBLIC_APP_URL whenever the request's own host
 * isn't one we recognise.
 *
 * @param {import("express").Request} req
 * @returns {string} e.g. "https://tukwila.ffc.example" (no trailing slash)
 */
export function appOrigin(req) {
  const host = String(req?.hostname || "").toLowerCase();
  if (!isAllowedHost(host)) return configuredAppUrl();
  // req.protocol honours X-Forwarded-Proto under `trust proxy` (app.js).
  const proto = req.protocol === "https" ? "https" : "http";
  // Keep the port only when the request carried one and it isn't the default —
  // it matters for local dev (localhost:5173), never in production.
  const rawHost = String(req.get?.("host") || host);
  const portMatch = rawHost.match(/:(\d+)$/);
  const port = portMatch && portMatch[1] !== (proto === "https" ? "443" : "80") ? `:${portMatch[1]}` : "";
  return `${proto}://${host}${port}`;
}

/**
 * Escape a string for interpolation into an HTML email body. Lives here beside
 * the link builders because outbound mail is the one place this codebase
 * assembles HTML by hand — a player's display name goes straight into the team
 * invite, and a display name is user-controlled text.
 */
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/**
 * Validate a caller-supplied post-sign-in destination. Only same-app absolute
 * PATHS are allowed — never a full URL, and never a protocol-relative "//evil"
 * (which a browser reads as an absolute URL to another host). Returns null for
 * anything else, so the caller lands on the app root.
 */
export function safeNextPath(raw) {
  if (typeof raw !== "string" || raw === "") return null;
  if (raw.length > 300) return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null; // protocol-relative → off-site
  if (raw.includes("\\")) return null; // some parsers treat \ as /
  return raw;
}
