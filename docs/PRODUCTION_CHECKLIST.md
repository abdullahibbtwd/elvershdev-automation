# Production Checklist (staged rollout A–E)

Go-live is **staged**. Each stage has an entry gate and exit criteria. Do not advance until the exit criteria are met and recorded.

## How to use this document

### Verification states

Every item carries exactly one state. **Do not upgrade a state without evidence** (command output, a screenshot, a log, a test run) recorded in the "Evidence" column.

| State | Meaning |
| --- | --- |
| **Planned** | Required but **not present in the repo**. (Phase 12 code now exists, so Planned is used only where something is genuinely missing, for example a MinIO backup script.) |
| **Implemented** | The code/config exists in the repo (read by a human or agent). It has **not** necessarily been run. |
| **Tested locally** | Exercised on a developer machine, by automated tests (mocks) or by hand. |
| **Tested on VPS** | Exercised on the real production-like VPS (Caddy, Docker network, firewall, real disk). |
| **Verified with real providers** | Exercised end-to-end against the **live** third-party service with real credentials (`*_USE_MOCK=false`). |
| **Not yet verified** | No evidence in any environment. |

An item can move through states in order (`Implemented` → `Tested locally` → `Tested on VPS` → `Verified with real providers`). Write down the highest state **actually reached**.

### Baseline (updated after Phase 12 code landed)

Derived from reading the repository and from one local unit-test run, **not** from running anything on a VPS:

- Phases 1–12 are implemented in code (12 Prisma migrations through `phase12_ops`; processors for all queues; e2e specs for auth, platform, story-AI, visual-AI, motion-AI, voice-AI, video-render, automation and `production-readiness.e2e-spec.ts` in `apps/api/test`).
- **Unit tests: 137 passed locally (24 suites), including the Phase 12 specs** `distributed-lock.service.spec.ts` and `validate-production.spec.ts`. The e2e suites need local Postgres/Redis/MinIO and were **not re-run** for this update; "e2e spec exists" means the spec is written, so re-run `pnpm test:e2e` and record the result.
- **No live provider verification is recorded anywhere.** Mock mode is the exercised path. Every "Verified with real providers" cell is **Not yet verified**.
- **No VPS deployment has been recorded.** Every "Tested on VPS" cell is **Not yet verified**. Phase 12 artifacts (`docker-compose.prod.yml`, `infrastructure/caddy/Caddyfile`, `infrastructure/redis/redis.prod.conf`, `infrastructure/docker/Dockerfile.{api,worker,web}`, `scripts/*.sh`, `.env.production.example`, `/api/health/ready`, worker `/health`, ops API and System Ops page, alerts, cleanup, token-maintenance cron, `validateProductionConfig`, `ROLLOUT_STAGE`) are **Implemented**: they exist in the repo and have **not** been run on a VPS. The compose file and scripts have not been executed at all.
- **Single VPS is a single point of failure**; the **restore has never been tested**; backups are local-only until you copy them off-host.

### Stages A–E and `ROLLOUT_STAGE`

`ROLLOUT_STAGE` (env `ROLLOUT_STAGE`, overridden at runtime by the value an admin sets on `/system` or via `POST /api/ops/rollout`) accepts `A`–`E`. As implemented it gates **only the automation tick** (`AutomationCron`); it does not change `*_USE_MOCK` flags and does not block manual publishing from the UI. The checklist stages below keep their operator meaning, and map to the code as follows:

| Stage | Code description (`OpsService.getRolloutStage`) | Effect of `ROLLOUT_STAGE` in code | Operator expectation in this checklist |
| --- | --- | --- | --- |
| **A** | Infrastructure only | Automation planning **and the publish scheduler are skipped** (the tick only runs `recoverStalled`). | Stack on the VPS, all providers mocked. |
| **B** | Internal mock testing | Same as A. | Real Gemini + fal, manual and supervised; automation still off. |
| **C** | Controlled live testing | **Automation planning is enabled** for users with an enabled `AutomationConfig`; no daily cap. | Real Kling, TTS, render under load. Keep **every** `AutomationConfig` disabled/paused (or leave `ROLLOUT_STAGE` at `A`/`B`) until you intend automation, because stage C will plan. |
| **D** | Limited automation (1 video/day) | Planning enabled; `dailyGenerationTarget` is **forced down to 1** for enabled configs (it writes the change to the DB). | Manual publishing to test accounts; if you enable automation here, it is capped at 1/day. |
| **E** | Full operation | Planning enabled with the configured daily target. | Supervised automation, then limited unattended. |

Note the tension: the checklist's stage C and D are *manual* stages, but the code enables planning at C. Use the global pause (`POST /api/ops/automation/global-pause`, which sets enabled configs to `PAUSED`) or keep configs disabled if you want C/D to stay manual.

## Status summary (update as you go)

| Area | Current state |
| --- | --- |
| Core pipeline with mock providers | Implemented; Tested locally (unit: 137 passed; e2e specs exist, re-run needed) |
| Production compose, Caddy, Redis conf, Dockerfiles (non-root, `HEALTHCHECK`) | **Implemented**; not run anywhere; Tested on VPS: **Not yet verified** |
| Deploy / update / rollback scripts | **Implemented**; never executed; Tested on VPS: **Not yet verified** |
| `.env.production.example`, `validateProductionConfig` | **Implemented**; Tested locally (unit: `validate-production.spec.ts`); Tested on VPS: **Not yet verified** |
| Health `/live`, `/ready`, `/api/health` (incl. MinIO), worker `/health` | **Implemented**; `/live` + `/ready` covered by `production-readiness.e2e-spec.ts` (not re-run); Tested on VPS: **Not yet verified** |
| Redis distributed cron locks (automation, analytics, ops monitor, cleanup, token maintenance) | **Implemented**; Tested locally (unit: `distributed-lock.service.spec.ts`); multi-replica **Not yet verified** |
| Ops admin API `/api/ops/*`, System Ops page `/system` | **Implemented**; ADMIN check covered by e2e spec (not re-run); Tested on VPS: **Not yet verified** |
| `AlertsService`, optional SMTP, ops monitor | **Implemented**; SMTP delivery **Not yet verified** (no real relay used) |
| `CleanupService`, token-maintenance cron | **Implemented**; Tested on VPS: **Not yet verified** |
| Concurrency envs, `FFMPEG_THREADS`, worker memory warning, graceful shutdown (`FfmpegService.killAllProcesses`) | **Implemented**; **Not yet verified** under real load |
| Postgres backup script | **Implemented**; never run; local dir only; off-VPS copy **not set up** |
| Restore script | **Implemented but defective for unencrypted dumps** (see `BACKUP_AND_RESTORE.md`); restore **Not yet verified** |
| MinIO backup | **Planned**: no script exists |
| `MAX_UPLOAD_BYTES`, `MAX_VIDEO_DURATION_SECONDS` enforcement | **Not wired**: read into config but not enforced |
| Gemini (text) real | Not yet verified |
| Gemini TTS real | Not yet verified |
| fal.ai real | Not yet verified |
| Kling real | Not yet verified |
| Meta (Facebook/Instagram) real publishing | Not yet verified |
| TikTok real publishing | Not yet verified (requires app audit for public posting) |
| YouTube real publishing | Not yet verified |

---

## Stage A: Infrastructure and safety net (all providers mocked)

**Goal:** the stack runs safely on the VPS, is reachable only via HTTPS, can be monitored, backed up, restored and rolled back. No real provider traffic, no real posting.

`ROLLOUT_STAGE=A` (automation planning and publish scheduler off). All `*_USE_MOCK=true` (`GEMINI_USE_MOCK`, `GEMINI_TTS_USE_MOCK`, `FAL_USE_MOCK`, `KLING_USE_MOCK`, `SOCIAL_USE_MOCK`).

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| A1 | VPS provisioned, SSH key-only, patched | Not yet verified | |
| A2 | Firewall: only 80/443 (+ restricted SSH); external port scan clean for 5432, 5433, 6379, 9000, 9001, 3000, 5173 | Not yet verified | |
| A3 | `docker-compose.prod.yml` publishes only Caddy 80/443 | Implemented (`docker-compose.prod.yml`: only `caddy` has `ports:`); Tested on VPS: Not yet verified |  |
| A4 | Caddy reverse proxy with automatic HTTPS, HTTP→HTTPS redirect | Implemented (`infrastructure/caddy/Caddyfile`, `DOMAIN`); no certificate ever issued; Tested on VPS: Not yet verified |  |
| A5 | Production `.env.production` with unique strong secrets; no `change-me`/`minioadmin` (`deploy.sh` and `validateProductionConfig` enforce part of this) | Implemented (checks); Tested on VPS: Not yet verified | `grep -nE 'change-me\|minioadmin' .env.production` empty |
| A6 | `NODE_ENV=production`, `COOKIE_SECURE=true`, exact `CORS_ORIGIN`, `VITE_API_URL` | Not yet verified | |
| A7 | Redis password enforced server-side and client-side (`REDIS_PASSWORD`) | Implemented (`--requirepass`, `redis.prod.conf` `noeviction`; `validateProductionConfig` requires it); Tested on VPS: Not yet verified |  |
| A8 | `TRUST_PROXY` set; rate limiting keyed on real client IP | Implemented (`TRUST_PROXY`, also forced on when `NODE_ENV=production`); Tested on VPS: Not yet verified |  |
| A9 | `SWAGGER_ENABLED=false` or `/docs` blocked | Implemented (`SWAGGER_ENABLED=false` in the prod example; Caddy still proxies `/docs*`, API returns 404 when off); Tested on VPS: Not yet verified |  |
| A10 | `prisma migrate deploy` clean on a fresh DB (all 11+ migrations) | Implemented (12 migrations incl. `phase12_ops`); Tested on VPS: Not yet verified | `prisma migrate status` |
| A11 | Registration closed or gated | Not yet verified | |
| A12 | `/api/health/live` and `/api/health` respond via public HTTPS | Implemented (`/live`, `/api/health`); Tested on VPS: Not yet verified |  |
| A13 | `/api/health/ready` | Implemented (`/api/health/ready`: database, redis, minio); e2e spec exists, not re-run; Tested on VPS: Not yet verified |  |
| A14 | Worker `/health` on `WORKER_HEALTH_PORT` | Implemented (`apps/worker/src/lib/health-server.ts`, default `3101`; **[GAP]** does not probe Redis/Postgres); Tested on VPS: Not yet verified |  |
| A15 | Docker healthchecks for api/worker/web | Implemented (compose healthchecks + non-root Dockerfile `HEALTHCHECK`); Tested on VPS: Not yet verified |  |
| A16 | Docker log rotation configured | Implemented (`json-file` `max-size`/`max-file` on every service); Tested on VPS: Not yet verified |  |
| A17 | Worker `stop_grace_period` ≥ longest render | Implemented (worker `120s`, api `30s`; `WORKER_SHUTDOWN_TIMEOUT_MS=90000`; renders may run up to 15 min, so a mid-render restart is still interrupted); Tested on VPS: Not yet verified |  |
| A18 | Container CPU/memory limits; `WORKER_MEMORY_LIMIT_MB`, `FFMPEG_THREADS` set | Implemented (`API_*`/`WORKER_*` limits in compose; `WORKER_MEMORY_LIMIT_MB` is a warning threshold only; `FFMPEG_THREADS`); sizes unmeasured; Tested on VPS: Not yet verified |  |
| A19 | `scripts/deploy.sh`, `update.sh`, `rollback.sh` exist and are dry-run tested | Implemented (`deploy.sh`, `update.sh`, `rollback.sh`, `lib/common.sh`); never executed, no dry run. **Caveat:** `APP_VERSION` in `.env.production` defeats tag-based rollback; Tested on VPS: Not yet verified |  |
| A20 | Rollback rehearsed (code only; and DB restore variant) | Not yet verified (scripts exist; neither code rollback nor DB-restore variant rehearsed) |  |
| A21 | Reboot recovery rehearsed: reboot VPS, stack returns unaided | Not yet verified | |
| A22 | `backup-postgres.sh` runs on schedule | Implemented (`backup-postgres.sh`); **no scheduler installed**, add host cron; never run; Tested on VPS: Not yet verified |  |
| A23 | Off-VPS backup copy working | Not yet verified (no off-VPS copy automation exists; manual only) |  |
| A24 | **Restore drill executed and timed** (scratch DB, then scratch VPS) | Not yet verified | |
| A25 | Backup encryption decision made; passphrase stored off-VPS | Implemented (`BACKUP_ENCRYPT_PASSPHRASE`, openssl AES-256-CBC); decision and off-VPS passphrase storage Not yet verified |  |
| A26 | MinIO mirror scheduled (no `--remove`) | Planned (no MinIO backup script; manual `mc mirror` only) |  |
| A27 | SMTP configured; test alert received | Implemented (`SmtpService`, `ADMIN_EMAIL`/`SMTP_*`); no real relay or mailbox test; Not yet verified |  |
| A28 | Alert dedupe/cooldown verified (no storm on restart) | Implemented (DB-backed cooldown in `AlertsService`, `ALERT_COOLDOWN_MINUTES`); no restart-storm test; Not yet verified |  |
| A29 | External uptime monitor on the public URL | Not yet verified | |
| A30 | Disk alert (`DISK_USAGE_ALERT_PERCENT`) and temp cleanup (`TEMP_CLEANUP_*`) verified | Implemented (`DISK_USAGE_ALERT_PERCENT` ops-monitor alert; `CleanupService` with `TEMP_CLEANUP_MAX_AGE_HOURS`/`TEMP_CLEANUP_DISABLED`); **[GAP]** `df` runs inside the API container; Not yet verified |  |
| A31 | MinIO browser access to media (preview/download URLs) works in the locked-down topology | Not yet verified; **known issue** (API signs with internal `MINIO_ENDPOINT`) | |
| A32 | `.env` and `CREDENTIALS_ENCRYPTION_KEY` backed up in a password manager | Not yet verified | |
| A33 | Automated test suite re-run green (`pnpm test`) | Tested locally: unit tests **137 passed (24 suites)** incl. Phase 12 specs; e2e suites **not re-run** in this update (`pnpm test:e2e`, record the result) |  |
| A34 | `validateProductionConfig`: API refuses to start in production with missing/placeholder secrets, `minioadmin`, default Postgres password or empty `REDIS_PASSWORD` | Implemented; Tested locally (unit: `validate-production.spec.ts`); Tested on VPS: Not yet verified | |
| A35 | Ops admin API + `/system` page: non-admin gets 403, admin can read overview and change `ROLLOUT_STAGE`; first admin created via DB update (`ADMIN_EMAIL` does **not** grant admin) | Implemented; e2e spec exists (`production-readiness.e2e-spec.ts`, not re-run); Tested on VPS: Not yet verified | |
| A36 | Redis cron locks (automation, analytics, ops monitor, cleanup, token maintenance) prevent duplicate runs | Implemented; Tested locally (unit: `distributed-lock.service.spec.ts`); multi-replica Not yet verified | |
| A37 | Worker graceful shutdown (`SIGTERM` closes workers, kills FFmpeg after `WORKER_SHUTDOWN_TIMEOUT_MS`) | Implemented; Not yet verified (no render interrupted on purpose) | |
| A38 | `/api/ops/backup` (and the `/system` backup button) works in the production API container | **[GAP]** likely fails (API image has no `scripts/` or Docker CLI); use host cron | |
| A39 | Optional `backup` compose service (profile `ops`) runs | **[GAP]** likely cannot run as written (mounts only the script, no `lib/common.sh` or Docker CLI); do not rely on it | |
| A40 | `restore-postgres.sh` on an unencrypted `.sql.gz` | **[GAP]** defect found by reading (pipes compressed bytes into `psql` after dropping the schema); use the manual procedure; fix and rehearse | |

**Exit criteria for A:** A2, A5, A6, A12, A21, A24, A27, A31 all at **Tested on VPS**; backups proven by restore. **None of these has been met yet.**

---

## Stage B: Real Gemini (text) and fal.ai (images), supervised and low volume

**Goal:** real story/scene planning and image generation work and costs are understood.

`ROLLOUT_STAGE=B` (code description: internal mock testing; automation planning stays off). Turn off `GEMINI_USE_MOCK` and `FAL_USE_MOCK`, set `GEMINI_API_KEY`, `FAL_API_KEY`. Keep Kling, TTS and social on mock. Automation **disabled**.

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| B1 | One real story generated end to end (Gemini): story, scenes, characters | Not yet verified (real providers) | |
| B2 | Output quality acceptable; JSON schema parsing robust to real responses | Not yet verified | |
| B3 | Real image generation (fal): single scene, then a full story | Not yet verified (real providers) | |
| B4 | `MINIO_PUBLIC_URL` / reference-image fetch path works for fal reference images (if `FAL_IMAGE_SUPPORTS_REFERENCE=true`) | Not yet verified | |
| B5 | Estimated cost (`ProviderUsage`) compared to the real provider invoice for the test run | Not yet verified | |
| B6 | `IMAGE_GENERATION_MAX_CONCURRENCY` tuned against fal rate limits | Implemented (`IMAGE_GENERATION_MAX_CONCURRENCY`, default 2); tuning against real fal limits Not yet verified |  |
| B7 | Failure handling: bad key → clear error, no retry storm; 429 → backoff | Not yet verified | |
| B8 | Alert fires on provider failure | **[GAP]** no provider-failure alert is wired (`provider_failure` type exists but nothing fires it); only `queue_failures` (> 25 failed in a queue) alerts |  |

**Exit:** B1, B3, B5 recorded with real providers.

---

## Stage C: Real motion (Kling), voice (Gemini TTS), FFmpeg render under load

**Goal:** the expensive and resource-heavy path is proven on the actual VPS.

`ROLLOUT_STAGE=C` (code: automation planning becomes **active** for enabled configs; keep configs disabled/paused for manual testing). Turn off `KLING_USE_MOCK`, `GEMINI_TTS_USE_MOCK`. Set `KLING_MAX_MONTHLY_SPEND_USD` and `GEMINI_TTS_MAX_MONTHLY_SPEND_USD` **before** the first real call.

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| C1 | Real Kling image-to-video for one scene (submit → poll → download → FFprobe validate → MinIO) | Not yet verified (real providers) | |
| C2 | Kling polling survives a worker restart | Not yet verified | |
| C3 | Kling spend guard enforced | Not yet verified | |
| C4 | Real Gemini TTS narration for one scene, then a story; WAV validated | Not yet verified (real providers) | |
| C5 | TTS spend guard and character/duration caps enforced | Not yet verified | |
| C6 | Full real render (1080×1920, 30fps, H.264/AAC) on the VPS | Not yet verified | |
| C7 | Render under load: CPU, RAM, disk, API latency measured while rendering (`FFMPEG_THREADS`, `VIDEO_RENDER_MAX_CONCURRENCY=1`) | Not yet verified | |
| C8 | `MAX_VIDEO_DURATION_SECONDS` and `MAX_UPLOAD_BYTES` enforced | **[GAP]** Not wired: `MAX_VIDEO_DURATION_SECONDS` has no consumer and `MAX_UPLOAD_BYTES` is not used (uploads still use the hard-coded 100 MB constant) |  |
| C9 | Worker OOM behaviour: `WORKER_MEMORY_LIMIT_MB` leaves headroom; no OOM kill during a long render | Implemented (`WORKER_MEMORY_LIMIT_MB`: warning log and `/health` `pressure` at 90%, no throttling; compose `WORKER_MEMORY_LIMIT`); OOM behaviour Not yet verified |  |
| C10 | Temp cleanup removes stale render dirs without touching active ones | Implemented (`CleanupService`: local temp and `tmp/` MinIO objects older than `TEMP_CLEANUP_MAX_AGE_HOURS`, protects referenced keys); Not yet verified |  |
| C11 | Redeploy/restart during an active render: graceful behaviour documented and acceptable | Not yet verified | |
| C12 | Measured time and cost for one complete video recorded (capacity planning) | Not yet verified | |

**Exit:** a complete real video (story → images → motion → voice → render) produced on the VPS, with measured resource use and cost, no incident.

---

## Stage D: Manual publishing to test accounts (Meta, TikTok, YouTube)

**Goal:** real OAuth and real publishing from the UI, human-triggered, to **test/private** destinations.

`ROLLOUT_STAGE=D` (code: planning enabled, `dailyGenerationTarget` forced to 1). Turn off `SOCIAL_USE_MOCK` and the provider mock flags **one platform at a time**. Automation still **disabled**.

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| D1 | HTTPS redirect URIs registered at each provider and match `*_REDIRECT_URI` | Not yet verified | |
| D2 | `SOCIAL_PUBLIC_MEDIA_BASE_URL` serves media to platforms that fetch by URL | Not yet verified | |
| D3 | **YouTube**: OAuth connect, upload a private/unlisted video, status reconcile | Not yet verified (real providers) | |
| D4 | **Meta (Facebook Page)**: OAuth connect, publish a test Reel/video | Not yet verified (real providers) | |
| D5 | **Instagram**: OAuth connect (business/creator account), publish a test Reel | Not yet verified (real providers) | |
| D6 | **TikTok**: OAuth connect, publish in sandbox/private mode. Public posting requires app audit (`TIKTOK_AUDITED`) | Not yet verified (real providers) | |
| D7 | Token refresh via `social-token-maintenance` works; expired token → `ACTION_REQUIRED` and reconnect flow works | Implemented (token-maintenance cron every 30 min enqueues `social-token-maintenance`; `TOKEN_MAINTENANCE_CRON_DISABLED`); real refresh Not yet verified |  |
| D8 | Credential decrypt after API/worker restart (proves key handling, both API and worker crypto) | Not yet verified | |
| D9 | `PUBLISHING_MAX_CONCURRENCY` set conservatively | Implemented (`PUBLISHING_MAX_CONCURRENCY`, default 2); Not yet verified |  |
| D10 | Duplicate-publish protection verified (retry/restart does not double-post) | Not yet verified | |
| D11 | Publish-failure alert and OAuth-expired alert fire | Partly Implemented: `oauth_expired` alert exists (ops monitor); **[GAP]** no publish-failure alert is wired; Not yet verified |  |
| D12 | Platform review/permissions status documented per platform (what is allowed in test vs public) | Not yet verified | |

**Exit:** each platform you intend to use has a recorded successful real publish, with a decision on whether public posting is allowed (platform review status).

---

## Stage E: Automation (supervised, then limited unattended)

**Goal:** scheduled/automated content with guardrails; start with approval-required, small budgets.

`ROLLOUT_STAGE=E` (code: full operation at the configured daily target). Only after A–D are done for the platforms involved.

| # | Item | State | Evidence |
| --- | --- | --- | --- |
| E1 | Automation config: daily/monthly budget and max cost per video set | Implemented (config fields exist) | |
| E2 | Plans require approval (`POST /api/automation/plans/:id/approve`) for the first runs | Implemented | |
| E3 | Pause/resume and **emergency stop** work as documented | Implemented; Tested locally (e2e spec exists); **Not yet verified on VPS** | |
| E4 | Global kill switch rehearsed (`AUTOMATION_CRON_DISABLED`, `POST /api/ops/automation/global-pause`, `dc stop worker`) | Not yet verified | |
| E5 | Scheduler lock prevents duplicate cron runs (`SCHEDULER_LOCK_TTL_SECONDS`) | Implemented (Redis locks `lock:cron:automation` etc., `SCHEDULER_LOCK_TTL_SECONDS`); Tested locally (unit); multi-replica Not yet verified |  |
| E6 | Stalled-execution recovery (`recoverStalled`) observed working after an induced worker kill | Implemented; Not yet verified | |
| E7 | Reboot mid-run: no lost or duplicated publications | Not yet verified | |
| E8 | 7 consecutive supervised days with no unresolved alert | Not yet verified | |
| E9 | Analytics sync with real platform data (Phase 11) | Not yet verified (real providers) | |
| E10 | Budget guards stop spend at limits | Not yet verified | |
| E11 | On-call/owner for alerts defined | Not yet verified | |
| E12 | RBAC enforced or risk accepted in writing (roles are not enforced today) | Partly Implemented: `RolesGuard` + `@Roles(ADMIN)` enforced on `/api/ops/*` only; other routes still ignore roles; open registration unchanged. Accept the risk in writing or extend RBAC |  |

**Exit:** a defined period of supervised automation with measured cost, no duplicate posts, and a rehearsed stop procedure. Only then consider reducing human approval.

---

## Final go/no-go (before real users)

- [ ] Stage A exit criteria met (**restore drill proven**; today the restore is untested and `restore-postgres.sh` has a known defect for unencrypted dumps)
- [ ] All provider claims backed by recorded evidence at **Verified with real providers**, or the provider is left on mock and **disclosed**
- [ ] Security checklist in `SECURITY.md` section 9 complete
- [ ] Incident runbooks reviewed by whoever is on call
- [ ] Known single-VPS limitations accepted by the business owner: single point of failure (outage on VPS loss), RPO 24h, RTO ~1–2h (targets, **not measured**), backups local-only until copied off-host, MinIO not backed up by any script
- [ ] Rollback and emergency stop rehearsed in the last 30 days

## Evidence log

| Date | Item | State reached | Who | Notes / link |
| --- | --- | --- | --- | --- |
| | | | | |
