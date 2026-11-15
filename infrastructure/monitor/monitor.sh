#!/usr/bin/env bash
# External health monitor — does not depend on Nest/API process internals.
# Probes compose services and writes JSON status + optional alert file.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env.production}"
OUT_DIR="${MONITOR_OUT_DIR:-$ROOT_DIR/backups/monitor}"
INTERVAL="${MONITOR_INTERVAL_SECONDS:-60}"
mkdir -p "$OUT_DIR"

API_URL="${MONITOR_API_URL:-http://127.0.0.1:3000/api/health/ready}"
WORKER_URL="${MONITOR_WORKER_URL:-http://127.0.0.1:3101/health/ready}"

check() {
  local name="$1" url="$2"
  local code
  code=$(curl -fsS -o /tmp/monitor-"$name".json -w "%{http_code}" --max-time 5 "$url" || echo "000")
  if [[ "$code" == "200" ]]; then
    echo "{\"name\":\"$name\",\"ok\":true,\"code\":$code}"
  else
    echo "{\"name\":\"$name\",\"ok\":false,\"code\":$code}"
  fi
}

# Single-shot mode (default) or loop when MONITOR_LOOP=1
run_once() {
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  local api worker
  api=$(check api "$API_URL")
  worker=$(check worker "$WORKER_URL")
  local postgres_ok=false redis_ok=false minio_ok=false
  if command -v docker >/dev/null 2>&1; then
    docker exec aivideo-postgres pg_isready -U "${POSTGRES_USER:-postgres}" >/dev/null 2>&1 && postgres_ok=true || true
    docker exec aivideo-redis redis-cli ${REDIS_PASSWORD:+-a "$REDIS_PASSWORD"} ping 2>/dev/null | grep -q PONG && redis_ok=true || true
    docker exec aivideo-minio curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1 && minio_ok=true || true
  fi
  local payload
  payload=$(cat <<EOF
{"ts":"$ts","api":$api,"worker":$worker,"postgres":$postgres_ok,"redis":$redis_ok,"minio":$minio_ok}
EOF
)
  echo "$payload" > "$OUT_DIR/last_status.json"
  if echo "$payload" | grep -q '"ok":false\|false'; then
    echo "$payload" > "$OUT_DIR/last_alert.json"
    echo "[monitor] ALERT $payload" >&2
    exit 1
  fi
  echo "[monitor] OK $payload"
}

if [[ "${MONITOR_LOOP:-0}" == "1" ]]; then
  while true; do
    run_once || true
    sleep "$INTERVAL"
  done
else
  run_once
fi
