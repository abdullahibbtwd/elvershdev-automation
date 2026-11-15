# Backup and Restore

> **Status.** `scripts/backup-postgres.sh` and `scripts/restore-postgres.sh` (plus `scripts/lib/common.sh`) **exist in the repo** (Phase 12). They cover **PostgreSQL only**. There is **no MinIO backup script**, no off-VPS copy automation, and no scheduler installed by the scripts. This document describes what the scripts actually do (read from the source) and gives manual commands against the production compose file.
>
> **[PHASE 12.1 local drill completed 2026-11-15]** Postgres dump → gzip integrity → openssl encrypt/decrypt → restore into scratch DB `aivideo_restore_drill` (not production) with matched `users` count. MinIO: 221 objects mirrored and restored into scratch bucket `ai-video-restore-drill` (COUNT_MATCH). See `PHASE12_1_COMPLETION_REPORT.md`. **VPS restore still Not yet verified.**
>
> **Single-VPS reality.** Default backups land in `./backups/postgres` on the same disk as the data. A disk or VPS loss destroys data and backups together unless you copy them off the host yourself.

## 1. What must be backed up

| Data | Where | Criticality | Method |
| --- | --- | --- | --- |
| **PostgreSQL**: users, stories, scenes, jobs, renders, publications, analytics, **encrypted channel credentials** | volume `postgres_data` | **Critical** | Logical dump with `pg_dump` via `scripts/backup-postgres.sh` (section 3) |
| **MinIO objects**: images, clips, narration audio, final MP4/SRT, uploads | volume `minio_data`, bucket `MINIO_BUCKET` (`ai-video`) | High. Partly regenerable, but regeneration **costs provider money** and loses manual edits/selections. | Bucket mirror (section 5), **manual only, no script** |
| **`.env.production`** (secrets) and `releases/*.env.bak` copies | `/opt/aivideo/.env.production` | **Critical** | Password manager, **not** with DB dumps. `CREDENTIALS_ENCRYPTION_KEY` loss makes stored OAuth tokens unreadable even with a perfect DB backup. |
| **Caddy data** (certificates) | volume `caddy_data` (and `caddy_config`) in `docker-compose.prod.yml` | Low. Re-issued automatically, but watch Let's Encrypt rate limits. | Optional |
| **Redis** (`redis_data`, AOF) | volume | Low. Queue state is transient. Jobs can be re-queued from Postgres `GenerationJob` rows. | Not backed up by default |
| Code and compose files | git | Recoverable from the git remote | Keep the remote healthy |

## 2. Targets: RPO and RTO

These are **documented targets for a single-VPS deployment, not measured results.**

| Metric | Target | Basis |
| --- | --- | --- |
| **RPO** (max acceptable data loss) | **24 hours** | One scheduled daily Postgres backup. Everything written since the last good backup is lost on restore. |
| **RTO** (time to restore service) | **~1–2 hours** | New VPS provisioning, Docker install, `.env` restore, DB restore, bring-up, DNS. Assumes an off-VPS backup copy and a prepared runbook. Longer if the MinIO dataset is large (download time). |

To tighten RPO, increase backup frequency (for example every 6 hours). Postgres WAL archiving / PITR is out of scope for this single-VPS design.

**What these numbers do not cover:** a backup that exists only on the VPS disk. If the VPS or disk is lost, those backups are lost with it, and RPO/RTO are effectively unbounded. **An off-VPS copy is mandatory** for the targets to mean anything.

## 3. PostgreSQL backup

### 3.1 `scripts/backup-postgres.sh` **[PHASE 12]**

Run from the host:

```bash
cd /opt/aivideo
./scripts/backup-postgres.sh
```

What it does (from the source):

1. Requires `.env.production` and sources it (override with `ENV_FILE`; compose file via `COMPOSE_FILE`).
2. Runs `docker compose -f docker-compose.prod.yml --env-file .env.production exec -T postgres pg_dump -U $POSTGRES_USER -d $POSTGRES_DB --no-owner --format=plain | gzip -c` into `BACKUP_DIR` (default `<repo>/backups/postgres`) as `aivideo-<UTC timestamp>.sql.gz`.
3. Fails if the file is empty or `gzip -t` fails. It does **not** test that the SQL actually restores.
4. If `BACKUP_ENCRYPT_PASSPHRASE` is set: encrypts with `openssl enc -aes-256-cbc -pbkdf2 -salt` to `aivideo-<ts>.sql.gz.enc` and deletes the unencrypted file. (The passphrase is passed on the `openssl` command line, so it is briefly visible in the process list on the host.)
5. Writes `last_success.json` (`file`, `createdAt`, `bytes`) in the backup dir.
6. Deletes `aivideo-*.sql.gz` / `.sql.gz.enc` older than `BACKUP_RETENTION_DAYS` (default 14).
7. Prints a reminder to copy off-VPS and not to trust it until a restore test succeeds.

It does **not**: copy off-VPS, alert on failure, back up MinIO, or schedule itself. `update.sh` calls it before every update and aborts if it fails. The `./backups/postgres` directory is also bind-mounted into the postgres container at `/backups` (the script itself writes on the host side).

**Format note:** the dump is **plain SQL, gzipped**, not `pg_dump -Fc`. Restore it with `psql`, **not** `pg_restore`.

Schedule it with host `cron` or a systemd timer (daily, off-peak, avoiding render windows):

```cron
# /etc/cron.d/aivideo-backup  (example; nothing installs this for you)
30 3 * * * deploy cd /opt/aivideo && ./scripts/backup-postgres.sh >> /var/log/aivideo-backup.log 2>&1
```

Other triggers and their caveats:

- `POST /api/ops/backup` (admin, body `{"confirm":"BACKUP"}`, also a button on `/system`) runs the same script **from inside the API container**. The production API image does not contain `scripts/` or the Docker CLI, so expect it to **fail** (recorded as a `FAILED` `BackupRecord` plus a `backup_failed` alert). Use host cron instead.
- The optional `backup` service (profile `ops`: `docker compose -f docker-compose.prod.yml --profile ops up -d backup`) loops the script every `BACKUP_INTERVAL_SECONDS` inside a `postgres:16-alpine` container that mounts only `backup-postgres.sh` (no `lib/common.sh`, no env file, no Docker CLI). As written it appears unable to run; **do not rely on it** until fixed and tested.

### 3.2 Manual backup (equivalent, same format)

```bash
cd /opt/aivideo
set -a; . ./.env.production; set +a
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
mkdir -p backups/postgres
STAMP=$(date -u +%Y%m%dT%H%M%SZ)

$DC exec -T postgres \
  pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --format=plain \
  | gzip -c > "backups/postgres/aivideo-$STAMP.sql.gz"

# sanity checks
test -s "backups/postgres/aivideo-$STAMP.sql.gz" && gzip -t "backups/postgres/aivideo-$STAMP.sql.gz" && echo OK
gunzip -c "backups/postgres/aivideo-$STAMP.sql.gz" | head -20
```

Do **not** copy the `postgres_data` directory while Postgres runs; it will not be consistent.

### 3.3 Retention

| Tier | Suggestion |
| --- | --- |
| Local on VPS | 7–14 daily dumps (`BACKUP_RETENTION_DAYS`). Enough for "oops" recovery; disk-cheap for a small DB. |
| Off-VPS | 14 daily + 8 weekly + 6 monthly (adjust to budget/compliance). |

Prune only **after** a newer backup is verified. Monitor `BACKUP_DIR` size against `DISK_USAGE_ALERT_PERCENT`.

## 4. Encryption (optional but recommended for off-VPS copies)

Dumps contain **encrypted** social tokens (AES-256-GCM), password hashes (bcrypt), refresh-session hashes, and all user content. They are sensitive even though credentials are encrypted at the application layer, and the key lives in `.env.production`.

The backup script supports one method: set `BACKUP_ENCRYPT_PASSPHRASE` and it produces `.sql.gz.enc` using OpenSSL (`aes-256-cbc`, `-pbkdf2`, salted). Manual decrypt:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 \
  -in backups/postgres/aivideo-<STAMP>.sql.gz.enc -out aivideo-<STAMP>.sql.gz \
  -pass env:BACKUP_ENCRYPT_PASSPHRASE
gzip -t aivideo-<STAMP>.sql.gz
```

Rules:

- Keep the passphrase **off the VPS backup location**, e.g. in a password manager. A backup you cannot decrypt is no backup. `.env.production` (and `releases/*.env.bak`) on the same VPS does not count as off-VPS storage.
- Test decryption as part of the restore drill.
- Prefer transport/storage encryption on the off-VPS target as well.
- This is not authenticated encryption (AES-CBC); it protects confidentiality only.

## 5. MinIO backup strategy

MinIO here is **single node, single drive, no versioning, no replication**. There is no built-in protection against disk loss or accidental deletion. **No script in the repo backs up MinIO**; `deploy.sh` only creates an empty `backups/minio` directory. Everything in this section is manual and unverified.

**Recommended approach.** Mirror the bucket to a different host/provider on a schedule using `mc` (MinIO Client) or `rclone`, run **inside the Docker network** (MinIO is not published to the host):

```bash
# one-off mirror to another S3-compatible target, using a temporary container on the compose network
docker run --rm --network aivideo-prod_aivideo_internal \
  -e MC_HOST_src="http://$MINIO_ACCESS_KEY:$MINIO_SECRET_KEY@minio:9000" \
  -e MC_HOST_dst="https://<ACCESS>:<SECRET>@<offsite-s3-host>" \
  minio/mc mirror --overwrite src/ai-video dst/<offsite-bucket>/ai-video
```

(`docker-compose.prod.yml` sets project name `aivideo-prod` and network `aivideo_internal`, so the network should be `aivideo-prod_aivideo_internal`; confirm with `docker network ls`. Pin the `minio/mc` image tag in real use.)

Guidance:

- Use `mc mirror` **without `--remove`** (or enable versioning/object-lock on the target) so an accidental delete or bug does not propagate to the backup.
- Frequency: daily is consistent with the 24h RPO. Mirror is incremental, so cost is mainly the first run.
- **Prioritise final renders** (`video-render-storage` outputs) and approved narration/selected visuals; intermediate attempts are the most reproducible. If bandwidth is constrained, back up by prefix, but this repo's key layout should be inspected first (`storageKey` on `MediaAsset`) before filtering.
- DB and MinIO backups are **not atomic with each other**. Restoring a DB from T1 with objects from T2 can leave `MediaAsset` rows pointing at missing objects (restore from older DB) or orphan objects (restore from newer objects). Prefer mirroring MinIO shortly **after** the DB dump and accept small inconsistencies. After restore, run a reconciliation check (section 7).
- Alternative for the future: a second MinIO or managed S3 as the primary store removes this problem. That is an architecture change and is not part of the current Phase 12 work.

## 6. Restore

> **Restore rule:** never restore over a live production database to "test" it. Always rehearse on a scratch database or a scratch VPS.

### 6.1 Restore drill into a scratch database (required before trusting backups)

Do this **before** go-live and then on a schedule (for example quarterly and after any major change). This drill deliberately avoids `restore-postgres.sh` (which drops the live schema) and restores into a scratch database:

```bash
cd /opt/aivideo
set -a; . ./.env.production; set +a
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
DUMP=backups/postgres/aivideo-<STAMP>.sql.gz       # decrypt .enc first (section 4)

# 1. create a scratch DB (does NOT touch $POSTGRES_DB)
$DC exec -T postgres createdb -U "$POSTGRES_USER" aivideo_restore_test

# 2. restore (plain SQL -> psql)
gunzip -c "$DUMP" | $DC exec -T postgres \
  psql -U "$POSTGRES_USER" -d aivideo_restore_test -v ON_ERROR_STOP=1

# 3. verify: schema, row counts, migrations table
$DC exec -T postgres psql -U "$POSTGRES_USER" -d aivideo_restore_test -c \
  'SELECT count(*) AS users FROM users;' -c \
  'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;'

# 4. (optional) point a throwaway API at it and log in

# 5. clean up
$DC exec -T postgres dropdb -U "$POSTGRES_USER" aivideo_restore_test
```

Models use `@@map` snake_case table names (for example `users`, `stories`, `refresh_sessions`, plus Phase 12 `system_alerts`, `backup_records`). Run `\dt` on the restored database to see them all. Record the date, backup file, duration, and outcome in `PRODUCTION_CHECKLIST.md`. **Record the time it took, since that is your measured RTO input.** Until this has been done at least once, restore is **Not yet verified**.

### 6.2 Real restore: same VPS (data corruption / bad migration)

#### Using `scripts/restore-postgres.sh` **[PHASE 12]**, read this first

```bash
CONFIRM_RESTORE=YES ./scripts/restore-postgres.sh backups/postgres/aivideo-<STAMP>.sql.gz.enc
```

From the source: requires `.env.production`; takes the dump path as `$1`; refuses to run unless `CONFIRM_RESTORE=YES`; for `.enc` files it decrypts with `BACKUP_ENCRYPT_PASSPHRASE` and checks `gzip -t`; stops `api` and `worker`; runs `DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ...` in `$POSTGRES_DB`; streams the SQL into `psql -v ON_ERROR_STOP=1`; starts `api` and `worker` and waits for health. It is **destructive** and takes no safety backup of the current state.

**Known defect from reading the script (not run):** for an **unencrypted** `.sql.gz` file the script copies the dump to a temp file *without* a `.gz` suffix, so its `*.gz` test fails and it pipes the **still-compressed bytes** into `psql`, after it has already dropped the schema. That path is expected to fail and leave an **empty database**. The `.enc` path renames the decrypted file to `.gz` and should work, but the script's cleanup trap removes only the pre-rename temp path, so a **decrypted plaintext dump may be left in the system temp directory**; delete it manually. Until the script is fixed and tested:

- take a fresh dump of the current state first, and
- use the manual procedure below for unencrypted dumps (or decrypt `.enc` files yourself and use the manual procedure).

The script also leaves `api`/`worker` stopped if it fails partway, and does not re-run `prisma migrate deploy` (the dump includes `_prisma_migrations`; run `migrate deploy` yourself if you restore an older dump and then run newer code).

#### Manual procedure

```bash
cd /opt/aivideo
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
set -a; . ./.env.production; set +a
# 0. take a fresh dump of the current (broken) state first, in case you need it
./scripts/backup-postgres.sh
# 1. stop writers
$DC stop api worker
# 2. recreate the database (destroys current data in that DB only; volumes are NOT removed)
$DC exec -T postgres dropdb   -U "$POSTGRES_USER" "$POSTGRES_DB"
$DC exec -T postgres createdb -U "$POSTGRES_USER" "$POSTGRES_DB"
# 3. restore (decrypt first if .enc)
gunzip -c backups/postgres/aivideo-<STAMP>.sql.gz | $DC exec -T postgres \
  psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1
# 4. align schema with the code version you are about to run
$DC run --rm --no-deps api pnpm exec prisma migrate deploy
# 5. start
$DC up -d api worker
curl -fsS https://<your-domain>/api/health/ready
```

(`dropdb` fails if other sessions are connected; stopping `api`/`worker` first avoids that.) This uses `dropdb`/`createdb`, **not** volume removal. Never "fix" a restore by deleting `postgres_data`.

### 6.3 Real restore: new VPS (total loss)

1. Provision VPS; install Docker; firewall (`DEPLOYMENT.md` sections 2.1–2.2).
2. Clone the repo; restore `.env.production` from the password manager (**same** `CREDENTIALS_ENCRYPTION_KEY`, `JWT_*` secrets).
3. `docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis minio`, create the database if needed, then restore the Postgres dump (6.2 manual steps 3–4).
4. Restore MinIO: `mc mirror` from the off-VPS copy back into `ai-video`.
5. Start `api`, `worker`, `web`, `caddy` (or run `./scripts/deploy.sh`, which also rebuilds images and re-applies migrations).
6. Point DNS at the new VPS (lower the TTL ahead of time if you can).
7. Verify health, log in, open a recent story and render, run the reconciliation in section 7.
8. Review provider webhooks/OAuth redirect URIs (same domain means no changes) and Redis queue state (empty after restore; re-queue anything needed).

## 7. Post-restore verification

- `GET /api/health` and `/api/health/ready` are green (and worker `/health` on port 3101 inside the network).
- You can log in; refresh-token cookie works.
- Open a recent final render and confirm the media preview or download works (see the MinIO presigned-URL known issue in `DEPLOYMENT.md`).
- Social channels: connected channels should still decrypt (proves `CREDENTIALS_ENCRYPTION_KEY` is right). Expired tokens may need reconnecting; see `INCIDENT_RESPONSE.md` → OAuth.
- Look for DB rows referencing objects missing in MinIO (`MediaAsset.storageKey` without an object). Re-generate or mark failed as needed.
- Jobs: anything `PROCESSING` at backup time will be stale; cancel or retry from the Jobs page.
- Automation: review before re-enabling. Keep it **paused** until you have checked that scheduled publications will not double-post content already published after the backup point (posts made between the backup and the failure exist on the social platforms but not in the restored DB).

## 8. Failed backup handling

See `INCIDENT_RESPONSE.md` → "Backup failed". In short: check disk space, check the `postgres` container, run the manual command (3.2), fix the cause, and take a manual backup **before** the next deploy. A failed host-cron backup raises no alert; read `/var/log/aivideo-backup.log` and `backups/postgres/last_success.json`.

## 9. Checklist

- [ ] Daily Postgres backup scheduled (host cron; the scripts install nothing)
- [ ] Off-VPS copy configured and checked (manual; not automated)
- [ ] Encryption decision made (`BACKUP_ENCRYPT_PASSPHRASE`); passphrase stored off-VPS
- [ ] MinIO mirror scheduled (no `--remove`); no repo script exists
- [ ] `.env.production` stored in a password manager
- [ ] **Restore drill executed and timed** (scratch DB, then a scratch VPS at least once)
- [ ] Backup-failure alert tested (only the API-triggered path raises `backup_failed`; no stale-backup alert)
- [ ] `restore-postgres.sh` unencrypted-dump defect fixed and the script rehearsed
- [ ] RPO/RTO targets reviewed with the business owner
