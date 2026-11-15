#!/usr/bin/env bash
# Rolling application update without deleting persistent volumes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env_file
forbid_dev_defaults

PREVIOUS_VERSION="$(cat "$ROOT_DIR/releases/current_version.txt" 2>/dev/null || echo unknown)"
if [[ -z "${APP_VERSION:-}" || "${APP_VERSION}" == "0.1.0" || "${APP_VERSION}" == "latest" ]]; then
  APP_VERSION="$(date -u +%Y%m%d%H%M%S)"
fi
export APP_VERSION
mkdir -p "$ROOT_DIR/releases"
echo "$PREVIOUS_VERSION" > "$ROOT_DIR/releases/previous_version.txt"
echo "$APP_VERSION" > "$ROOT_DIR/releases/current_version.txt"
cp "$ENV_FILE" "$ROOT_DIR/releases/${APP_VERSION}.env.bak"

log "Backing up database before update"
bash "$SCRIPT_DIR/backup-postgres.sh" || die "Pre-update backup failed — aborting update"

log "Building new images version=$APP_VERSION (previous=$PREVIOUS_VERSION)"
"${COMPOSE[@]}" build api worker web

log "Applying migrations"
"${COMPOSE[@]}" run --rm --no-deps \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public" \
  api \
  pnpm exec prisma migrate deploy

log "Recreating api/worker/web (volumes untouched)"
"${COMPOSE[@]}" up -d --no-deps api worker web
"${COMPOSE[@]}" up -d caddy

wait_healthy api
wait_healthy worker
wait_healthy web

log "Update complete: $PREVIOUS_VERSION -> $APP_VERSION"
log "Rollback: APP_VERSION=$PREVIOUS_VERSION ./scripts/rollback.sh"
