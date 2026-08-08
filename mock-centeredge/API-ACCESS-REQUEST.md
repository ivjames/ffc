# CenterEdge API access — email template for the venue owner

The developer cannot request API credentials directly: CenterEdge provisions
API access to the **license holder**, so the venue owner (or whoever owns the
CenterEdge support relationship) must submit the request through the
CenterEdge Support Portal or their account manager. Send them the template
below — fill in the bracketed bits, attach nothing.

Once credentials arrive, drop the sandbox base URL into
`VITE_CENTEREDGE_API_BASE` and start reconciling `mock-centeredge/` against
the real docs (see `README.md` → "Swapping in the real API later").

---

**To:** CenterEdge Support (via the Support Portal, or your account manager)
**Subject:** API access request — third-party mobile app integration for [VENUE NAME]

Hi CenterEdge team,

We're [VENUE NAME] ([ACCOUNT / SITE ID if known]), and we're building a
custom mobile app for our guests with a development partner. We'd like to
request developer API access to integrate the app with our CenterEdge
system. Specifically, we're looking for:

1. **Sandbox environment** — a non-production environment (or sandbox
   tenant) we can develop and test against without touching live venue data,
   plus the base URLs for the relevant APIs.

2. **API credentials** — client credentials / API tokens for the sandbox
   (and, later, production) for the following capabilities:

   - **Food & beverage**: reading our menu/inventory (categories, items,
     prices, modifiers) and submitting guest orders from the app into the
     kitchen workflow (Advantage F&B / kitchen management).
   - **Player cards / loyalty**: looking up a guest's card by account or
     card number; reading cash balance, game-play credits, and ticket
     (redemption point) balances; and **crediting tickets/points** earned
     through app promotions and in-app games to a guest's account.

3. **Payment handling for app orders** — we expect payment to settle
   through CenterEdge Payments so orders reconcile in the POS. Please
   confirm, and point us at the client-side SDK / tokenization flow the app
   should use to take card (and ideally Apple Pay / Google Pay) payments
   for orders it submits — or let us know if app orders should instead
   carry an external payment reference.

4. **API documentation** — the current docs for Advantage Web Services (or
   whichever API surface covers the above), including authentication flow,
   rate limits, and webhook/event options if available.

5. **A technical contact** we can loop in our developer with for
   integration questions.

Our developer contact is [DEVELOPER NAME] ([DEVELOPER EMAIL]) — feel free
to include them on technical follow-ups.

Could you let us know the process, any partner/agreement paperwork required,
and expected timelines? Happy to jump on a call if that's easier.

Thanks!
[OWNER NAME]
[VENUE NAME] · [PHONE] · [EMAIL]
