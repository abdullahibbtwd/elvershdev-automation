#!/bin/sh
# Keep going past individual checks so Coolify Runtime Logs always show a diagnosis.
set -u

echo "[api-entrypoint] node=$(node -v) cwd=$(pwd) role=${PROCESS_ROLE:-api}"

if [ ! -f dist/main.js ]; then
  echo "[api-entrypoint] ERROR: dist/main.js missing" >&2
  ls -la . >&2 || true
  exit 1
fi

# Rebuild DATABASE_URL for the in-compose postgres service when needed.
# Special characters in POSTGRES_PASSWORD break naive compose interpolation.
if [ -n "${POSTGRES_PASSWORD:-}" ] && [ -n "${POSTGRES_USER:-}" ] && [ -n "${POSTGRES_DB:-}" ]; then
  ENCODED_URL="$(node -e "
    const u = process.env.POSTGRES_USER;
    const p = process.env.POSTGRES_PASSWORD;
    const d = process.env.POSTGRES_DB;
    const limit = process.env.PROCESS_ROLE === 'scheduler' ? 10 : 20;
    const url = new URL('postgresql://host');
    url.username = u;
    url.password = p;
    url.hostname = 'postgres';
    url.port = '5432';
    url.pathname = '/' + d;
    url.search = 'schema=public&connection_limit=' + limit;
    process.stdout.write(url.toString());
  ")"
  export DATABASE_URL="$ENCODED_URL"
  echo "[api-entrypoint] DATABASE_URL host=postgres (password URL-encoded)"
elif [ -z "${DATABASE_URL:-}" ]; then
  echo "[api-entrypoint] ERROR: DATABASE_URL and POSTGRES_* are both unset" >&2
  exit 1
else
  echo "[api-entrypoint] using provided DATABASE_URL (host will not be rewritten)"
fi

# Print which required keys are missing (names only — never values).
MISSING=""
for key in \
  JWT_ACCESS_SECRET \
  JWT_REFRESH_SECRET \
  CREDENTIALS_ENCRYPTION_KEY \
  REDIS_HOST \
  REDIS_PASSWORD \
  MINIO_ENDPOINT \
  MINIO_ACCESS_KEY \
  MINIO_SECRET_KEY \
  CORS_ORIGIN \
  PUBLIC_API_URL
do
  eval "val=\${$key:-}"
  if [ -z "$val" ]; then
    MISSING="$MISSING $key"
  fi
done
if [ -n "$MISSING" ]; then
  echo "[api-entrypoint] ERROR: missing required env:$MISSING" >&2
  echo "[api-entrypoint] Set these in Coolify → Environment Variables (runtime), then redeploy." >&2
  exit 1
fi

run_migrate() {
  if [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma migrate deploy
  elif [ -x ../../node_modules/.bin/prisma ]; then
    ../../node_modules/.bin/prisma migrate deploy
  else
    node -e "require('child_process').execFileSync(require.resolve('prisma/build/index.js'), ['migrate','deploy'], {stdio:'inherit'})"
  fi
}

if [ "${PROCESS_ROLE:-api}" = "api" ] && [ "${SKIP_DB_MIGRATE:-false}" != "true" ]; then
  echo "[api-entrypoint] applying prisma migrations..."
  if ! run_migrate; then
    echo "[api-entrypoint] ERROR: prisma migrate deploy failed" >&2
    exit 1
  fi
  echo "[api-entrypoint] migrations ok"
fi

echo "[api-entrypoint] starting node dist/main.js"
exec node dist/main.js
