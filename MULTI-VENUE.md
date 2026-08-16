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

Backward compat: on today's staging host (`ffc.lab980.com`) the first label
`ffc` matches no slug, so resolution falls through to the default org —
behavior is identical to today.

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
  Payload gains `org: { id, slug, name, branding }` (branding fully resolved,
  defaults merged). With no tenant (step 5): unfiltered + `org: null`.
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

## 6. Deferred (follow-ups, out of scope here)

- Tenant filtering on remaining player reads that can cross venues by guessed
  IDs (leaderboards by course id, shared games). Low risk — IDs are UUIDs —
  but should be swept before the second real client onboards.
- Per-org custom domains (client brings `play.theirdomain.com`) — needs
  per-domain cert issuance; the tenant resolver would match on full host.
- Media upload for logos/icons in Master Control (today: URL fields; assets
  can be served from `/brand/` or any HTTPS host).
- Per-org email sender identity for OTP mails.
