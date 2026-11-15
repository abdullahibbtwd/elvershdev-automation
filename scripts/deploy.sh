#!/usr/bin/env bash
# Initial or full production deployment. Never deletes named volumes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env_file
forbid_dev_defaults
require_vars \
  DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB \
  REDIS_PASSWORD MINIO_ACCESS_KEY MINIO_SECRET_KEY \
  JWT_ACCESS_SECRET JWT_REFRESH_SECRET CREDENTIALS_ENCRYPTION_KEY \
  CORS_ORIGIN PUBLIC_API_URL

mkdir -p "$ROOT_DIR/backups/postgres" "$ROOT_DIR/backups/minio" "$ROOT_DIR/releases"
# Prefer explicit APP_VERSION from the environment; never reuse the static
# placeholder from .env.production (e.g. 0.1.0) for image tags.
if [[ -z "${APP_VERSION:-}" || "${APP_VERSION}" == "0.1.0" || "${APP_VERSION}" == "latest" ]]; then
  APP_VERSION="$(date -u +%Y%m%d%H%M%S)"
fi
export APP_VERSION
echo "$APP_VERSION" > "$ROOT_DIR/releases/current_version.txt"
cp "$ENV_FILE" "$ROOT_DIR/releases/${APP_VERSION}.env.bak"

log "Building images (version=$APP_VERSION)"
"${COMPOSE[@]}" build

log "Starting infrastructure"
"${COMPOSE[@]}" up -d postgres redis minio
wait_healthy postgres
wait_healthy redis
wait_healthy minio

log "Applying database migrations (prisma migrate deploy)"
"${COMPOSE[@]}" run --rm --no-deps \
  -e DATABASE_URL="postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB}?schema=public" \
  api \
  pnpm exec prisma migrate deploy

log "Starting application services"
"${COMPOSE[@]}" up -d api worker web caddy

wait_healthy api
wait_healthy worker
wait_healthy web

log "Verifying public health via API container"
"${COMPOSE[@]}" exec -T api curl -fsS http://127.0.0.1:3000/api/health >/dev/null

log "Deployment complete. Version=$APP_VERSION"
log "Volumes preserved: postgres_data redis_data minio_data caddy_data"
log "Next: run scripts/backup-postgres.sh and verify restore before enabling automation."
