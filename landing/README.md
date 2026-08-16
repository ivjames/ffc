# Infinicade landing page

Static marketing landing page for the platform apex domain (`infinicade.com`),
for when the domain is purchased. Fully self-contained — one HTML file, inline
CSS/SVG, no external requests — so it can be previewed by opening
`index.html` directly in a browser.

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
