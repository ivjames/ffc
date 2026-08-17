// Launch signups — the marketing landing page's "tell me when it launches" box.
//
//   POST /api/launch-signup   -> store {email, consent}
//
// Who writes here: anyone on the public landing page, which is exactly the
// audience with no account — so this is an open write, the feedback.js stance.
// Open write means the caps here ARE the safety story:
//   - the only stored field is a single validated email (normalizeEmail: trim/
//     lowercase/shape/length), so there is nothing free-form to abuse
//   - a honeypot field (`company`) swallows dumb bots: filled in -> pretend
//     success, store nothing
//   - a fixed-window per-IP rate limit (the app-wide pattern, lib/rateLimit.js)
//     bounds what a single client can write
//
// Duplicates return the same 200 as first-time signups — the response must
// never reveal whether an address is already on the list (no enumeration).
// No mail is ever sent by this feature; the operator surface is
// routes/admin/launchSignups.js.
import { Router } from "express";
import { pool } from "../db.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import { normalizeEmail } from "../lib/validateUser.js";

export const router = Router();

// Nobody signs up for the same launch ten times an hour — past that it's a
// script, not a person.
const signupLimit = makeRateLimit({
  windowMs: 60 * 60_000,
  max: 10,
  name: "signup limit",
});

// Exposed for tests (the resetAuthRateLimits precedent in routes/auth.js).
export function resetLaunchSignupRateLimit() {
  signupLimit.reset();
}

// Honeypot: the form renders `company` invisibly and humans leave it blank. A
// filled-in value gets a convincing success so the bot moves on, and we store
// nothing. This runs BEFORE the limiter on purpose — a bot hammering the
// honeypot must not spend the per-IP bucket, or it would (a) start getting 429s
// that tell it the trap was noticed, and (b) lock out every real visitor
// sharing that NAT for the rest of the window.
function honeypotShortCircuit(req, res, next) {
  const { company } = req.body ?? {};
  if (typeof company === "string" && company.length > 0) {
    return res.json({ ok: true });
  }
  return next();
}

router.post("/", honeypotShortCircuit, signupLimit, async (req, res) => {
  const { email, consent } = req.body ?? {};

  const normalized = normalizeEmail(email);
  if (!normalized) {
    return res.status(400).json({ ok: false, error: "a valid email is required" });
  }
  // Consent is an explicit checkbox, not an implied default — the row records
  // what was actually agreed to, so anything but a literal true is a 400.
  if (consent !== true) {
    return res.status(400).json({ ok: false, error: "consent is required" });
  }

  try {
    // Upsert: a re-submit re-affirms consent and bumps updated_at, but
    // created_at keeps the first signup. Either way the response is the same
    // 200 — success must not disclose whether the address was already known.
    await pool.query(
      `insert into launch_signup (email, consent) values ($1, true)
       on conflict (email) do update
         set consent = excluded.consent, updated_at = now()`,
      [normalized]
    );
    return res.json({ ok: true });
  } catch (err) {
    console.error("[launch-signup] store error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
