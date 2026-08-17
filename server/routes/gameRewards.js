// POST /api/game-rewards/award — the trusted proxy between the app's
// mini-games and the venue's ticket system. The browser's ticket math is a
// display convenience; THIS endpoint decides what actually pays:
//
//   1. The game must be in the server registry (lib/gameRewards.js) and the
//      requested tickets within its per-round ceiling — a tampered client
//      can't mint more than a legitimate perfect round.
//   2. The card's venue-local daily cap (default 500, venue-tunable in Master
//      Control via pos.loyalty.gameRewardCaps) clamps what's left to award.
//   3. Every decision is recorded in game_ticket_award — the ledger that
//      backs the daily cap, idempotency, and the admin issuance rollup.
//
// Only after all that does lib/posLoyalty.js credit the vendor, server-side,
// with the same `game:<game>:<sessionId>` idempotency key the client adapter
// used to send — so vendor-side history stays continuous across the switch.
//
// Concurrency: cap check + reservation run in one transaction under a
// per-(venue, card) advisory xact lock, so two simultaneous end screens can't
// both squeeze under the daily cap. The POS call happens AFTER the
// reservation commits (no network under the lock); a crash between the two
// leaves a 'pending' row that the next replay retries against the vendor
// (same idempotency key — the vendor de-dupes).
import { Router } from "express";
import { pool } from "../db.js";
import { isKnownGame, effectiveCaps } from "../lib/gameRewards.js";
import { dailySpentTickets } from "../lib/dailyTickets.js";
import { isBonusKind, effectiveAdoptionBonus } from "../lib/adoptionBonus.js";
import { rewardTickets } from "../lib/posLoyalty.js";
import { UUID_RE } from "../lib/validateLocation.js";
import { tenant, findTenantLocation } from "../lib/tenant.js";

export const router = Router();

const VENUE_TZ = process.env.VENUE_TZ || "America/Los_Angeles";

router.post("/award", tenant(), async (req, res) => {
  const { locationId, playerId, game, tickets, sessionId } = req.body ?? {};

  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  if (typeof playerId !== "string" || playerId.length < 1 || playerId.length > 100) {
    return res.status(400).json({ ok: false, error: "playerId is required (1..100 chars)" });
  }
  if (typeof game !== "string" || !isKnownGame(game)) {
    return res.status(400).json({ ok: false, error: "unknown game" });
  }
  // Accept any plausible count and CLAMP to the per-round ceiling below
  // (rather than rejecting) — a few game formulas are uncapped client-side,
  // so a monster legitimate round must degrade to the cap, not to an error.
  if (!Number.isInteger(tickets) || tickets < 1 || tickets > 10_000) {
    return res.status(400).json({ ok: false, error: "tickets must be an integer 1..10000" });
  }
  if (typeof sessionId !== "string" || sessionId.length < 8 || sessionId.length > 100) {
    return res.status(400).json({ ok: false, error: "sessionId is required (8..100 chars)" });
  }

  try {
    // Tenant-scoped: a foreign tenant's location id 404s exactly like a
    // nonexistent one — a guessed id must not draw down (or write ledger rows
    // against) another client's ticket system.
    const loc = await findTenantLocation(locationId, req.tenant, { cols: "id, tz, pos" });
    if (!loc) return res.status(404).json({ ok: false, error: "unknown location" });
    const loyalty = loc.pos?.loyalty ?? null;
    if (!loyalty?.gameRewards) {
      return res.status(403).json({ ok: false, error: "game rewards not enabled for this venue" });
    }

    const caps = effectiveCaps(loc.pos, game);
    const tz = loc.tz || VENUE_TZ;
    const requested = Math.min(tickets, caps.perRound);

    // Reserve under the daily cap (or find the round's existing row).
    const client = await pool.connect();
    let row; // the game_ticket_award row this round settles on
    let duplicate = false;
    try {
      await client.query("begin");
      // Serialize same-card awards so concurrent rounds can't both pass the
      // daily-cap read below. Two int4 keys: venue, card.
      await client.query("select pg_advisory_xact_lock(hashtext($1), hashtext($2))", [
        locationId,
        playerId,
      ]);

      const existing = await client.query(
        `select * from game_ticket_award where game = $1 and session_id = $2`,
        [game, sessionId]
      );
      if (existing.rows[0]) {
        row = existing.rows[0];
        duplicate = true;
        await client.query("commit");
      } else {
        // Today's spend for this card at this venue (lib/dailyTickets.js).
        // Mini-games are now the only lane that draws on the budget — golf
        // achievements pay nothing — but the sum stays behind that module so a
        // future earning lane joins the cap rather than bypassing it.
        const spent = await dailySpentTickets(client, {
          locationId,
          cardId: playerId,
          tz,
        });
        const remaining = Math.max(0, caps.dailyPerCard - spent);
        const award = Math.min(requested, remaining);
        const inserted = await client.query(
          `insert into game_ticket_award
             (location_id, player_id, game, session_id, tickets_requested, tickets_awarded, status)
           values ($1, $2, $3, $4, $5, $6, $7)
           returning *`,
          [locationId, playerId, game, sessionId, tickets, award, award > 0 ? "pending" : "daily_cap"]
        );
        row = inserted.rows[0];
        await client.query("commit");
      }
    } catch (err) {
      await client.query("rollback").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    if (row.status === "daily_cap") {
      return res.json({
        ok: true,
        status: "daily-cap",
        ticketsAwarded: 0,
        dailyCap: caps.dailyPerCard,
        duplicate,
      });
    }

    // Already fully settled (a re-mounted end screen replaying) — answer from
    // the ledger without another vendor call.
    if (row.status === "awarded") {
      return res.json({
        ok: true,
        status: "awarded",
        ticketsAwarded: row.tickets_awarded,
        newTicketBalance: null, // stale by now; the rewards screen has live balances
        capped: row.tickets_awarded < row.tickets_requested,
        duplicate: true,
      });
    }

    // status 'pending': reservation committed (this round or a crashed earlier
    // try) — credit the vendor. Same-key replays de-dupe vendor-side too.
    const posResult = await rewardTickets(loyalty, {
      playerId,
      tickets: row.tickets_awarded,
      source: `game:${game}`,
      idempotencyKey: `game:${game}:${sessionId}`,
    });

    if (posResult.ok !== true) {
      // A failed vendor call is AMBIGUOUS — the credit may have landed with
      // the response lost. Keep the 'pending' reservation: it holds this
      // round's slice of the daily budget (conservative — the cap can't be
      // exceeded via a lost response + fresh rounds), and a retry of the same
      // session finds the row, replays the vendor call under the same
      // idempotency key (the vendor de-dupes), and settles it to 'awarded'.
      // Un-retried rows stay pending and are excluded from confirmed
      // issuance in the admin rollup.
      console.error("[game-rewards] POS credit failed (reservation held):", posResult.error);
      return res.status(502).json({ ok: false, error: posResult.error });
    }

    await pool.query(
      `update game_ticket_award set status = 'awarded', pos_transaction_id = $2 where id = $1`,
      [row.id, posResult.transactionId ?? null]
    );

    return res.json({
      ok: true,
      status: "awarded",
      ticketsAwarded: row.tickets_awarded,
      newTicketBalance: posResult.newTicketBalance ?? null,
      capped: row.tickets_awarded < tickets,
      duplicate,
    });
  } catch (err) {
    console.error("[game-rewards] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

// POST /api/game-rewards/bonus — the one-time adoption bonus (install /
// sign-in). Credits the player's linked card ONCE per (venue, card, kind) via
// the same trusted POS path as /award, but off the mini-game daily cap: it's a
// milestone perk, not a per-round earning. `unique (location_id, player_id,
// kind)` makes it one-time; the pending -> awarded flow (mirroring /award)
// keeps a lost vendor response from double-crediting.
router.post("/bonus", tenant(), async (req, res) => {
  const { locationId, playerId, kind } = req.body ?? {};

  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  if (typeof playerId !== "string" || playerId.length < 1 || playerId.length > 100) {
    return res.status(400).json({ ok: false, error: "playerId is required (1..100 chars)" });
  }
  if (typeof kind !== "string" || !isBonusKind(kind)) {
    return res.status(400).json({ ok: false, error: "kind must be 'install' or 'signin'" });
  }
  // The sign-in milestone has a server-verifiable condition — a real player
  // session — so require it, or an anonymous caller could mint the reward
  // without signing in. (Install can't be verified server-side; it stays
  // best-effort, bounded by one-time-per-card + the venue amount.)
  if (kind === "signin" && !req.user) {
    return res.status(401).json({ ok: false, error: "sign in to claim the sign-in bonus" });
  }

  try {
    // Same tenant gate as /award: foreign location = unknown location.
    const loc = await findTenantLocation(locationId, req.tenant, { cols: "id, pos" });
    if (!loc) return res.status(404).json({ ok: false, error: "unknown location" });
    const loyalty = loc.pos?.loyalty ?? null;
    if (!loyalty?.gameRewards) {
      return res.status(403).json({ ok: false, error: "ticket rewards not enabled for this venue" });
    }

    const amount = effectiveAdoptionBonus(loc.pos)[kind];
    if (amount <= 0) {
      // The venue switched this milestone off — a clean, non-error no-op.
      return res.json({ ok: true, status: "disabled", ticketsAwarded: 0 });
    }

    // Reserve the one-time award (or find the prior one). No daily-cap read —
    // adoption bonuses live outside the mini-game budget.
    const insert = await pool.query(
      `insert into bonus_award (location_id, player_id, kind, tickets, status)
         values ($1, $2, $3, $4, 'pending')
       on conflict (location_id, player_id, kind) do nothing
       returning *`,
      [locationId, playerId, kind, amount]
    );
    let row = insert.rows[0];
    let duplicate = false;
    if (!row) {
      duplicate = true;
      row = (
        await pool.query(
          `select * from bonus_award where location_id = $1 and player_id = $2 and kind = $3`,
          [locationId, playerId, kind]
        )
      ).rows[0];
    }

    // Already settled (a replay) — answer from the ledger, no vendor call.
    if (row.status === "awarded") {
      return res.json({
        ok: true,
        status: "awarded",
        ticketsAwarded: row.tickets,
        newTicketBalance: null,
        duplicate: true,
      });
    }

    // 'pending' (fresh, or a crashed earlier try) — credit the vendor. The
    // stable per-(card,kind) idempotency key de-dupes vendor-side on replay.
    const posResult = await rewardTickets(loyalty, {
      playerId,
      tickets: row.tickets,
      source: `bonus:${kind}`,
      // Key on the ledger row id (not kind+playerId): it's unique per
      // (venue, card, kind) so a shared POS that de-dupes keys globally can't
      // collide the same card's bonus across venues, it's stable across retries
      // (the pending row persists), and its fixed length stays within the POS
      // key limit regardless of how long the card id is.
      idempotencyKey: `bonus:${row.id}`,
    });
    if (posResult.ok !== true) {
      // Ambiguous — keep the pending reservation so a retry replays the same
      // idempotency key rather than minting a second award.
      console.error("[game-rewards] bonus POS credit failed (reservation held):", posResult.error);
      return res.status(502).json({ ok: false, error: posResult.error });
    }

    await pool.query(
      `update bonus_award set status = 'awarded', pos_transaction_id = $2 where id = $1`,
      [row.id, posResult.transactionId ?? null]
    );

    return res.json({
      ok: true,
      status: "awarded",
      ticketsAwarded: row.tickets,
      newTicketBalance: posResult.newTicketBalance ?? null,
      duplicate,
    });
  } catch (err) {
    console.error("[game-rewards] bonus error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
