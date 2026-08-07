// Persistent named teams. Everything here requires a signed-in player
// (requireUser) — teams are the first account-only surface.
//
//   POST   /api/teams                       {name} -> {ok, team}
//   GET    /api/teams                       -> {ok, teams:[...]} (mine, with members)
//   PATCH  /api/teams/:id                   {name} rename (owner only)
//   DELETE /api/teams/:id                   archive (owner only)
//   POST   /api/teams/:id/invites           {email} -> emails an accept link
//   POST   /api/teams/invites/accept        {token} -> join the team
//   DELETE /api/teams/:id/members/:userId   owner removes anyone; a member removes self
import { Router } from "express";
import { randomBytes } from "node:crypto";
import { pool } from "../db.js";
import { requireUser } from "../lib/userAuth.js";
import { normalizeEmail } from "../lib/validateUser.js";
import { sha256 } from "../lib/authCodes.js";
import { sendMail } from "../lib/mailer.js";
import { makeRateLimit } from "../lib/rateLimit.js";
import { UUID_RE } from "../lib/validateLocation.js";

export const router = Router();
router.use(requireUser);

const INVITE_TTL = "7 days";
// Invites cost an email each — cap per inviting user, not per IP (venue WiFi
// NATs many users onto one address).
const inviteLimit = makeRateLimit({
  windowMs: 24 * 60 * 60_000,
  max: 20,
  keyFn: (req) => req.user?.id ?? null,
  name: "invite limit",
});

export function resetTeamRateLimits() {
  inviteLimit.reset();
}

function normalizeTeamName(name) {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (trimmed.length < 1 || trimmed.length > 40) return null;
  return trimmed;
}

/** The caller's membership row for a team (or null). */
async function membership(teamId, userId) {
  const result = await pool.query(
    `select tm.role from team_member tm
       join team t on t.id = tm.team_id
      where tm.team_id = $1 and tm.app_user_id = $2 and t.archived_at is null`,
    [teamId, userId]
  );
  return result.rows[0] ?? null;
}

router.post("/", async (req, res) => {
  const name = normalizeTeamName(req.body?.name);
  if (!name) return res.status(400).json({ ok: false, error: "name must be 1-40 characters" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const team = await client.query(
      `insert into team (name, owner_user_id) values ($1, $2)
       returning id, name, owner_user_id as "ownerUserId", created_at as "createdAt"`,
      [name, req.user.id]
    );
    await client.query(
      `insert into team_member (team_id, app_user_id, role) values ($1, $2, 'owner')`,
      [team.rows[0].id, req.user.id]
    );
    await client.query("COMMIT");
    return res.json({ ok: true, team: team.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[teams] create error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

router.get("/", async (req, res) => {
  try {
    // My teams, each with its member list and (for owners) pending invites.
    const teams = await pool.query(
      `select t.id, t.name, t.owner_user_id as "ownerUserId", me.role,
              t.created_at as "createdAt"
         from team t
         join team_member me on me.team_id = t.id and me.app_user_id = $1
        where t.archived_at is null
        order by t.created_at`,
      [req.user.id]
    );
    if (teams.rowCount === 0) return res.json({ ok: true, teams: [] });
    const ids = teams.rows.map((t) => t.id);
    const members = await pool.query(
      `select tm.team_id as "teamId", tm.app_user_id as "userId", tm.role,
              u.display_name as "displayName", u.default_tag as "defaultTag", u.email
         from team_member tm
         join app_user u on u.id = tm.app_user_id
        where tm.team_id = any($1)
        order by tm.joined_at`,
      [ids]
    );
    const invites = await pool.query(
      `select team_id as "teamId", email, expires_at as "expiresAt"
         from team_invite
        where team_id = any($1) and accepted_at is null and expires_at > now()
        order by created_at`,
      [ids]
    );
    const byTeam = (rows) =>
      rows.reduce((map, row) => {
        (map[row.teamId] ??= []).push(row);
        return map;
      }, {});
    const membersBy = byTeam(members.rows);
    const invitesBy = byTeam(invites.rows);
    return res.json({
      ok: true,
      teams: teams.rows.map((t) => ({
        ...t,
        members: (membersBy[t.id] ?? []).map(({ teamId, ...m }) => m),
        // Pending invite addresses are only the owner's business.
        pendingInvites:
          t.role === "owner" ? (invitesBy[t.id] ?? []).map(({ teamId, ...i }) => i) : [],
      })),
    });
  } catch (err) {
    console.error("[teams] list error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.patch("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid team id" });
  const name = normalizeTeamName(req.body?.name);
  if (!name) return res.status(400).json({ ok: false, error: "name must be 1-40 characters" });
  try {
    const member = await membership(id, req.user.id);
    if (!member) return res.status(404).json({ ok: false, error: "not found" });
    if (member.role !== "owner") return res.status(403).json({ ok: false, error: "owner only" });
    const result = await pool.query(
      `update team set name = $2 where id = $1
       returning id, name, owner_user_id as "ownerUserId", created_at as "createdAt"`,
      [id, name]
    );
    return res.json({ ok: true, team: result.rows[0] });
  } catch (err) {
    console.error("[teams] rename error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid team id" });
  try {
    const member = await membership(id, req.user.id);
    if (!member) return res.status(404).json({ ok: false, error: "not found" });
    if (member.role !== "owner") return res.status(403).json({ ok: false, error: "owner only" });
    await pool.query(`update team set archived_at = now() where id = $1`, [id]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[teams] archive error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/:id/invites", inviteLimit, async (req, res) => {
  const { id } = req.params;
  if (!UUID_RE.test(id)) return res.status(400).json({ ok: false, error: "invalid team id" });
  const email = normalizeEmail(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, error: "email must be a valid address" });
  try {
    const member = await membership(id, req.user.id);
    if (!member) return res.status(404).json({ ok: false, error: "not found" });
    if (member.role !== "owner") return res.status(403).json({ ok: false, error: "owner only" });

    const team = await pool.query(`select name from team where id = $1`, [id]);
    const token = randomBytes(32).toString("hex");
    await pool.query(
      `insert into team_invite (team_id, email, token_hash, invited_by, expires_at)
         values ($1, $2, $3, $4, now() + interval '${INVITE_TTL}')`,
      [id, email, sha256(token), req.user.id]
    );

    const appUrl = (process.env.PUBLIC_APP_URL || "http://localhost:5173").replace(/\/$/, "");
    const link = `${appUrl}/teams/accept?token=${token}`;
    const teamName = team.rows[0].name;
    const inviter = req.user.displayName || req.user.email;
    await sendMail({
      to: email,
      kind: "team_invite",
      subject: `${inviter} invited you to team ${teamName}`,
      text: [
        `${inviter} invited you to join "${teamName}" on FFC Mini Golf.`,
        ``,
        `Open this link to accept (you'll sign in with your email — no password):`,
        link,
        ``,
        `The invite expires in 7 days. If you weren't expecting it, ignore this email.`,
      ].join("\n"),
      html: [
        `<p>${inviter} invited you to join <b>${teamName}</b> on FFC Mini Golf.</p>`,
        `<p><a href="${link}">Accept the invite</a> — you'll sign in with your email, no password.</p>`,
        `<p>The invite expires in 7 days. If you weren't expecting it, ignore this email.</p>`,
      ].join("\n"),
    });
    return res.json({ ok: true });
  } catch (err) {
    console.error("[teams] invite error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.post("/invites/accept", async (req, res) => {
  const { token } = req.body ?? {};
  if (typeof token !== "string" || !/^[0-9a-f]{64}$/.test(token)) {
    return res.status(400).json({ ok: false, error: "invalid invite token" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // The token is the capability — the signed-in user need not match the
    // invited address (people forward invites; the email is just transport).
    const invite = await client.query(
      `update team_invite set accepted_at = now()
        where token_hash = $1 and accepted_at is null and expires_at > now()
        returning team_id as "teamId"`,
      [sha256(token)]
    );
    if (invite.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(410).json({ ok: false, error: "invite expired or already used" });
    }
    const teamId = invite.rows[0].teamId;
    const team = await client.query(
      `select id, name, owner_user_id as "ownerUserId", created_at as "createdAt"
         from team where id = $1 and archived_at is null`,
      [teamId]
    );
    if (team.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(410).json({ ok: false, error: "invite expired or already used" });
    }
    await client.query(
      `insert into team_member (team_id, app_user_id, role) values ($1, $2, 'member')
       on conflict (team_id, app_user_id) do nothing`,
      [teamId, req.user.id]
    );
    await client.query("COMMIT");
    return res.json({ ok: true, team: team.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[teams] accept error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  } finally {
    client.release();
  }
});

router.delete("/:id/members/:userId", async (req, res) => {
  const { id, userId } = req.params;
  if (!UUID_RE.test(id) || !UUID_RE.test(userId)) {
    return res.status(400).json({ ok: false, error: "invalid id" });
  }
  try {
    const member = await membership(id, req.user.id);
    if (!member) return res.status(404).json({ ok: false, error: "not found" });
    const removingSelf = userId === req.user.id;
    if (!removingSelf && member.role !== "owner") {
      return res.status(403).json({ ok: false, error: "owner only" });
    }
    if (removingSelf && member.role === "owner") {
      // v1: an owner can't walk away and orphan the team — archive it instead.
      return res
        .status(409)
        .json({ ok: false, error: "owner can't leave — archive the team instead" });
    }
    await pool.query(`delete from team_member where team_id = $1 and app_user_id = $2`, [
      id,
      userId,
    ]);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[teams] remove member error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
