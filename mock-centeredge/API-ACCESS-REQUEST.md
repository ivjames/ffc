# CenterEdge API access — outreach kit

The developer cannot request API credentials directly: CenterEdge provisions
API access to the **license holder**, so the venue owner (or whoever owns the
CenterEdge support relationship) must submit the request through the
CenterEdge Support Portal or their account manager. Two pieces here:

1. **Cover email** — developer → owner, asking them to send the request and
   name the developer as an authorized technical contact.
2. **The request itself** — owner → CenterEdge, ready to forward.

---

## 1. Cover email (developer → owner)

**Subject:** CenterEdge API access — need you to submit this request (5-minute task)

Hi [OWNER NAME],

Quick status on the app, plus one ask that only you can do.

Good news first: the mobile ordering and rewards features are built and
working end to end — menu browsing, cart, kitchen-status tracking, player
card balances, and ticket rewards from the in-app games. I can demo any
time. It's all running against a stand-in for CenterEdge's system right
now, which is the one thing we can't fix ourselves: **CenterEdge only
grants API access to the license holder, so the request has to come from
you.**

The ask (about 5 minutes):

1. Open a ticket on the CenterEdge Support Portal (or email your account
   manager) and paste in everything below the line at the bottom of this
   email.
2. Fill in the few [BRACKETED] details.
3. Please keep the line naming me as an **authorized technical contact**
   on your account for this project — that lets their integration team
   work with me directly instead of routing every technical question
   through you.

Everything after their first reply, I'll handle.

What we're asking them for, in plain terms: a sandbox to build against,
credentials and documentation, and answers to three questions that shape
the build — how payment for app orders should settle, whether the app can
credit tickets to guests' play cards, and whether we can read a card's
play activity (that's what powers "spend 100 credits, get bonus tickets"
offers down the road).

One timing note: this is the only item on the critical path — everything
else keeps moving while we wait, but integration vendors typically take a
week or two to respond, so the sooner this goes in, the better.

Thanks!
[DEVELOPER NAME]

--- forward everything below this line to CenterEdge ---

## 2. The request (owner → CenterEdge)

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
   - **Play / usage history**: reading a card's game-play and credit-usage
     transactions (per-card activity at game readers), so the app can power
     play-based reward offers (e.g. bonus tickets for credits spent). Please
     also let us know if any event/webhook feed exists for this, or what
     polling cadence you support.

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

**[DEVELOPER NAME] ([DEVELOPER EMAIL]) is our authorized technical contact
on this account for this project** — please work with them directly on all
technical follow-ups, sandbox setup, and documentation.

Could you let us know the process, any partner/agreement paperwork required,
and expected timelines? Happy to jump on a call if that's easier.

Thanks!
[OWNER NAME]
[VENUE NAME] · [PHONE] · [EMAIL]

---

*Developer note (not part of the email): once credentials arrive, drop the
sandbox base URL into `VITE_CENTEREDGE_API_BASE` (or the venue's
`pos.*.apiBase` in Master Control) and start reconciling `mock-centeredge/`
against the real docs — see `README.md` → "Swapping in the real API later".*
