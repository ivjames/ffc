# Draft: API access request for the FEC owner to send CenterEdge

Give this template to the FEC owner. They should submit it through the
CenterEdge Support Portal (or to their account manager) — API access must be
sponsored by the venue, not requested by a third-party developer directly.
Replace the bracketed placeholders before sending.

---

**Subject:** API access request — custom mobile app integration for [Venue Name]

Hi CenterEdge team,

We're [Venue Name] (account #[account number], primary contact [owner name,
email, phone]). We're building a custom mobile app for our guests with a
development partner, and we'd like to request API access to integrate it with
our CenterEdge system.

**What we're building**

1. **Mobile food & beverage ordering** — the app needs to read our F&B
   menu/inventory (categories, items, prices, modifiers) and submit guest
   orders so they flow into our kitchen management system (KDS/kitchen
   printing) just like POS-entered orders.

2. **Player card & loyalty integration** — the app needs to look up a guest's
   player account (card number, cash balance, game-play credits, ticket
   balance) and securely credit tickets earned in app-based mini-games and
   promotions to their account.

**What we're requesting**

- Sandbox/test environment access for Advantage Web Services and any
  relevant F&B and Player Card APIs, including base URLs and test data.
- API credentials (client ID/secret or tokens) for the sandbox, and the
  process for obtaining production credentials once we've certified.
- API documentation/schemas for: menu/inventory read, order injection,
  player account lookup, and ticket/credit adjustment endpoints.
- Any rate limits, webhook/event options (e.g., order status updates), and
  security requirements (IP allowlisting, token rotation) we should design
  around.
- Whether there is a partner/integration certification program our developer
  should go through, and any associated costs or timelines.

**Our environment**

- CenterEdge Advantage version: [version]
- Deployment: [cloud / on-premise]
- Modules in use: [POS, F&B, Player Cards / arcade debit, etc.]

Our development partner is [developer name, email], who is authorized to work
with your team directly on technical details — please include them on
follow-ups.

What are the next steps to get a sandbox provisioned? Happy to sign any
integration or NDA paperwork required.

Thanks,
[Owner name]
[Venue name] · [phone]
