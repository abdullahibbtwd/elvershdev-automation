#!/usr/bin/env bash
# Mirror MinIO bucket to a local directory (preferably an attached off-VPS mount).
# Requires mc (MinIO client) on the host, or runs via a temporary minio/mc container.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env_file
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

DEST="${MINIO_BACKUP_DIR:-$ROOT_DIR/backups/minio}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$DEST/mirror-$STAMP"
mkdir -p "$TARGET"

log "Mirroring MinIO bucket ${MINIO_BUCKET} to $TARGET"
"${COMPOSE[@]}" run --rm --no-deps \
  -v "$TARGET:/backup" \
  --entrypoint /bin/sh \
  minio \
  -c "
    curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /tmp/mc && chmod +x /tmp/mc
    /tmp/mc alias set local http://minio:9000 \"$MINIO_ACCESS_KEY\" \"$MINIO_SECRET_KEY\"
    /tmp/mc mirror --overwrite local/${MINIO_BUCKET} /backup
  "

echo "{\"dir\":\"$(basename "$TARGET")\",\"createdAt\":\"$STAMP\"}" > "$DEST/last_success.json"
find "$DEST" -maxdepth 1 -type d -name 'mirror-*' -mtime +"${BACKUP_RETENTION_DAYS:-14}" -exec rm -rf {} + || true
log "MinIO mirror complete: $TARGET"
log "Copy this directory off-VPS. Do not trust until a restore drill succeeds."
