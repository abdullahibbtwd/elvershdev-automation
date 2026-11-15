# AI Video Automation Platform

Monorepo for AI-powered video generation, rendering, and multi-platform publishing.

## Stack

| Layer | Technology |
| --- | --- |
| Frontend | React, Vite, TypeScript, Tailwind, shadcn/ui |
| API | NestJS, Prisma, JWT, Swagger |
| Workers | BullMQ, FFmpeg, Gemini story intelligence |
| Data | PostgreSQL, Redis, MinIO |
| Monorepo | Turborepo + pnpm workspaces |

## Project structure

```text
apps/
  web/       React dashboard
  api/       NestJS HTTP API
  worker/    Background job processors
packages/
  shared/    Shared types, Zod schemas, queue names, story-AI contracts
  config/    Shared TypeScript / ESLint configs
infrastructure/docker/
  Dockerfiles + nginx config
docs/
  Production documentation (architecture, deployment, backups, security, runbooks)
```

## Prerequisites

- Node.js 20+
- pnpm 9+
- Docker + Docker Compose
- FFmpeg (local worker only; included in worker Docker image)

## Quick start

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
ln -sf ../../.env apps/api/.env
ln -sf ../../.env apps/worker/.env
```

Required secrets:

- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`
- `CREDENTIALS_ENCRYPTION_KEY` (≥32 characters)

> PostgreSQL is mapped to host port **5433** by default.

### 3. Start infrastructure

```bash
docker compose up -d postgres redis minio
```

### 4. Migrate database

```bash
pnpm db:generate
pnpm --filter @ai-video/api exec prisma migrate deploy
```

### 5. Run apps

```bash
pnpm --filter @ai-video/shared build
pnpm --filter @ai-video/api dev
pnpm --filter @ai-video/worker dev
pnpm --filter @ai-video/web dev
```

## Phase status

| Phase | Status |
| --- | --- |
| 1 Foundation / Docker / monorepo | Complete |
| 2 Auth + Prisma foundation | Complete |
| 3 Dashboard + projects/stories/media/jobs | Complete |
| 4 AI story intelligence + scene planning | Complete |
| 5 Visual intelligence + fal.ai scene images | Complete |
| 6 AI motion + video clips (Hailuo default; Kling preserved) | Complete (Phase 6.1 Hailuo) |
| 7 AI voice + Gemini TTS narration | Complete |
| 8 FFmpeg video assembly / rendering | Implemented (verified with mock providers; see [checklist](docs/PRODUCTION_CHECKLIST.md)) |
| 9 Social OAuth + publishing (Meta, TikTok, YouTube) | Implemented in code; **not verified against live platform accounts** |
| 10 Automation (planning, scheduling, orchestration, emergency stop) | Implemented in code; not verified on a VPS or with live providers |
| 11 Analytics + cost tracking | Implemented in code; not verified with live platform data |
| 12 Production hardening (single-VPS deploy, health checks, backups, alerts, limits) | **Implemented in repo** (`docker-compose.prod.yml`, Caddy, scripts, health/ops/alerts code, `.env.production.example`). See [`docs/`](docs/). Local unit tests pass (137, incl. lock and production-config specs). **Not yet verified on a VPS**; live providers unverified; **restore never tested** (and `restore-postgres.sh` has a known defect for unencrypted dumps); no MinIO backup script |

> "Implemented" means the code and Prisma migrations exist (`apps/api/prisma/migrations` has 12 migrations through `phase12_ops`). It does **not** mean verified with real third-party providers or on a production VPS. Provider integrations (Gemini, Gemini TTS, fal.ai, Kling, Meta, TikTok, YouTube) are exercised through mock modes; live verification status is tracked in [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md).

## Gemini story intelligence (Phase 4)

Story generation and scene planning use `@google/genai` through a shared-style Gemini provider (API) and worker client.

### Configuration

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Google AI API key (never hardcode) |
| `GEMINI_MODEL` | Model id (default `gemini-2.0-flash`) |
| `GEMINI_TIMEOUT_MS` | Request timeout (default `60000`) |
| `GEMINI_MAX_RETRIES` | Transient retry count (default `3`) |
| `GEMINI_USE_MOCK` | Force deterministic mock responses (`true`/`false`) |
| `GEMINI_PRICE_INPUT_PER_MILLION_USD` | Configurable input token price for cost estimates |
| `GEMINI_PRICE_OUTPUT_PER_MILLION_USD` | Configurable output token price for cost estimates |

Mocks are also used automatically when `NODE_ENV=test` or when `GEMINI_API_KEY` is unset. Automated tests never require paid Gemini calls.

### Usage flow

1. Open **Stories → AI story** (`/stories/new`)
2. Provide topic, niche, audience, language, tone, duration, category
3. API enqueues a `story-generation` job and returns immediately
4. Worker writes title, story, hook, narration, closing, description, hashtags, and character profiles
5. Worker auto-enqueues `scene-planning`
6. Scenes are stored with narration, visuals, image/video prompts, camera, lighting, environment, and character consistency instructions
7. Edit, regenerate, replan scenes, save drafts, or attach the story to a video project

### Story AI API

| Endpoint | Description |
| --- | --- |
| `POST /api/stories/generate` | Create story + enqueue Gemini generation |
| `POST /api/stories/:id/regenerate` | Regenerate story content |
| `POST /api/stories/:id/plan-scenes` | Re-run scene planning |
| `POST /api/stories/:id/attach-project` | Attach to existing/new video project |
| `GET /api/stories/:id` | Story detail with scenes, characters, usage |

Usage rows are stored in `ProviderUsage` with model, token counts, request type, estimated cost, and story/job links. Pricing is env-configurable — the app does not invent live Google price sheets.

## Visual intelligence & scene image generation (Phase 5)

Visual intelligence converts planned scenes into structured visual briefs and generates photorealistic scene images and character reference portraits stored in MinIO (`MediaAsset`).

### Configuration

| Variable | Purpose |
| --- | --- |
| `FAL_API_KEY` | fal.ai API key (never hardcode) |
| `FAL_IMAGE_MODEL` | Default model (`fal-ai/flux/dev`) |
| `FAL_IMAGE_PRICE_PER_IMAGE` | Configurable per-image USD price for cost estimates |
| `FAL_IMAGE_DEFAULT_ASPECT_RATIO` | Default aspect ratio (`9:16`) |
| `FAL_IMAGE_DEFAULT_FORMAT` | Output image format (`png`) |
| `FAL_IMAGE_TIMEOUT_MS` | Request timeout (`120000`) |
| `FAL_IMAGE_MAX_RETRIES` | Transient retry count (`3`) |
| `FAL_USE_MOCK` | Force deterministic mock PNG buffers (`true`/`false`) |
| `FAL_IMAGE_SUPPORTS_REFERENCE` | Enable/override reference-image capability (`true`/`false`) |
| `FAL_IMAGE_CURRENCY` | Currency label for cost estimates (`USD`) |

Mocks are used automatically when `NODE_ENV=test` or when `FAL_API_KEY` is unset.

### Visual AI API

| Endpoint | Description |
| --- | --- |
| `GET/POST/PATCH/DELETE /api/visual-styles` | List built-in styles and manage custom user styles |
| `POST /api/stories/:id/visuals/generate` | Enqueue `visual-analysis` (chains character references + scene images) |
| `GET /api/stories/:id/visuals` | Retrieve scenes, visual attempts, character references, and jobs |
| `GET /api/stories/:id/visuals/progress` | Retrieve per-status scene counts and active visual jobs |
| `POST /api/scenes/:id/visuals/generate` | Generate a scene image attempt |
| `POST /api/scenes/:id/visuals/regenerate` | Regenerate a new scene image attempt |
| `PATCH /api/scenes/:id/visuals/:visualId` | Update prompt or select preferred attempt |
| `POST /api/characters/:id/visual-reference/generate` | Generate a canonical character reference portrait |
| `GET/POST /api/visual-generation/jobs/:jobId` | Inspect, retry, or cancel visual generation jobs |

## Voice narration & Gemini TTS (Phase 7)

Narration planning uses Gemini JSON generation. Speech uses Gemini 3.8 TTS (`gemini-3.8-flash-lite-tts` by default) via the Interactions API. Unary responses are `audio/wav` (24 kHz mono PCM). Mock mode (`GEMINI_TTS_USE_MOCK=true`) produces valid WAV fixtures with no paid calls.

### Configuration

| Variable | Purpose |
| --- | --- |
| `GEMINI_TTS_MODEL` | TTS model id (default `gemini-3.8-flash-lite-tts`) |
| `GEMINI_TTS_DEFAULT_VOICE` | Prebuilt voice (default `Kore`) |
| `GEMINI_TTS_USE_MOCK` | Force mock speech (also on in `NODE_ENV=test` / missing API key) |
| `GEMINI_TTS_TIMEOUT_MS` / `GEMINI_TTS_MAX_RETRIES` | Request controls |
| `GEMINI_TTS_MAX_CONCURRENCY` | Worker concurrency for speech queues |
| `GEMINI_TTS_MAX_CHARACTERS` | Per-request character cap |
| `GEMINI_TTS_MAX_AUDIO_DURATION_SECONDS` | FFprobe duration guard |
| `GEMINI_TTS_PRICE_*` | Estimated cost tracking (not live invoices) |
| `GEMINI_TTS_MAX_MONTHLY_SPEND_USD` | Optional estimated-spend budget guard |

### Usage flow

1. Open a story workspace → **Narration / Voice**
2. Generate narration scripts (async `narration-planning`)
3. Edit / approve per-scene spoken text
4. Select a prebuilt voice or saved voice profile
5. Generate audio for all scenes or one scene (`speech-generation` → `audio-validation` → `audio-storage`)
6. Preview via short-lived MinIO download URLs, select preferred takes

Docs: [Speech generation](https://aistudio.google.com/docs/speech-generation) · [Pricing](https://aistudio.google.com/docs/pricing)

## Video assembly & FFmpeg rendering (Phase 8)

Assembles selected scene visuals, motion clips, and narration into a social-ready MP4 via FFmpeg/FFprobe (never inside HTTP requests). Pipeline: `video-render-planning` → `video-rendering` → `video-render-validation` → `video-render-storage`.

Default output profile: **9:16 · 1080×1920 · 30fps · H.264 + AAC · yuv420p · faststart**. Additional profiles (1:1, 16:9) are configurable.

### Configuration

| Variable | Purpose |
| --- | --- |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Binary paths (default `ffmpeg` / `ffprobe`) |
| `VIDEO_RENDER_MAX_CONCURRENCY` | Worker concurrency (default `1`) |
| `VIDEO_RENDER_MAX_OUTPUT_BYTES` | Output size guard |
| `VIDEO_RENDER_JOB_TIMEOUT_MS` | Soft job timeout hint |

### Usage flow

1. Open a story workspace → **Video Assembly / Final Render**
2. Review readiness (visuals, motion, approved narration audio)
3. Configure output profile, subtitles, and optional music
4. Click **Render Video** and watch stage progress
5. Preview / download the final MP4 and SRT

## Motion generation & image-to-video (Phase 6 / 6.1)

Converts completed scene images into short cinematic clips via **MiniMax Hailuo-02** on fal.ai (default) or Kling (optional; disabled until `KLING_ENABLED=true`), with Gemini motion briefs, BullMQ async polling, FFprobe validation, and MinIO persistence. Details: [`docs/PHASE6_1_HAILUO_INTEGRATION_REPORT.md`](docs/PHASE6_1_HAILUO_INTEGRATION_REPORT.md).

### Configuration

| Variable | Purpose |
| --- | --- |
| `VIDEO_GENERATION_PROVIDER` | Default `hailuo` (`kling` optional) |
| `FAL_API_KEY` | Shared fal.ai key for Hailuo (and image gen) |
| `HAILUO_MODEL` | `fal-ai/minimax/hailuo-02/standard/image-to-video` |
| `HAILUO_DEFAULT_DURATION` / `HAILUO_DEFAULT_RESOLUTION` | `6` / `768P` |
| `HAILUO_USE_MOCK` | Force mock async pipeline without paid calls |
| `HAILUO_PRICE_PER_SECOND_768P_USD` | Default `0.045` (~$0.27 for 6s) |
| `KLING_ENABLED` | Default `false` — Kling remains registered for future use |
| `KLING_*` | Existing Kling configuration (unchanged) |

Live Hailuo requires `FAL_API_KEY` and `HAILUO_USE_MOCK=false`. Live Kling requires `KLING_ENABLED=true`, a real key, and `KLING_USE_MOCK=false`.

### Motion pipeline

1. Require a completed `SceneVisual` image (reject scenes without images)
2. Gemini motion analysis → structured brief + editable motion prompt
3. Submit image-to-video to the selected provider (request id persisted)
4. Delayed BullMQ status polling (does not hold a worker open)
5. Download completed MP4, validate with FFprobe, store in MinIO
6. Link `MotionGeneration` → scene + source visual + `MediaAsset`

Queues: `motion-analysis` → `video-generation` → `video-status-polling` → `video-download`.

### Motion API

| Endpoint | Description |
| --- | --- |
| `POST /api/stories/:id/motion/generate` | Generate motion for story scenes |
| `GET /api/stories/:id/motion` | List scenes, clips, history |
| `GET /api/stories/:id/motion/progress` | Progress + active jobs |
| `POST /api/scenes/:id/motion/generate` | Generate one scene clip |
| `POST /api/scenes/:id/motion/regenerate` | New attempt for a scene |
| `GET /api/scenes/:id/motion` | Scene motion history |
| `GET /api/motion/providers` | List Hailuo/Kling availability |
| `GET/PATCH /api/motion/:motionId` | Inspect / edit prompt / select |
| `POST /api/motion/:motionId/retry\|cancel\|select` | Retry, cancel, select preferred clip |
| `GET/POST /api/motion-generation/jobs/:jobId` | Inspect / retry / cancel jobs |

## Dashboard pages

- `/` Overview
- `/projects` Video projects (CRUD)
- `/stories` Stories (drafts + AI create)
- `/stories/new` AI story brief
- `/stories/:id` Preview, edit, regenerate, scenes, visuals, motion clips, attach project
- `/media` Media library (MinIO upload + signed download URLs)
- `/jobs` Generation jobs (queue / cancel / retry)
- `/channels` Connected channels (encrypted credentials)
- `/publishing` Publishing history
- `/settings` User preferences

## Core API endpoints

### Auth (Phase 2)

`POST /api/auth/register|login|refresh|logout|logout-all`  
`GET /api/auth/me` · `PATCH /api/auth/change-password`  
`GET|PATCH /api/users/me`

### Platform (Phase 3)

| Resource | Endpoints |
| --- | --- |
| Projects | `GET/POST /api/projects`, `GET/PATCH/DELETE /api/projects/:id` |
| Stories | `GET/POST /api/stories`, `GET/PATCH/DELETE /api/stories/:id` |
| Media | `GET/POST /api/media/upload`, `POST /api/media/presign`, `GET /api/media/:id`, `GET /api/media/:id/download-url`, `DELETE /api/media/:id` |
| Jobs | `GET/POST /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/cancel`, `POST /api/jobs/:id/retry` |
| Channels | `GET/POST /api/channels`, `GET/PATCH/DELETE /api/channels/:id` |
| Publishing | `GET /api/publishing` |
| Settings | `GET/PATCH /api/settings` |
| Dashboard | `GET /api/dashboard/overview` |

All user-owned resources are scoped to the authenticated user.

## Queue architecture

Workers process jobs on:

- `story-generation` — Gemini story package + character profiles
- `scene-planning` — structured scene breakdown
- `visual-analysis` / `character-reference-generation` / `image-generation` — Phase 5 visuals
- `motion-analysis` / `video-generation` / `video-status-polling` / `video-download` — Phase 6 motion
- `narration-planning` / `speech-generation` / `audio-validation` / `audio-storage` — Phase 7 voice
- `video-render-planning` / `video-rendering` / `video-render-validation` / `video-render-storage` — Phase 8 render
- `social-publishing` / `social-media-upload` / `social-publish-status` / `social-token-maintenance` — Phase 9 publishing
- `automation-daily-planner` / `automation-orchestrator` / `automation-publish-scheduler` — Phase 10 automation
- `analytics-sync` / `analytics-post-refresh` / `analytics-account-refresh` / `analytics-aggregation` — Phase 11 analytics

Statuses: `PENDING` → `QUEUED` → `PROCESSING` → `COMPLETED` / `FAILED` / `CANCELLED`.

Duplicate active story/scene jobs for the same story are rejected. Jobs use BullMQ `jobId = generationJobId` for idempotent enqueue.

## Scripts

| Command | Description |
| --- | --- |
| `pnpm install` | Install workspace deps |
| `pnpm build` | Build all packages/apps |
| `pnpm dev` | Run apps in watch mode |
| `pnpm test` | Run API unit + e2e tests |
| `pnpm db:migrate` | Prisma migrate (dev) |
| `pnpm db:studio` | Prisma Studio |

## Production deployment

> **Do not deploy the root `docker-compose.yml` to a public server as-is.** It is a development file: it publishes Postgres (`5433`), Redis (`6379`), MinIO (`9000`/`9001`), the API (`3000`) and web (`5173`) on all host interfaces, and uses default passwords (`aivideo`, `minioadmin`) and a Redis instance without a password.

The production topology (`docker-compose.prod.yml`, started with `scripts/deploy.sh`, configured from `.env.production.example`) is a **single VPS** running Docker Compose behind a Caddy reverse proxy (only ports 80/443 public; Postgres, Redis and MinIO internal). Phase 12.1 adds singleton `api-scheduler` (`PROCESS_ROLE=scheduler`) so HTTP API replicas do not host duplicate automation/analytics consumers. It is **not highly available**. Local backup→scratch restore drills completed 2026-11-15; **VPS restore still unverified**. Targets: RPO 24h, RTO ~1–2h (not measured on VPS).

| Document | Contents |
| --- | --- |
| [`docs/PRODUCTION_ARCHITECTURE.md`](docs/PRODUCTION_ARCHITECTURE.md) | Components, deployment diagram, single points of failure, bottlenecks, insecure defaults, known gaps |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | VPS install, `docker-compose.prod.yml`, `scripts/deploy.sh` / `update.sh` / `rollback.sh`, `prisma migrate deploy`, reboot recovery |
| [`docs/ENVIRONMENT_VARIABLES.md`](docs/ENVIRONMENT_VARIABLES.md) | Every environment variable (matches `.env.example` / `.env.production.example`), required vs optional, Phase 12/12.1 additions |
| [`docs/ADMIN_BOOTSTRAP.md`](docs/ADMIN_BOOTSTRAP.md) | One-time administrator bootstrap (`ADMIN_BOOTSTRAP_TOKEN`) |
| [`docs/BACKUP_AND_RESTORE.md`](docs/BACKUP_AND_RESTORE.md) | Postgres/MinIO backup/restore, retention, encryption, restore drill evidence |
| [`docs/MONITORING_AND_ALERTS.md`](docs/MONITORING_AND_ALERTS.md) | `/api/health*`, worker deep health, external monitor, alert types, SMTP |
| [`docs/SECURITY.md`](docs/SECURITY.md) | Auth, encryption, roles, rate limits, CORS/helmet, secrets, registration gate |
| [`docs/INCIDENT_RESPONSE.md`](docs/INCIDENT_RESPONSE.md) | Runbooks: API/worker down, stalled queues, provider failures, disk full, OAuth, emergency stop, rollback |
| [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) | Staged rollout A–E and per-item verification state |
| [`docs/PHASE12_1_COMPLETION_REPORT.md`](docs/PHASE12_1_COMPLETION_REPORT.md) | Phase 12.1 blockers: local vs VPS vs live-provider status |

Items tagged **[PHASE 12]** / **[PHASE 12.1]** are implemented in the repository and, where noted, tested locally. They are **not** declared VPS- or live-provider-verified unless the completion report says so. Do not enable Stage E automatically.

## Remaining configuration

1. Replace JWT + encryption secrets for production (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CREDENTIALS_ENCRYPTION_KEY`)
2. Set secure cookie flags behind HTTPS (`NODE_ENV=production`, `COOKIE_SECURE=true`); `.env.example` ships `COOKIE_SECURE=false`
3. Set a real `GEMINI_API_KEY` (or keep `GEMINI_USE_MOCK=true` for unpaid local demos)
4. Set `FAL_API_KEY` / `KLING_API_KEY` when leaving mock mode (`FAL_USE_MOCK`, `KLING_USE_MOCK`, `GEMINI_TTS_USE_MOCK` default to `true` in `.env.example`)
5. Register social OAuth apps (Meta, TikTok, YouTube) with HTTPS redirect URIs before leaving social mock mode
6. Follow the staged rollout in [`docs/PRODUCTION_CHECKLIST.md`](docs/PRODUCTION_CHECKLIST.md) before enabling automation
