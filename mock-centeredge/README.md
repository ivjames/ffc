# mock-centeredge

Local mock of the **CenterEdge Advantage Web Services** surface the FEC app
integrates with: mobile F&B ordering (menu → cart → kitchen) and the player
card / loyalty side (balances, app-earned ticket rewards). In-memory (a restart
resets to the seed); runs both as a local dev backend and — until real
CenterEdge credentials land — as a stand-in demo backend on the droplet, behind
nginx's `/ce` proxy (see "Deployed demo backend" below). It is a mock, never a
production POS: real venues are served by their configured `pos.apiBase`.

**Why it exists:** we are pre-credential — the venue owner still has to sponsor
API access via the CenterEdge Support Portal (sandbox, base URLs, tokens; see
`API-ACCESS-REQUEST.md` for the ready-to-send email). This mock unblocks
frontend and state-management work now. The shapes are our best guess at the
real contract, with deliberately boring field names so the eventual remap is a
rename, not a rewrite. **CenterEdge's public GitHub does not include these
schemas** (only TextPay/Yardarm utilities), so expect field-level adjustments
when real docs arrive — the frontend's single seam is the CenterEdge adapter
`src/lib/pos/centeredge.ts` (behind the vendor-neutral `src/lib/pos/` layer;
features never import vendor code directly).

## Run

```sh
cd mock-centeredge && npm install   # first time only
npm start                           # or, from the repo root: npm run mock:centeredge
```

Listens on `PORT` (default **8070** — the real backend dev port is 8060),
bound to `127.0.0.1` by default (`MOCK_HOST=0.0.0.0` to expose it for
cross-device testing). The frontend client points here by default; override
with `VITE_CENTEREDGE_API_BASE`.

## Deployed demo backend

`ffc deploy` runs this mock under pm2 as **`ffc-centeredge-mock`** (loopback,
`CE_MOCK_PORT`, default 8070) and proxies it same-origin at **`/ce`** via the
player nginx vhost. The client build bakes `VITE_CENTEREDGE_API_BASE=/ce`, so
the POS adapter's `/api/v1/…` calls resolve to `https://<fqdn>/ce/api/v1/…`.
That's what makes the food-ordering + rewards surfaces work in a deployed demo.
With `VITE_DEV_MODE` on (the default), every venue acts as if all POS
capabilities are enabled against this base; a real venue instead sets its
`pos.apiBase` in Master Control, which overrides the baked-in base. Balances
and orders reset to the seed on every deploy (the mock is in-memory).

| env | purpose |
| --- | --- |
| `PORT` | listen port (default 8070) |
| `MOCK_STATIC_TOKEN` | the always-valid dev bearer token (default `ce-mock-dev-token`) |
| `MOCK_LATENCY_MS` | fixed artificial latency per request, to see loading states (default 0) |
| `MOCK_KITCHEN_STATIONS` | simulated cooks in the fake kitchen (default 2) |

## Auth

`POST /api/v1/auth/token` `{clientId, clientSecret}` (any non-empty values) →
`{access_token, token_type: "Bearer", expires_in}`. Every other `/api/v1` route
requires `Authorization: Bearer <token>` — an issued token or the static dev
token. Expiry is **not** enforced (real integration will enforce it).

```sh
curl -s -H "Authorization: Bearer ce-mock-dev-token" localhost:8070/api/v1/menu
```

## Endpoints

All JSON, base path `/api/v1`. Money is **integer cents**. Errors are
`{ok:false, error}` with a meaningful status.

### `GET /health` (no auth)
→ `{ok:true, mock:"centeredge"}`

### `GET /menu`
Full menu: categories → items → modifier groups (see `seed.js`). Notables for
frontend handling: `available:false` items (86'd — `item-nachos` in the seed),
required single-select groups (pizza size, tender dip), priced multi-select
toppings (max 5), and a top-level `taxRatePct`.

### `POST /orders`
```json
{
  "items": [
    { "menuItemId": "item-pizza-cheese", "quantity": 1,
      "modifierIds": ["mod-size-16", "mod-top-pepperoni"], "notes": "well done" }
  ],
  "payment": { "token": "tok_from_payment_sdk", "amountCents": 2422 },
  "playerId": "PL-1001",
  "guestName": "Ava",
  "notes": "table 12"
}
```
The server **recomputes the total** (item + modifiers, × qty, + tax) and
rejects a mismatched `payment.amountCents` with
`400 {expected: {subtotalCents, taxCents, totalCents}}` — so client cart math
is exercised against an independent implementation. `playerId` is optional
(guest checkout); when present it must exist and the order lands in that
player's transaction history as a receipt. Purchases do **not** earn tickets —
whether/how CenterEdge awards points on F&B spend is an open question, so the
mock deliberately doesn't invent a rate.

→ `201 {ok, order, kitchen: {printed: true, station, estimatedReadyAt}}`.
`order.status` starts at `received`; the order is scheduled into the fake
kitchen (below), which fixes its station and ETA. Order lines carry resolved
`modifierNames` alongside `modifierIds` so tickets/receipts render without a
menu lookup.

Failures: `400` validation (unknown item, 86'd item, missing required
modifier, >5 toppings, bad quantity, amount mismatch) · `402 payment_declined`
when `payment.token === "tok_declined"` · `404` unknown `playerId`.

### `GET /orders/:id`
Poll for kitchen progress: `received` → `sent_to_kitchen` → `preparing` →
`ready` → `picked_up`, plus `estimatedReadyAt` (ISO) for the tracking ETA.
Status comes from the fake kitchen's schedule, not a fixed stopwatch — see
below.

## The fake kitchen

`kitchen.js` services orders like a real (tiny) kitchen instead of a fixed
timeline: each order becomes a ticket that prints after a short delay, then
waits for one of `MOCK_KITCHEN_STATIONS` stations. Prep time scales with
what's on the ticket (pizzas slow, drinks fast; extra units add capped time),
so a burst of orders backs the queue up and later guests get honest, longer
ETAs. The whole schedule is computed once at placement and status is derived
from the clock — the load-aware version of the old "no timers to leak" rule.
Timing is demo scale (tens of seconds, not kitchen minutes). Unbumped tickets
auto-complete 10 minutes after ready so boards and polling loops terminate.

### `GET /kitchen` (no auth — a browser page)
The kitchen display (KDS): live board of open tickets with status, queue and
ETA, plus a **Bump** button per ticket — first tap marks the food ready,
second hands it to the guest. Deployed demo: `https://<fqdn>/ce/kitchen`.
This is how a demo driver plays "the kitchen" while someone orders from the
app and watches the tracking screen react.

### `GET /kitchen/orders`
Board JSON: `{ok, stations: {count, busy}, orders, recentlyCompleted}` —
open tickets oldest-first, last 5 picked-up tickets.

### `POST /kitchen/orders/:id/bump`
Advance a ticket: not yet ready → `ready` now; `ready` → `picked_up`.
Idempotent once picked up. Bumping early doesn't reflow other tickets'
reservations (the sim never rewrites history, erring toward safer ETAs).

### Pickup hand-off
Every order carries a 4-digit `pickupCode` (shown big on the guest's Ready
screen and on the KDS ready ticket). **Either side can complete the
hand-off:** staff tap **Hand off** on the KDS (the `ready → picked_up` bump),
or the guest taps "I've picked it up" in the app, whichever happens first.

### `POST /orders/:id/pickup`
Guest-side completion. `409` if the order isn't `ready` yet (collecting food
that's still cooking is rejected, not silently accepted); `→ picked_up` once
ready; idempotent thereafter. The 10-minute auto-complete stays as the safety
net so an abandoned order still leaves the board.

### `GET /players/:id`
`:id` is the account id (`PL-1001`) **or** the physical card number
(`770001112223`). → `{ok, player}` with `balances: {cashCents,
gamePlayCredits, tickets}`. Seeded players in `seed.js`; `PL-1003` has a
sparse profile (no email) on purpose.

### `GET /players/:id/transactions`
Newest-first `food_order` / `ticket_reward` history for the player.

### `POST /players/:id/tickets/reward`
Credits app-earned tickets (mini-games, promos) to the balance:
```json
{ "tickets": 250, "source": "minigame:skee-ball", "idempotencyKey": "<game session id>" }
```
`idempotencyKey` is **required** — a retried request replays the original
response (`duplicate: true`) instead of double-crediting, which is exactly the
retry semantics the real injection endpoint must have. `tickets` must be an
integer 1..10000.

→ `{ok, transactionId, playerId, ticketsAwarded, newTicketBalance, duplicate}`.

### `POST /_reset`
Restores all balances/orders to the seed (issued tokens survive). For tests
and demo resets.

## Failure simulation

- `payment.token = "tok_declined"` → 402 on order placement.
- Header `x-mock-force-error: 503` (any 4xx/5xx) → that status from any route,
  for exercising error/retry UI.
- `MOCK_LATENCY_MS=1500 npm start` → visible loading states.

## Tests

```sh
npm test   # node's built-in runner, boots the app on an ephemeral port
```

## Swapping in the real API later

1. Point the venue at the provisioned base URL — per venue via Master
   Control's POS config (`pos.apiBase`), or `VITE_CENTEREDGE_API_BASE` as the
   dev default.
2. Replace the static-token default in `src/lib/pos/centeredge.ts` with the
   real auth flow (`authenticate()` is the seam). Long-term, per-venue
   credentials belong in a server-side proxy (the `server/lib/vision.js`
   pattern), not the client bundle.
3. Reconcile field names/paths against the real Advantage Web Services docs —
   the CenterEdge adapter is the entire blast radius; features only see the
   vendor-neutral types in `src/lib/pos/types.ts`, so drift shows up as type
   errors there, not scattered across features.
