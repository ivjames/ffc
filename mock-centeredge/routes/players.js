// Player cards + ticket rewards — the mock stand-in for CenterEdge's player
// card database.
//
//   GET  /api/v1/players?cardNumber=…       look up a player by physical card
//   GET  /api/v1/players/:id                profile + balances
//   POST /api/v1/players/:id/tickets/reward inject app-earned tickets
//
// The reward endpoint requires an idempotencyKey and replays the original
// response on retry instead of double-crediting — build the client against
// that contract now, because the real injection API will demand it (a flaky
// network plus a retry loop must never mint tickets twice).
import { Router } from "express";
import { newId } from "../lib/store.js";

const MAX_TICKETS_PER_REWARD = 10_000;

export function playersRouter(store) {
  const router = Router();

  router.get("/", (req, res) => {
    const cardNumber = req.query.cardNumber;
    if (typeof cardNumber !== "string" || cardNumber.length === 0) {
      return res.status(400).json({ ok: false, error: "cardNumber query param is required" });
    }
    const normalized = cardNumber.replace(/[\s-]/g, "");
    for (const player of store.players.values()) {
      if (player.cardNumber.replace(/[\s-]/g, "") === normalized) {
        return res.json({ ok: true, player });
      }
    }
    return res.status(404).json({ ok: false, error: "no player with that card number" });
  });

  router.get("/:id", (req, res) => {
    const player = store.players.get(req.params.id);
    if (!player) return res.status(404).json({ ok: false, error: "player not found" });
    return res.json({ ok: true, player });
  });

  router.post("/:id/tickets/reward", (req, res) => {
    const player = store.players.get(req.params.id);
    if (!player) return res.status(404).json({ ok: false, error: "player not found" });

    const body = req.body ?? {};
    const { tickets, idempotencyKey } = body;
    if (typeof idempotencyKey !== "string" || idempotencyKey.length === 0 || idempotencyKey.length > 100) {
      return res.status(400).json({ ok: false, error: "idempotencyKey is required (1–100 chars)" });
    }
    if (!Number.isInteger(tickets) || tickets < 1 || tickets > MAX_TICKETS_PER_REWARD) {
      return res
        .status(400)
        .json({ ok: false, error: `tickets must be an integer 1–${MAX_TICKETS_PER_REWARD}` });
    }

    const replayKey = `${player.id}:${idempotencyKey}`;
    const prior = store.rewardsByKey.get(replayKey);
    if (prior) return res.json({ ...prior, replayed: true });

    player.balances.tickets += tickets;
    const response = {
      ok: true,
      reward: {
        id: newId("rwd"),
        playerId: player.id,
        tickets,
        source: typeof body.source === "string" ? body.source.slice(0, 50) : "app",
        gameId: typeof body.gameId === "string" ? body.gameId.slice(0, 50) : null,
        createdAt: new Date().toISOString(),
      },
      balance: { tickets: player.balances.tickets },
    };
    store.rewardsByKey.set(replayKey, response);
    return res.status(201).json(response);
  });

  return router;
}
