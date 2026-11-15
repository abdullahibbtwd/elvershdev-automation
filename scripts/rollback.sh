#!/usr/bin/env bash
# Roll back application containers to a previous image tag. Does not touch volumes.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env_file

TARGET_VERSION="${APP_VERSION:-$(cat "$ROOT_DIR/releases/previous_version.txt" 2>/dev/null || true)}"
[[ -n "$TARGET_VERSION" && "$TARGET_VERSION" != "unknown" ]] || die "Set APP_VERSION to the image tag to restore"

log "Rolling back application images to $TARGET_VERSION"
export APP_VERSION="$TARGET_VERSION"

# Prefer previously built tags; do not rebuild from current source
"${COMPOSE[@]}" up -d --no-deps --no-build api worker web || {
  log "Tagged images missing — attempting rebuild of tag $TARGET_VERSION from current tree"
  "${COMPOSE[@]}" build api worker web
  "${COMPOSE[@]}" up -d --no-deps api worker web
}

"${COMPOSE[@]}" up -d caddy
wait_healthy api
wait_healthy worker
wait_healthy web

echo "$TARGET_VERSION" > "$ROOT_DIR/releases/current_version.txt"
log "Rollback complete to version $TARGET_VERSION"
log "NOTE: Database migrations are not automatically reversed. Restore from backup if schema changed."
