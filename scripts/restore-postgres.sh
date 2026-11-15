#!/usr/bin/env bash
# Restore PostgreSQL from a gzip or encrypted dump. DESTRUCTIVE to DB contents.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

require_env_file
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

BACKUP_FILE="${1:-}"
[[ -n "$BACKUP_FILE" && -f "$BACKUP_FILE" ]] || die "Usage: $0 /path/to/aivideo-....sql.gz[.enc]"

CONFIRM="${CONFIRM_RESTORE:-}"
[[ "$CONFIRM" == "YES" ]] || die "Refusing restore. Re-run with CONFIRM_RESTORE=YES"

WORKDIR="$(mktemp -d)"
cleanup() { rm -rf "$WORKDIR"; }
trap cleanup EXIT

SQL_STREAM="$WORKDIR/restore.sql"

if [[ "$BACKUP_FILE" == *.enc ]]; then
  [[ -n "${BACKUP_ENCRYPT_PASSPHRASE:-}" ]] || die "BACKUP_ENCRYPT_PASSPHRASE required"
  DECRYPTED="$WORKDIR/backup.sql.gz"
  openssl enc -d -aes-256-cbc -pbkdf2 \
    -in "$BACKUP_FILE" -out "$DECRYPTED" \
    -pass pass:"$BACKUP_ENCRYPT_PASSPHRASE"
  gzip -t "$DECRYPTED" || die "Decrypted backup failed gzip integrity check"
  gunzip -c "$DECRYPTED" > "$SQL_STREAM"
elif [[ "$BACKUP_FILE" == *.gz ]]; then
  gzip -t "$BACKUP_FILE" || die "Backup failed gzip integrity check"
  gunzip -c "$BACKUP_FILE" > "$SQL_STREAM"
else
  cp "$BACKUP_FILE" "$SQL_STREAM"
fi

[[ -s "$SQL_STREAM" ]] || die "Restored SQL stream is empty"

log "Stopping api and worker during restore"
"${COMPOSE[@]}" stop api worker || true

log "Restoring into database $POSTGRES_DB"
"${COMPOSE[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 \
  -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO \"$POSTGRES_USER\";"

"${COMPOSE[@]}" exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$SQL_STREAM"

log "Starting api and worker"
"${COMPOSE[@]}" up -d api worker
wait_healthy api
wait_healthy worker
log "Restore complete. Verify application data before enabling automation."
