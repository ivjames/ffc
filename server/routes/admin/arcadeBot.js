// Admin: arcade bot control plane — Master Control → Ops → Arcade bot.
//   GET  /api/admin/arcade-bot/status    games, profiles, venues, both runners
//   POST /api/admin/arcade-bot/capture   play the games, write a profile
//   POST /api/admin/arcade-bot/replay    post the awards a profile implies
//   GET  /api/admin/arcade-bot/profile/:name   a profile's samples, for charts
//   GET  /api/admin/arcade-bot/traffic         synthetic award aggregates
//   POST /api/admin/arcade-bot/stop      {slot} stop capture or replay
//   POST /api/admin/arcade-bot/recheck-browser  re-probe browser + app, no cache
//
// The bots are scripts/arcade-bot.mjs and scripts/arcade-traffic.mjs (see
// ARCADE-BOT.md). This surface drives them from the browser; lib/arcadeBotRunner
// owns the processes.
//
// Auth: status is readable by any admin (org-scoped venue list). capture and
// replay are super_admin only — they are platform tools, not per-venue
// controls, and replay posts real ticket awards.
//
// CAPTURE NEEDS A BROWSER. It drives the player app in headless Chromium, which
// the API host may not have — an API box has no reason to ship one, and the
// binaries download separately from the npm package so no deploy step fetches
// them. Rather than spawn a run that dies with a Playwright stack trace, status
// LAUNCHES one (lib/browserProbe.js, cached) and the route refuses with the
// reason and the install command.
import { Router } from "express";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pool } from "../../db.js";
import { orgScope } from "../../lib/adminAuth.js";
import { GAME_REWARD_GAMES } from "../../lib/gameRewards.js";
import { moduleLive } from "../../lib/modules.js";
import * as runner from "../../lib/arcadeBotRunner.js";
import { browserStatus, resetBrowserStatus } from "../../lib/browserProbe.js";
import { appBaseStatus, resetAppBaseStatus } from "../../lib/captureTarget.js";

export const router = Router();

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Profile names are ours to generate, but they are also path segments — keep
// them boring so a name can never climb out of PROFILE_DIR.
const PROFILE_RE = /^[A-Za-z0-9._-]+\.json$/;

/**
 * The registry games, each with the bot's own per-round time estimate so the
 * form can show a pre-flight wall-clock figure that matches what the script
 * will print. The estimates live with the policies (scripts/lib/arcade), which
 * is a different tree from the API — imported lazily and defensively so a
 * policy that one day pulls in Playwright at module scope can't take the whole
 * admin router down with it. Without them the UI falls back to a flat rate.
 */
async function loadGames() {
  try {
    const reg = await import("../../../scripts/lib/arcade/registry.mjs");
    const est = new Map(reg.GAMES.map((g) => [g.key, g.estRoundMs]));
    return GAME_REWARD_GAMES.map((g) => ({ ...g, estRoundMs: est.get(g.key) ?? null }));
  } catch {
    return GAME_REWARD_GAMES.map((g) => ({ ...g, estRoundMs: null }));
  }
}

/** Refuse to parse anything that isn't plausibly one of our profiles. */
const MAX_PROFILE_BYTES = 8 * 1024 * 1024;

/**
 * What a profile will actually replay as. Replay draws from the recorded
 * samples, so a profile captured at a FIXED skill produces that same standard
 * of play forever — capture at `--skill 1` once and every synthetic award is a
 * perfect round, which is not what an arcade looks like. Each sample carries
 * the skill it was played at, so summarise the spread and let the picker say
 * so out loud. Unreadable or hand-dropped files still list (replay validates
 * them itself); they just carry no summary.
 */
function summarizeProfile(file) {
  try {
    if (statSync(file).size > MAX_PROFILE_BYTES) return null;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    const skills = [];
    // Only games with samples can be replayed — arcade-traffic throws
    // "profile has no game" on one that was captured empty.
    const gameKeys = [];
    for (const [key, g] of Object.entries(doc?.games ?? {})) {
      const samples = g?.samples ?? [];
      if (samples.length > 0) gameKeys.push(key);
      for (const s of samples) {
        if (typeof s?.skill === "number" && Number.isFinite(s.skill)) skills.push(s.skill);
      }
    }
    const games = Object.keys(doc?.games ?? {}).length;
    if (games === 0) return null;
    if (skills.length === 0) {
      return { games, gameKeys, samples: 0, skillMin: null, skillMax: null, skillMean: null };
    }
    const min = Math.min(...skills);
    const max = Math.max(...skills);
    return {
      games,
      gameKeys,
      samples: skills.length,
      skillMin: min,
      skillMax: max,
      skillMean: skills.reduce((a, b) => a + b, 0) / skills.length,
      capturedAt: typeof doc?.capturedAt === "string" ? doc.capturedAt : null,
    };
  } catch {
    return null;
  }
}

function listProfiles() {
  try {
    mkdirSync(runner.PROFILE_DIR, { recursive: true });
    return readdirSync(runner.PROFILE_DIR)
      .filter((f) => PROFILE_RE.test(f))
      .map((f) => {
        const full = path.join(runner.PROFILE_DIR, f);
        const s = statSync(full);
        return {
          name: f,
          bytes: s.size,
          modifiedAt: s.mtime.toISOString(),
          summary: summarizeProfile(full),
        };
      })
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch {
    return [];
  }
}

/**
 * Venues this admin may target, with whether an award would actually be
 * accepted there. That is TWO conditions, not one: routes/gameRewards.js
 * requires `pos.loyalty.gameRewards` AND `moduleLive(loc, "gameTickets")`, so
 * reading only the pos flag calls a venue enabled when the module is switched
 * off and every award 403s. Resolve it exactly the way the award route does.
 *
 * The org slug rides along because the child addresses the API over loopback,
 * where the tenant would otherwise resolve to the default org (see the replay
 * handler).
 */
async function loadVenues(scope) {
  const res = await pool.query(
    `select l.id, l.name, l.pos, l.modules, o.name as org_name, o.slug as org_slug
       from location l
       left join org o on o.id = l.org_id
      where l.archived_at is null and ($1::uuid is null or l.org_id = $1)
      order by o.name nulls first, l.name`,
    [scope]
  );
  return res.rows.map((r) => ({
    id: r.id,
    name: r.name,
    orgName: r.org_name ?? null,
    orgSlug: r.org_slug ?? null,
    gameRewards: r.pos?.loyalty?.gameRewards === true && moduleLive(r, "gameTickets"),
  }));
}

/**
 * Live org slugs, best-guess order. These are the labels of the player-app
 * vhosts (`<slug>.<PLATFORM_FQDN>`), which is how the capture base gets derived
 * instead of hand-configured.
 */
async function loadOrgSlugs() {
  try {
    const res = await pool.query(
      `select slug from org where archived_at is null and status = 'active' order by sort_order, name`
    );
    return res.rows.map((r) => r.slug).filter(Boolean);
  } catch {
    return [];
  }
}

const int = (v, lo, hi) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : null;
};

function validateCapture(body) {
  const rounds = int(body?.rounds, 1, 200);
  if (rounds === null) return { error: "rounds must be an integer 1..200" };
  const seed = int(body?.seed ?? 1, 1, 2_000_000);
  if (seed === null) return { error: "seed must be an integer 1..2000000" };
  let skill = null;
  if (body?.skill !== null && body?.skill !== undefined && body?.skill !== "") {
    const s = Number(body.skill);
    if (!(s >= 0 && s <= 1)) return { error: "skill must be between 0 and 1" };
    skill = s;
  }
  const games = Array.isArray(body?.games) ? body.games.filter((g) => /^[a-z]+$/.test(g)) : [];
  return { params: { rounds, seed, skill, games } };
}

function validateReplay(body) {
  if (typeof body?.locationId !== "string" || !UUID_RE.test(body.locationId)) {
    return { error: "locationId must be a uuid" };
  }
  if (typeof body?.profile !== "string" || !PROFILE_RE.test(body.profile)) {
    return { error: "profile must be a captured profile name" };
  }
  const plays = int(body?.plays, 1, 5000);
  if (plays === null) return { error: "plays must be an integer 1..5000" };
  // The auth rate limit caps new sessions at 10/IP/hour; the script enforces it
  // too, but refusing here gives the operator the reason in the form.
  const players = int(body?.players ?? 4, 0, 10);
  if (players === null) return { error: "players must be an integer 0..10 (auth limit)" };
  const concurrency = int(body?.concurrency ?? 6, 1, 32);
  if (concurrency === null) return { error: "concurrency must be an integer 1..32" };
  const seed = int(body?.seed ?? 1, 1, 2_000_000);
  if (seed === null) return { error: "seed must be an integer 1..2000000" };
  const intervalMin = body?.intervalMin ? int(body.intervalMin, 1, 1440) : null;
  if (body?.intervalMin && intervalMin === null) {
    return { error: "intervalMin must be an integer 1..1440" };
  }
  const sweeps = body?.sweeps ? int(body.sweeps, 1, 1000) : null;
  if (body?.sweeps && sweeps === null) return { error: "sweeps must be an integer 1..1000" };
  const games = Array.isArray(body?.games) ? body.games.filter((g) => /^[a-z]+$/.test(g)) : [];
  return {
    params: {
      locationId: body.locationId,
      profile: body.profile,
      plays,
      players,
      concurrency,
      seed,
      intervalMin,
      sweeps,
      dryRun: body?.dryRun === true,
      games,
    },
  };
}

function superOnly(req, res) {
  if (orgScope(req) !== null) {
    res.status(403).json({ ok: false, error: "forbidden: super_admin only" });
    return false;
  }
  return true;
}

// --- Status -----------------------------------------------------------------
router.get("/status", async (req, res) => {
  const scope = orgScope(req);
  try {
    const [venues, games, browser, app, awards] = await Promise.all([
      loadVenues(scope),
      loadGames(),
      // Capture is super_admin-only, and the probe's tried-list names other
      // orgs' hostnames — so neither runs for an org-scoped admin.
      scope === null ? browserStatus() : Promise.resolve(null),
      scope === null ? loadOrgSlugs().then(appBaseStatus) : Promise.resolve(null),
      pool.query(
        `select count(*)::int as total,
                count(*) filter (where created_at > now() - interval '24 hours')::int as last24h,
                coalesce(sum(tickets_awarded), 0)::int as tickets
           from game_ticket_award
          where session_id like 'synthetic:%'
            and ($1::uuid is null or location_id in (select id from location where org_id = $1))`,
        [scope]
      ),
    ]);
    return res.json({
      canControl: scope === null,
      // The bot's policies are keyed by the SERVER registry, and every game in
      // it has one — so this list is both "what may earn" and "what plays".
      games,
      browser,
      app,
      profiles: listProfiles(),
      venues,
      syntheticAwards: awards.rows[0],
      capture: runner.capture.status(),
      replay: runner.replay.status(),
    });
  } catch (err) {
    console.error("[admin/arcade-bot] status error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- What a profile actually recorded ----------------------------------------
// The summary in /status answers "which profile is this?"; charting the capture
// needs the SAMPLES — every round's score, tickets and the skill it was played
// at. Same name guard and containment check as replay: a profile name is a path
// segment, and it never gets to climb out of PROFILE_DIR.
router.get("/profile/:name", (req, res) => {
  const name = req.params.name;
  if (!PROFILE_RE.test(name)) return res.status(400).json({ ok: false, error: "bad profile name" });
  const full = path.join(runner.PROFILE_DIR, name);
  if (!full.startsWith(runner.PROFILE_DIR + path.sep) || !existsSync(full)) {
    return res.status(404).json({ ok: false, error: "no such profile" });
  }
  try {
    if (statSync(full).size > MAX_PROFILE_BYTES) {
      return res.status(413).json({ ok: false, error: "profile too large to chart" });
    }
    const doc = JSON.parse(readFileSync(full, "utf8"));
    const games = Object.entries(doc?.games ?? {})
      .map(([key, g]) => ({
        key,
        label: g?.label ?? key,
        rounds: g?.samples?.length ?? 0,
        stats: g?.stats ?? null,
        samples: (g?.samples ?? []).map((x) => ({
          score: Number(x?.score) || 0,
          tickets: Number(x?.tickets) || 0,
          skill: typeof x?.skill === "number" ? x.skill : null,
        })),
      }))
      .filter((g) => g.rounds > 0);
    return res.json({
      ok: true,
      name,
      capturedAt: typeof doc?.capturedAt === "string" ? doc.capturedAt : null,
      base: typeof doc?.base === "string" ? doc.base : null,
      games,
    });
  } catch (err) {
    console.error("[admin/arcade-bot] profile read failed:", err);
    return res.status(422).json({ ok: false, error: "could not read that profile" });
  }
});

// --- What the replay actually paid -------------------------------------------
// Aggregated in SQL, not shipped row-by-row: a long run is tens of thousands of
// awards and the charts only ever need buckets. Org-scoped like the rest of
// status, and restricted to our own reserved session ids so real player awards
// never appear in a synthetic-traffic chart.
router.get("/traffic", async (req, res) => {
  const scope = orgScope(req);
  const days = int(req.query.days ?? 7, 1, 90);
  if (days === null) return res.status(400).json({ ok: false, error: "days must be 1..90" });
  // Hour buckets for a short window (a run is minutes long and would be one bar
  // a day otherwise); day buckets once the window is wide enough that hours
  // would be thousands of near-empty points.
  const unit = days <= 3 ? "hour" : "day";

  const scopeSql = "and ($2::uuid is null or location_id in (select id from location where org_id = $2))";
  const where = `where session_id like 'synthetic:%' and created_at > now() - ($1 || ' days')::interval ${scopeSql}`;

  try {
    const [buckets, byGame, totals] = await Promise.all([
      pool.query(
        `select date_trunc('${unit}', created_at) as at,
                count(*)::int as awards,
                coalesce(sum(tickets_requested), 0)::int as requested,
                coalesce(sum(tickets_awarded), 0)::int as awarded
           from game_ticket_award ${where}
          group by 1 order by 1`,
        [String(days), scope]
      ),
      pool.query(
        `select game,
                count(*)::int as awards,
                coalesce(sum(tickets_requested), 0)::int as requested,
                coalesce(sum(tickets_awarded), 0)::int as awarded,
                count(*) filter (where status = 'daily_cap')::int as capped
           from game_ticket_award ${where}
          group by 1 order by awarded desc, game`,
        [String(days), scope]
      ),
      pool.query(
        `select count(*)::int as awards,
                coalesce(sum(tickets_requested), 0)::int as requested,
                coalesce(sum(tickets_awarded), 0)::int as awarded,
                count(distinct player_id)::int as cards,
                count(distinct split_part(session_id, ':', 2))::int as runs,
                count(*) filter (where status = 'daily_cap')::int as capped,
                min(created_at) as first_at,
                max(created_at) as last_at
           from game_ticket_award ${where}`,
        [String(days), scope]
      ),
    ]);
    return res.json({
      ok: true,
      days,
      unit,
      buckets: buckets.rows.map((r) => ({
        at: r.at.toISOString(),
        awards: r.awards,
        requested: r.requested,
        awarded: r.awarded,
      })),
      byGame: byGame.rows,
      totals: {
        ...totals.rows[0],
        first_at: totals.rows[0]?.first_at ? totals.rows[0].first_at.toISOString() : null,
        last_at: totals.rows[0]?.last_at ? totals.rows[0].last_at.toISOString() : null,
      },
    });
  } catch (err) {
    console.error("[admin/arcade-bot] traffic error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// --- Capture (super_admin) --------------------------------------------------
router.post("/capture", async (req, res) => {
  if (!superOnly(req, res)) return undefined;
  const v = validateCapture(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });

  const browser = await browserStatus();
  if (!browser.available) return res.status(409).json({ ok: false, error: browser.reason });
  // The app has to be up too. Without this the run connection-refuses its way
  // through every game and writes a profile with no rounds in it.
  const app = await appBaseStatus(await loadOrgSlugs());
  if (!app.reachable) return res.status(409).json({ ok: false, error: app.reason });
  if (runner.capture.isRunning()) {
    return res.status(409).json({ ok: false, error: "a capture is already running — stop it first" });
  }

  mkdirSync(runner.PROFILE_DIR, { recursive: true });
  const name = `profile-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const out = path.join(runner.PROFILE_DIR, name);
  // The origin that actually answered, not a configured guess.
  const appBase = app.base;
  try {
    const status = runner.capture.start(
      runner.CAPTURE_SCRIPT,
      runner.captureArgs({ ...v.params, out }, appBase),
      { ...v.params, profile: name }
    );
    return res.json({ ok: true, profile: name, runner: status });
  } catch (err) {
    return res.status(409).json({ ok: false, error: err.message });
  }
});

/**
 * The host the child must present so the venue resolves to ITS org.
 *
 * The child connects to loopback, and lib/tenant.js resolves the tenant from
 * the request host — `127.0.0.1` matches no org slug, so it lands on the
 * default-org fallback, and findTenantLocation then rejects any venue outside
 * that org as foreign. resolveTenant tries an exact slug match on the first
 * host label BEFORE any platform-domain logic, so sending the org's own
 * subdomain resolves via='host' to exactly that org — on a deployment with
 * PLATFORM_FQDN set and on a dev box without it alike.
 *
 * The child sends this as X-Forwarded-Host, which app.js honours via
 * `trust proxy`; a literal `host` header can't be used because node's fetch
 * drops it (forbidden header name) and sends the connection host anyway.
 *
 * A venue with no org keeps the fallback (which is what covers org-less legacy
 * rows), so it gets no header at all.
 */
function tenantHost(orgSlug) {
  if (!orgSlug) return null;
  const platform = (process.env.PLATFORM_FQDN || "").trim().toLowerCase();
  return platform ? `${orgSlug}.${platform}` : orgSlug;
}

// --- Replay (super_admin) ---------------------------------------------------
router.post("/replay", async (req, res) => {
  if (!superOnly(req, res)) return undefined;
  const v = validateReplay(req.body);
  if (v.error) return res.status(400).json({ ok: false, error: v.error });
  if (runner.replay.isRunning()) {
    return res.status(409).json({ ok: false, error: "a replay is already running — stop it first" });
  }

  // Resolve inside PROFILE_DIR and verify it stayed there.
  const profilePath = path.join(runner.PROFILE_DIR, v.params.profile);
  if (!profilePath.startsWith(runner.PROFILE_DIR + path.sep) || !existsSync(profilePath)) {
    return res.status(404).json({ ok: false, error: "no such profile" });
  }

  // A game the profile never captured makes arcade-traffic throw "profile has
  // no game" and exit without posting anything — refuse here, where the
  // operator can still see which games this profile actually holds.
  const summary = summarizeProfile(profilePath);
  if (!summary || summary.samples === 0) {
    return res.status(409).json({
      ok: false,
      error: "that profile recorded no rounds — capture one before replaying",
    });
  }
  const missing = v.params.games.filter((g) => !summary.gameKeys.includes(g));
  if (missing.length) {
    return res.status(400).json({
      ok: false,
      error: `profile has no ${missing.join(", ")} — it holds ${summary.gameKeys.join(", ")}`,
    });
  }

  let tenantHostValue = null;
  try {
    const org = await pool.query(
      `select o.slug from location l left join org o on o.id = l.org_id where l.id = $1`,
      [v.params.locationId]
    );
    tenantHostValue = tenantHost(org.rows[0]?.slug);
  } catch (err) {
    console.error("[admin/arcade-bot] tenant lookup failed:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }

  // Loopback: the child talks to THIS API, never out through a proxy or to
  // another host. The tenant rides in the Host header instead (above).
  const apiBase = `http://127.0.0.1:${process.env.PORT || 8060}`;
  try {
    const status = runner.replay.start(
      runner.REPLAY_SCRIPT,
      runner.replayArgs({ ...v.params, tenantHost: tenantHostValue }, profilePath, apiBase),
      v.params
    );
    return res.json({ ok: true, runner: status });
  } catch (err) {
    return res.status(409).json({ ok: false, error: err.message });
  }
});

// --- Re-probe the browser (super_admin) -------------------------------------
// The probe's answer is cached, which is right for a page that polls every 4s
// and wrong for the one moment it matters: an operator who has just run the
// install command and wants to know NOW. Drop the cache and launch again.
router.post("/recheck-browser", async (req, res) => {
  if (!superOnly(req, res)) return undefined;
  resetBrowserStatus();
  resetAppBaseStatus();
  const [browser, app] = await Promise.all([browserStatus(), loadOrgSlugs().then(appBaseStatus)]);
  return res.json({ ok: true, browser, app });
});

// --- Stop (super_admin) -----------------------------------------------------
router.post("/stop", (req, res) => {
  if (!superOnly(req, res)) return undefined;
  const slot = req.body?.slot;
  if (slot !== "capture" && slot !== "replay") {
    return res.status(400).json({ ok: false, error: "slot must be 'capture' or 'replay'" });
  }
  return res.json({ ok: true, runner: runner[slot].stop() });
});
