import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, STATIC_TOKEN, orderStatus } from './app.js';

let server;
let base;

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.on('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}/api/v1`;
});

after(() => server.close());

const AUTH = { authorization: `Bearer ${STATIC_TOKEN}` };
const JSON_AUTH = { ...AUTH, 'content-type': 'application/json' };

function post(path, body, headers = JSON_AUTH) {
  return fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

// A valid cart: 16" cheese pizza + pepperoni, large fountain drink.
// (1299+400+150) + (299+100) = 2248; tax 7.75% → 174; total 2422.
const CART = [
  { menuItemId: 'item-pizza-cheese', quantity: 1, modifierIds: ['mod-size-16', 'mod-top-pepperoni'] },
  { menuItemId: 'item-fountain', quantity: 1, modifierIds: ['mod-drink-lg'] },
];
const CART_TOTAL = 2422;

test('routes require a bearer token', async () => {
  const res = await fetch(`${base}/menu`);
  assert.equal(res.status, 401);
});

test('auth/token issues a working token', async () => {
  const issued = await post('/auth/token', { clientId: 'fec-app', clientSecret: 'dev' }, { 'content-type': 'application/json' });
  assert.equal(issued.status, 200);
  const { access_token, token_type } = await issued.json();
  assert.equal(token_type, 'Bearer');
  const res = await fetch(`${base}/menu`, { headers: { authorization: `Bearer ${access_token}` } });
  assert.equal(res.status, 200);
});

test('menu has categories, priced items, and modifier groups', async () => {
  const res = await fetch(`${base}/menu`, { headers: AUTH });
  const menu = await res.json();
  assert.ok(menu.categories.length >= 4);
  const pizza = menu.categories
    .flatMap((c) => c.items)
    .find((i) => i.id === 'item-pizza-cheese');
  assert.equal(pizza.priceCents, 1299);
  assert.ok(pizza.modifierGroups.some((g) => g.name === 'Extra Toppings'));
});

test('order happy path: server-priced total, kitchen status, polling progression', async () => {
  const res = await post('/orders', {
    items: CART,
    payment: { token: 'tok_visa_4242', amountCents: CART_TOTAL },
    playerId: 'PL-1001',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.order.totalCents, CART_TOTAL);
  assert.equal(body.order.status, 'received');
  assert.equal(body.kitchen.printed, true);

  const poll = await fetch(`${base}/orders/${body.order.id}`, { headers: AUTH });
  assert.equal((await poll.json()).order.status, 'received');
  // The derived timeline itself (pure function, no waiting):
  const t0 = Date.now();
  assert.equal(orderStatus(t0, t0 + 1_000), 'received');
  assert.equal(orderStatus(t0, t0 + 10_000), 'sent_to_kitchen');
  assert.equal(orderStatus(t0, t0 + 30_000), 'preparing');
  assert.equal(orderStatus(t0, t0 + 60_000), 'ready');
});

test('a linked-card order lands in history but does not earn tickets', async () => {
  const before = (await (await fetch(`${base}/players/PL-1002`, { headers: AUTH })).json())
    .player.balances.tickets;
  const res = await post('/orders', {
    items: CART,
    payment: { token: 'tok_visa_4242', amountCents: CART_TOTAL },
    playerId: 'PL-1002',
  });
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.loyalty, undefined); // no purchase-based earning

  const after = (await (await fetch(`${base}/players/PL-1002`, { headers: AUTH })).json())
    .player.balances.tickets;
  assert.equal(after, before); // balance unchanged by the purchase
  const txs = (await (await fetch(`${base}/players/PL-1002/transactions`, { headers: AUTH })).json())
    .transactions;
  assert.equal(txs[0].type, 'food_order'); // still recorded as a receipt
  assert.equal(txs[0].earnedTickets, undefined);
});

test('order rejects a total mismatch with the expected breakdown', async () => {
  const res = await post('/orders', {
    items: CART,
    payment: { token: 'tok_visa_4242', amountCents: 999 },
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.expected.totalCents, CART_TOTAL);
});

test('order rejects missing required modifier, unknown item, unavailable item', async () => {
  for (const items of [
    [{ menuItemId: 'item-pizza-cheese', quantity: 1, modifierIds: [] }], // size required
    [{ menuItemId: 'item-nope', quantity: 1 }],
    [{ menuItemId: 'item-nachos', quantity: 1 }], // 86'd in seed
  ]) {
    const res = await post('/orders', { items, payment: { token: 't', amountCents: 1 } });
    assert.equal(res.status, 400);
  }
});

test('tok_declined simulates a card decline', async () => {
  const res = await post('/orders', {
    items: CART,
    payment: { token: 'tok_declined', amountCents: CART_TOTAL },
  });
  assert.equal(res.status, 402);
  assert.equal((await res.json()).error, 'payment_declined');
});

test('player lookup works by id and by card number; unknown is 404', async () => {
  const byId = await (await fetch(`${base}/players/PL-1002`, { headers: AUTH })).json();
  assert.equal(byId.player.displayName, 'Sam Chen');
  const byCard = await (await fetch(`${base}/players/770001112230`, { headers: AUTH })).json();
  assert.equal(byCard.player.id, 'PL-1002');
  assert.equal((await fetch(`${base}/players/PL-9999`, { headers: AUTH })).status, 404);
});

test('ticket reward credits the balance and replays on a duplicate key', async () => {
  const before = (await (await fetch(`${base}/players/PL-1003`, { headers: AUTH })).json())
    .player.balances.tickets;
  const body = { tickets: 250, source: 'minigame:skee-ball', idempotencyKey: 'test-key-1' };

  const first = await (await post('/players/PL-1003/tickets/reward', body)).json();
  assert.equal(first.duplicate, false);
  assert.equal(first.newTicketBalance, before + 250);

  const replay = await (await post('/players/PL-1003/tickets/reward', body)).json();
  assert.equal(replay.duplicate, true);
  assert.equal(replay.transactionId, first.transactionId);
  assert.equal(replay.newTicketBalance, before + 250); // no double credit

  const after = (await (await fetch(`${base}/players/PL-1003`, { headers: AUTH })).json())
    .player.balances.tickets;
  assert.equal(after, before + 250);

  const txs = (await (await fetch(`${base}/players/PL-1003/transactions`, { headers: AUTH })).json())
    .transactions;
  assert.equal(txs.filter((t) => t.id === first.transactionId).length, 1);
});

test('ticket reward validates payload', async () => {
  for (const body of [
    { tickets: 250 }, // no idempotencyKey
    { tickets: 0, idempotencyKey: 'k' },
    { tickets: 10_001, idempotencyKey: 'k' },
    { tickets: 2.5, idempotencyKey: 'k' },
  ]) {
    const res = await post('/players/PL-1001/tickets/reward', body);
    assert.equal(res.status, 400);
  }
});

test('x-mock-force-error forces any error status', async () => {
  const res = await fetch(`${base}/menu`, { headers: { ...AUTH, 'x-mock-force-error': '503' } });
  assert.equal(res.status, 503);
});

test('_reset restores seed balances', async () => {
  await post('/players/PL-1001/tickets/reward', { tickets: 5, idempotencyKey: 'pre-reset' });
  await post('/_reset', {});
  const player = (await (await fetch(`${base}/players/PL-1001`, { headers: AUTH })).json()).player;
  assert.equal(player.balances.tickets, 4380);
});
