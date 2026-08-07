# mock-centeredge

Local mock of the CenterEdge Software API surface the FEC app will integrate
with — mobile **Food & Beverage ordering** (menu sync + kitchen order
injection) and the **player card / ticket loyalty** database (balances +
secure ticket rewards from in-app mini-games).

We are pre-credential: the venue owner still has to sponsor API access via the
CenterEdge Support Portal before we get sandbox URLs and tokens for Advantage
Web Services. This mock exists so frontend and state-management work proceeds
now. The payload shapes are our best guess at CenterEdge's architecture; when
the real API docs arrive, reconcile them in `lib/handlers.js` + `data/*.json`
and the app's client code should mostly survive.

**Zero dependencies** — plain `node:http`, Node >= 18. No install, no database.

## Run

```sh
node mock-centeredge/server.js      # from repo root; or: npm run mock:centeredge
```

Listens on `http://localhost:8061` by default.

| env var                | default | purpose                                                       |
| ---------------------- | ------- | ------------------------------------------------------------- |
| `MOCK_PORT`            | `8061`  | listen port                                                   |
| `MOCK_LATENCY_MS`      | `150`   | simulated network latency per request (`0` disables)          |
| `MOCK_API_TOKEN`       | unset   | if set, the bearer token must match exactly; otherwise any non-empty token passes |
| `MOCK_KITCHEN_SECONDS` | `300`   | seconds for an order to go accepted → in_kitchen → ready      |

## Auth

Every `/api/v1/*` endpoint requires `Authorization: Bearer <token>` — the app
must wire the header now so swapping in real credentials later is a config
change. Any non-empty token is accepted unless `MOCK_API_TOKEN` is set.

State is in-memory only; restart or `POST /api/v1/mock/reset` returns to the
seed data in `data/menu.json` / `data/players.json`.

## Endpoints

### `GET /api/health` (no auth)

`{ "ok": true, "mock": "centeredge", "version": 1 }`

### `GET /api/v1/menu`

Full menu: categories → items (with `priceCents`, `available`) → modifier
groups (`required`, `minSelections`, `maxSelections`) → options with price
deltas. `itm-nachos` is seeded `available: false` to exercise sold-out UI.

### `POST /api/v1/orders`

```json
{
  "playerId": "PLR-1001",            // optional; else guestName is required
  "guestName": "Walk-in Guest",
  "items": [
    { "itemId": "itm-pizza-cheese", "quantity": 1,
      "modifiers": ["opt-crust-hand", "opt-pepperoni"], "notes": "well done" }
  ],
  "payment": { "method": "tokenized_card", "token": "tok_test_123" },
  "tipCents": 200
}
```

- Totals are computed **server-side** from the menu; the client never sends prices.
- `payment.method` is `"tokenized_card"` (any token string accepted) or
  `"stored_value"` (requires `playerId`, actually debits the card, `402` when short).
- Any invalid line (unknown item/modifier, sold out, missing required modifier
  group) fails the whole order with `422` and an `error.code`.
- `201` response: `orderId`, sequential `orderNumber`, `status: "accepted"`,
  `kitchen: { printed, station }`, `estimatedReadyMinutes`, `totals`.

### `GET /api/v1/orders/{orderId}`

Order with a live `status` that advances by wall-clock over
`MOCK_KITCHEN_SECONDS`: `accepted` → `in_kitchen` → `ready`. Poll it for the
order-tracking screen.

### `GET /api/v1/players/{playerId}`

Guest profile + digital arcade card: `cardNumber`, `tier`, and
`balances: { storedValueCents, gameCredits, ticketCount }`.

Seeded players: `PLR-1001` (gold, $25 stored value), `PLR-1002` (new, nearly
empty — good for insufficient-funds paths), `PLR-1003` (platinum whale).

### `POST /api/v1/players/{playerId}/tickets/reward`

Simulates secure injection of app-generated tickets (mini-game wins, promos):

```json
{ "tickets": 250, "source": "minigame:putt-streak", "referenceId": "game-abc-123" }
```

- `referenceId` is a required **idempotency key** — generate one per game
  result. Replays return the original grant with `duplicate: true` and never
  double-award (mobile retries are safe).
- `tickets` capped at 10,000 per grant; `source` is a required free-form tag.
- `201`: `{ rewardId, ticketsAwarded, newTicketCount, referenceId, awardedAt }`.

### `GET /api/v1/players/{playerId}/tickets/history`

Audit trail of every reward granted this session (newest last).

### `POST /api/v1/mock/reset` (no auth)

Restore seed state. Tests call this between cases.

## Failure simulation

- Header `X-Mock-Scenario: outage` on any authed route → `503`, for retry/error UI.
- No/bad bearer token → `401`.
- Unknown player → `404 player_not_found`; unknown order → `404 order_not_found`.
- All errors share one shape: `{ "error": { "code": "...", "message": "..." } }`.

## Tests

```sh
cd mock-centeredge && node --test
```

14 cases covering auth, menu shape, order pricing/validation, stored-value
debits, ticket idempotency, and reset.
