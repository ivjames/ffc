// node:test coverage for the CenterEdge mock — spins the real server on an
// ephemeral port and exercises the contracts the frontend will code against.
// Run: node --test mock-centeredge/
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

process.env.MOCK_LATENCY_MS = "0";

const { createMockServer } = await import("./server.js");

let server;
let baseUrl;

before(async () => {
  server = createMockServer();
  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(() => server.close());

beforeEach(async () => {
  await fetch(`${baseUrl}/api/v1/mock/reset`, { method: "POST" });
});

const AUTH = { Authorization: "Bearer dev-token" };

function get(path, headers = {}) {
  return fetch(`${baseUrl}${path}`, { headers: { ...AUTH, ...headers } });
}

function post(path, body, headers = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...AUTH, ...headers },
    body: JSON.stringify(body),
  });
}

const validOrder = (over = {}) => ({
  guestName: "Walk-in Guest",
  items: [
    {
      itemId: "itm-pizza-cheese",
      quantity: 1,
      modifiers: ["opt-crust-hand", "opt-pepperoni"],
    },
  ],
  payment: { method: "tokenized_card", token: "tok_test_123" },
  ...over,
});

test("health endpoint needs no auth", async () => {
  const res = await fetch(`${baseUrl}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test("API endpoints reject missing bearer token", async () => {
  const res = await fetch(`${baseUrl}/api/v1/menu`);
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error.code, "unauthorized");
});

test("x-mock-scenario: outage forces a 503", async () => {
  const res = await get("/api/v1/menu", { "X-Mock-Scenario": "outage" });
  assert.equal(res.status, 503);
});

test("GET /api/v1/menu returns categories, items, and modifiers", async () => {
  const res = await get("/api/v1/menu");
  assert.equal(res.status, 200);
  const menu = await res.json();
  assert.equal(menu.currency, "USD");
  assert.ok(Array.isArray(menu.categories) && menu.categories.length >= 3);
  const pizza = menu.categories[0].items.find((i) => i.id === "itm-pizza-cheese");
  assert.equal(pizza.priceCents, 1599);
  const toppings = pizza.modifierGroups.find((g) => g.id === "mod-pizza-toppings");
  assert.ok(toppings.options.some((o) => o.id === "opt-pepperoni"));
});

test("POST /api/v1/orders computes totals server-side", async () => {
  const res = await post("/api/v1/orders", validOrder());
  assert.equal(res.status, 201);
  const order = await res.json();
  assert.equal(order.status, "accepted");
  assert.equal(order.kitchen.printed, true);
  // 1599 base + 0 crust + 200 pepperoni = 1799 subtotal; 7% tax = 126.
  assert.equal(order.totals.subtotalCents, 1799);
  assert.equal(order.totals.taxCents, 126);
  assert.equal(order.totals.totalCents, 1925);
  assert.ok(order.orderId.startsWith("ORD-"));

  const poll = await get(`/api/v1/orders/${order.orderId}`);
  assert.equal(poll.status, 200);
  assert.equal((await poll.json()).orderNumber, order.orderNumber);
});

test("orders with unknown items are rejected whole", async () => {
  const res = await post(
    "/api/v1/orders",
    validOrder({ items: [{ itemId: "itm-nope", quantity: 1 }] })
  );
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "unknown_item");
});

test("sold-out items are rejected", async () => {
  const res = await post(
    "/api/v1/orders",
    validOrder({ items: [{ itemId: "itm-nachos", quantity: 1 }] })
  );
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "item_unavailable");
});

test("required modifier groups are enforced", async () => {
  const res = await post(
    "/api/v1/orders",
    validOrder({ items: [{ itemId: "itm-pizza-cheese", quantity: 1, modifiers: [] }] })
  );
  assert.equal(res.status, 422);
  assert.equal((await res.json()).error.code, "modifier_required");
});

test("stored_value payment debits the card and 402s when short", async () => {
  // PLR-1001 has 2500c stored value. Slice + cheese option = 399c, tax 28c.
  const ok = await post(
    "/api/v1/orders",
    validOrder({
      playerId: "PLR-1001",
      guestName: undefined,
      items: [{ itemId: "itm-pizza-slice", quantity: 1, modifiers: ["opt-slice-cheese"] }],
      payment: { method: "stored_value" },
    })
  );
  assert.equal(ok.status, 201);

  const player = await (await get("/api/v1/players/PLR-1001")).json();
  assert.equal(player.balances.storedValueCents, 2500 - 427);

  // PLR-1002 has 0 stored value — must fail without charging.
  const short = await post(
    "/api/v1/orders",
    validOrder({
      playerId: "PLR-1002",
      guestName: undefined,
      items: [{ itemId: "itm-pizza-slice", quantity: 1, modifiers: ["opt-slice-cheese"] }],
      payment: { method: "stored_value" },
    })
  );
  assert.equal(short.status, 402);
  assert.equal((await short.json()).error.code, "insufficient_funds");
});

test("GET /api/v1/players/{id} returns profile and balances", async () => {
  const res = await get("/api/v1/players/PLR-1001");
  assert.equal(res.status, 200);
  const player = await res.json();
  assert.equal(player.cardNumber, "6039-5501-0000-1001");
  assert.equal(player.balances.ticketCount, 1380);
});

test("unknown player 404s", async () => {
  const res = await get("/api/v1/players/PLR-9999");
  assert.equal(res.status, 404);
  assert.equal((await res.json()).error.code, "player_not_found");
});

test("ticket rewards inject tickets and are idempotent by referenceId", async () => {
  const body = {
    tickets: 250,
    source: "minigame:putt-streak",
    referenceId: "game-abc-123",
  };
  const first = await post("/api/v1/players/PLR-1002/tickets/reward", body);
  assert.equal(first.status, 201);
  const granted = await first.json();
  assert.equal(granted.ticketsAwarded, 250);
  assert.equal(granted.newTicketCount, 25 + 250);

  // Replay (e.g. mobile retry after timeout) must not double-award.
  const replay = await post("/api/v1/players/PLR-1002/tickets/reward", body);
  assert.equal(replay.status, 200);
  const replayed = await replay.json();
  assert.equal(replayed.duplicate, true);
  assert.equal(replayed.rewardId, granted.rewardId);
  assert.equal(replayed.newTicketCount, 275);

  const player = await (await get("/api/v1/players/PLR-1002")).json();
  assert.equal(player.balances.ticketCount, 275);

  const history = await (await get("/api/v1/players/PLR-1002/tickets/history")).json();
  assert.equal(history.length, 1);
  assert.equal(history[0].referenceId, "game-abc-123");
});

test("ticket rewards validate amount and required fields", async () => {
  const tooMany = await post("/api/v1/players/PLR-1002/tickets/reward", {
    tickets: 999999,
    source: "minigame:x",
    referenceId: "r1",
  });
  assert.equal(tooMany.status, 422);

  const noRef = await post("/api/v1/players/PLR-1002/tickets/reward", {
    tickets: 10,
    source: "minigame:x",
  });
  assert.equal(noRef.status, 422);
  assert.equal((await noRef.json()).error.code, "reference_required");
});

test("mock reset restores seed balances", async () => {
  await post("/api/v1/players/PLR-1002/tickets/reward", {
    tickets: 10,
    source: "minigame:x",
    referenceId: "reset-check",
  });
  await fetch(`${baseUrl}/api/v1/mock/reset`, { method: "POST" });
  const player = await (await get("/api/v1/players/PLR-1002")).json();
  assert.equal(player.balances.ticketCount, 25);
});
