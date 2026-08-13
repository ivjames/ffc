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

### Player accounts + shared games — deploy notes

Two features lean on infrastructure beyond the code:

- **Outbound email** (sign-in codes, team invites): set `MAIL_PROVIDER=resend`
  + `RESEND_API_KEY` + `MAIL_FROM` in `server/.env`, and set `PUBLIC_APP_URL`
  to the player origin (e.g. `https://ffc.lab980.com`) so magic links and
  invite links point at production. **Before flipping to `resend`, verify the
  sending domain in Resend (SPF + DKIM DNS records)** — unverified domains
  don't deliver. Until then the default `console` provider logs codes to the
  pm2 log (fine for dev, warned-about in production).
- **SSE** (`GET /api/games/:id/events` — live shared scorecards): the endpoint
  already sends `X-Accel-Buffering: no` so nginx doesn't buffer the stream,
  and heartbeats every 25 s keep the connection inside nginx's default
  `proxy_read_timeout 60s`. If a vhost overrides `proxy_read_timeout` below
  ~30 s, raise it for `/api/` or the streams will cycle (EventSource
  auto-reconnects, so it degrades rather than breaks — each reconnect re-syncs
  from a full snapshot).

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
