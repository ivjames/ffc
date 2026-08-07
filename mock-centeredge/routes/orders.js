// F&B ordering — the mock stand-in for injecting orders into CenterEdge's
// kitchen management.
//
//   POST /api/v1/orders      submit a cart (validated + priced server-side)
//   GET  /api/v1/orders/:id  poll kitchen status (received → in_kitchen → ready)
//
// The mock recomputes the total from the menu and rejects a client total that
// disagrees (422 with expectedTotalCents) — that mismatch is exactly the bug
// class a cart UI ships with, and the real POS will be at least this strict.
// Payment is a token passthrough: any token is "charged" except the magic
// token "tok_declined", which returns 402 so the frontend can build the
// card-declined path.
import { Router } from "express";
import { itemIndex, newId, orderStatus } from "../lib/store.js";

const MAX_QTY_PER_LINE = 20;
const MAX_LINES = 30;

export function ordersRouter(store) {
  const router = Router();

  router.post("/", (req, res) => {
    const body = req.body ?? {};
    const items = Array.isArray(body.items) ? body.items : null;
    if (!items || items.length === 0 || items.length > MAX_LINES) {
      return res
        .status(400)
        .json({ ok: false, error: `items must be a non-empty array (max ${MAX_LINES} lines)` });
    }
    if (body.playerId !== undefined && !store.players.has(body.playerId)) {
      return res.status(404).json({ ok: false, error: `unknown playerId ${body.playerId}` });
    }

    const index = itemIndex(store.menu);
    const problems = [];
    const lines = [];
    let totalCents = 0;

    items.forEach((line, i) => {
      const item = index.get(line?.itemId);
      if (!item) return problems.push(`items[${i}]: unknown itemId ${JSON.stringify(line?.itemId)}`);
      if (!item.available) return problems.push(`items[${i}]: ${item.id} is unavailable (86'd)`);
      const qty = line.quantity;
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY_PER_LINE) {
        return problems.push(`items[${i}]: quantity must be an integer 1–${MAX_QTY_PER_LINE}`);
      }

      const chosen = Array.isArray(line.modifiers) ? line.modifiers : [];
      let lineCents = item.priceCents;
      const validModifiers = new Map();
      for (const g of item.modifierGroups) for (const m of g.modifiers) validModifiers.set(m.id, m);
      for (const modId of chosen) {
        const mod = validModifiers.get(modId);
        if (!mod) return problems.push(`items[${i}]: modifier ${JSON.stringify(modId)} not valid for ${item.id}`);
        lineCents += mod.priceCents;
      }
      // Enforce group min/max (e.g. crust choice is required, max 5 toppings).
      for (const g of item.modifierGroups) {
        const picked = g.modifiers.filter((m) => chosen.includes(m.id)).length;
        if (picked < g.minSelections || picked > g.maxSelections) {
          return problems.push(
            `items[${i}]: group "${g.name}" needs ${g.minSelections}–${g.maxSelections} selections, got ${picked}`
          );
        }
      }

      lineCents *= qty;
      totalCents += lineCents;
      lines.push({
        itemId: item.id,
        name: item.name,
        quantity: qty,
        modifiers: chosen,
        notes: typeof line.notes === "string" ? line.notes.slice(0, 200) : undefined,
        lineTotalCents: lineCents,
      });
    });

    if (problems.length > 0) {
      return res.status(422).json({ ok: false, error: "invalid items", problems });
    }

    const payment = body.payment ?? {};
    if (typeof payment.token !== "string" || payment.token.length === 0) {
      return res.status(400).json({ ok: false, error: "payment.token is required" });
    }
    if (payment.amountCents !== totalCents) {
      return res.status(422).json({
        ok: false,
        error: "payment.amountCents does not match the priced cart",
        expectedTotalCents: totalCents,
      });
    }
    if (payment.token === "tok_declined") {
      return res.status(402).json({ ok: false, error: "card declined", code: "card_declined" });
    }

    const now = Date.now();
    const order = {
      id: newId("ord"),
      locationId: store.menu.locationId,
      playerId: body.playerId ?? null,
      items: lines,
      totalCents,
      createdAt: new Date(now).toISOString(),
      createdAtMs: now,
      estimatedReadyMinutes: 12,
    };
    store.orders.set(order.id, order);

    const { createdAtMs, ...publicOrder } = order;
    return res.status(201).json({ ok: true, order: { ...publicOrder, ...orderStatus(order, now) } });
  });

  router.get("/:id", (req, res) => {
    const order = store.orders.get(req.params.id);
    if (!order) return res.status(404).json({ ok: false, error: "order not found" });
    const { createdAtMs, ...publicOrder } = order;
    return res.json({ ok: true, order: { ...publicOrder, ...orderStatus(order) } });
  });

  return router;
}
