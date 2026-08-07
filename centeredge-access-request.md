# CenterEdge API access request — email template

The developer-side integration is unblocked locally (see
`mock-centeredge/`), but real integration needs API credentials that only
the venue (the CenterEdge customer) can request. CenterEdge provisions API
access through its Support Portal, sponsored by the account holder — not
through a public developer signup.

Send the email below to the FEC owner. They should paste the "ticket text"
section into a CenterEdge Support Portal ticket (or forward it to their
CenterEdge account manager).

---

**To:** [FEC owner]
**Subject:** Action needed: request CenterEdge API access so we can connect the app

Hi [name],

The app is at the point where the food-ordering and ticket-rewards features
are built and working against a stand-in server. To connect them to your real
CenterEdge system, CenterEdge needs to hear from you directly — API access is
provisioned per customer, so the request has to come from your account.

Could you open a ticket on the CenterEdge Support Portal (or email your
account manager) with the text below? Once they respond, just forward me
whatever they send — I'll take it from there.

---

### Ticket text (copy/paste)

We are building a custom mobile app for our facility with a third-party
developer and need API access to integrate it with our CenterEdge system.
Specifically, we're requesting:

1. **Sandbox environment** — a non-production environment we can develop and
   test against before touching live data.
2. **Advantage Web Services access** — base URLs, API documentation, and
   authentication credentials (client ID/secret or API tokens) for:
   - **Food & beverage**: reading our menu/inventory (categories, items,
     prices, modifiers) and submitting orders into kitchen
     management/printing.
   - **Player cards / loyalty**: looking up player accounts by card number,
     reading balances (cash, game-play credits, tickets), and **crediting
     tickets to a player's balance** from app-side promotions and games.
3. **Documentation** for the above, including auth flow, rate limits, and
   webhook/event options if available (e.g. order-status updates).
4. A technical contact we can loop in our developer with directly.

Our developer contact for technical questions: [developer name, email].

---

Two notes for when they reply:

- If CenterEdge offers a choice of integration methods (cloud API vs.
  on-premise web services), ask them which they recommend for a mobile
  ordering + loyalty use case — and tell me which they said.
- If there are integration fees or a partner-agreement step, that's a
  business decision for you; let me know what they quote.

Thanks!
[developer name]
