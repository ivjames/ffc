// Player accounts — passwordless email sign-in (registration and sign-in are
// the same flow: request a code, verify it, and the account exists).
//
//   POST /api/auth/request-code  {email, profile?}   -> {ok:true} (always)
//   POST /api/auth/verify        {email, code}       -> {ok, user} + session cookie
//   GET  /api/auth/magic?token=...                   -> 302 to the app + session cookie
//   GET  /api/auth/me                                -> {ok, user} | 401
//   PATCH /api/auth/me           {displayName?, defaultTag?}
//   POST /api/auth/logout                            -> {ok} + cookie clear
//
// request-code answers {ok:true} whether or not the address has an account —
// same non-enumeration stance as the admin login's uniform error.
import { Router } from "express";
import { pool } from "../db.js";
import { normalizeEmail, normalizeProfile } from "../lib/validateUser.js";
import { createAuthCode, verifyAuthCode, verifyMagicToken } from "../lib/authCodes.js";
import { sendMail, isMailDeliveryConfigured } from "../lib/mailer.js";
import { tenant } from "../lib/tenant.js";
import { appOrigin, safeNextPath, escapeHtml } from "../lib/appOrigin.js";
import { resolveBranding } from "../lib/branding.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import {
  USER_COOKIE_NAME,
  serializeUserCookie,
  clearUserCookieHeader,
  createUserSession,
  deleteUserSession,
  upsertVerifiedUser,
  requireUser,
  isProd,
} from "../lib/userAuth.js";
import { parseCookies } from "../lib/adminSession.js";

export const router = Router();

// --- Rate limits ------------------------------------------------------------
// Email sends are the abuse surface (cost + spam): 3 per address / 15 min and
// 10 per IP / hour. Verifies are cheap but guessable: 10 per IP / minute on
// top of the per-code 5-attempt lockout in authCodes.js.
const emailSendLimit = makeRateLimit({
  windowMs: 15 * 60_000,
  max: 3,
  keyFn: (req) => normalizeEmail(req.body?.email) || null,
  name: "code request limit",
});
const ipSendLimit = makeRateLimit({ windowMs: 60 * 60_000, max: 10, name: "code request limit" });
const verifyLimit = makeRateLimit({ windowMs: 60_000, max: 10, name: "verify limit" });

export function resetAuthRateLimits() {
  emailSendLimit.reset();
  ipSendLimit.reset();
  verifyLimit.reset();
}

/**
 * The sign-in email. LINK-FIRST: the button is the primary action and the
 * 6-digit code is the fallback below it, because one tap beats reading six
 * digits off one screen and typing them into another.
 *
 * The code still matters and is never dropped — a link opens in whatever
 * browser the mail app hands it to, which on a phone is often NOT the browser
 * (or the installed PWA) the player started in. When that happens the link
 * signs them in somewhere they weren't, and the code is the only thing that
 * finishes the flow on the original device. So: both, link first.
 *
 * `origin` is per-tenant (lib/appOrigin.js), not a global constant — see the
 * note there on why a venue's link must point at that venue's own host.
 */
function codeEmail({ code, magicToken, origin, appName, next }) {
  const params = new URLSearchParams({ token: magicToken });
  if (next) params.set("next", next);
  const link = `${origin}/api/auth/magic?${params}`;
  const brand = appName || "FFC";
  const text = [
    `Tap to sign in to ${brand}:`,
    link,
    ``,
    `Or type this code into the app instead: ${code}`,
    ``,
    `Use the code if you opened this email somewhere other than the device`,
    `you're signing in on — the link signs in whichever browser opens it.`,
    ``,
    `Both expire in 10 minutes. If you didn't request this, ignore this email.`,
  ].join("\n");
  const html = [
    `<p style="font-size:16px">Tap to sign in to <b>${escapeHtml(brand)}</b>:</p>`,
    `<p><a href="${link}" style="display:inline-block;padding:12px 28px;border-radius:999px;`,
    `background:#15803d;color:#ffffff;font-weight:bold;font-size:16px;text-decoration:none">Sign in</a></p>`,
    `<p style="color:#555">Or type this code into the app instead:</p>`,
    `<p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>`,
    `<p style="color:#555;font-size:13px">Use the code if you opened this email somewhere other than`,
    ` the device you're signing in on — the link signs in whichever browser opens it.</p>`,
    `<p style="color:#555;font-size:13px">Both expire in 10 minutes. If you didn't request this, ignore this email.</p>`,
  ].join("\n");
  return { subject: `Sign in to ${brand} (code ${code})`, text, html };
}


// tenant() resolves the org this subdomain serves so the OTP send is metered
// against THAT org's MAIL_DAILY_CAP pool (lib/mailer.js) — one client's busy
// Saturday must not lock another client's players out of sign-in. No
// resolvable tenant (no live orgs) attributes to the null pool.
router.post("/request-code", ipSendLimit, emailSendLimit, tenant(), async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, error: "email must be a valid address" });
  const profileCheck = normalizeProfile(req.body?.profile);
  if (profileCheck.error) return res.status(400).json({ ok: false, error: profileCheck.error });
  // Where the player was heading before the sign-in gate stopped them, so the
  // link returns them THERE instead of the app root. Path-only and validated
  // (lib/appOrigin.js) — an emailed redirect target is a phishing primitive if
  // it can point off-site.
  const next = safeNextPath(req.body?.next);
  try {
    const { code, magicToken } = await createAuthCode(email, profileCheck.row);
    const { subject, text, html } = codeEmail({
      code,
      magicToken,
      // Per tenant, not the global PUBLIC_APP_URL: the session cookie the link
      // sets is host-only, so a link pointing at another venue's host signs
      // the player in on that host and leaves them signed out on their own.
      origin: appOrigin(req),
      appName: resolveBranding(req.tenant?.org?.branding).appName,
      next,
    });
    await sendMail({
      to: email,
      subject,
      text,
      html,
      kind: "otp",
      orgSlug: req.tenant?.org?.slug ?? null,
    });
    // BYPASS while no real mail provider is configured: hand the code straight
    // back so the app can sign in without an inbox — the stopgap until Resend
    // is wired up. Setting MAIL_PROVIDER retires this automatically (checked
    // per request, no restart). DEV ONLY: in production a returned code would
    // let anyone sign in as any address, so there the misconfiguration fails
    // safe (no code anywhere — sign-in is down until a provider is set).
    if (!isMailDeliveryConfigured() && !isProd()) {
      return res.json({ ok: true, bypassCode: code });
    }
    // Uniform response — never reveals whether the address has an account, and
    // a mailer failure is not surfaced either (that too would leak, and the
    // client can only say "check your inbox" regardless).
    return res.json({ ok: true });
  } catch (err) {
    console.error("[auth] request-code error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

async function establishSession(res, email, profile) {
  const user = await upsertVerifiedUser(email, profile);
  const { token } = await createUserSession(user.id);
  res.set("Set-Cookie", serializeUserCookie(token, { secure: isProd() }));
  return user;
}

router.post("/verify", verifyLimit, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, error: "email must be a valid address" });
  try {
    const result = await verifyAuthCode(email, req.body?.code);
    if (!result.ok) {
      return res.status(401).json({ ok: false, error: "invalid or expired code" });
    }
    const user = await establishSession(res, email, result.profile);
    return res.json({ ok: true, user });
  } catch (err) {
    console.error("[auth] verify error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.get("/magic", verifyLimit, async (req, res) => {
  // Redirect to the origin THIS request arrived on, not a global constant: the
  // session cookie just set is host-only, so landing the browser anywhere else
  // would hand it a session it can't see.
  const appUrl = appOrigin(req);
  const next = safeNextPath(req.query?.next);
  try {
    const result = await verifyMagicToken(req.query?.token);
    if (!result.ok) {
      // Send the browser somewhere sensible either way — the app shows its
      // signed-out state and the user can request a fresh code. `link=expired`
      // is what the account screen reads to explain what happened.
      return res.redirect(302, `${appUrl}/me/account?link=expired`);
    }
    await establishSession(res, result.email, result.profile);
    return res.redirect(302, `${appUrl}${next ?? "/"}`);
  } catch (err) {
    console.error("[auth] magic error:", err);
    return res.redirect(302, appUrl);
  }
});

router.get("/me", (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, error: "not signed in" });
  return res.json({ ok: true, user: req.user });
});

router.patch("/me", requireUser, async (req, res) => {
  const profileCheck = normalizeProfile(req.body);
  if (profileCheck.error) return res.status(400).json({ ok: false, error: profileCheck.error });
  const { displayName, defaultTag } = profileCheck.row;
  try {
    const result = await pool.query(
      `update app_user
          set display_name = case when $2::boolean then $3 else display_name end,
              default_tag  = case when $4::boolean then $5 else default_tag end
        where id = $1
        returning id, email, display_name as "displayName",
                  default_tag as "defaultTag", email_verified_at as "emailVerifiedAt"`,
      [
        req.user.id,
        displayName !== undefined, displayName ?? null,
        defaultTag !== undefined, defaultTag ?? null,
      ]
    );
    return res.json({ ok: true, user: result.rows[0] });
  } catch (err) {
    console.error("[auth] patch me error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/logout", async (req, res) => {
  const token = parseCookies(req)[USER_COOKIE_NAME];
  try {
    await deleteUserSession(token);
  } catch (err) {
    console.error("[auth] logout error:", err);
  }
  res.set("Set-Cookie", clearUserCookieHeader({ secure: isProd() }));
  return res.json({ ok: true });
});
