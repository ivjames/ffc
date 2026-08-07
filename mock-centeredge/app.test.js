// Tests for the mock CenterEdge API. Run with: node --test mock-centeredge/
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createMockApi, MAX_TICKETS_PER_REWARD } from "./app.js";

let server;
let baseUrl;
let api;

before(async () => {
  api = createMockApi();
  server = http.createServer(api.handler);
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

beforeEach(() => api.resetState());

const AUTH = { Authorization: "Bearer dev-token" };

async function call(method, pathname, { body, headers = {} } = {}) {
  const res = await fetch(baseUrl + pathname, {
    method,
    headers: { "Content-Type": "application/json", ...AUTH, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

test("health check works without auth", async () => {
  const res = await fetch(`${baseUrl}/api/v1/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("menu requires auth and returns categories with modifiers", async () => {
  const unauthed = await fetch(`${baseUrl}/api/v1/menu`);
  assert.equal(unauthed.status, 401);

  const { status, body } = await call("GET", "/api/v1/menu");
  assert.equal(status, 200);
  assert.ok(body.menu.categories.length >= 3);
  const pizza = body.menu.categories[0].items.find((i) => i.id === "item-pizza-cheese");
  assert.ok(pizza.modifierGroups.some((g) => g.name === "Toppings"));
});

test("expired token returns TOKEN_EXPIRED", async () => {
  const { status, body } = await call("GET", "/api/v1/menu", {
    headers: { Authorization: "Bearer expired-token" },
  });
  assert.equal(status, 401);
  assert.equal(body.error.code, "TOKEN_EXPIRED");
});

test("order computes totals including modifiers and tax", async () => {
  const { status, body } = await call("POST", "/api/v1/orders", {
    body: {
      guestName: "Walk-up",
      items: [
        // 1499 + 200 pepperoni + 0 hand-tossed = 1699, ×2 = 3398
        { itemId: "item-pizza-cheese", quantity: 2, modifiers: ["opt-pepperoni", "opt-crust-hand"] },
        // 299 + 100 medium = 399
        { itemId: "item-fountain", quantity: 1, modifiers: ["opt-size-md"] },
      ],
      payment: { method: "tokenized-card", token: "tok_mock_visa" },
    },
  });
  assert.equal(status, 201);
  const subtotal = 3398 + 399;
  assert.equal(body.totals.subtotalCents, subtotal);
  assert.equal(body.totals.taxCents, Math.round(subtotal * 0.07));
  assert.equal(body.totals.totalCents, subtotal + Math.round(subtotal * 0.07));
  assert.equal(body.status, "received");
  assert.ok(body.orderId.startsWith("ord-"));

  const fetched = await call("GET", `/api/v1/orders/${body.orderId}`);
  assert.equal(fetched.status, 200);
  assert.equal(fetched.body.orderId, body.orderId);
});

test("order rejects missing required modifier group", async () => {
  const { status, body } = await call("POST", "/api/v1/orders", {
    body: {
      items: [{ itemId: "item-pizza-cheese", quantity: 1, modifiers: [] }], // crust is required
      payment: { method: "pay-at-counter" },
    },
  });
  assert.equal(status, 422);
  assert.equal(body.error.code, "MODIFIER_SELECTION_REQUIRED");
});

test("order rejects unknown and unavailable items", async () => {
  const unknown = await call("POST", "/api/v1/orders", {
    body: { items: [{ itemId: "item-nope", quantity: 1 }], payment: { method: "pay-at-counter" } },
  });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.body.error.code, "UNKNOWN_ITEM");

  const unavailable = await call("POST", "/api/v1/orders", {
    body: { items: [{ itemId: "item-pretzel", quantity: 1 }], payment: { method: "pay-at-counter" } },
  });
  assert.equal(unavailable.status, 422);
  assert.equal(unavailable.body.error.code, "ITEM_UNAVAILABLE");
});

test("player-credit payment deducts cash balance and logs activity", async () => {
  const before = await call("GET", "/api/v1/players/p-1001");
  const startBalance = before.body.balances.cashBalanceCents;

  const { status, body } = await call("POST", "/api/v1/orders", {
    body: {
      playerId: "p-1001",
      items: [{ itemId: "item-fries", quantity: 1 }],
      payment: { method: "player-credit" },
    },
  });
  assert.equal(status, 201);

  const afterRes = await call("GET", "/api/v1/players/p-1001");
  assert.equal(afterRes.body.balances.cashBalanceCents, startBalance - body.totals.totalCents);
  assert.equal(afterRes.body.recentActivity[0].type, "fnb-purchase");
});

test("player-credit payment fails with 402 when balance is short", async () => {
  const { status, body } = await call("POST", "/api/v1/orders", {
    body: {
      playerId: "p-1002", // 500¢ balance
      items: [{ itemId: "item-wings", quantity: 2, modifiers: ["opt-sauce-bbq"] }],
      payment: { method: "player-credit" },
    },
  });
  assert.equal(status, 402);
  assert.equal(body.error.code, "INSUFFICIENT_FUNDS");
});

test("player lookup returns profile and 404s on unknown id", async () => {
  const { status, body } = await call("GET", "/api/v1/players/p-1001");
  assert.equal(status, 200);
  assert.equal(body.cardNumber, "8014-2233-4455-6677");
  assert.equal(typeof body.balances.tickets, "number");

  const missing = await call("GET", "/api/v1/players/p-9999");
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "PLAYER_NOT_FOUND");
});

test("ticket reward credits balance and is idempotent per key", async () => {
  const before = await call("GET", "/api/v1/players/p-1002");
  const startTickets = before.body.balances.tickets;

  const reward = {
    tickets: 250,
    source: "app-minigame",
    gameId: "skee-blitz",
    idempotencyKey: "reward-abc-123",
  };
  const first = await call("POST", "/api/v1/players/p-1002/tickets/reward", { body: reward });
  assert.equal(first.status, 201);
  assert.equal(first.body.newTicketBalance, startTickets + 250);
  assert.equal(first.body.idempotent, false);

  // Same key replayed: no double credit, same transaction id.
  const second = await call("POST", "/api/v1/players/p-1002/tickets/reward", { body: reward });
  assert.equal(second.status, 200);
  assert.equal(second.body.idempotent, true);
  assert.equal(second.body.transactionId, first.body.transactionId);

  const afterRes = await call("GET", "/api/v1/players/p-1002");
  assert.equal(afterRes.body.balances.tickets, startTickets + 250);
});

test("ticket reward validates amount, source, and card status", async () => {
  const overCap = await call("POST", "/api/v1/players/p-1001/tickets/reward", {
    body: { tickets: MAX_TICKETS_PER_REWARD + 1, source: "app-minigame", idempotencyKey: "over-cap-01" },
  });
  assert.equal(overCap.status, 400);
  assert.equal(overCap.body.error.code, "INVALID_TICKET_AMOUNT");

  const noSource = await call("POST", "/api/v1/players/p-1001/tickets/reward", {
    body: { tickets: 10, idempotencyKey: "no-source-01" },
  });
  assert.equal(noSource.status, 400);
  assert.equal(noSource.body.error.code, "MISSING_SOURCE");

  const frozen = await call("POST", "/api/v1/players/p-1003/tickets/reward", {
    body: { tickets: 10, source: "app-minigame", idempotencyKey: "frozen-01" },
  });
  assert.equal(frozen.status, 409);
  assert.equal(frozen.body.error.code, "PLAYER_CARD_INACTIVE");
});

test("mock reset restores seed state", async () => {
  await call("POST", "/api/v1/players/p-1002/tickets/reward", {
    body: { tickets: 100, source: "app-minigame", idempotencyKey: "pre-reset-01" },
  });
  const reset = await call("POST", "/api/v1/_mock/reset");
  assert.equal(reset.status, 200);

  const { body } = await call("GET", "/api/v1/players/p-1002");
  assert.equal(body.balances.tickets, 65); // seed value
});

test("X-Mock-Fail forces the requested error status", async () => {
  const { status, body } = await call("GET", "/api/v1/menu", { headers: { "X-Mock-Fail": "503" } });
  assert.equal(status, 503);
  assert.equal(body.error.code, "MOCK_FORCED_ERROR");
});
