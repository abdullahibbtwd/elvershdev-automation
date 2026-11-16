# Environment Variables

All variables used by the API, worker, web build and Docker Compose.

- **Local development:** `.env` at the repo root (copied from `.env.example`) feeds `docker-compose.yml`; `apps/api/.env` and `apps/worker/.env` are symlinks to it.
- **Production:** `.env.production` (copied from `.env.production.example`) is read by `docker-compose.prod.yml` (`env_file: ${ENV_FILE:-.env.production}` and `--env-file` in `scripts/lib/common.sh`). Phase 12 variables are present in **both** example files; `.env.production.example` carries production-oriented values and a few compose-only variables that `.env.example` does not have (`HTTP_PORT`, `HTTPS_PORT`, `API_MEMORY_LIMIT`, `API_CPU_LIMIT`, `WORKER_MEMORY_LIMIT`, `WORKER_CPU_LIMIT`).

> **Status.** Variable names in this document were checked against `.env.example`, `.env.production.example`, `docker-compose.prod.yml`, `scripts/*.sh` and the code (`apps/api/src/config/configuration.ts`, `apps/worker/src`). None of this has been exercised on a VPS.

## Legend

| Marker | Meaning |
| --- | --- |
| **Required** | The app fails to start, or is insecure or broken in production, without a correct value. |
| **Required\*** | Required only when the related feature or provider is enabled/used. |
| Optional | Has a safe default. |
| **[REPO]** | Present in `.env.example` and/or read by code. |
| **[PHASE 12]** | Introduced by Phase 12. **Now implemented** and present in `.env.example` and `.env.production.example`. Defaults shown are the code defaults and the values in the example files. "Implemented" means the code reads it; it does not mean it was verified on a VPS. |

"Code default" = what the code uses if the variable is unset. "`.env.example`" = the value shipped in the example. Where they differ, **production should set the variable explicitly**.

Security rule: never commit `.env`. Use `chmod 600 .env`. Never put secrets in `VITE_*` variables (they are compiled into public JS).

---

## 1. Core application

| Variable | Req? | Code default / example | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | **Required** | `development` (example) | Set `production`. Controls log format (pino JSON in production), safer cookie defaults, Gemini/fal mock auto-fallback (`test`). |
| `PORT` | Optional | `3000` | API listen port inside the container. |
| `API_PREFIX` | Optional | `api` | Global route prefix. |
| `CORS_ORIGIN` | **Required** | `http://localhost:5173` | Comma-separated allowed origins. Must be the exact HTTPS web origin. Also the fallback for `SOCIAL_FRONTEND_REDIRECT_URL`. |
| `LOG_LEVEL` | Optional | `info` | Listed in `.env.example`. |
| `WEB_PORT` | Optional | `5173` | Dev compose host port for web. **Do not publish in production.** |
| `VITE_API_URL` | **Required** (build-time) | `http://localhost:3000/api` | Compose build arg for the web image. Production: `https://<domain>/api`. Rebuild web after changing. |
| `WORKER_CONCURRENCY` | Optional | `2` | Default BullMQ concurrency for workers without a specific override. |
| `PUBLIC_API_URL` | **Required** | `http://localhost:3000` | Public base URL of the API (no `/api`). Used for OAuth/social flows. |
| `TRUST_PROXY` | **Required** behind Caddy **[PHASE 12]** | `false` (`.env.example`), `true` (`.env.production.example`) | `apps/api/src/main.ts` sets Express `trust proxy` to `1` when `TRUST_PROXY=true` **or** `NODE_ENV=production`, so the real client IP from `X-Forwarded-For` is used for rate limiting. `docker-compose.prod.yml` also hard-codes `TRUST_PROXY: "true"` for the `api` service. Only safe when the API is reachable solely through Caddy (true in the prod compose topology; **not verified on a VPS**). |
| `SWAGGER_ENABLED` | Optional **[PHASE 12]** | `true` (`.env.example`), `false` (`.env.production.example`) | `true` always mounts `/docs`; `false` never mounts it; unset mounts it only when `NODE_ENV` is not `production`. Caddy still **proxies** `/docs*` to the API, so a disabled Swagger simply returns 404. |
| `ROLLOUT_STAGE` | Optional **[PHASE 12]** | `A` | Rollout stage `A`–`E`. Initial value only: once an admin sets a stage (System Ops page or `POST /api/ops/rollout`) the value stored in the `Setting` row `system:rolloutStage` **overrides** the env var. Gates the **automation tick only**: `A`/`B` skip automation planning and the publish scheduler; `D` caps `dailyGenerationTarget` at 1; `C` and `E` do not cap. It does **not** flip any `*_USE_MOCK` flag and does not block manual publishing from the UI. See `PRODUCTION_CHECKLIST.md`. |
| `ADMIN_EMAIL` | Optional **[PHASE 12]** | empty (`.env.example`), `ops@example.com` (`.env.production.example`) | **Alert recipient only** (used with `SMTP_HOST` and `SMTP_FROM` by `SmtpService`). It does **not** promote that account to `ADMIN`. The first admin must be created by a DB update; later admins can be promoted via `POST /api/ops/promote-admin` by an existing admin. |
| `APP_VERSION` | Optional **[PHASE 12]** | `0.1.0` | Reported by `/api/health/live` and worker `/health`, and used as the image tag (`aivideo-api:${APP_VERSION}`, etc.). **Caveat from reading the scripts:** `deploy.sh` and `update.sh` source `.env.production` (via `require_vars` / `forbid_dev_defaults`) *before* computing `APP_VERSION="${APP_VERSION:-<UTC timestamp>}"`, so a value present in the file wins over both a shell-exported value and the timestamp default. With the shipped `APP_VERSION=0.1.0` every deploy/update reuses the same image tag, which defeats tag-based rollback. For per-release tags, **delete or change `APP_VERSION` in `.env.production` for each release**. `rollback.sh` does not source the file, so `APP_VERSION=<tag> ./scripts/rollback.sh` works as documented. Not exercised on a VPS. |
| `DOMAIN` | **Required** (production) | `localhost` (`.env.example`), `example.com` (prod example) | Caddy site address (`{$DOMAIN:localhost}`) and automatic-HTTPS hostname. `deploy.sh` refuses to run if empty. |
| `HTTP_PORT` / `HTTPS_PORT` | Optional (production compose) | `80` / `443` | Host ports published by the `caddy` service. Only in `.env.production.example`. |

## 2. PostgreSQL

| Variable | Req? | Default / example | Notes |
| --- | --- | --- | --- |
| `POSTGRES_USER` | Optional | `aivideo` | Used by the postgres container and by compose to build `DATABASE_URL` for `api`. |
| `POSTGRES_PASSWORD` | **Required** | `aivideo` (insecure) | Strong random. |
| `POSTGRES_DB` | Optional | `aivideo` | |
| `POSTGRES_PORT` | Dev only | `5433` | Host port mapping in the dev compose file. **Remove in production.** |
| `DATABASE_URL` | **Required** | `postgresql://aivideo:aivideo@localhost:5433/aivideo?schema=public` | Used by Prisma (API, worker, `migrate deploy`). Compose overrides it for `api` to point at host `postgres:5432`; note the **worker service in the dev compose does not override it**, so set a container-correct `DATABASE_URL` (`@postgres:5432`) in the production environment for the worker and for `migrate deploy` runs. |

## 3. Redis / BullMQ

| Variable | Req? | Default / example | Notes |
| --- | --- | --- | --- |
| `REDIS_HOST` | Optional | `localhost` | Compose sets `redis` for `api`/`worker`. |
| `REDIS_PORT` | Optional | `6379` | Dev host mapping too. |
| `REDIS_PASSWORD` | **Required** in production | empty | Read by API, worker and the health check. `docker-compose.prod.yml` passes it to the Redis server as `--requirepass`, and `validateProductionConfig` refuses to start the API in production without it. The dev `docker-compose.yml` does **not** set a Redis password. |
| `REDIS_MAXMEMORY` | Optional **[PHASE 12]** | `512mb` | Passed as `--maxmemory` in `docker-compose.prod.yml`. `infrastructure/redis/redis.prod.conf` sets `maxmemory-policy noeviction` (BullMQ jobs must never be evicted), AOF `appendonly yes`, and renames `FLUSHALL`, `FLUSHDB`, `DEBUG` to empty (disabled). Redis is not published to the host. |

## 4. MinIO / object storage

| Variable | Req? | Default / example | Notes |
| --- | --- | --- | --- |
| `MINIO_ENDPOINT` | **Required** | `http://localhost:9000` | Compose sets `http://minio:9000` for `api`/`worker`. API presigned URLs are built from this internal endpoint. API presigned URLs are still built from this internal endpoint; see the known issue in `DEPLOYMENT.md` (browser access to media is **not verified**). |
| `MINIO_ACCESS_KEY` | **Required** | `minioadmin` (insecure) | Also `MINIO_ROOT_USER` for the server in compose. |
| `MINIO_SECRET_KEY` | **Required** | `minioadmin` (insecure) | Also `MINIO_ROOT_PASSWORD`. |
| `MINIO_BUCKET` | Optional | `ai-video` | Auto-created by the API at start. |
| `MINIO_REGION` | Optional | `us-east-1` | |
| `MINIO_API_PORT` / `MINIO_CONSOLE_PORT` | Dev only | `9000` / `9001` | Host mappings in dev compose. **Remove in production.** |
| `MINIO_PUBLIC_URL` | Optional | none | Read by the worker's image/video generation processors, to rewrite presigned reference-image URLs for providers (fal/Kling) that must fetch them. Present in both example files (empty in `.env.example`; `https://<domain>/media-proxy` in `.env.production.example`). Caddy serves `/media-proxy/*` by stripping the prefix and proxying to `minio:9000`. A provider needs a publicly reachable URL to fetch source images, so this matters for real fal/Kling use. |

## 5. Authentication and security

| Variable | Req? | Default / example | Notes |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | **Required** | `change-me-…` | ≥32 chars, random. Changing it invalidates all access tokens. |
| `JWT_REFRESH_SECRET` | **Required** | `change-me-…` | ≥32 chars, random, different from the access secret. Changing it logs everyone out. |
| `JWT_ACCESS_EXPIRES_IN` | Optional | `15m` | |
| `JWT_REFRESH_EXPIRES_IN` | Optional | `7d` | Format `<n>[smhd]`. |
| `CREDENTIALS_ENCRYPTION_KEY` | **Required** | `change-me-…` | ≥32 chars (the API refuses to start otherwise). AES-256-GCM key for stored social tokens (SHA-256-derived). **Back it up. Changing or losing it makes all stored channel credentials undecryptable.** There is no key rotation mechanism. |
| `COOKIE_SECURE` | **Required** in production | code: `true` when `NODE_ENV=production`; example: `false` | Set `true`. |
| `COOKIE_SAME_SITE` | Optional | code: `strict` in production; example: `lax` | |
| `COOKIE_PATH` | Optional | `/api/auth` | Scope of the refresh cookie. |
| `COOKIE_DOMAIN` | Optional | none | Leave empty for host-only cookies. |

## 6. Phase 12: worker, FFmpeg, limits, cleanup, alerts, backups

All names below exist in `.env.example` **and** `.env.production.example` unless noted. "Wired" = read by code or scripts today; where a variable is read into config but not used, it is called out.

### Worker, FFmpeg and concurrency

| Variable | Req? | Default (code / `.env.example` / prod example) | Notes |
| --- | --- | --- | --- |
| `WORKER_CONCURRENCY` | Optional | `2` | Default BullMQ concurrency; fallback for the per-queue values below. |
| `VIDEO_RENDER_MAX_CONCURRENCY` | Optional | `1` | Render queue concurrency. Keep `1` on a single small VPS. |
| `IMAGE_GENERATION_MAX_CONCURRENCY` | Optional | `2` | Image queue. Falls back to `WORKER_CONCURRENCY`. Tune to fal rate limits. |
| `PUBLISHING_MAX_CONCURRENCY` | Optional | `2` | Publishing queues. Falls back to `WORKER_CONCURRENCY`. |
| `KLING_MAX_CONCURRENCY` / `GEMINI_TTS_MAX_CONCURRENCY` | Optional | `2` | Kling and TTS queues. Fall back to `WORKER_CONCURRENCY`. |
| `FFMPEG_THREADS` | Optional | `2` | Passed to FFmpeg `-threads` (`apps/worker/src/lib/ffmpeg.ts`). Keep ≤ CPUs given to the worker. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Optional | `ffmpeg` / `ffprobe` | The worker image provides both. |
| `VIDEO_RENDER_MAX_OUTPUT_BYTES` | Optional | `524288000` | 500 MB output guard. |
| `VIDEO_RENDER_JOB_TIMEOUT_MS` | Optional | `900000` | 15 min render timeout. Only in `.env.example`. Keep `stop_grace_period` and `WORKER_SHUTDOWN_TIMEOUT_MS` in mind. |
| `WORKER_LOCK_DURATION_MS` | Optional | `120000` | BullMQ lock duration. Only in `.env.example`. |
| `WORKER_STALLED_INTERVAL_MS` | Optional | `60000` | BullMQ stalled-check interval. Only in `.env.example`. |
| `WORKER_MAX_STALLED_COUNT` | Optional | `2` | BullMQ max stalled count. Only in `.env.example`. |
| `WORKER_HEALTH_PORT` | Optional | `3101` | Port of the worker's HTTP `/health`. Internal only; compose sets it to `3101` and the healthcheck calls `http://127.0.0.1:3101/health`. |
| `WORKER_HEALTH_HOST` | Optional | `worker` | Host the **API** uses to call the worker's `/health` (Docker DNS name). Change only if the service is renamed. |
| `WORKER_MEMORY_LIMIT_MB` | Optional | `2048` | Soft ceiling the worker compares its RSS against. At ≥ 90% it **logs a warning** and `/health` reports `memory.pressure: true`. It does **not** stop taking jobs. Keep it below the Docker limit. |
| `WORKER_MEMORY_CHECK_MS` | Optional | code default | Interval of the worker memory check. Read by code; not in either example file. |
| `WORKER_SHUTDOWN_TIMEOUT_MS` | Optional | `90000` | Graceful shutdown budget on SIGTERM/SIGINT. After it, the worker calls `FfmpegService.killAllProcesses()` and exits 1. Compose `stop_grace_period` for the worker is `120s`, deliberately larger. |
| `SCHEDULER_LOCK_TTL_SECONDS` | Optional | `55` | TTL of the Redis locks that make the API crons single-leader (automation, analytics, ops monitor, cleanup, token maintenance). Some crons fall back to a larger TTL in code if unset; set explicitly. Must exceed the longest tick. |

### Limits

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `MAX_UPLOAD_BYTES` | Optional | `104857600` | **Read into config (`ops.maxUploadBytes`) but not yet enforced.** Media upload limits still use the hard-coded 100 MB constant in `apps/api/src/modules/media/media.constants.ts`. Changing this variable currently has no effect. |
| `MAX_VIDEO_DURATION_SECONDS` | Optional | `600` | **Read into config (`ops.maxVideoDurationSeconds`) but no consumer was found in the code.** Not enforced. |

### Cleanup, disk and memory monitoring

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `TEMP_CLEANUP_MAX_AGE_HOURS` | Optional | `24` | Age threshold for `CleanupService` (hourly cron + `POST /api/ops/cleanup/temp`). Removes old local temp files and unreferenced `tmp/` MinIO objects, plus expired OAuth states and expired/revoked sessions (revoked > 7 days). |
| `TEMP_CLEANUP_DISABLED` | Optional | `false` | `true` disables the hourly cleanup cron (the manual endpoint still works). |
| `OPS_MONITOR_DISABLED` | Optional | `false` | `true` disables the per-minute ops monitor cron (infra/disk/memory/queue/OAuth alerts). |
| `TOKEN_MAINTENANCE_CRON_DISABLED` | Optional | `false` | `true` disables the 30-minute social token-maintenance enqueue cron. |
| `DISK_USAGE_ALERT_PERCENT` | Optional | `85` | Ops monitor alerts when `df -P /` **inside the API container** reaches this percentage. That is the container's root filesystem view, not guaranteed to reflect host or Docker-volume usage. Not verified on a VPS. |
| `MEMORY_ALERT_PERCENT` | Optional | `90` | Ops monitor alerts on host memory used % as seen by the API container (`os.totalmem`/`freemem`). |

### Alerts and SMTP

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `ALERTS_ENABLED` | Optional | `true` | `false` makes `AlertsService.fire` a no-op (no DB row, no email). |
| `ALERT_COOLDOWN_MINUTES` | Optional | `30` | Dedupe window: an `OPEN` alert with the same `dedupeKey` inside the cooldown is not re-fired or re-emailed. |
| `ADMIN_EMAIL` | **Required\*** (email alerts) | empty | Alert recipient. See section 1. |
| `SMTP_HOST`, `SMTP_FROM` | **Required\*** (email alerts) | empty | Email is sent only when `SMTP_HOST`, `SMTP_FROM` **and** `ADMIN_EMAIL` are all set. Otherwise alerts are stored in the DB and logged, not emailed. |
| `SMTP_PORT` | Optional | `587` | |
| `SMTP_SECURE` | Optional | `false` | `true` = implicit TLS; `false` = STARTTLS where supported. |
| `SMTP_USER`, `SMTP_PASS` | Optional | empty | Variable is **`SMTP_PASS`** (not `SMTP_PASSWORD`). |

The SMTP client is a small built-in implementation (no nodemailer). **No test email has been sent to a real mailbox** and no real SMTP relay has been verified.

### Backups (scripts and the optional `backup` compose service)

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `BACKUP_RETENTION_DAYS` | Optional | `14` | `scripts/backup-postgres.sh` deletes `aivideo-*.sql.gz[.enc]` older than this under the backup dir. |
| `BACKUP_ENCRYPT_PASSPHRASE` | Optional | empty | When set, dumps are encrypted with `openssl enc -aes-256-cbc -pbkdf2 -salt` and written as `.sql.gz.enc`. Restore needs the same passphrase. **Store it off the VPS.** |
| `BACKUP_INTERVAL_SECONDS` | Optional | `86400` | Loop interval of the optional `backup` compose service (profile `ops`). |
| `BACKUP_DIR` | Optional | `<repo>/backups/postgres` | Read by `backup-postgres.sh` from the shell environment (default shown). Not listed in either example file. |

## 7. AI providers

### Gemini (story, scenes, motion briefs, narration planning)

| Variable | Req? | Code default / example | Notes |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | **Required\*** | empty | If empty, the app silently uses mock responses. |
| `GEMINI_MODEL` | Optional | `gemini-2.0-flash` | |
| `GEMINI_TIMEOUT_MS` | Optional | `60000` | |
| `GEMINI_MAX_RETRIES` | Optional | `3` | |
| `GEMINI_USE_MOCK` | Optional | code `false`; example `false` | `true` forces mocks. |
| `GEMINI_PRICE_INPUT_PER_MILLION_USD` / `GEMINI_PRICE_OUTPUT_PER_MILLION_USD` | Optional | `0.10` / `0.40` (example) | Estimated cost tracking only. |

### Gemini TTS

| Variable | Req? | Code default → example | Notes |
| --- | --- | --- | --- |
| `GEMINI_TTS_MODEL` | Optional | `gemini-3.8-flash-lite-tts` | |
| `GEMINI_TTS_DEFAULT_VOICE` | Optional | `Kore` | |
| `GEMINI_TTS_USE_MOCK` | Optional | code `false`; **example `true`** | Set deliberately. |
| `GEMINI_TTS_TIMEOUT_MS` | Optional | `120000` | |
| `GEMINI_TTS_MAX_RETRIES` | Optional | `3` | |
| `GEMINI_TTS_MAX_CONCURRENCY` | Optional | `2` | |
| `GEMINI_TTS_MAX_CHARACTERS` | Optional | code `4000`; example `8000` | Differ, so set explicitly. |
| `GEMINI_TTS_MAX_AUDIO_DURATION_SECONDS` | Optional | code `120`; example `600` | Differ, so set explicitly. |
| `GEMINI_TTS_MAX_ATTEMPTS_PER_SCENE` | Optional | code `10`; example `20` | Differ, so set explicitly. |
| `GEMINI_TTS_PRICE_INPUT_PER_MILLION_USD`, `GEMINI_TTS_PRICE_AUDIO_OUTPUT_PER_MILLION_USD`, `GEMINI_TTS_AUDIO_TOKENS_PER_SECOND`, `GEMINI_TTS_CURRENCY` | Optional | `0.50`, `6.00`, `25`, `USD` | Estimates only. |
| `GEMINI_TTS_MAX_MONTHLY_SPEND_USD` | Optional | empty (disabled) | Estimated-spend guard. Recommended in production. |

### fal.ai (images)

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `FAL_API_KEY` | **Required\*** | empty | Empty means mock. |
| `FAL_USE_MOCK` | Optional | code `false`; **example `true`** | |
| `FAL_IMAGE_MODEL` | Optional | `fal-ai/flux/dev` | |
| `FAL_IMAGE_PRICE_PER_IMAGE` | Optional | `0.025` | Estimate only. |
| `FAL_IMAGE_DEFAULT_ASPECT_RATIO` | Optional | `9:16` | |
| `FAL_IMAGE_DEFAULT_FORMAT` | Optional | `png` | |
| `FAL_IMAGE_TIMEOUT_MS` | Optional | `120000` | |
| `FAL_IMAGE_MAX_RETRIES` | Optional | `3` | |
| `FAL_IMAGE_SUPPORTS_REFERENCE` | Optional | `false` (example) | |
| `FAL_IMAGE_SUPPORTS_NEGATIVE_PROMPT` | Optional | unset | Read by code; not in `.env.example`. |
| `FAL_IMAGE_CURRENCY` | Optional | `USD` | |

### Kling (image-to-video)

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `VIDEO_GENERATION_PROVIDER` | Optional | `hailuo` | Default video provider (`hailuo` or `kling`). |
| `HAILUO_ENABLED` | Optional | `true` | Set `false` to disable Hailuo selection. |
| `HAILUO_MODEL` | Optional | `fal-ai/minimax/hailuo-02/standard/image-to-video` | fal.ai endpoint id. Reuses `FAL_API_KEY`. |
| `HAILUO_DEFAULT_RESOLUTION` | Optional | `768P` | `512P` or `768P`. |
| `HAILUO_DEFAULT_DURATION` | Optional | `6` | `6` or `10`. |
| `HAILUO_PROMPT_OPTIMIZER` | Optional | `true` | |
| `HAILUO_MAX_RETRIES` / `HAILUO_TIMEOUT_MS` | Optional | `2` / `600000` | |
| `HAILUO_USE_MOCK` | Optional | code/example `true` | Force mock without fal credits. |
| `HAILUO_POLL_INTERVAL_SECONDS` / `HAILUO_MAX_POLL_ATTEMPTS` | Optional | `15` / `80` | |
| `HAILUO_PRICE_PER_SECOND_768P_USD` / `HAILUO_PRICE_PER_SECOND_512P_USD` | Optional | `0.045` / `0.017` | Estimates (~$0.27 for 6s 768P). |
| `HAILUO_CURRENCY` | Optional | `USD` | |
| `HAILUO_MAX_MONTHLY_SPEND_USD` | Optional | empty (disabled) | Recommended before live mode. |
| `KLING_ENABLED` | Optional | `false` | Kling stays registered; enable explicitly for future use. |
| `KLING_API_KEY` | **Required\*** | empty | Bearer key. Falls back to `KLING_ACCESS_KEY` for compatibility. |
| `KLING_ACCESS_KEY`, `KLING_SECRET_KEY`, `KLING_API_SECRET` | Optional (legacy) | empty | Legacy names. |
| `KLING_USE_MOCK` | Optional | code `false`; **example `true`** | |
| `KLING_API_BASE_URL` | Optional | `https://api-singapore.klingai.com` | |
| `KLING_MODEL` | Optional | `kling-2.6` | |
| `KLING_DEFAULT_DURATION_SECONDS` | Optional | `5` | `5` or `10`. |
| `KLING_DEFAULT_RESOLUTION` | Optional | `720p` | `720p` or `1080p`. |
| `KLING_TIMEOUT_MS` / `KLING_MAX_RETRIES` | Optional | `120000` / `3` | |
| `KLING_POLL_INTERVAL_SECONDS` / `KLING_MAX_POLL_ATTEMPTS` | Optional | `8` / `90` | |
| `KLING_MAX_CONCURRENCY` | Optional | `2` | Shared video-generation queue concurrency. |
| `KLING_PRICE_PER_SECOND_USD` / `KLING_CURRENCY` | Optional | `0.07` / `USD` | Estimates. |
| `KLING_MOCK_READY_AFTER_MS` | Optional | `1500` | Mock only. |
| `KLING_MAX_CLIPS_PER_SCENE` / `KLING_MAX_ATTEMPTS_PER_SCENE` | Optional | `10` / `20` | |
| `KLING_MAX_MONTHLY_SPEND_USD` | Optional | empty (disabled) | Recommended in production. |
| `KLING_SUPPORTS_NEGATIVE_PROMPT`, `KLING_SUPPORTS_LAST_FRAME` | Optional | unset | Read by code; not in `.env.example`. |

## 8. Social platforms

| Variable | Req? | Default | Notes |
| --- | --- | --- | --- |
| `SOCIAL_USE_MOCK` | Optional | `false` | Global social mock flag. Provider-specific mock flags also exist. |
| `SOCIAL_FRONTEND_REDIRECT_URL` | **Required** | `http://localhost:5173` | Where users land after OAuth. Production: web origin. |
| `SOCIAL_OAUTH_STATE_TTL_SECONDS` | Optional | `600` | |
| `SOCIAL_PUBLIC_MEDIA_BASE_URL` | **Required\*** | empty | Public base URL platforms use to fetch media (needed by providers that pull from a URL). |
| `SOCIAL_PRESIGN_TTL_SECONDS` | Optional | `3600` | |
| `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` | **Required\*** | empty | Instagram falls back to these. Needed for OAuth connect; optional if using page-token S2S only. |
| `FACEBOOK_REDIRECT_URI` | **Required\*** | `http://localhost:3000/api/channels/facebook/callback` | Must be `https://<domain>/api/channels/facebook/callback` and registered at Meta. |
| `FACEBOOK_GRAPH_VERSION` | Optional | `v22.0` | |
| `FACEBOOK_USE_MOCK` | Optional | `false` | |
| `FACEBOOK_PAGE_ACCESS_TOKEN` | Optional | empty | Permanent Page access token for browserless Facebook/Instagram publishing. |
| `FACEBOOK_PAGE_ID` | Optional | empty | Facebook Page ID used with the page token. |
| `INSTAGRAM_APP_ID`, `INSTAGRAM_APP_SECRET` | Optional | fall back to Facebook values | |
| `INSTAGRAM_REDIRECT_URI` | **Required\*** | `http://localhost:3000/api/channels/instagram/callback` | |
| `INSTAGRAM_USE_MOCK` | Optional | `false` | |
| `INSTAGRAM_ACCOUNT_ID` | Optional | empty | IG Business/Creator account ID linked to the Page (S2S path). |
| `TIKTOK_CLIENT_KEY`, `TIKTOK_CLIENT_SECRET` | **Required\*** | empty | User OAuth still required once; publishing uses stored user tokens. |
| `TIKTOK_REDIRECT_URI` | **Required\*** | `http://localhost:3000/api/channels/tiktok/callback` | |
| `TIKTOK_USE_MOCK` | Optional | `false` | |
| `TIKTOK_AUDITED` | Optional | `false` | Set `true` only after TikTok has audited the app. Gates public posting behaviour. |
| `YOUTUBE_CLIENT_ID`, `YOUTUBE_CLIENT_SECRET` | **Required\*** | empty | |
| `YOUTUBE_REDIRECT_URI` | **Required\*** | `http://localhost:3000/api/channels/youtube/callback` | |
| `YOUTUBE_USE_MOCK` | Optional | `false` | |
| `YOUTUBE_REFRESH_TOKEN` | Optional | empty | After one offline OAuth, enables browserless token refresh/uploads via bootstrap script. |

## 9. Scheduling toggles and process roles **[PHASE 12.1]**

| Variable | Default | Effect |
| --- | --- | --- |
| `PROCESS_ROLE` | `all` | `all` = HTTP + crons + automation/analytics queue hosts (dev/single-container). `api` = HTTP + producers only (safe to scale). `scheduler` = Nest crons + automation/analytics BullMQ hosts (singleton). Prod compose sets `api` / `scheduler` explicitly. |
| ~~`REGISTRATION_ENABLED`~~ | removed | Public `POST /api/auth/register` was removed. Existing users login only; create accounts via DB/seed. |
| `ADMIN_BOOTSTRAP_TOKEN` | empty | One-time bootstrap secret (≥16 chars) for `POST /api/ops/bootstrap-admin`. Unused after first successful bootstrap. |
| `QUEUE_BACKLOG_ALERT_THRESHOLD` | `100` | Ops monitor fires when waiting jobs ≥ threshold. |
| `PROVIDER_SPEND_ALERT_USD` | `50` | Daily `ProviderUsage` spend alert threshold. |
| `BACKUP_STALE_HOURS` | `36` | Alert when no successful backup within this window. |
| `AUTOMATION_CRON_DISABLED` | unset | `true` disables the automation per-minute tick. |
| `AUTOMATION_QUEUE_HOST_DISABLED` | unset | `true` disables the automation queue host. |
| `ANALYTICS_CRON_DISABLED` | unset | `true` disables analytics cron. |
| `ANALYTICS_QUEUE_HOST_DISABLED` | unset | `true` disables the analytics queue host. |

Prod topology: `api` (`PROCESS_ROLE=api`) + singleton `api-scheduler` (`PROCESS_ROLE=scheduler`). Redis locks remain belt-and-suspenders on cron ticks. Never scale `api-scheduler`.

## 10. Production `.env.production`

Start from the shipped template and replace every placeholder:

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

The template contains these groups (see the file itself for every value): app/proxy (`NODE_ENV`, `APP_VERSION`, `DOMAIN`, `HTTP_PORT`, `HTTPS_PORT`, `PORT`, `API_PREFIX`, `CORS_ORIGIN`, `PUBLIC_API_URL`, `SOCIAL_FRONTEND_REDIRECT_URL`, `VITE_API_URL=/api`, `TRUST_PROXY`, `SWAGGER_ENABLED`, `LOG_LEVEL`, `ROLLOUT_STAGE`), Postgres, Redis (`REDIS_PASSWORD`, `REDIS_MAXMEMORY`), MinIO (`MINIO_*`, `SOCIAL_PUBLIC_MEDIA_BASE_URL`, `SOCIAL_PRESIGN_TTL_SECONDS`), JWT/credentials/cookies, worker and limits, container limits (`API_MEMORY_LIMIT`, `API_CPU_LIMIT`, `WORKER_MEMORY_LIMIT`, `WORKER_CPU_LIMIT`), alerts/SMTP, backups, and provider/social settings with every `*_USE_MOCK=true`.

Notes:

- The template ships `VITE_API_URL=/api` (same-origin through Caddy). It is a **build-time** value for the web image; rebuild `web` after changing it.
- `DATABASE_URL` in the template points at host `postgres`. `docker-compose.prod.yml` also rebuilds it from `POSTGRES_*` for `api` and `worker`, so keep `POSTGRES_USER/PASSWORD/DB` and `DATABASE_URL` consistent.
- `COOKIE_SAME_SITE=strict`, `COOKIE_SECURE=true`, `COOKIE_PATH=/api/auth`, `COOKIE_DOMAIN=<domain>` are set in the template.
- Variables **not** in the production template but supported (provider tuning such as `GEMINI_MODEL`, `KLING_*`, `FAL_IMAGE_*`, `GEMINI_TTS_*` limits and spend guards, `TIKTOK_AUDITED`, `FACEBOOK_GRAPH_VERSION`, `VIDEO_RENDER_JOB_TIMEOUT_MS`, `WORKER_LOCK_DURATION_MS`, `WORKER_STALLED_INTERVAL_MS`, `WORKER_MAX_STALLED_COUNT`, the three `*_DISABLED` cron toggles) fall back to code defaults. Several code defaults differ from `.env.example` (see section 7), so add the ones you care about explicitly. Set the `*_MAX_MONTHLY_SPEND_USD` guards **before** turning on any real provider.
- Keep every `*_USE_MOCK=true` until that provider has been verified (see `PRODUCTION_CHECKLIST.md`).

### What blocks a bad production config

Two independent checks exist; neither has been run against a real VPS:

1. `scripts/lib/common.sh` (`forbid_dev_defaults`), used by `deploy.sh` and `update.sh`: rejects values containing `change-me` for `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`; `POSTGRES_PASSWORD=aivideo`; `MINIO_ACCESS_KEY`/`MINIO_SECRET_KEY` equal to `minioadmin`; empty `REDIS_PASSWORD`; and secrets shorter than 32 chars. `deploy.sh` additionally requires `DOMAIN POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB REDIS_PASSWORD MINIO_ACCESS_KEY MINIO_SECRET_KEY JWT_ACCESS_SECRET JWT_REFRESH_SECRET CREDENTIALS_ENCRYPTION_KEY CORS_ORIGIN PUBLIC_API_URL`.
2. `validateProductionConfig()` (`apps/api/src/config/validate-production.ts`), called first in `apps/api/src/main.ts`: when `NODE_ENV=production`, the **API** refuses to start if any of `DATABASE_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET CREDENTIALS_ENCRYPTION_KEY REDIS_HOST REDIS_PASSWORD MINIO_ENDPOINT MINIO_ACCESS_KEY MINIO_SECRET_KEY CORS_ORIGIN PUBLIC_API_URL` is missing/blank; if a JWT/encryption secret is < 32 chars or **contains** `change-me`, `changeme`, `secret`, `password` or `example` (case-insensitive; this also rejects the template placeholders, and a random value that happens to contain one of those words); if MinIO keys are `minioadmin`; if `POSTGRES_PASSWORD` is `aivideo`; or if `REDIS_PASSWORD` is empty. The worker does **not** run this validation.

## Validation tip

Before first boot, check for leftovers:

```bash
grep -nE 'change-me|minioadmin|PASSWORD=aivideo|PASSWORD=$|localhost' .env
```

Any hit in a production `.env` needs a deliberate justification.
