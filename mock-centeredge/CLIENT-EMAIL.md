# Draft: API-access request for the FEC owner

Email template for the venue owner to send (or adapt) to CenterEdge Support.
CenterEdge provisions API access to the **venue's** account, so the request
has to come from the owner — the dev team can be CC'd for the technical
back-and-forth. Submit through the CenterEdge Support Portal (or the venue's
account manager) and fill in the bracketed fields.

---

**Subject:** API access request — custom mobile app integration for [Venue Name]

Hi CenterEdge team,

We're [Venue Name] (account #[account number], location: [city, state]). We're
building a custom mobile app for our guests and would like to integrate it
with our CenterEdge system. Could you help us get set up with developer/API
access?

**What we're building**

1. **Mobile food & beverage ordering** — the app shows our current F&B menu
   (items, prices, modifiers) and submits guest orders so they print to our
   kitchen like any POS order.
2. **Loyalty / ticket rewards** — the app links a guest to their player card,
   shows card balances (stored value, game credits, tickets), and awards bonus
   tickets earned in app mini-games to their card balance.

**What we're requesting**

- Access to the relevant APIs — we understand this is likely Advantage Web
  Services plus whatever covers F&B/inventory and the player card database.
  Please point us at the right products if we've named them wrong.
- A **sandbox/test environment** with base URLs and authentication credentials
  so our developer can build against test data before touching production.
- API documentation for the endpoints covering: menu/inventory read, order
  creation, player/card lookup, and ticket/balance adjustments.
- Any certification, review, or security requirements for third-party
  integrations, and any associated costs or contracts we should plan for.

**Technical contact**

Our developer is [Developer Name] ([developer email]) — please include them on
technical correspondence and credential delivery (via a secure channel).

We're currently running CenterEdge [version, if known — e.g. "Advantage,
cloud-hosted"]. Happy to jump on a call if that's easier to scope.

Thanks!

[Owner Name]
[Venue Name] — [phone]

---

## Notes for the developer (not part of the email)

- CenterEdge's public GitHub only hosts utilities (TextPay OpenAPI specs,
  Yardarm SDK tooling) — the core POS/loyalty/ticket schemas are only
  available through this sponsored-access route.
- When credentials arrive, capture into `.env` (never commit): sandbox base
  URL, auth token/client credentials, venue/location ID.
- First task post-credentials: diff the real contracts against
  `mock-centeredge/README.md` and reconcile `lib/handlers.js` + `data/*.json`.
