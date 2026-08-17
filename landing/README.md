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
all respect `prefers-reduced-motion`): a phone in the hero running
the app's actual Fun Zone games (skee-ball, bowling, axe throw, high
striker — scenes and mechanics ported from src/features/fun/*), a live-reshuffling leaderboard mock, an AI-hunt verify loop, a
ticket count-up, and a white-label venue switcher that re-skins a phone
mockup per tenant.

Deliberately **not** in `public/`: everything there ships inside the player
PWA bundle and would be served on every tenant subdomain. This page belongs
only on the bare platform domain.

## How it's served

This page runs on the bare platform apex — `ffc.lab980.com` pro tem, and the
same machinery later serves `infinicade.com` unchanged (only DNS + the
`FFC_FQDN`-derived names differ). One command wires it:

```bash
ffc landing-vhost    # requires the wildcard cert; run after an ffc deploy
```

That renders `deploy/nginx.landing.conf.template` into the exact-name apex
vhost (`sites-available/<fqdn>-landing`, certbot-free, wildcard-lineage TLS)
and re-renders the player vhost so the PWA keeps only `*.<fqdn>` — nginx
exact-match precedence gives the apex to this page. `build_release` ships
this directory into each release, so the vhost serves from the atomically
swapped `current/landing/`. The apex also:

- 301s the frozen player paths (`/install`, `/join`, `/tv`, `/teams/accept`,
  `/games/…`, `/me/…`) to the default org's subdomain, so printed QR signage
  and emailed links survive the cutover;
- serves `sw.js` (in this directory) uncached — a kill-switch worker that
  unwinds PWA installs from when the apex served the player app.

Full cutover runbook: DEPLOY.md → "Platform topology".

The contact address (`hello@infinicade.com`) assumes mail is set up on the
new domain — update it if a different address ends up being used.
