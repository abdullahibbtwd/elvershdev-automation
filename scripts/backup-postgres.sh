#!/usr/bin/env bash
# Create a PostgreSQL dump with optional openssl encryption and retention.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env_file
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
RAW_FILE="$BACKUP_DIR/aivideo-${STAMP}.sql.gz"
mkdir -p "$BACKUP_DIR"

log "Creating Postgres backup $RAW_FILE"
"${COMPOSE[@]}" exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --format=plain \
  | gzip -c > "$RAW_FILE"

if [[ ! -s "$RAW_FILE" ]]; then
  rm -f "$RAW_FILE"
  die "Backup file is empty"
fi

# Integrity: gunzip -t
gzip -t "$RAW_FILE" || die "gzip integrity check failed"

FINAL_FILE="$RAW_FILE"
if [[ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ]]; then
  FINAL_FILE="${RAW_FILE}.enc"
  openssl enc -aes-256-cbc -pbkdf2 -salt \
    -in "$RAW_FILE" -out "$FINAL_FILE" \
    -pass pass:"$BACKUP_ENCRYPT_PASSPHRASE"
  rm -f "$RAW_FILE"
  log "Encrypted backup written to $FINAL_FILE"
fi

# Marker for ops dashboard
echo "{\"file\":\"$(basename "$FINAL_FILE")\",\"createdAt\":\"$STAMP\",\"bytes\":$(stat -f%z "$FINAL_FILE" 2>/dev/null || stat -c%s "$FINAL_FILE")}" \
  > "$BACKUP_DIR/last_success.json"

# Retention
find "$BACKUP_DIR" -type f \( -name 'aivideo-*.sql.gz' -o -name 'aivideo-*.sql.gz.enc' \) -mtime +"$RETENTION_DAYS" -delete || true

log "Backup complete: $FINAL_FILE"
log "Copy off-VPS when possible. Do not trust until restore test succeeds."
