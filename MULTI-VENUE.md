# Multi-venue (white-label) architecture

Target model: one central platform domain (e.g. `minigolf.example`). Each client
(org) gets a subdomain named by its `org.slug` — `bullwinkles.minigolf.example`,
`pa-parks.minigolf.example`. One deployed instance (one API, one Postgres, one
static PWA bundle) serves every subdomain; the API resolves the tenant from the
`Host` header. Within a client's subdomain the existing geolocation system picks
the park the player is standing in (`src/lib/geolocate.ts` already iterates all
of the tenant's locations).

Decisions (2026-08-16, operator-approved):

- **Player accounts are global.** One email = one `app_user` platform-wide.
  Tenancy is enforced by filtering what each subdomain *shows*, not by walling
  off identity. Browser origins already isolate sessions per subdomain
  (cookies are host-only).
- **Admin tenancy already exists** (`org` / `location`, `super_admin` /
  `org_admin`, `orgScope()` in ~15 routers) and is unchanged by this work.

## 1. Tenant resolution (server/lib/tenant.js)

`resolveTenant(req)` → org row `{ id, slug, name, branding }` or `null`:

1. Take `req.hostname` (Express, `trust proxy` is on), lowercase, strip port.
2. First DNS label → candidate slug. If it matches a live org
   (`archived_at is null`, `status = 'active'`) → that org.
3. Otherwise fall back to `DEFAULT_ORG_SLUG` env (default `bullwinkles`).
4. Otherwise fall back to the first live org by `sort_order, name`.
5. No live orgs at all → `null` (payloads then use empty branding defaults and
   an unfiltered catalog, preserving pre-org behavior).

Lookups go through a small in-process TTL cache (~30 s) — the content endpoint
is hit on every app boot. Exposed as middleware `tenant()` setting
`req.tenant`; mounted only on the routes that need it (content, manifest,
announcements), not globally.

Platform topology (since the apex cutover — see DEPLOY.md "Platform
topology"): the bare apex `ffc.lab980.com` serves the marketing landing page
via its own nginx vhost, and the player PWA's canonical host is the default
org's subdomain `bullwinkles.ffc.lab980.com` (resolved via step 2, `via:
'host'` — strict org filtering, no org-less fallback rows). Unmatched labels
on other subdomains still fall through to `DEFAULT_ORG_SLUG` as above.
Infrastructure hostnames can never become org slugs: `normalizeOrg` rejects
the reserved labels in `server/lib/reservedSlugs.js` (admin, api, app, ffc,
infinicade, landing, mail, www).

## 2. Org branding (`org.branding` jsonb, default `'{}'`)

All keys optional. Missing keys fall back to the current hardcoded Bullwinkle's
values, so an empty object changes nothing:

| Key | Default | Constraint |
| --- | --- | --- |
| `appName` | `Mini Golf Scorecard` | 1..80 chars |
| `shortName` | `MiniGolf` | 1..30 chars |
| `themeColor` | `#15803d` | `#rrggbb` |
| `backgroundColor` | `#052e16` | `#rrggbb` |
| `accentColor` | `#38bdf8` | `#rrggbb` |
| `logoUrl` | `/brand/logo.png` | path (`/…`) or `https://…`, ≤300 chars |
| `logoBadgeUrl` | `/brand/logo-badge.png` | same |
| `logoWordmarkUrl` | `/brand/logo-wordmark.png` | same |
| `icon192Url` | `/icons/icon-192.png` | same |
| `icon512Url` | `/icons/icon-512.png` | same |
| `shareFooter` | `Bullwinkle's · come beat this score` | 1..120 chars |

Canonical defaults live in one place server-side
(`server/lib/branding.js`, `BRANDING_DEFAULTS` + `normalizeBranding()`), and one
place client-side (`src/lib/branding.ts`). Validation rejects unknown keys.

## 3. API changes

- **`GET /api/content`** — filtered by tenant. Locations:
  `org_id = tenant.id OR org_id IS NULL` (org-less rows are a safety net and
  appear only under the default org — resolution step 3/4 — never under a
  non-default tenant). Courses: only those belonging to the returned locations.
  Payload gains `org: { id, slug, name, branding }` (branding is the SPARSE
  stored object — only the keys the org set; the client merges its own
  defaults in `src/lib/branding.ts`, and sparseness is what lets it tell an
  explicit `themeColor` from the default). With no tenant (step 5):
  unfiltered + `org: null`.
- **`GET /api/manifest.webmanifest`** — new, per-tenant PWA manifest
  (`application/manifest+json`): `name` = `appName`, `short_name` =
  `shortName`, `theme_color`, `background_color`, icons from
  `icon192Url`/`icon512Url` (512 doubles as maskable), `display: standalone`,
  `orientation: portrait`, `start_url: '/'`, `scope: '/'`.
- **`GET /api/announcements`** (player-facing) — location-scoped rows are
  already picked by location; rows must additionally be limited to the
  tenant's locations (global rows, `location_id IS NULL`, still show
  everywhere).
- **`PATCH /api/admin/orgs/:id/branding`** — body is the full branding object
  (replace, not merge). Allowed for `super_admin`, or an `org_admin` on their
  own org (branding is cosmetic; org create/rename/archive stays
  super_admin-only). Returns `{ ok, org }` with branding included. `ORG_COLS`
  everywhere gains `branding`.

## 4. Player PWA

- `src/lib/branding.ts`: `getBranding()` accessor with defaults; hydrated from
  the `/api/content` payload (same store/revision mechanism as the catalog,
  cached in the same `ffc.content` localStorage entry). On (re)hydrate, apply
  `document.title = appName` and the `theme-color` meta.
- `index.html` / `vite.config.ts`: VitePWA `manifest: false`; static
  `<link rel="manifest" href="/api/manifest.webmanifest">`. Static head values
  stay as the pre-hydration defaults. Service worker generation is unchanged
  (`/api/` is already in `navigateFallbackDenylist`).
- `shareImage.ts` footer, `logo.ts` asset paths → read from `getBranding()`.
- Accent fallback: locations/courses with no entry in the hardcoded accent maps
  fall back to `branding.accentColor` (today: `DEFAULT_ACCENT`).
- `scripts/export-content.mjs` + `content.generated.ts` carry the new `org`
  field (snapshot = default org).

## 5. Deploy

- `deploy/nginx.conf.template`: player vhost `server_name __FQDN__ *.__FQDN__;`
  (admin's exact `admin.__FQDN__` match still wins over the wildcard). Cert
  lineage is already the wildcard `*.__FQDN__`.
- `bin/ffc`: no behavioral change required beyond the template; docs/comments
  updated. Client DNS = one CNAME/A per org slug under the platform domain (or
  a wildcard DNS record).

## 6. Onboarding a new site

Provisioning is a Master Control tool, not an ops task: **Provision site**
(super_admin only, `POST /api/admin/provision`) creates the whole site in one
transaction — org + branding + first venue (hours, POS offering selection) +
courses, plus optionally an emailed invite for the site's org_admin, who sets
their own password via the link (no password ever typed by the operator). The
subdomain is live
immediately (the tenant cache is cleared in-process): no SSH, no DNS, no
cert, no deploy — the wildcard vhost/cert/record already cover every slug.
Create-only semantics: an existing org/location slug 409s, never overwrites.
Follow-ups (logo/icon uploads, ticket caps, hunt items) happen on the
existing org/venue pages.

## 7. Follow-ups

Addressed since the initial build:

- **Cross-tenant reads/writes via guessed or stale UUIDs — done.** Every
  player-facing router is swept (see `server/routes/tenantIsolation.
  integration.test.js`): a foreign-tenant id behaves exactly like a
  nonexistent one, with the same host/fallback/no-org semantics as
  `/api/content` (helpers: `tenantOrgFilter`/`findTenantCourse`/
  `findTenantLocation` in `server/lib/tenant.js`). Deliberately global, per
  the accounts decision: auth, teams/invites, and shared-game join/play via
  join-code and participant-token capabilities.
- **Branding asset upload — done.** `POST /api/admin/orgs/:id/branding/assets`
  (base64 JSON, validated in `server/lib/brandAssets.js`; icons must be PNG at
  exactly 192²/512²), stored content-hashed under `BRAND_ASSET_DIR` and served
  at `/api/brand-assets/...` through the existing `/api/` proxy. Master
  Control's Branding card has an Upload button per field. In production set
  `BRAND_ASSET_DIR=$APP_DIR/shared/brand-assets` in `server/.env` (`ffc
  deploy` creates the directory).
- **theme-color meta contention — done.** `src/lib/branding.ts` is the single
  writer: an org with an explicit `themeColor` owns the status-bar color in
  both modes; otherwise the pre-multi-venue light/dark greys apply unchanged.

Still deferred (need operator decisions):

- Per-org custom domains (client brings `play.theirdomain.com`) — needs
  per-domain cert issuance; the tenant resolver would match on full host.
- Per-org email sender identity for OTP mails. Cheap first step once the
  platform domain exists: keep the platform address, make the display name
  per-org ("Bullwinkle's <play@mail.PLATFORM>") — zero client DNS work.

## 7. Domain cutover runbook

For when the platform domain is purchased (candidate as of 2026-08-16:
`infinicade.com`, pending a GoDaddy closeout purchase — written as `DOMAIN`
below so it works for any name). Nothing in the codebase hardcodes the domain;
this is all DNS + droplet env + one-time service setup.

Before the domain lands (can be done now):

1. Trademark clearance for the chosen name: USPTO search
   (tmsearch.uspto.gov) for the name and close variants; for a name with a
   prior user in this industry, an hour of trademark-attorney review before
   putting it on client contracts.

Once the domain is owned:

1. **DNS** — at the registrar, delegate to DigitalOcean
   (`ns1/ns2/ns3.digitalocean.com`); in DO DNS create apex `A` → droplet IP
   and wildcard `A` (`*`) → droplet IP. One record covers every current and
   future client subdomain; onboarding a client thereafter is zero DNS work.
   (`ffc wildcard-cert` does DNS-01 via `doctl`, which is why DNS lives on DO.)
2. **TLS + vhosts** — on the droplet: `export FFC_FQDN=DOMAIN` (persist it in
   the shell profile / wherever `ffc` is invoked), then `ffc wildcard-cert`
   (issues `DOMAIN` + `*.DOMAIN`), `ffc vhost`, `ffc admin-vhost`. The player
   vhost's `server_name DOMAIN *.DOMAIN` makes every org slug resolve
   immediately; `admin.DOMAIN` stays on its exact-match vhost.
3. **Server env** (`server/.env`): `BRAND_ASSET_DIR=$APP_DIR/shared/brand-assets`
   (dir is created by `ffc deploy`); `DEFAULT_ORG_SLUG` can stay unset
   (default `bullwinkles`).
4. **Email (Resend + Zoho)** — add `DOMAIN` (or `mail.DOMAIN`) in Resend,
   publish its DKIM/SPF records in DO DNS, then set `MAIL_PROVIDER=resend`,
   `RESEND_API_KEY`, `MAIL_FROM="FFC <play@mail.DOMAIN>"` in `server/.env`
   (`server/lib/mailer.js` already speaks Resend). Zoho MX records can coexist
   for human mailboxes; Resend sends, Zoho receives.
5. **Bullwinkle's migration** — `bullwinkles.DOMAIN` works the moment DNS+TLS
   are up (slug match). Keep `ffc.lab980.com` serving during the transition
   (it resolves to the default org, unchanged). Origin changes reset PWA
   installs and on-device data: accounts survive (global, email OTP), local
   anonymous rounds don't — migrate while the installed base is small.
   Reprint venue QR codes to the new origin; retire the old origin once
   traffic there goes quiet.
6. **Smoke test** — `curl -H 'Host: bullwinkles.DOMAIN' https://DOMAIN/api/content`
   (own catalog + branding), same for a second org, `/api/manifest.webmanifest`
   per host, admin login at `admin.DOMAIN`, one OTP mail end-to-end.

### Dress rehearsal (no new domain needed)

Every step above except the registrar delegation can be rehearsed today on
the existing staging FQDN, because the wildcard machinery is domain-agnostic:

1. In DO DNS, add a wildcard record for the staging host if absent
   (`*.ffc.lab980.com` → droplet, alongside the existing A record).
2. On the droplet: `ffc wildcard-cert` (now issues `ffc.lab980.com` +
   `*.ffc.lab980.com`), then `ffc vhost` (installs the wildcard lineage and
   the `server_name __FQDN__ *.__FQDN__` conf).
3. Create a throwaway org in Master Control (e.g. slug `rehearsal`) with a
   location and course, set its branding, and visit
   `https://rehearsal.ffc.lab980.com` — expect that org's catalog, title,
   colors, and manifest; expect `https://ffc.lab980.com` unchanged
   (default-org fallback).
4. Archive the throwaway org afterwards. What remains for cutover day is
   then ONLY: registrar delegation, `FFC_FQDN`, re-run cert/vhost, email DNS.

## 8. New-client onboarding checklist

Once the platform is live on its domain, onboarding an operator is Master
Control work only — target well under an hour:

1. **Org**: Orgs → create (name + slug; the slug IS their subdomain — choose
   like a permanent identifier, it shouldn't change later).
2. **Branding**: org page → Branding card — app name, short name, colors,
   share footer; upload logo marks and the two PWA icons (192/512 PNG).
3. **Locations**: Location wizard per park — name, slug, coords, geofence
   radius, timezone, hours; POS config if the venue has CenterEdge.
4. **Courses**: per location — name, theme, hole count, pars.
5. **Admin access**: create their `org_admin` account (scoped to the org).
6. **Verify**: open `https://<slug>.DOMAIN` — their catalog, their branding,
   their manifest; their admin login sees only their org.
7. **Hand-off artifacts**: their URL for venue QR codes; their Master Control
   login; note that geofence enforcement is per-deployment
   (`VITE_GEOFENCE_ENFORCED`) and venue coords must be set before enabling.
