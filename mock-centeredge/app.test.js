import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createApp, STATIC_TOKEN } from './app.js';
import {
  AUTO_PICKUP_MS,
  EXTRA_UNIT_MS,
  MAX_EXTRA_MS,
  PRINT_DELAY_MS,
  bumpTicket,
  completedAtMs,
  freshKitchen,
  prepDurationMs,
  scheduleTicket,
  ticketStatus,
} from './kitchen.js';

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

test('order happy path: server-priced total, kitchen ticket, ETA on the order', async () => {
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
  assert.match(body.kitchen.station, /^station-\d+$/);
  assert.ok(Date.parse(body.order.estimatedReadyAt) > Date.now());
  // Modifier names ride along for the kitchen ticket / receipt.
  assert.deepEqual(body.order.items[0].modifierNames, ['16" Large', 'Pepperoni']);

  const poll = await fetch(`${base}/orders/${body.order.id}`, { headers: AUTH });
  const polled = (await poll.json()).order;
  assert.equal(polled.status, 'received'); // print delay hasn't elapsed yet
  assert.equal(polled.estimatedReadyAt, body.order.estimatedReadyAt);
});

// ---- fake kitchen sim (pure functions, no waiting) -------------------------

const PIZZA = [{ menuItemId: 'item-pizza-cheese', quantity: 1 }];

test('kitchen sim: a lone ticket walks the whole lifecycle on schedule', () => {
  const kitchen = freshKitchen(2);
  const t0 = 1_000_000;
  const ticket = scheduleTicket(kitchen, PIZZA, t0);
  assert.equal(ticket.startAtMs, t0 + PRINT_DELAY_MS); // empty kitchen: no queue wait
  assert.equal(ticket.readyAtMs, ticket.startAtMs + prepDurationMs(PIZZA));
  assert.equal(ticketStatus(ticket, t0), 'received');
  assert.equal(ticketStatus(ticket, ticket.startAtMs), 'preparing');
  assert.equal(ticketStatus(ticket, ticket.readyAtMs - 1), 'preparing');
  assert.equal(ticketStatus(ticket, ticket.readyAtMs), 'ready');
  // Never bumped → assumed collected after the auto-pickup window.
  assert.equal(ticketStatus(ticket, ticket.readyAtMs + AUTO_PICKUP_MS), 'picked_up');
});

test('kitchen sim: tickets queue when every station is busy', () => {
  const kitchen = freshKitchen(2);
  const a = scheduleTicket(kitchen, PIZZA, 0);
  const b = scheduleTicket(kitchen, PIZZA, 0);
  const c = scheduleTicket(kitchen, PIZZA, 0);
  assert.notEqual(a.station, b.station); // burst spreads across stations
  assert.equal(b.startAtMs, PRINT_DELAY_MS);
  // Third order waits for the first station to free up…
  assert.equal(c.startAtMs, Math.min(a.readyAtMs, b.readyAtMs));
  // …and reads as queued-in-kitchen while it waits.
  assert.equal(ticketStatus(c, PRINT_DELAY_MS + 1), 'sent_to_kitchen');
});

test('kitchen sim: the slowest line sets prep; extra units add capped time', () => {
  const drink = [{ menuItemId: 'item-fountain', quantity: 1 }];
  const both = [...PIZZA, ...drink];
  assert.ok(prepDurationMs(drink) < prepDurationMs(PIZZA));
  // The drink rides along with the pizza rather than queueing after it.
  assert.equal(prepDurationMs(both), prepDurationMs(PIZZA) + EXTRA_UNIT_MS);
  const party = [{ menuItemId: 'item-pizza-cheese', quantity: 20 }];
  assert.equal(prepDurationMs(party), prepDurationMs(PIZZA) + MAX_EXTRA_MS);
});

test('kitchen sim: bump forces ready, then picked up, then is idempotent', () => {
  const kitchen = freshKitchen(1);
  const ticket = scheduleTicket(kitchen, PIZZA, 0);
  const midPrep = ticket.startAtMs + 1;
  assert.equal(bumpTicket(ticket, midPrep), 'ready'); // food's up early
  assert.equal(ticket.readyAtMs, midPrep);
  assert.equal(ticketStatus(ticket, midPrep), 'ready');
  assert.equal(bumpTicket(ticket, midPrep + 5), 'picked_up'); // handed to the guest
  assert.equal(bumpTicket(ticket, midPrep + 6), 'picked_up'); // double-tap is harmless
  assert.equal(ticketStatus(ticket, midPrep + 7), 'picked_up');
});

test('kitchen sim: completion time is the bump instant, else auto-pickup', () => {
  const kitchen = freshKitchen(1);
  // Made ready early, sat a while, then handed off — completes at the bump.
  const bumped = scheduleTicket(kitchen, PIZZA, 0);
  bumpTicket(bumped, 5); // ready
  bumpTicket(bumped, 9_000); // picked up at t=9000
  assert.equal(completedAtMs(bumped), 9_000);
  // Never bumped — completes at the derived auto-pickup instant, which lands
  // AFTER the bumped ticket's pickup even though it was ready far earlier.
  const abandoned = scheduleTicket(freshKitchen(1), PIZZA, 0);
  assert.equal(completedAtMs(abandoned), abandoned.readyAtMs + AUTO_PICKUP_MS);
  assert.ok(completedAtMs(abandoned) > completedAtMs(bumped));
});

test('kitchen board lists open tickets and bump services them end to end', async () => {
  const placed = await (
    await post('/orders', {
      items: CART,
      payment: { token: 'tok_visa_4242', amountCents: CART_TOTAL },
      guestName: 'KDS Test',
    })
  ).json();
  const id = placed.order.id;

  const board = await (await fetch(`${base}/kitchen/orders`, { headers: AUTH })).json();
  assert.ok(board.stations.count >= 1);
  const ticket = board.orders.find((o) => o.id === id);
  assert.equal(ticket.guestName, 'KDS Test');
  assert.match(ticket.station, /^station-\d+$/);
  assert.ok(['received', 'sent_to_kitchen', 'preparing'].includes(ticket.status));

  // First bump: food's up. Second: handed off.
  const first = await (await post(`/kitchen/orders/${id}/bump`, {})).json();
  assert.equal(first.order.status, 'ready');
  const second = await (await post(`/kitchen/orders/${id}/bump`, {})).json();
  assert.equal(second.order.status, 'picked_up');

  // Off the live board, into the completed rail — and the player's tracking
  // poll sees the fulfilled state too.
  const after = await (await fetch(`${base}/kitchen/orders`, { headers: AUTH })).json();
  assert.equal(after.orders.find((o) => o.id === id), undefined);
  assert.ok(after.recentlyCompleted.some((o) => o.id === id));
  const polled = await (await fetch(`${base}/orders/${id}`, { headers: AUTH })).json();
  assert.equal(polled.order.status, 'picked_up');

  assert.equal((await post('/kitchen/orders/ord-nope/bump', {})).status, 404);
});

test('kitchen API requires auth; the KDS page itself does not', async () => {
  assert.equal((await fetch(`${base}/kitchen/orders`)).status, 401);
  assert.equal(
    (await fetch(`${base}/kitchen/orders/x/bump`, { method: 'POST' })).status,
    401,
  );
  const page = await fetch(`${base.replace(/\/api\/v1$/, '')}/kitchen`);
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /text\/html/);
  assert.match(await page.text(), /Kitchen/);
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
