# Incident Response Runbooks

Practical steps for the most likely production incidents on the single-VPS deployment. Tags: **[REPO]** = exists from earlier phases; **[PHASE 12]** = added by Phase 12 and **now present in the repo**. These runbooks have **not** been rehearsed on a VPS, and the single VPS is a single point of failure: if the host is down, nothing here (including alerts) runs.

Conventions used below:

```bash
cd /opt/aivideo
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.production'   # docker-compose.yml is for local dev only
set -a; . ./.env.production; set +a
```

Service names: `postgres`, `redis`, `minio`, `api`, `worker`, `web` (+ `caddy`; optional `backup` under profile `ops`).

## Golden rules

1. **Never `down -v`, `volume rm`, or `volume prune`.** Data volumes are not a troubleshooting tool.
2. **Take a backup before risky repairs** (`BACKUP_AND_RESTORE.md`), if Postgres is up.
3. **Stop the bleeding first** (pause automation, stop spending), then diagnose.
4. **Write down what you did** (time, command, result). It is your timeline and your post-mortem.
5. If in doubt about double-publishing to social platforms, **pause first**.

## First 5 minutes: triage

```bash
dc ps                                           # who is down/unhealthy/restarting?
curl -fsS https://<domain>/api/health/live      # process up?
curl -fsS https://<domain>/api/health           # DB + Redis OK?
df -h; free -m; uptime                          # disk, memory, load
dc logs --since 15m --tail=200 api worker | grep -iE 'error|fail|fatal|ECONN|ENOSPC|OOM'
docker stats --no-stream
```

| Symptom | Go to |
| --- | --- |
| Site/API unreachable or 5xx | [API down](#1-api-down) |
| Jobs not progressing, worker container gone | [Worker down](#2-worker-down) |
| Worker up, but jobs sit in queue | [Queue stalled](#3-queue-stalled) |
| Many `FAILED` jobs, 401/429/5xx from a provider | [Provider failures](#4-provider-failures) |
| `ENOSPC`, disk ≥ threshold | [Disk full](#5-disk-full) |
| Backup alert or missing backup | [Backup failed](#6-backup-failed) |
| Publishing stuck at `ACTION_REQUIRED`/`EXPIRED`/`REVOKED` | [OAuth expired](#7-oauth-expired) |
| Unwanted posting or runaway spend | [Emergency stop](#8-emergency-stop) |
| Bad release | [Rollback](#9-rollback) |
| VPS dead, disk lost | [Total VPS loss](#10-total-vps-loss) |
| Suspected compromise | [Security incident](#11-security-incident) |

---

## 1. API down

**Symptoms:** UI shows errors, `/api/health/live` fails, Caddy returns 502/504.

```bash
dc ps api caddy
dc logs --tail=200 api
curl -s http://localhost:3000/api/health/live || dc exec api node -e "fetch('http://localhost:3000/api/health/live').then(r=>r.text()).then(console.log)"
```

Common causes and fixes:

| Cause | Evidence | Fix |
| --- | --- | --- |
| Missing/invalid env (`CREDENTIALS_ENCRYPTION_KEY` < 32 chars, missing JWT secrets) | Crash on boot with "must be set" | Fix `.env.production`; `dc up -d api` (production API also refuses to start on placeholder secrets: see `validateProductionConfig` in the logs) |
| Postgres unreachable or wrong password | Prisma connection errors, `/api/health` shows `database` down | `dc ps postgres`; `dc logs postgres`; see "Postgres down" below |
| Redis unreachable or auth failure (`NOAUTH`/`WRONGPASS`) | `/api/health` shows `redis` down | Check `REDIS_PASSWORD` matches on server and clients |
| OOM-killed | `docker inspect aivideo-api --format '{{.State.OOMKilled}}'` | Raise limit or free memory (a render may be starving the API) |
| Bad deploy | Errors start right after an update | [Rollback](#9-rollback) |
| Disk full | `ENOSPC` | [Disk full](#5-disk-full) |
| Caddy/cert problem | `dc logs caddy`; cert errors | Check DNS, ports 80/443, rate limits |

Restart (safe; keeps data): `dc restart api`.

**Postgres down:** `dc logs --tail=100 postgres`. If it is crash-looping on corruption or disk-full, free space first. **Do not delete `postgres_data`.** If data is really corrupted, restore from backup (`BACKUP_AND_RESTORE.md` 6.2).

**Impact note:** while the API is down, the automation cron, the publish scheduler and the analytics cron (they run inside the API process) are also stopped. After recovery, the next tick catches up due work. Review for stale items.

---

## 2. Worker down

**Symptoms:** no job progress, `worker` container Exited/restarting. (The worker serves `/health` on `WORKER_HEALTH_PORT` and has a compose healthcheck, but it only proves the process answers HTTP, not that Redis/Postgres are reachable; the ops monitor raises `worker_down` when the API cannot reach it. Also check Docker state, logs and queue symptoms.)

```bash
dc ps worker
dc logs --tail=200 worker
docker inspect aivideo-worker --format 'OOMKilled={{.State.OOMKilled}} Restarts={{.RestartCount}} ExitCode={{.State.ExitCode}}'
```

| Cause | Evidence | Fix |
| --- | --- | --- |
| OOM during FFmpeg render | `OOMKilled=true`, FFmpeg in last logs | Lower `FFMPEG_THREADS`, keep `VIDEO_RENDER_MAX_CONCURRENCY=1`, keep `WORKER_MEMORY_LIMIT_MB` below the container limit (it only warns, it does not throttle), raise `WORKER_MEMORY_LIMIT`/VPS RAM |
| Redis unreachable | connection errors at start | Fix Redis/`REDIS_PASSWORD` |
| Wrong `DATABASE_URL` inside the container | Prisma errors (`localhost:5433` unreachable from a container) | The worker needs `@postgres:5432` (`ENVIRONMENT_VARIABLES.md` section 2) |
| FFmpeg missing | worker logs warn "FFmpeg not found on PATH" | Rebuild the worker image (`Dockerfile.worker` installs ffmpeg) |
| Hung (Up but idle) | No logs, jobs `PROCESSING` forever | `dc restart worker` |

Restart: `dc restart worker`. SIGTERM triggers a graceful close (waits for active jobs); with the default 10s Docker timeout a long render is killed anyway. Expect that job to fail or stall.

**After restart:** BullMQ re-picks stalled jobs. Check the Jobs page: retry jobs left `FAILED`; cancel those that are no longer wanted. For `video-status-polling` (Kling), jobs resume polling; check the provider side to avoid paying twice (retrying a generation job will likely **submit a new, billable Kling task**; confirm in the provider dashboard first).

---

## 3. Queue stalled

**Symptoms:** worker is up, but jobs stay `QUEUED`/`PROCESSING`; backlog age grows.

```bash
dc logs --since 30m worker | tail -100
dc exec redis redis-cli -a "$REDIS_PASSWORD" info memory | head -5
dc exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'bull:*:wait'
dc exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'bull:*:failed'
# length of one queue's wait list (example)
dc exec redis redis-cli -a "$REDIS_PASSWORD" llen bull:video-rendering:wait
dc exec redis redis-cli -a "$REDIS_PASSWORD" zcard bull:video-status-polling:delayed
```

(Queue names from `packages/shared/src/queues`. BullMQ keys use the `bull:` prefix by default.)

| Cause | Fix |
| --- | --- |
| Long render blocking the render queue (`VIDEO_RENDER_MAX_CONCURRENCY=1`) | Expected. Wait, or check the render is progressing (ffmpeg process in `docker top aivideo-worker`) |
| Provider rate-limited/slow | See [Provider failures](#4-provider-failures); lower `KLING_MAX_CONCURRENCY`, `GEMINI_TTS_MAX_CONCURRENCY`, `IMAGE_GENERATION_MAX_CONCURRENCY` (then recreate `worker`) |
| Worker not consuming (hung) | `dc restart worker` |
| Redis out of memory/evicting | Check `used_memory`; clean obsolete completed/failed jobs; add RAM |
| Jobs in DB `PROCESSING` but not in Redis (lost after crash) | Retry from the Jobs page (`POST /api/jobs/:id/retry`) or cancel |
| Automation items stuck | The per-minute cron runs `recoverStalled()`; if the API is up this self-heals. Check `GET /api/automation/executions` and retry (`POST /api/automation/executions/:id/retry`) |

Avoid flushing Redis (`FLUSHALL`) as a first resort: it drops all queued and delayed work (for example in-flight Kling polling), after which DB rows say `PROCESSING` for work no one is doing. If you must, pause automation first, then reconcile every `PROCESSING`/`QUEUED` job via retry/cancel.

---

## 4. Provider failures

**Symptoms:** failed jobs with 401/403 (bad/expired key, billing), 429 (rate limit), 5xx/timeouts (provider outage), or "mock" output appearing unexpectedly.

1. Identify the provider from the failing queue: Gemini (story/scene/motion-analysis/narration planning), TTS (`speech-generation`), fal (`image-generation`, `character-reference-generation`), Kling (`video-generation`, `video-status-polling`, `video-download`), Meta/TikTok/YouTube (`social-*`).
2. Check the provider's status page and your billing/quota.
3. **Stop retry storms and spend:** pause automation (`POST /api/automation/pause`); lower the relevant `*_MAX_CONCURRENCY`; optionally set the monthly spend guard (`KLING_MAX_MONTHLY_SPEND_USD`, `GEMINI_TTS_MAX_MONTHLY_SPEND_USD`).
4. For auth errors: rotate/replace the key in `.env.production`, then `dc up -d --force-recreate api worker` (env is read at start).
5. For outages: leave jobs failed or queued; retry after recovery. Retrying creates new paid provider calls; do it deliberately.
6. Verify the **mock flags**: a provider that silently falls back to mock (`GEMINI_USE_MOCK`, `FAL_USE_MOCK`, `KLING_USE_MOCK`, `GEMINI_TTS_USE_MOCK`, or empty `GEMINI_API_KEY`/`FAL_API_KEY`) produces fake content that can then be rendered and published. Check `.env.production` after any config change.
7. Cost visibility: Analytics → Costs and `ProviderUsage` hold **estimates** from configurable prices. They are not invoices; reconcile with the provider's billing dashboard.

---

## 5. Disk full

**Symptoms:** `ENOSPC`, Postgres refusing writes, MinIO failing uploads, containers crash-looping. The ops monitor alerts at `DISK_USAGE_ALERT_PERCENT` (it measures the API container's root filesystem, so also check host `df -h`).

```bash
df -h
docker system df
sudo du -xh /var/lib/docker --max-depth=2 2>/dev/null | sort -h | tail -15
sudo du -sh /var/backups/aivideo 2>/dev/null     # or your BACKUP_DIR
dc exec worker sh -c 'du -sh /tmp; ls -lt /tmp | head'
```

Safe cleanup, in order:

1. **Old local backups** beyond retention (after confirming the newest is good and copied off-VPS).
2. **Stale temp files** in the worker container (`/tmp/ai-video-*`, FFmpeg work dirs, `social-publish-*`). `CleanupService` does this hourly for files older than `TEMP_CLEANUP_MAX_AGE_HOURS` (default 24 h; `TEMP_CLEANUP_DISABLED` turns it off; `POST /api/ops/cleanup/temp` with `{"confirm":"CLEANUP"}` runs it now). Manual: delete only files older than ~2h so you do not break an active render:
   ```bash
   dc exec worker sh -c 'find /tmp -mindepth 1 -mmin +120 -delete'
   ```
3. **Docker junk:** `docker image prune -f` (dangling only), `docker builder prune -f`. **Never** `docker system prune --volumes`.
4. **Container logs** (no rotation configured by default): `sudo truncate -s 0 /var/lib/docker/containers/<id>/<id>-json.log` and then add `max-size`/`max-file` logging options.
5. MinIO content: delete failed/obsolete attempts through the app (media delete API) rather than from disk. If the disk is truly too small, resize the VPS volume.

Afterwards: confirm Postgres is healthy (`dc logs postgres`), restart crash-looping services, check jobs that failed with `ENOSPC` and retry them.

---

## 6. Backup failed

**Symptoms:** `backup_failed` alert (raised **only** when `POST /api/ops/backup` fails; host-cron failures raise no alert and there is no stale-backup alert), `scripts/backup-postgres.sh` non-zero exit, no recent file in `backups/postgres` (`BACKUP_DIR`).

```bash
ls -lh backups/postgres | tail; cat backups/postgres/last_success.json   # or BACKUP_DIR
df -h
dc ps postgres
tail -n 100 /var/log/aivideo-backup.log
```

Typical causes: disk full, `postgres` container down, wrong `POSTGRES_USER`/`POSTGRES_DB`/password, encryption passphrase file missing, off-VPS target unreachable/credentials expired, cron not running.

Fix the cause, then take a **manual backup immediately** (`BACKUP_AND_RESTORE.md` 3.2) and verify (`gzip -t` on the file; the dump is plain SQL, not `pg_restore` format). Until a good backup exists, **freeze deployments and migrations**. If the failure persisted > 24h, you are outside the RPO target, so record it.

---

## 7. OAuth expired

**Symptoms:** publications `ACTION_REQUIRED`/`FAILED`, channel status `EXPIRED`/`REVOKED`/`MISSING_PERMISSIONS`/`ERROR`, provider errors 190 (Meta), `invalid_grant` (YouTube), token errors (TikTok).

Causes: user revoked access, password changed at the platform, token lifetime elapsed and refresh failed, app permissions/review status changed, **`CREDENTIALS_ENCRYPTION_KEY` changed** (tokens undecryptable), wrong `*_REDIRECT_URI`.

Steps:

1. Open **Channels**; reconnect the affected channel (new OAuth flow stores fresh encrypted tokens).
2. If **all** channels fail at once, suspect the encryption key or provider app config: confirm `CREDENTIALS_ENCRYPTION_KEY` is unchanged vs. your password-manager copy.
3. Confirm `*_REDIRECT_URI` matches what is registered at the provider and uses HTTPS on the production domain.
4. `social-token-maintenance` is the queue that refreshes tokens; check worker logs for it.
5. After reconnecting, review queued/scheduled publications **before** re-triggering to avoid double posts.
6. TikTok: public posting requires an audited app (`TIKTOK_AUDITED`); unaudited apps are restricted by TikTok regardless of our config.

---

## 8. Emergency stop

Use when the system is posting or spending in a way you do not want.

**Per-user automation kill switch [REPO]:**

- UI: Automation → emergency stop, or `POST /api/automation/emergency-stop` (authenticated as the user). Sets `AutomationRunMode.EMERGENCY_STOP`, cancels that user's queued generation jobs, and marks processing jobs `INTERRUPTED` (external provider work may still finish). Audit: `config.emergency_stop`.
- `POST /api/automation/pause` pauses (reversible via `resume`).

**Global emergency stop [PHASE 12.1] (ADMIN):**

- `POST /api/ops/emergency-stop` — persists `system:automation:emergencyStop`, forces all configs to `EMERGENCY_STOP`, pauses generation/publish queues, removes waiting BullMQ jobs, cancels cancellable DB jobs, marks running work `INTERRUPTED` (honest — not claimed cancelled if still external), records `interrupted_tasks` with `republish_blocked`, publishes Redis `ops:ffmpeg-kill` for local FFmpeg SIGKILL, attempts Kling cancel where supported (usually unsupported).
- `POST /api/ops/emergency-stop/clear` — clears the flag (optionally `resumeQueues: true`). Does **not** auto-republish interrupted publications.
- `GET /api/ops/emergency-stop` — current flag.

**Global kill switches (operator, no code change):**

```bash
# 1. Stop scheduler + HTTP background roles
#    AUTOMATION_CRON_DISABLED=true  ANALYTICS_CRON_DISABLED=true
dc up -d --force-recreate api api-scheduler

# 2. Stop job processing entirely (jobs stay queued in Redis; nothing runs, nothing spends)
dc stop worker

# 3. Stop everything user-facing but keep data (maintenance mode)
dc stop api api-scheduler worker web
```

Also:

- Set all `*_USE_MOCK=true` and recreate `api api-scheduler worker` to stop real calls while keeping the app usable.
- Revoke platform access at the provider console if posts are unauthorized.
- `POST /api/ops/automation/global-pause` pauses automation without the full interrupt/cancel path; prefer emergency-stop for runaway spend/publish.
- `ROLLOUT_STAGE` A/B skips planning; it does **not** stop manual publishing from the UI.

**Recovery:** clear emergency stop only after reviewing `interrupted_tasks` and queue state; do not republish interrupted publications until reconciled; resume automation only after confirming.

---

## 9. Rollback

Full procedure: `DEPLOYMENT.md` section 5. Quick form:

```bash
git log --oneline -n 10
git checkout <previous-good-sha>
dc build
dc up -d --no-deps api worker web
curl -fsS https://<domain>/api/health
```

Reminder: **code rollback does not undo database migrations.** If the bad release shipped a migration that the old code cannot tolerate: stop `api`/`worker`, restore the pre-deploy Postgres backup (data since then is lost), then start the old code. Pause automation before rollback to avoid new work being created in a half-state.

---

## 10. Total VPS loss

Follow `BACKUP_AND_RESTORE.md` 6.3. Prerequisites you must already have: off-VPS Postgres backup, MinIO mirror, `.env.production` copy (esp. `CREDENTIALS_ENCRYPTION_KEY`), DNS access, access to the git remote. Target RTO ~1–2 hours (not yet measured).

After restore: keep automation **paused**, check for publications made between the last backup and the failure (they exist on the platforms but not in the DB), then resume deliberately.

---

## 11. Security incident

1. **Contain:** `dc stop worker` (stop spending/publishing); pause automation; if needed take the site offline (`dc stop caddy web api`).
2. **Rotate secrets:** `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (forces all re-login), `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `MINIO_*`, all provider API keys and OAuth client secrets. Revoke connected channels at Meta/TikTok/YouTube. Rotating `CREDENTIALS_ENCRYPTION_KEY` means existing tokens are lost; users must reconnect (and stored tokens that may have leaked should be revoked at the platforms).
3. **Preserve evidence:** copy logs (`dc logs > incident-$(date +%F).log`), note `AutomationAuditLog` and publication history.
4. **Investigate:** unknown users (`users` table), unexpected channels, unexpected posts, SSH logins (`last`, `journalctl -u ssh`), open ports (external scan).
5. **Recover:** rebuild from known-good code; restore data only if tampered.
6. **Afterwards:** write a post-mortem; close the gap that allowed it (open registration, public ports, weak secrets, etc.).

## Post-incident

- Record: timeline, root cause, impact, what worked, what to change.
- Update the relevant doc or alert (for example add a missing alert type).
- If the incident revealed a backup/restore gap, run a restore drill.
