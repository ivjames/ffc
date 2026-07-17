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

```bash
# 1. DNS + dir + clone + nginx + TLS (lab980 helper; see lab980 CLAUDE.md)
provision-site minigolf ivjames/ffc          # -> minigolf.lab980.com
#   ...or graduate to an apex later:  provision-site @ ivjames/ffc --domain <domain>

cd /var/www/ffc

# 2. Postgres: create the database, then load schema + seed courses
createdb ffc
cp server/.env.example server/.env            # set DATABASE_URL, PORT=8060, APP_TOKEN
cd server && npm ci && npm run migrate         # creates course/round/score tables
node -e "require('fs')"                        # (sanity)
cd ..

# 3. Start the API under pm2
pm2 start server/index.js --name ffc-api
pm2 save                                       # boot hook must already be installed once per droplet

# 4. nginx site (see deploy/nginx.conf.template — fill __FQDN__/__APP_DIR__/__API_PORT__)
#    provision-site already writes a proxy vhost; adjust it to match the template
#    (SPA fallback + /api proxy + SW no-cache headers), then:
certbot --nginx -d minigolf.lab980.com --redirect
nginx -t && systemctl reload nginx

# 5. First build + release
./deploy/deploy.sh
```

## Seeding the four courses into Postgres

The bundled seed (`src/data/courses.ts`) is the source of truth. Load the same
four rows into the `course` table via the API's dev endpoint:

```bash
# with APP_TOKEN set in server/.env, pass it as a header
curl -X POST http://127.0.0.1:8060/api/seed \
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
