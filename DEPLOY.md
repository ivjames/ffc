# Deploy — Mini Golf PWA (lab980 droplet)

Matches the lab980 one-dir-per-site / pm2 / nginx / certbot shape. The Vite
build is static assets served by nginx; the Node/Express API (`server/`) runs
under pm2 on a local port and nginx proxies `/api/` to it. Postgres runs on the
same box.

Two hard requirements from the build plan (§3):

1. **HTTPS via certbot with auto-renewal.** Service workers — and therefore
   offline + install — only run in a secure context and silently fail without
   TLS in production.
2. **Atomic deploys.** Build into a fresh release dir and swap a symlink; never
   overwrite in place, or a mid-deploy load serves mixed old/new hashed assets
   and poisons the service-worker cache. `ffc deploy` does this.

Everything app-specific lives in the project's **`bin/ffc` operate CLI** (the
lab980 per-site tooling convention), so bring-up is two commands plus a one-time
edit of the DB credentials.

## First-time provisioning

Run as **root on the droplet**. Subdomain `ffc.lab980.com` throughout; change the
`ffc` label if you want a different one (and set `FFC_FQDN` for `ffc setup`).

```bash
# 1. Subdomain shell: DNS + clone + dir + reserve a port. One command.
#    (ivjames/ffc is private — export GITHUB_TOKEN=ghp_... first so the clone auths.)
provision-site ffc ivjames/ffc

# 2. Postgres: the role OWNS the db (so it can create tables in `public` on
#    PG15+, where GRANT ALL ON DATABASE isn't enough), and the superuser creates
#    the pgcrypto extension once (it's untrusted — a plain role can't create it;
#    the migration's `create extension if not exists` is then a no-op).
sudo -u postgres psql <<'SQL'
CREATE ROLE ffc LOGIN PASSWORD 'CHANGE_ME';
CREATE DATABASE ffc OWNER ffc;
\connect ffc
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL
#    Already created the db as postgres? Fix it instead of recreating:
#      ALTER DATABASE ffc OWNER TO ffc;
#      \connect ffc
#      GRANT ALL ON SCHEMA public TO ffc;
#      CREATE EXTENSION IF NOT EXISTS pgcrypto;

# 3. API config — the one bit that needs a human (secrets).
cd /var/www/ffc/server && cp .env.example .env
#    edit .env:  DATABASE_URL=postgres://ffc:CHANGE_ME@localhost:5432/ffc
#                APP_TOKEN=$(openssl rand -hex 16)
#                PORT=<free port>  — the droplet runs many apps on 8060+, so use
#                the one provision-site reserved:  grep '^PORT=' /var/www/ffc/.env
#    (bin/ffc reads this PORT for the vhost, health check and seeding.)

# 4. Symlink the operate CLI onto PATH (once), then let it do the rest:
#    migrate DB -> start API (pm2) -> first atomic build -> static vhost -> TLS -> seed.
ln -sf /var/www/ffc/bin/ffc /usr/local/bin/ffc
ffc setup
```

That's it — `https://ffc.lab980.com` is live. `ffc setup` overwrites
`provision-site`'s default proxy vhost with the static + `/api` vhost (this app
serves the build statically from nginx and proxies only `/api/` to the Node
API), then issues the cert against it, so the vhost shape is handled for you.

If certbot reports it can't reach the host, DNS from step 1 is still
propagating — just re-run `ffc vhost` a minute later.

Reboot survival needs the pm2 boot hook installed **once per droplet** (not
per site):

```bash
pm2 startup systemd -u root --hp /root    # then run the line it prints
systemctl is-enabled pm2-root             # -> enabled
```

### Master Control (admin console) — one-time bring-up

The admin app builds and ships with every `ffc deploy` (into `current/dist-admin`),
but its subdomain + TLS are set up once. It uses a **wildcard cert** issued via
certbot **DNS-01** through `doctl` (already authenticated on the droplet — the DO
token needs write scope on the DNS zone), so no per-subdomain cert step is ever
needed again:

```bash
# DNS: point a wildcard at the droplet (once). e.g. with doctl:
doctl compute domain records create lab980.com --record-type A \
  --record-name '*.ffc' --record-data <droplet-ip> --record-ttl 300

ffc admin-setup     # wildcard-cert (DNS-01 via doctl) + admin vhost + reload
```

Master Control is then live at `https://admin.ffc.lab980.com`, gated by the same
`APP_TOKEN` from `server/.env`. It is a separate origin from the player PWA (no
service worker). Re-issue/rotate the cert with `ffc wildcard-cert`; rewrite the
vhost with `ffc admin-vhost`.

## Platform topology (apex landing + org subdomains)

Staging runs the production shape the platform will keep on its real domain:

| Host | Serves | Vhost file |
| --- | --- | --- |
| `ffc.lab980.com` (bare apex) | Infinicade marketing landing page (`current/landing/`) | `sites-available/ffc.lab980.com-landing` (written by `ffc landing-vhost`; certbot never touches it) |
| `<org-slug>.ffc.lab980.com` | player PWA, tenant-resolved from the first DNS label | `sites-available/ffc.lab980.com` (written by `ffc vhost`; `server_name *.ffc.lab980.com` once the landing vhost exists) |
| `bullwinkles.ffc.lab980.com` | the default org — the canonical player host | (same wildcard vhost) |
| `admin.ffc.lab980.com` | Master Control | `sites-available/admin.ffc.lab980.com` |

One wildcard cert lineage (`ffc-wildcard`) covers all of it, apex included. The
apex 301s the frozen player paths (`/install`, `/join`, `/tv`, `/teams/accept`,
`/games/…`, `/me/…`) to `bullwinkles.ffc.lab980.com` so printed QR signage and
emailed links keep working, and serves a kill-switch `sw.js` that unwinds
PWA installs from the apex-served-the-app era. Org slugs that would collide
with infrastructure hostnames are rejected at the API
(`server/lib/reservedSlugs.js`: admin, api, app, ffc, infinicade, landing,
mail, www). Unmatched subdomain labels still fall back to `DEFAULT_ORG_SLUG`
(default `bullwinkles`).

On the future real domain (`infinicade.com`) this whole shape carries over —
the org slugs, data, and vhost templates are domain-agnostic; only DNS, the
wildcard cert, and the `FFC_FQDN`-derived names change.

New tenants need **no droplet work at all**: the wildcard vhost, cert, and
DNS record already cover every slug, so sites are provisioned on demand from
Master Control (Provision site page → `POST /api/admin/provision`) — see
MULTI-VENUE.md §6.

### Apex cutover runbook (one-time)

Run as root on the droplet, top to bottom:

```bash
# 1. Preflight (read-only)
ls /etc/letsencrypt/live/ffc-wildcard/          # wildcard lineage exists (else: ffc wildcard-cert)
dig +short bullwinkles.ffc.lab980.com           # resolves to the droplet (the *.ffc A record above)
grep DEFAULT_ORG_SLUG /var/www/ffc/server/.env  # unset, or bullwinkles

# 2. Ship the code (release now contains current/landing/)
ffc deploy

# 3. Flip the apex — one command: writes the landing vhost, re-renders the
#    player vhost without the apex, installs the wildcard cert on *.ffc, reloads
ffc landing-vhost
nginx -t                                        # must be clean, NO "conflicting server name" warnings

# 4. Repoint outbound links at the canonical player host
#    (edit /var/www/ffc/server/.env): PUBLIC_APP_URL=https://bullwinkles.ffc.lab980.com
ffc restart

# 5. Seed the demo orgs (idempotent; re-running RESETS them)
ffc seed-demo
```

DB sanity — rows without an org would vanish under strict per-host tenancy
(schema.sql backfills `location.org_id` on migrate; verify it held):

```sql
select count(*) from location where org_id is null;   -- expect 0
select c.id, c.name from course c
  left join location l on l.id = c.location_id
 where c.location_id is null or l.org_id is null;     -- expect 0 rows
```

Verify (give the ~30 s tenant cache a beat after seeding):

```bash
curl -s  https://ffc.lab980.com/ | grep -om1 Infinicade          # landing page on the apex
curl -sI https://ffc.lab980.com/install | grep -i location       # 301 -> bullwinkles.…/install (printed QR keeps working)
curl -s  https://ffc.lab980.com/sw.js | head -1                  # kill-switch worker (JS comment, not HTML)
curl -s  https://bullwinkles.ffc.lab980.com/api/content   | jq '[.locations[].slug]'   # upland, tukwila, wilsonville
curl -s  https://boardwalk-fun.ffc.lab980.com/api/content | jq '[.locations[].slug]'   # ["santa-cruz"] only (strict isolation)
curl -s  https://putters-cove.ffc.lab980.com/api/content  | jq '[.locations[].slug]'   # ["newport"] only
curl -s  https://boardwalk-fun.ffc.lab980.com/api/manifest.webmanifest | jq .name      # "Boardwalk Fun Co."
```

Then in a browser: install the PWA from `bullwinkles.…` and play a hole;
`admin.ffc.lab980.com` still loads; `boardwalk-fun` shows food ordering +
rewards (via the `/ce` mock), `putters-cove` rewards only. A phone with the
OLD apex install self-destructs into the redirect on its next online open —
reinstall from `bullwinkles.…` (apex-origin offline data is orphaned; known
cost).

If `certbot install` balks at the wildcard-only name in step 3, the manual
fix is copying the two `ssl_certificate` lines from the landing vhost into
the player vhost's 443 block, then `nginx -t && systemctl reload nginx`.

**Rollback** (also required before `ffc rollback` to any pre-landing commit —
older releases don't contain `current/landing/`):

```bash
rm /etc/nginx/sites-enabled/ffc.lab980.com-landing /etc/nginx/sites-available/ffc.lab980.com-landing
ffc vhost        # apex returns to the player vhost automatically
# restore PUBLIC_APP_URL in server/.env, then: ffc restart
```

### Player accounts + shared games — deploy notes

Two features lean on infrastructure beyond the code:

- **Outbound email** (sign-in codes + magic links, team invites, challenge
  invites, admin password resets): see the go-live runbook below. It is its own
  section because turning this on is the one deploy step that fails
  *silently* — nothing throws, nothing 500s, the mail just never arrives.

  `PUBLIC_APP_URL` is a **fallback**, not the link origin. Emailed links are
  built from the host the request arrived on, so each venue's players get
  links to their own subdomain — which matters because the session cookie is
  host-only, and a link to another venue's host signs a player in there and
  leaves them signed out at their own. Set `PLATFORM_FQDN` (it is what makes a
  venue subdomain a recognised host) and keep `PUBLIC_APP_URL` pointed at the
  default org's origin for requests whose host isn't recognised. Hosts outside
  that allow-list never appear in an outbound link — that is deliberate, and it
  is what stops the sign-in form being usable as a phishing relay.
- **SSE** (`GET /api/games/:id/events` — live shared scorecards): the endpoint
  already sends `X-Accel-Buffering: no` so nginx doesn't buffer the stream,
  and heartbeats every 25 s keep the connection inside nginx's default
  `proxy_read_timeout 60s`. If a vhost overrides `proxy_read_timeout` below
  ~30 s, raise it for `/api/` or the streams will cycle (EventSource
  auto-reconnects, so it degrades rather than breaks — each reconnect re-syncs
  from a full snapshot).

### Transactional email — go-live runbook

Do these in order. **Every step names the symptom you get if you skip it**,
because the failure mode of misconfigured Resend is silence: the app reports
success, the log says nothing, and the first sign of trouble is a player who
"never got the code" — reported days later, to somebody else.

Two surfaces do the checking, both **super_admin only**:

- **Master Control -> Ops -> Mail** — the whole procedure with no shell. Shows
  the provider, whether the credential is set, `MAIL_FROM`, the domains
  `MAIL_FROM` is checked against, the resolved link origin,
  `PLATFORM_FQDN`/`PUBLIC_APP_URL`, the caps, and any config problems *with
  their fix*. Sends a test message to a typed address and prints the provider's
  raw error verbatim when it fails.
- **The API underneath it**, if you'd rather curl: `GET /api/admin/mail/status`
  and `POST /api/admin/mail/test {"to":"you@example.com"}`.

The same checks run at **startup**: the API logs an `OUTBOUND MAIL PREFLIGHT`
block to the pm2 log (`ffc logs`) listing every problem it can see from config
alone, each with its fix. A clean boot logs nothing.

**1. Verify the sending domain in Resend (SPF + DKIM). Operator job — this
cannot be done from the app.** In the Resend dashboard add the domain you will
send from, then publish the TXT records it gives you (an SPF record and a DKIM
key) in that domain's DNS. Wait for Resend to show the domain **Verified**.
*Symptom if skipped:* every send is rejected `403 ... domain is not verified`.
Nothing in the app surfaces it — the mailer logs the failure and callers that
can't leak (sign-in) return their usual uniform response. The admin test send
is the only place you will see that 403 text.

**2. Set the env.** In `server/.env`:

```
MAIL_PROVIDER=resend
RESEND_API_KEY=re_...            # from the Resend dashboard
MAIL_FROM=FFC <noreply@ffc.lab980.com>   # @ the domain verified in step 1
MAIL_SENDING_DOMAINS=            # only if MAIL_FROM's domain != PLATFORM_FQDN
PLATFORM_FQDN=ffc.lab980.com     # what makes a venue subdomain a link host
PUBLIC_APP_URL=https://bullwinkles.ffc.lab980.com   # fallback origin
```

*Symptoms if skipped or wrong:*
- `MAIL_PROVIDER` left unset — no mail at all, and in production the code is
  neither logged nor returned over HTTP (both are dev-only), so **email sign-in
  is effectively disabled**. Preflight: `console_in_production`.
- `RESEND_API_KEY` missing — every send fails with `RESEND_API_KEY is not set`,
  and sign-in/team invites report success anyway. Preflight:
  `resend_key_missing`.
- `MAIL_FROM` on a domain you didn't verify — the step-1 403, invisibly.
  Preflight: `mail_from_domain_mismatch`. If you verified a domain unrelated to
  `PLATFORM_FQDN`, name it in `MAIL_SENDING_DOMAINS` so the check knows.
- `PLATFORM_FQDN` unset on a multi-venue instance — **the nastiest one**,
  because mail still sends. No venue subdomain is a recognised link host, so
  every tenant's magic links are built against `PUBLIC_APP_URL`. A player at
  venue B clicks their link, signs in on venue A's host (the session cookie is
  host-only), and is still signed out where they started. Preflight:
  `platform_fqdn_unset_multi_org`.

**3. Restart and read the preflight.** `ffc restart`, then `ffc logs`. A clean
config logs nothing about mail; anything else prints the block described above.
*Symptom if skipped:* you discover a typo'd env var at step 5 instead of now.

**4. Check status.** Master Control -> Ops -> Mail (or `GET
/api/admin/mail/status`). Confirm: provider `resend`, credential **set**,
`MAIL_FROM` on the verified domain, link origin pointing at the venue host you
loaded the console from, `PLATFORM_FQDN` set, and **no warnings**. *Symptom if
skipped:* you send a test that fails for a reason the status line would have
told you in one glance.

**5. Send a test message** to an address you can actually open, from the same
screen. Then check the inbox **and the spam folder**.
- Green, and the mail arrives -> the pipe works.
- Green, no mail, not in spam -> check Resend's own delivery log; the API
  accepted it and something downstream dropped it.
- Green, lands in **spam** -> DNS is incomplete (usually a missing DMARC record,
  or SPF published on the wrong subdomain). Fix DNS, don't touch the app.
- **Red, with the provider's error text** -> read it. `domain is not verified`
  means step 1 isn't finished. `Invalid API key` means the key is wrong or was
  pasted with a trailing newline. `You can only send testing emails to your own
  address` means the Resend account is still in test mode.
- Green but "nothing was actually delivered" -> `MAIL_PROVIDER` is still
  `console`. The env didn't take; check you restarted.

**6. Confirm a real sign-in on a tenant subdomain** — the end-to-end check, and
the only one that exercises the link origin. Open
`https://<venue>.<PLATFORM_FQDN>` in a private window, sign in with an email
address, and click the link **from that mail** (not the code).
- You land signed in on `<venue>.<PLATFORM_FQDN>` -> done.
- You land on a *different* venue's host, or the apex, and are signed out ->
  `PLATFORM_FQDN` is unset or wrong; the link fell back to `PUBLIC_APP_URL`.
- No mail, though step 5 delivered -> the send was dropped by a cap. Check
  `MAIL_DAILY_CAP` (per org, rolling 24h) and `MAIL_GLOBAL_DAILY_CAP` on the
  status screen; an explicit `0` is a kill switch, and the mailer logs
  `daily send cap reached` when it bites.

**What retires itself once this is live.** While `MAIL_PROVIDER` is unset the
dev sign-in **bypass** is on: `/api/auth/request-code` hands the code straight
back in its response so the app can sign in with no inbox. It is checked per
request, so setting a real provider retires it with no restart — and it never
runs in production regardless.

## Routine redeploys

```bash
ffc deploy      # pull main -> TEST GATE -> build into releases/<ts> -> migrate DB -> swap current -> restart API -> health check
```

**The test gate.** There is no CI on this project, so the deploy is the gate:
after pulling, `ffc deploy` runs the full server suite (`server/*.test.js`,
node:test) against a scratch database (`<dbname>_test` on the same Postgres,
created automatically; `FFC_TEST_DATABASE_URL` overrides) **before anything
ships** — a red suite aborts with production untouched (no build swap, no
migrate, no restart). Because the suite applies `schema.sql` to the scratch DB,
a broken migration fails here too, not against the live database. Emergency
bypass (a true fire only): `FFC_SKIP_TESTS=1 ffc deploy`.

`ffc deploy` applies `schema.sql` on every deploy (all DDL is idempotent), so new
tables and columns reach production automatically — no manual migrate step. Run
it standalone with `ffc migrate` if needed. It also self-heals the nginx vhost:
if the live config is missing `client_max_body_size` (needed for scavenger-hunt
photo uploads), deploy re-renders it once (which re-runs certbot); otherwise it
just reloads.

`ffc deploy` pulls `main`, then **re-execs the freshly-pulled copy of itself** so
changes to the deploy logic take effect on the same run (no more "lands one
deploy late"). After restarting the API it **polls `/api/health` (~30 s)** and
fails the deploy loudly — with recent pm2 logs — if the API doesn't come up:
pm2 "restarted" alone proves nothing when the process crash-loops. It ends by
printing the client vs API build hash and whether they match (also available
standalone as `ffc version`).

**Rolling back.** Every deploy records the outgoing commit in `.ffc-prev-sha`;
if a deploy goes bad:

```bash
ffc rollback            # return to the previously-deployed commit
ffc rollback <sha>      # or an explicit one
```

Rollback is **code only** — `schema.sql` is forward-only and applied DDL stays
applied (the house rule of additive-only migrations is what keeps old code
compatible; a migration that drops/renames something old code reads makes that
deploy a point of no return, so treat destructive DDL as its own decision).
Rollback rebuilds, restarts, health-checks, and skips both the test gate and
migrate. The next `ffc deploy` ships the `main` tip again.

Other operate commands: `ffc restart`, `ffc logs`, `ffc version` (build sync
check), `ffc seed` (re-load courses), `ffc vhost` (rewrite vhost + re-cert).

## Backups (do this — the droplet is the only copy)

Postgres, its dumps, and every uploaded photo live on the **same droplet**; a
local dump is a convenience, not a backup. `ffc backup` dumps to
`data/backups/` (gzipped, newest `FFC_BACKUP_KEEP`, default 14, kept) and then
pushes **offsite** to `FFC_BACKUP_REMOTE`, which is either

- an **rclone remote** path, e.g. `spaces:ffc-backups` (DO Spaces — run
  `rclone config` once with a Spaces key), or
- an **scp target**, e.g. `user@host:/backups/ffc`.

One-time setup on the droplet:

```bash
echo 'FFC_BACKUP_REMOTE=spaces:ffc-backups' >> /var/www/ffc/.env   # or an scp target
ffc backup          # verify one full dump + offsite push works
ffc backup-cron     # install the nightly cron (/etc/cron.d/ffc-backup, 04:10)
```

Without `FFC_BACKUP_REMOTE` set, `ffc backup` still dumps locally but WARNS
loudly — droplet loss is then total data loss. Restore into a **fresh**
database with `gunzip -c ffc-<ts>.sql.gz | psql "$DATABASE_URL"`. Note the
dump covers Postgres only: uploaded photos (`server/data/*`) and the
CenterEdge mock's state file ride in `data/`/`server/data/` on disk — rsync
those separately if they matter to you.

## Seeding the four courses

`ffc setup` already seeds them. The source of truth is
`deploy/courses.seed.json` (mirrors `src/data/courses.ts`); re-load anytime with
`ffc seed`. Stable `id`s make it an idempotent upsert.

## Verify after deploy

- `https://<fqdn>/` loads over TLS (padlock).
- DevTools → Application → Service Workers shows an activated SW.
- Install prompt appears (Add to Home Screen) on a phone.
- Airplane mode: the app still opens and a full round can be scored offline.
- Reconnect: a completed round syncs (row appears via `GET /api/leaderboard`).
