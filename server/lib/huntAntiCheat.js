// Pure resolver for HUNT_ALLOW_PHOTO_OF_PHOTO, extracted from routes/hunt.js
// so it's directly unit-testable (no re-importing routes/hunt.js under
// different env combos, which was corrupting whole-suite coverage reports —
// each dynamic re-import muddied V8's per-file coverage accounting).
const TRUTHY_RE = /^(1|true|yes|on)$/i;

/**
 * TESTING ONLY — remove before production. When HUNT_ALLOW_PHOTO_OF_PHOTO is
 * truthy, the anti-cheat photo-of-a-photo check is bypassed, so testers can
 * verify landmarks from screenshots or pictures of a screen. Leave it UNSET in
 * production so the anti-cheat is active (the default, production-safe path).
 *
 * Fail-safe: even if the flag is accidentally left set in a production deploy
 * config, this forces it off rather than letting the bypass reach a public,
 * unauthenticated, family-venue upload endpoint.
 *
 * @param {object} args
 * @param {string|undefined} args.rawFlag   process.env.HUNT_ALLOW_PHOTO_OF_PHOTO
 * @param {string|undefined} args.nodeEnv   process.env.NODE_ENV
 * @param {(msg: string) => void} [args.warn]  injectable for tests; defaults to console.warn
 * @returns {boolean} whether the anti-cheat bypass is active
 */
export function resolveAllowPhotoOfPhoto({ rawFlag, nodeEnv, warn = console.warn }) {
  const truthy = TRUTHY_RE.test(rawFlag ?? "");
  const isProduction = nodeEnv === "production";
  if (truthy && isProduction) {
    warn(
      "[hunt] HUNT_ALLOW_PHOTO_OF_PHOTO is set truthy with NODE_ENV=production — " +
        "forcing it OFF. This flag is TEST ONLY and must never be set in a " +
        "production deploy config; remove it from that environment's config."
    );
  }
  return truthy && !isProduction;
}
