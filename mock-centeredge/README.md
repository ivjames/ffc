# mock-centeredge

A local mock of the CenterEdge POS APIs the FFC app will integrate with —
mobile F&B ordering (menu → cart → kitchen) and player cards / ticket rewards
(profiles, balances, app-earned ticket injection). It exists so frontend and
state-management work can proceed **before** the venue owner gets real API
credentials from CenterEdge support (see `../centeredge-access-request.md` for
the email that starts that process).

Everything is in-memory, seeded from `data/*.json`. No database, no
persistence — restart or `POST /api/v1/_reset` returns to seed state.

> **These shapes are our best guess.** CenterEdge's public GitHub only hosts
> utilities (TextPay OpenAPI, Yardarm) — the core POS / player-card / ticket
> schemas are not public. When the sandbox and real docs arrive, reconcile
> every endpoint here against them and keep the client behind a thin API
> layer so the swap touches one module, not every screen.

## Run

```sh
cd mock-centeredge
npm install
npm start          # listens on PORT (default 8070)
npm test           # node --test integration suite
```

Point the app at it with e.g. `VITE_CENTEREDGE_BASE_URL=http://localhost:8070`.

| env var           | purpose                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------ |
| `PORT`            | Listen port (default `8070`).                                                              |
| `MOCK_API_KEY`    | When set, every `/api/v1/*` route requires `Authorization: Bearer <key>` (rehearse the auth flow). Unset = auth off. |
| `MOCK_LATENCY_MS` | Artificial delay per response, to exercise loading states. Default `0`.                    |

## Endpoints

All JSON. `ok: true/false` on every response, matching the ffc-server style.

### `GET /api/health`
→ `200 { "ok": true, "mock": "centeredge" }` — never behind auth.

### `GET /api/v1/menu`
The full F&B menu: `categories[] → items[] → modifierGroups[] → modifiers[]`.
All prices are **integer cents**. Items can be `available: false` (86'd —
`itm_nachos` ships that way so the UI handles it). Modifier groups carry
`minSelections`/`maxSelections` (e.g. crust is required, max 5 toppings).

### `POST /api/v1/orders`
Submit a cart. The mock **re-prices the cart server-side** and rejects a
mismatched client total — build the cart math against that.

```json
{
  "playerId": "plr_1001",
  "items": [
    { "itemId": "itm_pizza_cheese_16", "quantity": 1,
      "modifiers": ["mod_crust_hand", "mod_pepperoni"], "notes": "well done" }
  ],
  "payment": { "token": "tok_from_your_psp", "amountCents": 2149 }
}
```

- `201` → `{ ok, order: { id, status, printing, items, totalCents, estimatedReadyMinutes, ... } }`
- `400` — malformed (no items, missing payment token)
- `402` — magic token `tok_declined` (build the card-declined path)
- `404` — unknown `playerId`
- `422` — unknown/86'd item, invalid modifier, group min/max violated
  (`problems[]` lists each), or wrong total (`expectedTotalCents` tells you
  what the server priced)

`playerId` is optional (guest checkout). Payment is a token passthrough —
the mock never sees card numbers, and neither should the real integration.

### `GET /api/v1/orders/:id`
Kitchen status, derived from order age so polling shows the whole arc:
`received` (printing queued) → after 15 s `in_kitchen` (printed) → after
60 s `ready`.

### `GET /api/v1/players/:id`
→ `{ ok, player: { id, cardNumber, name, email, tier, balances: { cashCents, gamePlayCredits, tickets }, createdAt } }`

Seed players: `plr_1001` (gold, big balances), `plr_1002` (standard),
`plr_1003` (zero tickets). `404` for unknown ids.

### `GET /api/v1/players?cardNumber=6039-5551-0001`
Look up a player by physical card number (dashes/spaces ignored) — the
"link my arcade card" flow.

### `POST /api/v1/players/:id/tickets/reward`
Inject app-earned tickets (mini-game payouts). **`idempotencyKey` is
required** and replays are safe: retrying with the same key returns the
original reward (`replayed: true`) without double-crediting. `tickets` must
be an integer 1–10000.

```json
{ "tickets": 250, "source": "minigame", "gameId": "putt-streak", "idempotencyKey": "<uuid>" }
```

→ `201 { ok, reward: { id, playerId, tickets, source, gameId, createdAt }, balance: { tickets } }`

### `POST /api/v1/_reset`
Dev-only: restore all seed data. (Doesn't exist in the real API, obviously —
keep it out of the client's API layer.)
