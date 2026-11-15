# Monitoring and Alerts

What to watch, how, and which alerts exist. Tags: **[REPO]** = present in the code from earlier phases; **[PHASE 12]** = added by Phase 12 and **now present in the repo** (read from the code; covered by local unit/e2e tests only). **[GAP]** = still missing or unverified. **Nothing here has been tested on a VPS, and no alert email has been delivered to a real mailbox.**

## Principle

Everything runs on one VPS. **A dead VPS cannot send its own alert emails.** Pair in-stack alerting (SMTP) with at least one **external** uptime check against the public URL.

## 1. Health endpoints

### API

| Endpoint | Status | Behaviour | Use for |
| --- | --- | --- | --- |
| `GET /api/health/live` | **[PHASE 12]** | Static JSON: `status`, `service: "api"`, `environment`, `version` (`APP_VERSION`), `timestamp`. No dependency checks. | Liveness: Docker `HEALTHCHECK` / compose healthcheck, external uptime monitor. |
| `GET /api/health` | **[REPO]** | Terminus check of Postgres (`SELECT 1`), Redis (`PING`) and MinIO. 503 with details if any fails. Does not check the worker or queue depth. | Quick dependency check; used by `deploy.sh` (inside the `api` container). |
| `GET /api/health/ready` | **[PHASE 12]** | Same three checks as `/api/health` (database, redis, minio). | Readiness gate for you and external checks. **`update.sh` and `deploy.sh` do not call it** (they rely on container health and `/api/health`). |

All three are `@Public()` (no JWT). Routes are under the global prefix, so the full path is `/api/health…`. Caddy proxies all of `/api/*`, so `/api/health` and `/api/health/ready` (which reveal dependency failure messages) are publicly reachable; `/api/health/live` is the one to hand to uptime monitors.

### Worker

| Endpoint | Status | Behaviour |
| --- | --- | --- |
| `GET /health/live` on `WORKER_HEALTH_PORT` (default `3101`) | **[PHASE 12.1]** | Process liveness only. |
| `GET /health` and `/health/ready` | **[PHASE 12.1]** | Deep checks: Redis PING, Postgres `SELECT 1`, MinIO `HeadBucket`, plus ffmpeg/queues/memory. `/health/ready` returns 503 if any dependency is down. |

**[PHASE 12.1]** Compose profile `ops` includes an external `monitor` service that curls API/worker readiness independently of Nest. Ops monitor also alerts on queue backlog, daily provider spend, and stale backups.

The API polls this endpoint (`http://${WORKER_HEALTH_HOST}:${WORKER_HEALTH_PORT}/health`, 3 s timeout) for the `worker` component in `/api/ops/overview` and for the `worker_down` alert.

Examples:

```bash
curl -fsS https://<domain>/api/health/live
curl -fsS https://<domain>/api/health
curl -fsS https://<domain>/api/health/ready
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
$DC exec worker curl -fsS http://127.0.0.1:3101/health     # the worker image installs curl
```

### Container healthchecks (`docker-compose.prod.yml`, **[PHASE 12]**)

| Service | Check |
| --- | --- |
| `postgres` | `pg_isready -U $POSTGRES_USER -d $POSTGRES_DB`, every 10 s |
| `redis` | `redis-cli -a $REDIS_PASSWORD ping`, every 10 s |
| `minio` | `curl -f http://localhost:9000/minio/health/live`, every 15 s |
| `api` | `curl -fsS http://127.0.0.1:3000/api/health/live`, every 30 s (45 s start period) |
| `worker` | `curl -fsS http://127.0.0.1:3101/health`, every 30 s (45 s start period) |
| `web` | `wget -qO- http://127.0.0.1:8080/healthz`, every 30 s |
| `caddy` | none |

`docker compose ps` shows `healthy`/`unhealthy`. The `Dockerfile.{api,worker,web}` images also define their own `HEALTHCHECK`. The `api` healthcheck uses `/live`, so it does not go unhealthy when Postgres/Redis/MinIO are down; the ops monitor alerts on those instead.

## 2. Ops dashboards

| Dashboard | Status | What it shows |
| --- | --- | --- |
| Jobs page (`/jobs`, `GET /api/jobs`) | **[REPO]** | Generation jobs with status `PENDING/QUEUED/PROCESSING/COMPLETED/FAILED/CANCELLED`, with retry/cancel. |
| Automation dashboard (`/automation`, `GET /api/automation/dashboard`), executions, calendar | **[REPO]** | Automation mode (`ENABLED/PAUSED/EMERGENCY_STOP`), plans, scheduled work, executions. |
| Analytics → Costs (`AnalyticsCostsPage`) and `ProviderUsage` | **[REPO]** | **Estimated** provider spend (configurable prices, not invoices). |
| Publishing page | **[REPO]** | Publication status incl. `FAILED`, `ACTION_REQUIRED`. |
| Notifications (in-app, `Notification` model, `dedupeKey`) | **[REPO]** | Per-user in-app notifications, deduplicated per `(userId, dedupeKey)`. |
| **System Ops page** (`/system`, shown in the nav for admins) | **[PHASE 12]** | Environment/version/rollout stage, component status, queues, alerts, failed jobs (with retry), last backup. Actions wired in the page: run diagnostics, trigger backup (`POST /api/ops/backup`, see the container caveat in `DEPLOYMENT.md` known issues), set rollout stage A–E, global automation pause. Queue pause/resume, temp cleanup and promote-admin exist only as API endpoints. |
| `GET /api/ops/*` (ADMIN role) | **[PHASE 12]** | `overview`, `queues`, `jobs/active`, `jobs/failed`, `alerts`, `providers`, `rollout` (GET/POST), `queues/pause`, `queues/resume`, `jobs/:id/retry`, `backup` (needs `{"confirm":"BACKUP"}`), `diagnostics`, `automation/global-pause`, `cleanup/temp` (needs `{"confirm":"CLEANUP"}`), `promote-admin`. Enforced by `RolesGuard` + `@Roles(ADMIN)` on the controller; the local e2e spec checks that an editor is rejected and an admin accepted. Other API routes still do not check roles. |

**[GAP]** The overview's disk figure is a placeholder (`usedPercent: 0`); real disk usage is only evaluated by the ops monitor cron (`df -P /` inside the API container). `lastSuccessfulBackup` reflects only `BackupRecord` rows, which are written by `POST /api/ops/backup`, **not** by host-cron backups.

For anything not covered, use:

```bash
docker stats --no-stream
df -h && docker system df
docker compose -f docker-compose.prod.yml logs --since 1h api worker | grep -iE 'error|fail|stalled'
docker compose -f docker-compose.prod.yml exec redis redis-cli -a "$REDIS_PASSWORD" --scan --pattern 'bull:*:wait' | head
```

## 3. What to monitor

| Signal | Why | Where |
| --- | --- | --- |
| Public URL up (`/api/health/live`, over HTTPS) | Whole-stack availability, TLS validity | **External** uptime monitor (recommended; not part of the repo) |
| Container state / restarts | Crash loops | `docker compose ps`, `docker inspect --format '{{.RestartCount}}'` |
| Worker liveness | Crashed worker | **[PHASE 12]** worker `/health` + ops-monitor `worker_down` alert (process-level only, see worker gap above) |
| Queue depth and age of oldest waiting job | Stalled queue, rate-limited provider | **[PHASE 12]** `/system` and `/api/ops/queues` show counts; **[GAP]** no age-of-oldest-job metric or stalled alert |
| Failed-job rate | Provider outage, bad config | Jobs page, `/api/ops/jobs/failed`, `queue_failures` alert (> 25 failed in a queue) |
| Disk usage % | Disk full is the most likely self-inflicted outage | **[PHASE 12]** `disk_usage` alert at `DISK_USAGE_ALERT_PERCENT` (container-root `df`; **[GAP]** may not reflect host or volume usage) |
| Memory | OOM during render | **[PHASE 12]** `memory_pressure` alert at `MEMORY_ALERT_PERCENT` (host memory as seen from the API container); worker logs a warning and `/health` flags `pressure` at 90% of `WORKER_MEMORY_LIMIT_MB` |
| Backup freshness and success | Silent backup failure | **[GAP]** `backup_failed` fires only when `POST /api/ops/backup` fails. There is **no stale-backup check**. Check `backups/postgres/last_success.json` or your cron log yourself. |
| Provider errors and spend | 401/429/5xx; budget guards (`KLING_MAX_MONTHLY_SPEND_USD`, `GEMINI_TTS_MAX_MONTHLY_SPEND_USD`) | Logs, `ProviderUsage`, Analytics → Costs. **[GAP]** no provider-failure alert is wired |
| OAuth/channel health | Expired tokens block publishing | **[PHASE 12]** `oauth_expired` alert; token-maintenance cron (every 30 min) enqueues refresh jobs for channels expiring within an hour or in `EXPIRED`/`ERROR` state |
| TLS certificate expiry | Caddy renewal failure | External monitor with cert check |

## 4. Alert types **[PHASE 12]**

Alerts are stored in the `system_alerts` table (`SystemAlert`), visible at `/system` and `GET /api/ops/alerts`, and emailed when SMTP is configured. The per-minute **ops monitor** (`OpsMonitorCron`, Redis-locked as `cron:ops-monitor`) evaluates the conditions below and resolves them automatically when they clear. `AlertType` also declares `api_down`, `stalled_jobs`, `publish_failures`, `budget_limit`, `provider_spend`, `provider_failure`, but **nothing fires them yet [GAP]**.

| Alert (`type`, `dedupeKey`) | Trigger | Severity | Fired by | Runbook |
| --- | --- | --- | --- | --- |
| `database_failure` (`infra:database`) | `SELECT 1` fails | Critical | ops monitor | `INCIDENT_RESPONSE.md` → API down |
| `redis_failure` (`infra:redis`) | queue counts call fails | Critical | ops monitor | → API/Redis |
| `minio_failure` (`infra:minio`) | storage ping fails | Critical | ops monitor | → MinIO |
| `worker_down` (`infra:worker`) | worker `/health` unreachable or non-200 | Critical | ops monitor | → Worker down |
| `disk_usage` (`infra:disk`) | `df -P /` ≥ `DISK_USAGE_ALERT_PERCENT` (Critical at ≥ 95%) | Warning/Critical | ops monitor | → Disk full |
| `memory_pressure` (`infra:memory`) | host memory used % ≥ `MEMORY_ALERT_PERCENT` | Warning | ops monitor | → Worker down / tune `FFMPEG_THREADS` |
| `queue_failures` (`queues:failures`) | any queue with > 25 failed jobs | Warning | ops monitor | → Provider failures |
| `oauth_expired` (`social:oauth-expired`) | channels `EXPIRED`, or token expired with no refresh token | Warning | ops monitor | → OAuth expired |
| `backup_failed` (`backup:postgres:failed`) | `POST /api/ops/backup` fails | Critical | `OpsService.triggerBackup` | → Backup failed |

Not covered: stale backups, stalled jobs, publish failures, provider failures, budget thresholds, emergency-stop notifications. In-app per-user notifications (`Notification` table, `NotificationsService`) remain separate and are used only if an alert is fired with `notifyUserId`.

The ops monitor runs inside the API. If the API (or the whole VPS) is down, **no alert is produced**. That is why an external uptime monitor is required.

## 5. SMTP configuration **[PHASE 12]**

Variables: `ADMIN_EMAIL` (recipient), `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`false`), `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, plus `ALERTS_ENABLED` and `ALERT_COOLDOWN_MINUTES`. The variable is **`SMTP_PASS`**, not `SMTP_PASSWORD`. Email is attempted only if `SMTP_HOST`, `SMTP_FROM` **and** `ADMIN_EMAIL` are all set; otherwise the alert is recorded and logged only. See `ENVIRONMENT_VARIABLES.md`.

`SmtpService` is a small built-in SMTP client (no nodemailer): plain SMTP, STARTTLS, or implicit TLS (`SMTP_SECURE=true`), optional AUTH LOGIN. It has never been exercised against a real provider. There is no "send test email" endpoint; the practical test is to trigger a real condition (for example `POST /api/ops/diagnostics` does not email; lower `DISK_USAGE_ALERT_PERCENT` temporarily and wait for the monitor).

Practical advice:

- Use a transactional email service or your mail provider's SMTP submission port (587 STARTTLS or 465 TLS). Many VPS providers block outbound port 25.
- An untested alert channel should be assumed broken.
- Put the alert sender on a domain with SPF/DKIM so alerts do not land in spam.
- Alert mail works only while the VPS is alive (see Principle).

## 6. Dedupe and cooldown **[PHASE 12]**

Implemented in `AlertsService.fire` / `resolve`:

- **Dedupe key** per condition (table above); one `SystemAlert` row per key, with `occurrenceCount`, `lastFiredAt`, `cooldownUntil`.
- While an alert is `OPEN` and `cooldownUntil` is in the future, further `fire` calls return the existing row and send **no** new email. After the cooldown (`ALERT_COOLDOWN_MINUTES`, default 30) a still-failing condition re-fires and re-emails.
- `resolve` marks the row `RESOLVED` and sends a `[RECOVERED]` email (when SMTP is configured). A condition that fails again later re-opens the same row.
- State is in Postgres, so it survives API restarts (a crash-looping API will not email on every restart within the cooldown).
- Different keys never suppress each other.

Separately, in-app `Notification.dedupeKey` is unique per user and permanent per key **[REPO]**.

This behaviour has local unit/e2e coverage only; the "no storm on restart" claim is not verified on a VPS.

## 7. Logs

- API logs: `nestjs-pino`. JSON in production (pretty-print only when `NODE_ENV !== production`). The `Authorization` and `Cookie` request headers are redacted. Set `LOG_LEVEL` as needed.
- Worker logs: its own pino-style logger (`apps/worker/src/lib/logger.ts`).
- Docker captures stdout/stderr. `docker-compose.prod.yml` configures `json-file` rotation on every service (for example api/worker `50m` × 7 files, caddy `20m` × 5). The dev compose file has none. Caddy writes JSON access logs to stdout.
- Requests carry an `x-request-id` (generated if absent) for API ↔ log correlation.
- Centralised log shipping is out of scope for the single-VPS design.

## 8. Monitoring checklist

- [ ] External uptime monitor on `https://<domain>/api/health/live`
- [ ] TLS expiry monitored
- [ ] `/api/health/ready` and worker `/health` verified on the VPS (code exists; not yet verified)
- [ ] SMTP test alert received in a real mailbox (code exists; not yet verified)
- [ ] Disk alert tested by lowering `DISK_USAGE_ALERT_PERCENT` temporarily (not yet verified)
- [ ] Backup failure alert tested (only covers `POST /api/ops/backup`; no stale-backup alert exists)
- [ ] Docker log rotation confirmed on the VPS (configured in `docker-compose.prod.yml`)
- [ ] Someone is actually on the receiving end of the alerts
