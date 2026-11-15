# Deployment Guide (single VPS)

How to install, update, roll back and recover the platform on one Linux VPS with Docker Compose.

> **Status of the tooling.** `docker-compose.prod.yml`, `infrastructure/caddy/Caddyfile`, `infrastructure/redis/redis.prod.conf`, `infrastructure/docker/Dockerfile.{api,worker,web}`, `.env.production.example` and `scripts/{deploy,update,rollback,backup-postgres,restore-postgres}.sh` (+ `scripts/lib/common.sh`) **exist in the repository**. This guide describes what they do, as read from the files.
>
> **None of it has been run on a VPS.** No first deploy, update, rollback, reboot-recovery or restore has been recorded. Treat every command below as untested until you record evidence in `PRODUCTION_CHECKLIST.md`. If a script behaves differently from this document, the script wins; fix the doc.
>
> The repository workspace is not a git repository (no `.git` directory). The scripts do **not** call `git`; code updates are your responsibility (clone/pull/copy) before running `update.sh`.
>
> **Single VPS = single point of failure.** One host runs Caddy, web, API, worker, Postgres, Redis and MinIO. A host, disk or provider failure is a full outage, and alerts are sent from the same host (a dead VPS cannot alert). Use an external uptime monitor.

## 0. Rules that never change

1. **Never delete volumes.** `postgres_data`, `redis_data`, `minio_data` hold all state.
   - Safe: `docker compose ... up -d`, `restart`, `stop`, `down`
   - **Destructive, forbidden in routine operations:** `docker compose down -v`, `docker volume rm`, `docker volume prune`, `docker system prune --volumes`
2. **Only ports 80 and 443 are public.** Postgres (`5432`), Redis (`6379`), MinIO (`9000`/`9001`), API (`3000`) and web (`80` inside the network) are internal only.
3. **Never run the development `docker-compose.yml` on a public host.** It publishes `5433`, `6379`, `9000`, `9001`, `3000` and `5173` on all interfaces. Docker-published ports bypass UFW, so a firewall rule alone will not save you.
4. **Back up before every deployment that includes a migration.** Migrations are forward-only.
5. **Verify a restore at least once** before trusting any backup (`BACKUP_AND_RESTORE.md`).

## 1. Prerequisites

| Item | Requirement |
| --- | --- |
| VPS | Linux (Ubuntu LTS or Debian), x86_64. Sizing guidance: **≥4 vCPU, ≥8 GB RAM, ≥80 GB SSD** is a sensible starting point for one FFmpeg render at a time plus the stack; the repo does not benchmark this, so measure during rollout stage C. |
| Software | Docker Engine + Compose v2 plugin, `bash`, `curl`, `openssl` (backup encryption), `gzip`, `ufw` (or provider firewall); `git` if you pull updates that way |
| DNS | An `A` (and optionally `AAAA`) record for your domain pointing at the VPS. Needed by Caddy for HTTPS and by OAuth redirect URIs. |
| Provider accounts | Gemini key, fal key, Kling key; Meta/TikTok/YouTube developer apps **only when you reach publishing stages** |
| Off-VPS backup target | Another host or object store for backup copies |
| SMTP account | Optional, for alert email (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, plus `ADMIN_EMAIL` as recipient). Without it, alerts are stored in the DB and visible on `/system` only. |

## 2. Initial VPS install

### 2.1 Harden the host

```bash
# as root, on a fresh VPS
adduser deploy && usermod -aG sudo deploy
# copy your SSH key to deploy, then disable password and root SSH login in /etc/ssh/sshd_config
apt update && apt -y upgrade

# Firewall: only SSH + 80/443
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Optionally allow 443/udp if Caddy serves HTTP/3.

### 2.2 Install Docker and enable it at boot

Install Docker Engine and the Compose plugin from Docker's official instructions for your distribution, then:

```bash
sudo usermod -aG docker deploy
sudo systemctl enable --now docker containerd   # required for reboot recovery
docker compose version
```

### 2.3 Get the code

```bash
sudo mkdir -p /opt/aivideo && sudo chown deploy:deploy /opt/aivideo
cd /opt/aivideo
git clone <your-repo-url> .
```

### 2.4 Create `.env.production`

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Every script reads `.env.production` (override with `ENV_FILE=/path`) and `docker-compose.prod.yml` (override with `COMPOSE_FILE=/path`); see `scripts/lib/common.sh`. Variable-by-variable detail is in `ENVIRONMENT_VARIABLES.md`.

```bash
# generate secrets (run each; paste results into .env.production)
openssl rand -base64 48     # JWT_ACCESS_SECRET
openssl rand -base64 48     # JWT_REFRESH_SECRET (different value)
openssl rand -base64 48     # CREDENTIALS_ENCRYPTION_KEY
openssl rand -hex 24        # POSTGRES_PASSWORD, REDIS_PASSWORD, MINIO_SECRET_KEY
```

Replace every placeholder in the template:

| Variable | Production value |
| --- | --- |
| `DOMAIN` | Your hostname (Caddy site address; automatic HTTPS) |
| `CORS_ORIGIN`, `PUBLIC_API_URL`, `SOCIAL_FRONTEND_REDIRECT_URL` | `https://<your-domain>` (exact origin, no trailing slash) |
| `VITE_API_URL` | Template ships `/api` (same origin via Caddy). Baked into the web image at build time. |
| `MINIO_PUBLIC_URL`, `SOCIAL_PUBLIC_MEDIA_BASE_URL` | `https://<your-domain>/media-proxy` (Caddy strips the prefix and proxies to `minio:9000`) |
| `POSTGRES_PASSWORD`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `REDIS_PASSWORD` | strong, unique |
| `DATABASE_URL` | Keep consistent with `POSTGRES_*` (compose also rebuilds it for `api`/`worker`) |
| `JWT_*_SECRET`, `CREDENTIALS_ENCRYPTION_KEY` | ≥32 chars, unique, **no** `change-me`, and not containing `secret`/`password`/`example` (the API's `validateProductionConfig` rejects those) |
| `*_REDIRECT_URI` (Facebook, Instagram, TikTok, YouTube) | `https://<your-domain>/api/channels/<provider>/callback`, matching the provider console exactly |
| `ADMIN_EMAIL`, `SMTP_*` | Alert recipient and SMTP relay (optional, see `MONITORING_AND_ALERTS.md`) |
| `APP_VERSION` | **Delete or change per release.** The scripts source this file before choosing a tag, so a fixed value (template: `0.1.0`) is reused for every deploy/update and defeats tag-based rollback. |
| `ROLLOUT_STAGE` | Keep `A` initially (see `PRODUCTION_CHECKLIST.md`) |
| All `*_USE_MOCK` | Keep `true` until each real provider is verified |

**Back up `.env.production` (especially `CREDENTIALS_ENCRYPTION_KEY`) to a password manager.** If that key is lost, every stored social-channel token becomes unreadable and users must reconnect their channels.

### 2.5 First start: `scripts/deploy.sh`

```bash
cd /opt/aivideo
./scripts/deploy.sh
```

What the script does, in order (from `scripts/deploy.sh`):

1. Requires `.env.production`; refuses insecure defaults (`forbid_dev_defaults`: `change-me`, default Postgres/MinIO credentials, empty `REDIS_PASSWORD`, secrets < 32 chars); requires `DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB REDIS_PASSWORD MINIO_ACCESS_KEY MINIO_SECRET_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET CREDENTIALS_ENCRYPTION_KEY CORS_ORIGIN PUBLIC_API_URL`.
2. Creates `backups/postgres`, `backups/minio`, `releases/`; writes `releases/current_version.txt` and copies the env file to `releases/<version>.env.bak` (**this copy contains secrets**; protect it like the env file).
3. `docker compose -f docker-compose.prod.yml build`.
4. Starts `postgres redis minio`, waits for health.
5. Applies migrations: `docker compose ... run --rm --no-deps -e DATABASE_URL=... api pnpm exec prisma migrate deploy`.
6. Starts `api worker web caddy`, waits for `api`, `worker`, `web` health, then runs `curl http://127.0.0.1:3000/api/health` inside the `api` container.
7. Prints a reminder to take a backup and **verify a restore** before enabling automation. It never deletes volumes.

Manual equivalent (same compose file; use only if you cannot run the script):

```bash
cd /opt/aivideo
export ENV_FILE=.env.production
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC build
$DC up -d postgres redis minio
$DC ps                                   # wait for "healthy"
$DC run --rm --no-deps api pnpm exec prisma migrate deploy
$DC up -d api worker web caddy
```

`docker-compose.prod.yml` has no `apps` profile; only the optional `backup` service uses a profile (`ops`, see `BACKUP_AND_RESTORE.md`). Why `pnpm exec prisma migrate deploy` works in the image: `Dockerfile.api` copies the full `node_modules` (including the Prisma CLI) and enables pnpm via corepack, with working directory `/app/apps/api`, where `prisma/schema.prisma` lives.

What the production stack provides (all read from the files, not tested on a VPS):

- Only `caddy` publishes ports (`${HTTP_PORT:-80}`, `${HTTPS_PORT:-443}`). Postgres, Redis, MinIO, API, web and worker are not published.
- Images run as a non-root `aivideo` user and define a `HEALTHCHECK` (`Dockerfile.api`, `Dockerfile.worker`, `Dockerfile.web`); compose healthchecks cover every service.
- JSON log rotation on every service; memory limits on postgres/redis/minio/web and configurable `API_MEMORY_LIMIT`/`API_CPU_LIMIT`/`WORKER_MEMORY_LIMIT`/`WORKER_CPU_LIMIT`.
- `stop_grace_period`: api `30s`, worker `120s`.
- Caddy routes `/api/*` → `api:3000`, `/docs*` → `api:3000` (Swagger is off unless `SWAGGER_ENABLED=true`), `/media-proxy/*` → `minio:9000` (prefix stripped), everything else → `web:8080`; sets HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`. No CSP is set.

### 2.6 Verify

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC ps
curl -fsS https://<your-domain>/api/health/live        # {"status":"ok","service":"api","version":...}
curl -fsS https://<your-domain>/api/health/ready       # database + redis + minio
curl -fsS https://<your-domain>/api/health             # database + redis + minio
$DC exec worker curl -fsS http://127.0.0.1:3101/health # worker health (internal only)
$DC logs --tail=100 api worker
```

`/api/health` and `/api/health/ready` run the same three checks (Postgres, Redis, MinIO). `/api/health/live` is a static response and checks nothing. The worker's `/health` returns HTTP 200 with uptime, queues, FFmpeg availability and memory figures whenever the process is up; it does **not** probe Redis or Postgres.

Confirm from **outside** the VPS that nothing else is reachable:

```bash
# from your laptop, each should time out or be refused
nc -zv <vps-ip> 5432 6379 9000 9001 3000 5173 5433 3101
```

Then register the first user in the UI. New users get the default role `EDITOR`. **`ADMIN_EMAIL` does not make anyone an admin**; it is only the alert recipient. Create the first admin with a one-off DB update, for example:

```bash
$DC exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "UPDATE users SET role='ADMIN' WHERE email='you@example.com';"
```

(The `User` model is mapped to table `users` in `apps/api/prisma/schema.prisma`; verify before running.) After that, an admin can use the **System Ops** page (`/system`, visible to admins) or `POST /api/ops/promote-admin`. Registration remains open and non-ops roles are not enforced; see `SECURITY.md`.

## 3. Ports

| Port | Service | Exposure |
| --- | --- | --- |
| 80, 443 | Caddy | **Public** (80 only for ACME and redirect) |
| 3000 | API (`PORT`) | Internal only |
| 8080 (container) | web (unprivileged nginx; Caddy proxies to `web:8080`) | Internal only |
| 5432 | PostgreSQL | Internal only (dev compose maps host `POSTGRES_PORT`=5433, **do not** in prod) |
| 6379 | Redis | Internal only |
| 9000 / 9001 | MinIO API / console | Internal only |
| `WORKER_HEALTH_PORT` (`3101`) | Worker health | Internal only (not published) |

For admin work, never open a public port. SSH into the VPS and use `docker compose exec`:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production exec postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"
docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" ping
```

If you need the MinIO console (`:9001`) in a browser, either bind it to `127.0.0.1` on the VPS in a temporary override file and use `ssh -L 9001:127.0.0.1:9001 deploy@<vps>`, or use the `mc` CLI from inside the Docker network. Remove the override afterwards.

## 4. Updating (`scripts/update.sh`)

Get the new code onto the VPS first (the script does not pull). Then:

```bash
cd /opt/aivideo
./scripts/update.sh
```

What the script does (from `scripts/update.sh`):

1. Requires `.env.production`; runs the same insecure-default checks as `deploy.sh`.
2. Records `releases/previous_version.txt` (the old `current_version.txt`), writes the new `releases/current_version.txt`, copies the env file to `releases/<version>.env.bak`.
3. Runs `scripts/backup-postgres.sh` and **aborts** if it fails.
4. `build api worker web` with the new `APP_VERSION` tag.
5. Runs `prisma migrate deploy` in a one-off `api` container.
6. `up -d --no-deps api worker web`, then `up -d caddy`; waits for `api`, `worker`, `web` health.
7. Prints the rollback command: `APP_VERSION=<previous> ./scripts/rollback.sh`.

Caveats read from the scripts:

- **Image tag:** `APP_VERSION` set in `.env.production` overrides the timestamp default, so keep it out of the file (or change it per release). Otherwise old and new images share one tag and rollback has nothing to roll back to.
- **Backup first:** the backup runs on the host via `docker compose exec postgres pg_dump`. It covers Postgres only. MinIO objects are **not** backed up by any script.
- **No automatic health gate beyond container health.** It does not call `/api/health/ready`; check it yourself (section 2.6).
- Migrations run **before** the new containers start; a failed migration aborts the script (`set -e`) and leaves the old containers running, but a partially applied migration may need manual attention.

Operational rules:

- **Drain the worker before restarting it** when you can. Compose gives the worker `stop_grace_period: 120s` and the worker's own graceful-shutdown budget is `WORKER_SHUTDOWN_TIMEOUT_MS=90000`. After that it kills FFmpeg children (`FfmpegService.killAllProcesses`) and exits. A render longer than ~90 s that is mid-flight at update time is interrupted (renders can take up to `VIDEO_RENDER_JOB_TIMEOUT_MS`=900000 / 15 min). The interrupted job is failed or stalled; retry it from the Jobs page or `POST /api/ops/jobs/:id/retry`.
- Prefer a quiet window (no renders or scheduled publishes). Check `GET /api/automation/dashboard` and the Jobs page first. Optionally pause automation first (`POST /api/ops/automation/global-pause` with `{"paused":true}`; note it sets enabled automation configs to `PAUSED`, so they must be re-enabled afterwards).
- Changing `VITE_API_URL` requires `build web` again; restarting is not enough.

## 5. Rollback (`scripts/rollback.sh`)

```bash
APP_VERSION=<previous-tag> ./scripts/rollback.sh   # or rely on releases/previous_version.txt
```

From `scripts/rollback.sh`: takes `APP_VERSION` from the environment, else `releases/previous_version.txt` (refuses `unknown`/empty); runs `up -d --no-deps --no-build api worker web` using the existing tagged images; if the tag is missing it **falls back to rebuilding from the current source tree** under that tag name (so that image would contain the *current* code, not the old code; verify with `docker image ls`); then `up -d caddy`, waits for health and writes `releases/current_version.txt`. It does **not** revert the database and does not check out code.

For a code-level rollback when images are missing, restore the previous source tree yourself and rebuild:

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
# restore the previous source tree (git checkout <previous-sha> or your own copy), then:
APP_VERSION=<tag> $DC build api worker web
APP_VERSION=<tag> $DC up -d --no-deps api worker web
curl -fsS https://<your-domain>/api/health/ready
```

**Database caveat (important).** Prisma migrations are forward-only; there is no `down`. Rolling back code to a version older than the latest applied migration works only if the old code tolerates the newer schema (typically true for purely additive migrations). If a migration was destructive or incompatible:

1. Stop `api` and `worker`.
2. Restore the **pre-deploy** Postgres backup with `scripts/restore-postgres.sh` (`BACKUP_AND_RESTORE.md`). **This loses data written since that backup.** The restore script has **never been run against a real dump**; rehearse it first.
3. Start the old code.

This is why update step 3 (backup first) is not optional. A rollback has not been rehearsed on a VPS.

## 6. Migrations

Production uses **`prisma migrate deploy`** only. It applies pending migrations from `apps/api/prisma/migrations` and never generates or resets anything.

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps api pnpm exec prisma migrate deploy
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm --no-deps api pnpm exec prisma migrate status
```

Never run in production:

| Command | Why not |
| --- | --- |
| `prisma migrate dev` (`pnpm db:migrate`) | Can prompt to **reset the database** on drift |
| `prisma migrate reset` | Drops all data |
| `prisma db push` (`pnpm db:push`) | Bypasses migration history; can drop columns/data |

Current migrations (12): `init`, `auth_and_foundation`, `phase3_core_platform` … `phase11_analytics`, `phase12_ops` (adds the ops/alerting tables, e.g. `SystemAlert`, `BackupRecord`). Run `ls apps/api/prisma/migrations` for the authoritative list.

**Review every new migration for destructive SQL before deploying it.** Today only `20260314190000_auth_and_foundation` contains `DROP TABLE … CASCADE` (it drops the legacy `users`, `stories`, `jobs`, etc. from the `init` migration, with the comment "no production data yet"). That is harmless on a fresh database, because all migrations run in order against an empty schema, but it is the kind of statement that destroys data if it were ever applied to a populated database. Check new migrations with:

```bash
grep -nE 'DROP (TABLE|COLUMN)|TRUNCATE|DELETE FROM|ALTER COLUMN .* TYPE' apps/api/prisma/migrations/*/migration.sql
```

## 7. Reboot recovery

After a VPS reboot (planned or not), the stack should come back **without manual action**, provided:

- Docker is enabled at boot (`systemctl is-enabled docker` → `enabled`).
- Services use `restart: unless-stopped` (set on every service in `docker-compose.prod.yml`). `unless-stopped` means a container that was manually stopped stays stopped. **Reboot recovery has not been rehearsed.**
- Data lives in named volumes (survives reboots).

Start-up order is enforced by `depends_on` with `condition: service_healthy` (`api`/`worker` wait for `postgres`, `redis`, `minio`; `web` waits for `api`; `caddy` waits for `api` and `web`).

**Post-reboot checklist**

```bash
uptime
docker compose -f docker-compose.prod.yml --env-file .env.production ps    # all Up/healthy?
curl -fsS https://<your-domain>/api/health/ready
docker compose -f docker-compose.prod.yml --env-file .env.production logs --tail=50 worker api caddy
df -h                                                        # disk OK?
```

Then check application state:

1. **Queues.** Redis uses AOF, so queued jobs normally survive. BullMQ re-activates stalled jobs from interrupted workers. Open the **Jobs** page: look for jobs stuck in `PROCESSING`/`QUEUED` that no worker is touching, then retry or cancel them (`POST /api/jobs/:id/retry` or `/cancel`).
2. **Automation.** The API's minute-by-minute cron calls `recoverStalled()` automatically. Review `GET /api/automation/dashboard` and executions.
3. **Scheduled publications.** Publications whose time passed during downtime are picked up by the publish scheduler on the next tick. Check the Publishing page for `FAILED`/`ACTION_REQUIRED` items, and for double-posting risk, review before re-triggering manually.
4. **Certificates.** Caddy re-uses stored certificates (its data volume must persist, the same "never wipe volumes" rule).
5. **Backups.** Confirm the next scheduled backup ran (`BACKUP_AND_RESTORE.md`). No scheduler is installed by the scripts; backups run only if you add host cron or start the optional `backup` service.
6. **Alerts.** Open `/system` (admin) and review open alerts.

If Docker itself fails to start or a volume is corrupted, go to `INCIDENT_RESPONSE.md` → "Total VPS loss / restore".

## 8. Routine operations

```bash
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC ps
$DC logs -f --tail=200 api
$DC restart worker          # safe; see grace period note
docker stats --no-stream                                           # CPU/memory
docker system df                                                   # image/volume/build-cache usage
docker image prune -f                                              # dangling images only; NEVER add --volumes
```

## 9. Known issues to resolve before real users

These come from reading the current code and scripts. Details in `PRODUCTION_ARCHITECTURE.md`.

1. **Browser media URLs (unresolved).** The API signs MinIO download/upload URLs using the internal `MINIO_ENDPOINT` (`http://minio:9000`). With MinIO unpublished, the browser cannot reach them. `MINIO_PUBLIC_URL` is applied only in two worker processors (image and video generation), and Caddy's `/media-proxy/*` route plus `SOCIAL_PUBLIC_MEDIA_BASE_URL` address the provider/social fetch case, not browser previews. **Treat media preview/download in the UI as not working in the locked-down topology until verified.**
2. **Open registration** and **roles enforced only on `/api/ops/*`**. Other endpoints do not check roles. See `SECURITY.md`.
3. **`APP_VERSION` in the env file defeats tag-based rollback** (see section 2.4).
4. **`POST /api/ops/backup` is unlikely to work in the production API container.** It runs `../../scripts/backup-postgres.sh` relative to the API working directory, but `Dockerfile.api` copies only `apps/api`, `packages` and `node_modules` (no `scripts/`, no Docker CLI, and the script uses `docker compose exec`). Expect a `FAILED` backup record and a `backup_failed` alert. Run backups from the host.
5. **The optional `backup` compose service (profile `ops`)** runs `backup-postgres.sh` inside a `postgres:16-alpine` container, which mounts only that one script (not `scripts/lib/common.sh`, no env file, no Docker CLI). As written it looks unable to run. Use host cron instead (see `BACKUP_AND_RESTORE.md`) until this is fixed and tested.
6. **Disk metrics** come from `df -P /` inside the API container and the overview endpoint's disk figure is a placeholder (`usedPercent: 0`); host/volume disk usage needs an external check.
7. **Single VPS, single instance.** The five API crons are guarded by Redis locks (`lock:cron:*`), so extra API replicas should not double-run them, but multi-replica operation has not been tested, and there is no HA for Postgres, Redis or MinIO.
8. **Nothing here has been tested on a VPS** and no live provider has been exercised.
