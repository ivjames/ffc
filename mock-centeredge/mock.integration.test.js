// Integration coverage for the mock CenterEdge API: menu shape, order
// validation/pricing/status, player lookup, and idempotent ticket rewards.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "./app.js";
import { orderStatus, ORDER_RECEIVED_MS, ORDER_IN_KITCHEN_MS } from "./lib/store.js";

let baseUrl;
let server;

before(async () => {
  const app = createApp();
  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const get = (path) => fetch(`${baseUrl}${path}`);
const post = (path, body) =>
  fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

// A known-good cart: one 16" pizza (crust required, +pepperoni 250) = 2149,
// one large fountain drink (299 + 100) = 399. Total 2548.
const goodCart = () => ({
  items: [
    {
      itemId: "itm_pizza_cheese_16",
      quantity: 1,
      modifiers: ["mod_crust_hand", "mod_pepperoni"],
    },
    { itemId: "itm_fountain", quantity: 1, modifiers: ["mod_size_lg"] },
  ],
  payment: { token: "tok_test_visa", amountCents: 2548 },
});

test("GET /api/health identifies the mock", async () => {
  const res = await get("/api/health");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, mock: "centeredge" });
});

test("GET /api/v1/menu returns categories, items, prices, modifiers", async () => {
  const res = await get("/api/v1/menu");
  assert.equal(res.status, 200);
  const { ok, menu } = await res.json();
  assert.equal(ok, true);
  assert.ok(Array.isArray(menu.categories) && menu.categories.length >= 4);
  const pizza = menu.categories
    .flatMap((c) => c.items)
    .find((i) => i.id === "itm_pizza_cheese_16");
  assert.equal(pizza.priceCents, 1899);
  const toppings = pizza.modifierGroups.find((g) => g.id === "mg_toppings");
  assert.ok(toppings.modifiers.some((m) => m.id === "mod_pepperoni" && m.priceCents === 250));
});

test("POST /api/v1/orders prices the cart and returns kitchen status", async () => {
  const res = await post("/api/v1/orders", goodCart());
  assert.equal(res.status, 201);
  const { ok, order } = await res.json();
  assert.equal(ok, true);
  assert.equal(order.totalCents, 2548);
  assert.equal(order.status, "received");
  assert.equal(order.printing.kitchen, "queued");
  assert.match(order.id, /^ord_/);

  const poll = await get(`/api/v1/orders/${order.id}`);
  assert.equal(poll.status, 200);
  assert.equal((await poll.json()).order.status, "received");
});

test("order status progresses received → in_kitchen → ready with age", () => {
  const order = { createdAtMs: 0 };
  assert.equal(orderStatus(order, 0).status, "received");
  assert.equal(orderStatus(order, ORDER_RECEIVED_MS).status, "in_kitchen");
  assert.equal(orderStatus(order, ORDER_RECEIVED_MS + ORDER_IN_KITCHEN_MS).status, "ready");
});

test("POST /api/v1/orders rejects a wrong client total with the expected one", async () => {
  const cart = goodCart();
  cart.payment.amountCents = 999;
  const res = await post("/api/v1/orders", cart);
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.expectedTotalCents, 2548);
});

test("POST /api/v1/orders rejects unknown items, bad modifiers, and 86'd items", async () => {
  const res = await post("/api/v1/orders", {
    items: [
      { itemId: "itm_nope", quantity: 1 },
      { itemId: "itm_fountain", quantity: 1, modifiers: ["mod_pepperoni"] },
      { itemId: "itm_nachos", quantity: 1 },
    ],
    payment: { token: "tok_test_visa", amountCents: 100 },
  });
  assert.equal(res.status, 422);
  const { problems } = await res.json();
  assert.equal(problems.length, 3);
});

test("POST /api/v1/orders enforces required modifier groups (crust)", async () => {
  const res = await post("/api/v1/orders", {
    items: [{ itemId: "itm_pizza_cheese_16", quantity: 1, modifiers: [] }],
    payment: { token: "tok_test_visa", amountCents: 1899 },
  });
  assert.equal(res.status, 422);
  const { problems } = await res.json();
  assert.match(problems[0], /Crust/);
});

test("POST /api/v1/orders declines the magic token with 402", async () => {
  const cart = goodCart();
  cart.payment.token = "tok_declined";
  const res = await post("/api/v1/orders", cart);
  assert.equal(res.status, 402);
  assert.equal((await res.json()).code, "card_declined");
});

test("GET /api/v1/players/:id returns profile and balances; 404 unknown", async () => {
  const res = await get("/api/v1/players/plr_1001");
  assert.equal(res.status, 200);
  const { player } = await res.json();
  assert.equal(player.cardNumber, "6039-5551-0001");
  assert.equal(typeof player.balances.tickets, "number");

  assert.equal((await get("/api/v1/players/plr_nope")).status, 404);
});

test("GET /api/v1/players?cardNumber= looks up by physical card, ignoring dashes", async () => {
  const res = await get("/api/v1/players?cardNumber=603955510002");
  assert.equal(res.status, 200);
  assert.equal((await res.json()).player.id, "plr_1002");
});

test("ticket reward credits the balance and replays on the same idempotencyKey", async () => {
  const before = (await (await get("/api/v1/players/plr_1002")).json()).player.balances.tickets;
  const body = { tickets: 250, source: "minigame", gameId: "putt-streak", idempotencyKey: "test-key-1" };

  const first = await post("/api/v1/players/plr_1002/tickets/reward", body);
  assert.equal(first.status, 201);
  const firstJson = await first.json();
  assert.equal(firstJson.balance.tickets, before + 250);
  assert.match(firstJson.reward.id, /^rwd_/);

  // Retry with the same key: same reward id, no double credit.
  const second = await post("/api/v1/players/plr_1002/tickets/reward", body);
  assert.equal(second.status, 200);
  const secondJson = await second.json();
  assert.equal(secondJson.replayed, true);
  assert.equal(secondJson.reward.id, firstJson.reward.id);
  assert.equal(secondJson.balance.tickets, before + 250);

  const after = (await (await get("/api/v1/players/plr_1002")).json()).player.balances.tickets;
  assert.equal(after, before + 250);
});

test("ticket reward rejects missing idempotencyKey and out-of-range amounts", async () => {
  const noKey = await post("/api/v1/players/plr_1001/tickets/reward", { tickets: 10 });
  assert.equal(noKey.status, 400);

  for (const tickets of [0, -5, 10001, 2.5, "50"]) {
    const res = await post("/api/v1/players/plr_1001/tickets/reward", {
      tickets,
      idempotencyKey: `bad-${tickets}`,
    });
    assert.equal(res.status, 400, `tickets=${tickets} should 400`);
  }
});

test("POST /api/v1/_reset restores seed balances", async () => {
  await post("/api/v1/players/plr_1003/tickets/reward", {
    tickets: 500,
    idempotencyKey: "reset-test",
  });
  const reset = await post("/api/v1/_reset", {});
  assert.equal(reset.status, 200);
  const { player } = await (await get("/api/v1/players/plr_1003")).json();
  assert.equal(player.balances.tickets, 0);
});
