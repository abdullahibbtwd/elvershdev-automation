#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
COMPOSE_FILE="${COMPOSE_FILE:-$ROOT_DIR/docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

require_env_file() {
  [[ -f "$ENV_FILE" ]] || die "Missing env file: $ENV_FILE (copy .env.production.example)"
}

require_vars() {
  local missing=()
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  for var in "$@"; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("$var")
    fi
  done
  if ((${#missing[@]} > 0)); then
    die "Missing required variables: ${missing[*]}"
  fi
}

forbid_dev_defaults() {
  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a
  local bad=()
  [[ "${JWT_ACCESS_SECRET:-}" == *change-me* ]] && bad+=("JWT_ACCESS_SECRET")
  [[ "${JWT_REFRESH_SECRET:-}" == *change-me* ]] && bad+=("JWT_REFRESH_SECRET")
  [[ "${CREDENTIALS_ENCRYPTION_KEY:-}" == *change-me* ]] && bad+=("CREDENTIALS_ENCRYPTION_KEY")
  [[ "${POSTGRES_PASSWORD:-}" == "aivideo" ]] && bad+=("POSTGRES_PASSWORD")
  [[ "${MINIO_ACCESS_KEY:-}" == "minioadmin" ]] && bad+=("MINIO_ACCESS_KEY")
  [[ "${MINIO_SECRET_KEY:-}" == "minioadmin" ]] && bad+=("MINIO_SECRET_KEY")
  [[ -z "${REDIS_PASSWORD:-}" ]] && bad+=("REDIS_PASSWORD")
  if ((${#bad[@]} > 0)); then
    die "Refusing production deploy with insecure defaults: ${bad[*]}"
  fi
  if [[ ${#JWT_ACCESS_SECRET} -lt 32 || ${#JWT_REFRESH_SECRET} -lt 32 || ${#CREDENTIALS_ENCRYPTION_KEY} -lt 32 ]]; then
    die "JWT and encryption secrets must be at least 32 characters"
  fi
}

wait_healthy() {
  local service="$1"
  local attempts="${2:-60}"
  local i
  for ((i = 1; i <= attempts; i++)); do
    local status
    status="$("${COMPOSE[@]}" ps --format json "$service" 2>/dev/null | head -1 || true)"
    if echo "$status" | grep -qi '"Health":"healthy"\|healthy'; then
      log "$service is healthy"
      return 0
    fi
    # fallback: inspect container health
    local cid
    cid="$("${COMPOSE[@]}" ps -q "$service" || true)"
    if [[ -n "$cid" ]]; then
      local health
      health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      if [[ "$health" == "healthy" || "$health" == "running" ]]; then
        if [[ "$health" == "healthy" ]]; then
          log "$service is healthy"
          return 0
        fi
      fi
    fi
    sleep 5
  done
  die "$service did not become healthy in time"
}
