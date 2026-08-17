# Infinicade landing page

Two builds share the same layout, copy, and interactions:

- **`index.html`** — the live candidate: light-mode corporate look (white
  cards, violet-led accents, sentence-case headings) with pastel aurora drift.
- **`aurora-dark.html`** — the dark neon-arcade variant, preserved as built;
  documented in detail in [`SPEC.md`](./SPEC.md).

Static marketing landing page for the platform apex domain (`infinicade.com`),
for when the domain is purchased. Fully self-contained — one HTML file, inline
CSS/JS/SVG with the display fonts (Unbounded + Space Grotesk, both SIL OFL)
embedded as data URIs — so it makes zero external requests and can be
previewed by opening `index.html` directly in a browser.

Interactive touches (all vanilla JS, all degrade gracefully without it, and
all respect `prefers-reduced-motion`): a playable drag-to-putt mini golf ball
in the hero, a live-reshuffling leaderboard mock, an AI-hunt verify loop, a
ticket count-up, and a white-label venue switcher that re-skins a phone
mockup per tenant.

Deliberately **not** in `public/`: everything there ships inside the player
PWA bundle and would be served on every tenant subdomain. This page belongs
only on the bare platform domain.

## Wiring it up (once the domain exists)

Per the multi-venue architecture (`MULTI-VENUE.md`), tenants live on
`<org-slug>.infinicade.com` and the player vhost's
`server_name __FQDN__ *.__FQDN__;` currently serves the PWA on the apex too
(falling back to the default org). To put this page on the apex instead:

1. Add an exact-name `server` block for the apex ahead of the wildcard
   (nginx: exact match beats wildcard) with
   `root <APP_DIR>/current/landing;` — no API proxy needed.
2. Drop the apex from the PWA vhost's `server_name` (keep `*.__FQDN__`).
3. Reuse the existing wildcard cert lineage (it covers apex + `*`).

Until then, nothing references this directory; it's inert in the repo.

The contact address (`hello@infinicade.com`) assumes mail is set up on the
new domain — update it if a different address ends up being used.
