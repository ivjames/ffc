// /api/loyalty — the player-facing view of a venue rewards card, bound to the
// signed-in account.
//
// Every route here requires a player session. That is the whole point of the
// module: before it existed, the browser talked to the loyalty vendor directly
// with a bundled bearer token, so a card number was the only thing standing
// between a visitor and a stranger's name, tier, balances and ticket history.
// Now the vendor is reachable only from the server (lib/posLoyalty.js, which
// holds the credentials in env), and the only card a session can read is the
// one that session linked:
//
//   POST   /link   {locationId, cardNumber} -> verify with the vendor, bind it
//   DELETE /link   {locationId}             -> unbind
//   GET    /me?locationId=                  -> the linked card + its history
//
// Linking still proves possession the same way it always did — by quoting the
// number printed on the physical card — but a number alone no longer reads
// anything back, and the ticket-write paths (routes/gameRewards.js,
// routes/rewards.js) derive the card from this binding instead of the body.
import { Router } from "express";
import { requireUser } from "../lib/userAuth.js";
import { UUID_RE } from "../lib/validateLocation.js";
import { tenant, findTenantLocation } from "../lib/tenant.js";
import { fetchPlayer, fetchPlayerTransactions } from "../lib/posLoyalty.js";
import { linkedCardFor, linkCard, unlinkCard } from "../lib/cardLink.js";

export const router = Router();

router.use(requireUser);

/** Resolve the venue + its loyalty config, or answer and return null. */
async function loyaltyVenue(locationId, req, res) {
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    res.status(400).json({ ok: false, error: "locationId must be a uuid" });
    return null;
  }
  // Same tenant gate as the award routes: a foreign org's location id 404s
  // exactly like a nonexistent one.
  const loc = await findTenantLocation(locationId, req.tenant, { cols: "id, pos" });
  if (!loc) {
    res.status(404).json({ ok: false, error: "unknown location" });
    return null;
  }
  const loyalty = loc.pos?.loyalty ?? null;
  if (!loyalty) {
    res.status(403).json({ ok: false, error: "rewards cards are not enabled for this venue" });
    return null;
  }
  return loyalty;
}

router.post("/link", tenant(), async (req, res) => {
  const { locationId, cardNumber } = req.body ?? {};
  if (typeof cardNumber !== "string" || cardNumber.trim().length < 1 || cardNumber.length > 100) {
    return res.status(400).json({ ok: false, error: "cardNumber is required (1..100 chars)" });
  }
  try {
    const loyalty = await loyaltyVenue(locationId, req, res);
    if (!loyalty) return undefined;
    const found = await fetchPlayer(loyalty, cardNumber.trim());
    if (found.ok !== true) {
      // Keep the vendor's 404 distinguishable so the UI can say "no card with
      // that number" instead of a generic failure; everything else is 502.
      const status = found.status === 404 ? 404 : 502;
      return res.status(status).json({
        ok: false,
        error: status === 404 ? "no card found with that number" : found.error,
      });
    }
    await linkCard(req.user.id, locationId, found.player.id);
    return res.json({ ok: true, player: found.player });
  } catch (err) {
    console.error("[loyalty/link] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.delete("/link", tenant(), async (req, res) => {
  const { locationId } = req.body ?? {};
  if (typeof locationId !== "string" || !UUID_RE.test(locationId)) {
    return res.status(400).json({ ok: false, error: "locationId must be a uuid" });
  }
  try {
    await unlinkCard(req.user.id, locationId);
    return res.json({ ok: true });
  } catch (err) {
    console.error("[loyalty/unlink] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});

router.get("/me", tenant(), async (req, res) => {
  const locationId = typeof req.query.locationId === "string" ? req.query.locationId : "";
  try {
    const loyalty = await loyaltyVenue(locationId, req, res);
    if (!loyalty) return undefined;
    const link = await linkedCardFor(req.user.id, locationId);
    if (!link) return res.json({ ok: true, player: null, transactions: [] });
    const found = await fetchPlayer(loyalty, link.cardPlayerId);
    if (found.ok !== true) {
      // The card vanished vendor-side (closed account, re-issued number): drop
      // the stale binding so the UI offers linking again rather than looping.
      if (found.status === 404) {
        await unlinkCard(req.user.id, locationId);
        return res.json({ ok: true, player: null, transactions: [] });
      }
      return res.status(502).json({ ok: false, error: found.error });
    }
    const txs = await fetchPlayerTransactions(loyalty, link.cardPlayerId);
    return res.json({
      ok: true,
      player: found.player,
      transactions: txs.ok === true ? txs.transactions : [],
    });
  } catch (err) {
    console.error("[loyalty/me] error:", err);
    return res.status(500).json({ ok: false, error: "internal error" });
  }
});
