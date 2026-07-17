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
   and poisons the service-worker cache. `deploy/deploy.sh` does this.

## First-time provisioning

Run as **root on the droplet**. The subdomain used below is `ffc.lab980.com`;
change `ffc` to whatever label you want.

Note on the vhost: `provision-site` writes a vhost that proxies **all** of `/`
to one app port — that shape is for a Node server app. This app is different:
nginx serves the static `dist/` directly and proxies only `/api/` to the Node
API. So we provision with `--no-tls`, then replace the generated vhost with
`deploy/nginx.conf.template` before issuing the cert. Steps are idempotent.

```bash
# ── 1. DNS + clone + dir + reserve a local port (skip TLS until the real vhost) ──
#   ivjames/ffc is private — export a token first so the https clone can auth:
#     export GITHUB_TOKEN=ghp_...            # a PAT with repo read access
provision-site ffc ivjames/ffc --no-tls
#   creates the A record ffc.lab980.com -> droplet IP, clones into /var/www/ffc,
#   reserves a port (writes /var/www/ffc/.env with PORT, default 8060).
#   Apex instead of a subdomain? e.g.  provision-site @ ivjames/ffc --domain <domain>

# ── 2. Postgres: database + role, then point the API at it ──
sudo -u postgres psql -c "CREATE DATABASE ffc;"
sudo -u postgres psql -c "CREATE ROLE ffc LOGIN PASSWORD 'CHANGE_ME';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ffc TO ffc;"

cd /var/www/ffc/server
cp .env.example .env
#   edit .env — set:
#     DATABASE_URL=postgres://ffc:CHANGE_ME@localhost:5432/ffc
#     PORT=8060
#     APP_TOKEN=$(openssl rand -hex 16)      # guards POST /api/seed
npm ci
npm run migrate                              # creates course/round/score tables

# ── 3. Start the API under pm2 (from server/ so dotenv loads server/.env) ──
pm2 start index.js --name ffc-api --cwd /var/www/ffc/server
pm2 save
#   Reboot survival needs the pm2 boot hook installed ONCE per droplet:
#     pm2 startup systemd -u root --hp /root   # then run the line it prints
#     systemctl is-enabled pm2-root            # -> enabled
curl -fsS http://127.0.0.1:8060/api/health    # {"ok":true}

# ── 4. Seed the four courses (see the seed block below), API now up on :8060 ──

# ── 5. First static build + atomic release (creates /var/www/ffc/current -> release) ──
cd /var/www/ffc
./deploy/deploy.sh

# ── 6. Swap the proxy vhost for the static + /api vhost, then reload ──
sed -e 's/__FQDN__/ffc.lab980.com/g' \
    -e 's#__APP_DIR__#/var/www/ffc#g' \
    -e 's/__API_PORT__/8060/g' \
    deploy/nginx.conf.template > /etc/nginx/sites-available/ffc.lab980.com
ln -sf /etc/nginx/sites-available/ffc.lab980.com /etc/nginx/sites-enabled/ffc.lab980.com
nginx -t && systemctl reload nginx

# ── 7. TLS — adds the 443 server block + HTTP->HTTPS redirect on top ──
#   (needs DNS from step 1 to have propagated; re-run if certbot says it can't reach the host)
certbot --nginx -d ffc.lab980.com --redirect -n --agree-tos -m ivjames@gmail.com
```

## Seeding the four courses into Postgres

The bundled seed (`src/data/courses.ts`) is the source of truth. Load the same
four rows into the `course` table via the API's dev endpoint:

```bash
# pull APP_TOKEN straight from server/.env, then POST the seed
APP_TOKEN=$(grep -E '^APP_TOKEN=' /var/www/ffc/server/.env | cut -d= -f2-)
curl -fsS -X POST http://127.0.0.1:8060/api/seed \
  -H 'content-type: application/json' \
  -H "x-app-token: $APP_TOKEN" \
  -d '[
    {"id":"11111111-1111-4111-8111-111111111111","name":"Jungle Run","theme":"jungle","pars":[3,2,4,3,3,2,4,3,2,3,4,3,2,3,3,4,2,3]},
    {"id":"22222222-2222-4222-8222-222222222222","name":"Pirate'\''s Cove","theme":"pirate","pars":[2,3,3,4,3,2,3,4,3,2,3,3,4,2,3,3,4,3]},
    {"id":"33333333-3333-4333-8333-333333333333","name":"Space Odyssey","theme":"space","pars":[3,3,2,4,3,3,2,3,4,3,3,2,4,3,3,2,3,4]},
    {"id":"44444444-4444-4444-8444-444444444444","name":"Haunted Manor","theme":"haunted","pars":[3,4,2,3,3,4,3,2,3,4,2,3,3,4,3,2,3,3]}
  ]'
```

Passing stable `id`s makes re-seeding idempotent (upsert on id).

## Routine redeploys

```bash
cd /var/www/ffc && ./deploy/deploy.sh
```

Pulls `main`, builds into `releases/<timestamp>/`, atomically swaps `current`,
reloads nginx, restarts the pm2 API, prunes old releases.

## Verify after deploy

- `https://<fqdn>/` loads over TLS (padlock).
- DevTools → Application → Service Workers shows an activated SW.
- Install prompt appears (Add to Home Screen) on a phone.
- Airplane mode: the app still opens and a full round can be scored offline.
- Reconnect: a completed round syncs (row appears via `GET /api/leaderboard`).
