# Mock CenterEdge API

A local stand-in for the CenterEdge Advantage Web Services APIs (F&B ordering +
player card / loyalty), so frontend and state-management work can proceed
**before** the FEC owner secures real API credentials from CenterEdge.

> ⚠️ These payload shapes are our best-guess design, not CenterEdge's official
> schemas. CenterEdge's public GitHub only hosts utilities (TextPay OpenAPI
> specs, Yardarm) — the core POS/loyalty schemas are only available once the
> owner sponsors API access via the CenterEdge Support Portal. When the sandbox
> arrives, reconcile these shapes against the official docs and adjust the
> app's API layer in one place.

## Running

Zero dependencies — Node 18+ only:

```sh
npm run mock:centeredge        # from the repo root, or:
node mock-centeredge/server.js
```

Listens on `http://localhost:4300` (override with `MOCK_PORT`). CORS is wide
open so a Vite/Metro dev server can call it directly.

Tests: `npm run test:mock` (uses Node's built-in test runner, no deps).

## Authentication

Every endpoint except `/api/v1/health` and `/api/v1/_mock/reset` requires an
`Authorization: Bearer <token>` header, mimicking the OAuth-style tokens the
real integration will use.

- Any non-empty token is accepted by default.
- `Bearer expired-token` always returns `401 TOKEN_EXPIRED` — use it to test
  the app's token-refresh path.
- Set `MOCK_API_TOKEN=<value>` to require an exact token (`403 FORBIDDEN`
  otherwise).

## Endpoints

### `GET /api/v1/menu`

Returns `{ menu }` — categories → items → modifier groups → options. Prices
are **integer cents** (`priceCents`, `priceDeltaCents`). `taxRateBps` (basis
points, 700 = 7%) applies at order time. Items can be `available: false`
(the seeded pretzel is, for testing sold-out UI). Modifier groups carry
`required` / `minSelections` / `maxSelections` — the order endpoint enforces
them.

### `POST /api/v1/orders`

```jsonc
{
  "playerId": "p-1001",              // optional unless paying with player-credit
  "guestName": "Walk-up",            // optional
  "deliverTo": "Table 12",           // optional free text (table/locker/pickup)
  "items": [
    {
      "itemId": "item-pizza-cheese",
      "quantity": 1,                 // integer 1–20
      "modifiers": ["opt-pepperoni", "opt-crust-hand"],
      "notes": "extra crispy"        // optional, ≤200 chars
    }
  ],
  "payment": {
    "method": "tokenized-card",      // or "player-credit" | "pay-at-counter"
    "token": "tok_mock_visa"         // required for tokenized-card
  }
}
```

Responds `201` with the order: `orderId`, `status`, per-line pricing, `totals`
(`subtotalCents` / `taxCents` / `totalCents`), `kitchen` print status, and
`estimatedReadyMinutes`. `player-credit` deducts the player's
`cashBalanceCents` (or fails `402 INSUFFICIENT_FUNDS`) and logs the purchase
in their activity feed.

### `GET /api/v1/orders/:id`

Poll for live status. The mock advances the order on wall-clock time so the
status UI can be exercised without a kitchen:

| elapsed | `status`    | `kitchen.printStatus` |
|--------:|-------------|-----------------------|
|  0–3 s  | `received`  | `queued`              |
|  3–15 s | `received`  | `printed`             |
| 15–60 s | `preparing` | `printed`             |
|  60 s+  | `ready`     | `printed`             |

### `GET /api/v1/players/:id`

Guest profile + digital arcade card: `cardNumber`, `tier`, `status`
(`active` / `frozen`), `balances` (`cashBalanceCents`, `gamePlayCredits`,
`bonusCredits`, `tickets`), and `recentActivity`.

Seeded players:

| id       | card                  | notes                                   |
|----------|-----------------------|-----------------------------------------|
| `p-1001` | `8014-2233-4455-6677` | gold tier, $25 cash, 1850 tickets       |
| `p-1002` | `8014-8899-1122-3344` | low balance ($5) — good for 402 testing |
| `p-1003` | `8014-0000-9999-0000` | **frozen** card — rewards/charges 409   |

### `POST /api/v1/players/:id/tickets/reward`

Simulates secure injection of app-earned tickets (mini-game rewards):

```jsonc
{
  "tickets": 250,                    // integer 1–1000 per transaction
  "source": "app-minigame",          // required
  "gameId": "skee-blitz",            // optional
  "idempotencyKey": "reward-abc-123" // required, ≥8 chars
}
```

`201` on first award with `transactionId` and `newTicketBalance`. Replaying
the same `idempotencyKey` returns `200` with the original result and
`idempotent: true` — **no double credit**. Build the app client to always send
an idempotency key and treat both statuses as success; the real integration
will need the same discipline for retry safety.

### `POST /api/v1/_mock/reset`

Restores all seed data (players, orders, idempotency records). Handy in e2e
test setup.

## Error shape

All errors return `{ "error": { "code", "message", "details?" } }` with codes
like `UNKNOWN_ITEM`, `ITEM_UNAVAILABLE`, `MODIFIER_SELECTION_REQUIRED`,
`INSUFFICIENT_FUNDS`, `PLAYER_NOT_FOUND`, `PLAYER_CARD_INACTIVE`,
`TOKEN_EXPIRED`. Build the client's error handling against `error.code`, not
HTTP status alone.

## Chaos testing

Two request headers let the app exercise slow/flaky-network handling:

- `X-Mock-Delay: 2000` — delay the response by N ms (capped at 10 s).
- `X-Mock-Fail: 503` — force any 4xx/5xx status (`MOCK_FORCED_ERROR`).

## Swapping in the real API later

Keep all fetch calls behind a single API-client module with a configurable
base URL. When the CenterEdge sandbox is provisioned: point the base URL at
it, replace the mock bearer token with the real auth flow, and reconcile field
names/shapes in that one module. The rest of the app (state management, UI)
should not need to change.
