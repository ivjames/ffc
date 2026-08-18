// Admin: outbound email diagnostics.
//   GET  /api/admin/mail/status   what provider is configured, and its shape
//   POST /api/admin/mail/test     send one real email and report the outcome
//
// Wiring up Resend is a DNS-and-dashboard job (verify the sending domain, add
// SPF/DKIM, put the key in server/.env) and it fails in ways that are silent
// from the app's side: an unverified domain, a key pasted with a newline, a
// MAIL_FROM whose domain isn't the verified one. Without a way to send one
// test message, the only feedback loop is "ask a player to sign in and see if
// they complain" — so this is the check that turns a config change into a
// yes/no answer.
//
// super_admin only: it can send mail to an arbitrary address, so it is not
// something an org_admin should hold. The response reports the provider's real
// error text, which is the whole point — a masked "send failed" would leave the
// operator exactly where they started.
import { Router } from "express";
import { isSuperAdmin, audit, actorLabel } from "../../lib/adminAuth.js";
import {
  sendMail,
  mailFrom,
  isMailDeliveryConfigured,
  maskRecipient,
} from "../../lib/mailer.js";
import { normalizeEmail } from "../../lib/validateUser.js";
import { appOrigin } from "../../lib/appOrigin.js";

export const router = Router();

// super_admin only — this router can send mail to an arbitrary address and
// reports the provider's raw error text, neither of which belongs to an
// org_admin. Applied router-wide so a route added later can't miss it.
router.use((req, res, next) => {
  if (!isSuperAdmin(req)) {
    return res.status(403).json({ ok: false, error: "forbidden: super admin only" });
  }
  next();
});

const PROVIDER_NOTES = {
  console: "No mail is delivered — messages are logged (dev) or withheld (production).",
  resend: "Delivered via the Resend API. The MAIL_FROM domain must be verified there (SPF + DKIM).",
  smtp: "Delivered over SMTP_URL via nodemailer.",
};

router.get("/status", (req, res) => {
  const provider = process.env.MAIL_PROVIDER || "console";
  res.json({
    ok: true,
    provider,
    note: PROVIDER_NOTES[provider] ?? "Unrecognised MAIL_PROVIDER — sends will fall back to console.",
    delivers: isMailDeliveryConfigured(),
    from: mailFrom(),
    // Whether the provider's credential is even present. The VALUE is never
    // returned — only whether something is set — so this endpoint can't be
    // used to read a key back out.
    credentialSet:
      provider === "resend"
        ? Boolean(process.env.RESEND_API_KEY)
        : provider === "smtp"
          ? Boolean(process.env.SMTP_URL)
          : true,
    // The origin players' magic links will actually point at for THIS host —
    // the other half of "is sign-in wired up correctly" (lib/appOrigin.js).
    linkOrigin: appOrigin(req),
    publicAppUrl: process.env.PUBLIC_APP_URL || null,
    platformFqdn: process.env.PLATFORM_FQDN || null,
    dailyCap: Number(process.env.MAIL_DAILY_CAP) || 500,
  });
});

router.post("/test", async (req, res) => {
  const to = normalizeEmail(req.body?.to);
  if (!to) return res.status(400).json({ ok: false, error: "to must be a valid address" });

  const provider = process.env.MAIL_PROVIDER || "console";
  const stamp = new Date().toISOString();
  const result = await sendMail({
    to,
    kind: "admin_test",
    subject: "FFC mail test",
    text: [
      `This is a test message from FFC's Master Control.`,
      ``,
      `Provider: ${provider}`,
      `From:     ${mailFrom()}`,
      `Sent:     ${stamp}`,
      ``,
      `If this landed in your inbox, transactional email is working — sign-in`,
      `codes, magic links, and team invites all travel this same path.`,
    ].join("\n"),
    html: [
      `<p>This is a test message from FFC's Master Control.</p>`,
      `<ul><li>Provider: <b>${provider}</b></li><li>From: <b>${mailFrom()}</b></li>`,
      `<li>Sent: ${stamp}</li></ul>`,
      `<p>If this landed in your inbox, transactional email is working — sign-in codes,`,
      ` magic links, and team invites all travel this same path.</p>`,
    ].join("\n"),
  });

  await audit({
    action: "mail.test",
    entity: "mail",
    entityId: null,
    // The recipient is masked in the audit trail: this table is read by more
    // people than the person who typed the address.
    detail: { to: maskRecipient(to), provider, ok: result.ok },
    actor: actorLabel(req),
  });

  if (!result.ok) {
    // 200 with ok:false, not a 5xx: the request succeeded, the SEND failed, and
    // the operator needs the provider's own words to fix their config.
    return res.json({ ok: false, provider, error: result.error, delivered: false });
  }
  return res.json({
    ok: true,
    provider,
    delivered: isMailDeliveryConfigured(),
    id: result.id ?? null,
    // With the console provider the call "succeeds" without delivering
    // anything — say so plainly rather than letting a green tick imply an
    // inbox got something.
    note: isMailDeliveryConfigured()
      ? `Sent to ${maskRecipient(to)}. Check the inbox (and the spam folder).`
      : "MAIL_PROVIDER is 'console' — nothing was actually delivered. Set a real provider first.",
  });
});
