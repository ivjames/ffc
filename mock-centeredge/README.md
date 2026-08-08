# mock-centeredge

Local mock of the **CenterEdge Advantage Web Services** surface the FEC app
integrates with: mobile F&B ordering (menu → cart → kitchen) and the player
card / loyalty side (balances, app-earned ticket rewards). Dev-only, in-memory,
never deployed.

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

Listens on `PORT` (default **8070** — the real backend dev port is 8060).
The frontend client (`src/lib/centeredgeApi.ts`) points here by default;
override with `VITE_CENTEREDGE_API_BASE`.

| env | purpose |
| --- | --- |
| `PORT` | listen port (default 8070) |
| `MOCK_STATIC_TOKEN` | the always-valid dev bearer token (default `ce-mock-dev-token`) |
| `MOCK_LATENCY_MS` | fixed artificial latency per request, to see loading states (default 0) |

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
player's transaction history.

→ `201 {ok, order, kitchen: {printed: true, station: "kitchen-1"}}`.
`order.status` starts at `received`.

Failures: `400` validation (unknown item, 86'd item, missing required
modifier, >5 toppings, bad quantity, amount mismatch) · `402 payment_declined`
when `payment.token === "tok_declined"` · `404` unknown `playerId`.

### `GET /orders/:id`
Poll for kitchen progress. Status is derived from time since creation:
`received` (<5s) → `sent_to_kitchen` (<20s) → `preparing` (<45s) → `ready`.

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
