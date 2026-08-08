# FEC POS vendor API landscape

Research snapshot, 2026-08-08 (web research; no NDAs, no partner portals).
Question: which major FEC POS / game-card vendors expose APIs we could build
`src/lib/pos/` adapters against, and for which capability — **ordering**
(menu / order injection) vs **loyalty** (card balance, credits, tickets)?
Capabilities are decoupled in our config precisely because the vendor
landscape splits the same way.

## The short version

- **Nobody in the arcade-card world has public developer docs.** Every card
  vendor (Embed, Intercard, Sacoa, Semnox) gates its API behind a
  sales/partner arrangement. CenterEdge is the same. Expect a
  credential-request dance per vendor, like the one we're already in with
  CenterEdge.
- **Loyalty/card APIs clearly exist at every card vendor** — evidenced by
  shipping third-party POS integrations (ROLLER, Toast, Aluvii, CenterEdge
  itself). Balance / recharge / sell / debit are well-evidenced everywhere;
  explicit "inject tickets" semantics are confirmed nowhere publicly (our
  CenterEdge ticket-reward contract is still a guess).
- **Order injection INTO a vendor's kitchen is evidenced almost nowhere.**
  The industry pattern runs the other way: card systems embed themselves as a
  *tender type* inside restaurant POS (Toast, GoTab, Ordyx, HungerRush), not
  as an order-accepting API. Our CenterEdge `POST /orders` mock is the least
  industry-typical assumption we hold — worth confirming early in the
  CenterEdge ticket.
- **ROLLER is the one genuinely developer-friendly platform** (public docs,
  OAuth2, webhooks, sandbox — paid add-on) but its API covers
  bookings/ticketing/checkout, not F&B order injection or card credits; cards
  in ROLLER venues route through partner card systems anyway.

## Per-vendor summary

| Vendor | Loyalty/card API | Ordering API | Docs | Access |
| --- | --- | --- | --- | --- |
| **CenterEdge** | Expected (Advantage Web Services) | Expected (unconfirmed) | Private | Owner sponsors via Support Portal (in progress) |
| **Intercard** | Yes — "Enhanced 3rd Party Interface": sell, reload, refund, balance, pay | Inverted: card as tender inside Toast/GoTab/MICROS | Private (partner support articles only) | Contact Intercard support; credentials + IP allowlist |
| **Embed** | Yes — "API license": sale, add value, balance (cash/bonus/tickets), transfer (via Aluvii/CenterEdge integrations) | No evidence | Private | Commercial API license via sales |
| **Sacoa** | Yes — best-evidenced card ops: login, balance, recharge, debit, refund, sell, zero; entitlement loading via ROLLER | Inverted: card functions embedded in Ordyx/HungerRush/TRAY/Aloha | Private | Per-venue URL + credentials from Sacoa rep |
| **Semnox (Parafait)** | Platform features exist; third-party API surface unverified | No evidence (first-party F&B stack; UrbanPiper listing unconfirmed) | Private | Partner program / in-house dev team |
| **ROLLER** | Not via public API (cards route to partner systems); gift cards read-only | No (bookings/checkout only) | **Public** (docs.roller.app) | Paid add-on (tiered call volume + onboarding fee), OAuth2 |
| **Clubspeed** | Weak/indirect (payments, gift-card history; karting race credits) | Partial — POS "Checks" API documents check creation/payment/void | **Public** (per-venue `/api/` reference) | Email Clubspeed for a key (informal) |
| Others (scan) | Amusement Connect markets an "open API" (no public docs); CORE Cashless advertises e-commerce/account APIs (no public docs); Party Center Software API is read-only export | — | Private | Partner-arranged |

## What this means for the adapter roadmap

1. **The decoupled config matches reality.** Real venues genuinely mix
   vendors per capability (e.g. Sacoa cards + a restaurant POS for food), so
   `pos.ordering` and `pos.loyalty` naming separate vendors is the right
   shape, not speculative flexibility.
2. **Loyalty adapters are the repeatable product.** Every card vendor has a
   partner API whose verbs rhyme (balance / recharge / debit / sell). Our
   `LoyaltyApi` contract (lookup, balances, ticket credit) should map onto
   any of them with a thin adapter — Sacoa and Intercard are the
   best-evidenced second adapters when a client shows up with one.
3. **Ordering adapters may need a different second vendor class.** If order
   injection into arcade POS stays rare, the second `OrderingApi` adapter is
   likelier to be a restaurant POS with real public APIs (Toast, Square) than
   another arcade vendor — the decoupling makes that combination legal
   already.
4. **Every card-vendor integration starts with a sales conversation.** Build
   the ask into client onboarding: the venue owner requests API access from
   their card vendor the same way our CenterEdge template
   (`mock-centeredge/API-ACCESS-REQUEST.md`) does — that template generalizes
   with the vendor name swapped.
5. **Confirm CenterEdge order injection early.** It's our least-supported
   assumption industry-wide; if CenterEdge's answer is "cards as tender only,"
   the F&B flow pivots to whatever ordering system the venue runs, and the
   loyalty integration proceeds unchanged — which the decoupling now permits
   without rework.
