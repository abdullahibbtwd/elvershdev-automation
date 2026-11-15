#!/bin/sh
set -eu

echo "[api-entrypoint] node=$(node -v) cwd=$(pwd) role=${PROCESS_ROLE:-api}"

if [ ! -f dist/main.js ]; then
  echo "[api-entrypoint] ERROR: dist/main.js missing" >&2
  exit 1
fi

# Prefer local prisma bin (copied from build); fall back to pnpm.
run_migrate() {
  if [ -x ./node_modules/.bin/prisma ]; then
    ./node_modules/.bin/prisma migrate deploy
  elif [ -x ../../node_modules/.bin/prisma ]; then
    ../../node_modules/.bin/prisma migrate deploy
  else
    pnpm exec prisma migrate deploy
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
