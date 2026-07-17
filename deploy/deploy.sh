#!/usr/bin/env bash
# Atomic deploy for the Mini Golf PWA on the lab980 droplet.
#
# §3 hard requirement: NEVER overwrite the served directory in place — a
# mid-deploy page load would serve mixed old/new hashed assets and poison the
# service-worker cache. Instead we build into a fresh timestamped release dir
# and swap a single `current` symlink that nginx's `root` points at. The swap
# is atomic (ln -sfn via a temp name + mv), so a request either sees the whole
# old release or the whole new one — never a mix.
#
# Usage (on the droplet):  ./deploy/deploy.sh
# Assumes this repo is checked out at $APP_DIR and nginx `root` is
# $APP_DIR/current/dist (see deploy/nginx.conf.template).
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/ffc}"
RELEASES_DIR="$APP_DIR/releases"
KEEP="${KEEP:-5}"                      # how many old releases to retain
BRANCH="${BRANCH:-main}"

cd "$APP_DIR"

echo "==> Fetching latest ($BRANCH)"
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git reset --hard --quiet "origin/$BRANCH"

TS="$(date +%Y%m%d%H%M%S)"
RELEASE="$RELEASES_DIR/$TS"
mkdir -p "$RELEASE"

echo "==> Building frontend into $RELEASE"
npm ci
npm run build
cp -r dist "$RELEASE/dist"

echo "==> Swapping current -> $TS (atomic)"
ln -sfn "$RELEASE" "$APP_DIR/current.tmp"
mv -Tf "$APP_DIR/current.tmp" "$APP_DIR/current"

echo "==> Reloading nginx"
nginx -t && systemctl reload nginx

echo "==> Restarting API (pm2)"
if [ -d "$APP_DIR/server" ]; then
  ( cd "$APP_DIR/server" && npm ci --omit=dev )
  # Start from the server dir (--cwd) so dotenv loads server/.env (DATABASE_URL,
  # APP_TOKEN). A restart reuses the process's stored cwd, so this matters most
  # on the first start (the fallback branch).
  pm2 restart ffc-api --update-env \
    || pm2 start index.js --name ffc-api --cwd "$APP_DIR/server"
  pm2 save
fi

echo "==> Pruning old releases (keep $KEEP)"
ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "==> Done. Serving release $TS"
