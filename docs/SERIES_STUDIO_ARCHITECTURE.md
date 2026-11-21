# AI Series Studio — Architecture & Implementation Plan

**Phase:** A complete → **B in progress / delivered for schema + config/lanes**  
**Status:** Architecture approved; Phase B adds Prisma models, migration, shared constants/queues, and Series config/lane APIs (Series Studio remains disabled by default).  
**Date:** 2026-11-16  
**Scope:** Add an independent episodic movie engine without breaking standalone story automation.

---

## 1. Executive summary

The platform is a **pnpm + Turborepo monorepo** (`ai-video-platform`) with:

| App / package | Role |
| --- | --- |
| `apps/api` | NestJS 10, Prisma 6, JWT auth, crons, BullMQ producers + API-hosted automation/analytics workers |
| `apps/worker` | BullMQ media workers (Gemini, fal, Hailuo/Kling/xAI Grok Lite, TTS, FFmpeg → MinIO) |
| `apps/web` | React 18 + Vite SPA, TanStack Query, dark cyan dashboard |
| `packages/shared` | Queues, Zod/JSON schemas, automation constants, pricing, prompts |
| Postgres / Redis / MinIO | System of record, BullMQ + locks, media |

There is **no Series Studio / episode / lane model today**. The product is built around **one-shot Story → scenes → visuals → motion → narration → render → publish**, plus a separate **per-user standalone automation** pipeline (`AutomationConfig` + `ContentPlan` + `ContentSchedule`).

**Series Studio must be a parallel product surface** that:

1. Owns movie-level canon, lanes, continuity, and replacement planning.
2. **Adapts each approved episode into an existing `Story` (+ optional `VideoProject`)** and drives the **existing** stage services/queues.
3. Never shares lane state, characters, or schedules with the other lane or with standalone automation slots.

---

## 2. Current architecture (as inspected)

### 2.1 Request and job flow

1. Browser → `Authorization: Bearer` → Nest API (`API_PREFIX` default `api`).
2. Long work: API creates `GenerationJob` + enqueues BullMQ (`jobId = generationJobId`).
3. Worker writes Postgres + MinIO; automation/analytics processors stay on the API (Nest DI).
4. Multi-instance safety: `PROCESS_ROLE` (`all` | `api` | `scheduler`) + Redis `DistributedLockService` cron locks (`lock:cron:*` / `cron:*`).

### 2.2 Pipeline queues (reuse — do not fork)

From `packages/shared/src/queues/index.ts`:

**Story / visuals / motion / voice / render / social**

- `story-generation` → `scene-planning`
- `visual-analysis` → `character-reference-generation` / `image-generation`
- `motion-analysis` → `video-generation` → `video-status-polling` → `video-download`
- `narration-planning` → `speech-generation` → `audio-validation` → `audio-storage`
- `video-render-planning` → `video-rendering` → `video-render-validation` → `video-render-storage`
- `social-publishing`, `social-media-upload`, `social-publish-status`, `social-token-maintenance`

**Standalone automation (must remain untouched in behaviour)**

- `automation-daily-planner`, `automation-orchestrator`, `automation-publish-scheduler`

**Analytics**

- `analytics-sync`, `analytics-post-refresh`, `analytics-account-refresh`, `analytics-aggregation`

### 2.3 Standalone automation (isolation boundary)

| Concern | Implementation |
| --- | --- |
| Config | `AutomationConfig` 1:1 `User` — `enabled`, `runMode` (`ENABLED` \| `PAUSED` \| `EMERGENCY_STOP`) |
| Planning | Daily slots → `ContentPlan` + `ContentSchedule` (single `storyId` / `videoRenderId`) |
| Orchestration | `AutomationOrchestratorService` advances `AUTOMATION_STAGE_ORDER` by calling Stories/Visuals/Motion/Narration/Rendering |
| Publishing | `ScheduledPublication` + publish scheduler + `PublishingService` |
| Global stop | `Setting` keys `system:automation:emergencyStop` / `globalPause` + `EmergencyStopService` |
| Audit / notify | `AutomationAuditLog`, `Notification` with dedupe keys |

**Defaults** (`packages/shared/src/automation/constants.ts`): morning-ish window starting `08:00`, evening-ish end `19:30`, ~50–60s videos, concurrency generation `2` / publishing `4`. Series Studio will mirror **lane-local** morning/evening times (`08:00` / `19:00`) in its own config, not by mutating these defaults.

### 2.4 Story / character / media models (reuse targets)

| Model | Series relevance |
| --- | --- |
| `Story` | **Episode production unit** after adapter materialization |
| `StoryScene` | Scene plan for one episode (`unique(storyId, sceneNumber)`) |
| `CharacterProfile` | **Story-scoped only** today; workers `deleteMany` + recreate on regen |
| `CharacterVisualReference` → `MediaAsset` | Reference portraits via fal |
| `VideoProject` | Thin publish/packaging wrapper — **not** a series hierarchy |
| `VideoRender` / `PublishRecord` | Final asset + social attempt |
| `ProviderUsage` | Cost ledger (optional `storyId`) |
| `Setting` | Global KV — optional system flags; prefer dedicated Series config tables |

### 2.5 Gemini structured-output pattern (reuse)

Canonical path (worker `lib/gemini.ts` + shared packages):

1. Prompt (`packages/shared/src/*-ai/prompts.ts`)
2. Gemini JSON Schema (`responseJsonSchema` + `application/json`)
3. Normalize nested quirks
4. Zod `.parse`
5. `ProviderUsage` + cost estimate

Story Zod lives in `packages/shared/src/story-ai/schemas.ts` (`generatedStorySchema`, `generatedScenePlanSchema`). Series Studio adds **new** Zod packages (e.g. `packages/shared/src/series-ai/`) following the same dual-schema pattern — **no second Gemini client**.

### 2.6 Frontend conventions

- Routes: `apps/web/src/App.tsx` + `nav-config.ts` groups (Core / Distribution / Automation / System)
- API: axios `api` + TanStack Query; `{ success, data }` envelopes
- Settings UX reference: `AutomationSettingsPage` (GET → local form → PATCH + control POSTs)
- Design: dark “obsidian + cyan”; shadcn-like `components/ui/*`
- **No Series routes or nav yet**

### 2.7 Empty / stub modules (do not revive as pipelines)

- `apps/api/src/modules/ai-generation/*` — stub
- `apps/api/src/modules/scheduling/scheduling.service.ts` — empty; real scheduling is automation + publishing

Series Studio gets a **new** Nest module (`modules/series/`), not these stubs.

### 2.8 VPS / resource constraints (already encoded)

| Knob | Default | Implication for Series |
| --- | --- | --- |
| `VIDEO_RENDER_MAX_CONCURRENCY` | **1** | Keep Series default max concurrent episode production **1** |
| `WORKER_CONCURRENCY` | 2 | Do not raise without measurement |
| `FFMPEG_THREADS` | 2 | Shared host with API |
| Automation generation concurrency | 2 | Series should default lower (1) and share provider budgets carefully |

Pass **asset IDs / storage keys** in queue payloads — never binary video in Redis (existing pattern).

---

## 3. Conflicts and risks discovered

| # | Conflict | Risk if ignored | Mitigation |
| --- | --- | --- | --- |
| 1 | `CharacterProfile` is **story-only**; story/scene workers **wipe and recreate** characters | Series continuity and approved refs destroyed | Series-scoped `SeriesCharacter` + refs; episode adapter **projects** locked character snapshots into each episode `Story` without calling wipe-regen paths; harden workers to skip character replace when `payload.preserveCharacters` / series metadata set |
| 2 | `AutomationConfig` is single per user | Morning/evening lanes cannot live there | Separate `SeriesAutomationConfig` + `SeriesLane` |
| 3 | `ContentPlan` / `ContentSchedule` assume one-off ideas | Lane progression / replacement would collide with daily planner | Dedicated Series schedule + production-run models; **do not** enqueue automation-daily-planner for series |
| 4 | `VideoProject` ≠ series | Overloading projects confuses UI/API | New `StorySeries` / `SeriesEpisode`; optional link episode → `storyId` / `videoProjectId` |
| 5 | Closed `GenerationJobType` / `JOB_TYPE_TO_QUEUE` | New planning jobs need registration | Add Series-specific queue names + optional job types **or** host Series planning on API like automation (Nest DI) without overloading STORY job type |
| 6 | Global emergency stop pauses automation queues | Series must honour the same stop honestly | Series cron/orchestrator checks same `EmergencyStopService` / Setting flags; register Series queues in pause/drain lists |
| 7 | Publishing idempotency | Duplicate posts | DB unique `SeriesSchedule.idempotencyKey` + publication state machine + reconcile (copy automation publish pattern) |
| 8 | Shared FFmpeg / provider budgets | Series + standalone can starve VPS | Shared budget service extension or Series budget fields; default concurrency 1; disk/backlog checks |
| 9 | Analytics keyed by render/story | Series rollups missing | Later: tag `ProviderUsage.metadata` / episode IDs; do not block Phase B |
| 10 | Name collisions | Prisma `Project`/`Scene`/`Schedule` | Prefer `StorySeries`, `SeriesEpisode`, `EpisodeScene` (series canon), `SeriesSchedule` |

**No existing Series code was found** (grep clean aside from unrelated analytics wording).

---

## 4. Design principles

1. **Isolation:** Standalone automation and Series Studio share infrastructure, not business state.
2. **Lane isolation:** MORNING and EVENING never share active series, characters, memory, or schedules.
3. **Reuse media pipeline:** Episode → adapter → existing Stories/Visuals/Motion/Narration/Rendering/Publishing.
4. **Canon before production:** Full movie plan + ending exist before Episode 1 production.
5. **Idempotent scheduling:** Uniqueness in Postgres + deterministic Bull job IDs; reconcile uncertain publishes.
6. **Feature switches are real:** Disabled switches do not enqueue new work; pause is per-lane; disabling publish does not delete assets.
7. **Low resource defaults:** Max concurrent episode production = 1; sequential renders.
8. **Honest readiness:** Completion report will not claim live provider/VPS readiness from mocks alone.

---

## 5. Target domain model (logical)

```text
User
 └─ SeriesAutomationConfig          (global Series switches + budgets)
 └─ SeriesLane (MORNING | EVENING)  (schedule, timezone, status, activeSeriesId)
      ├─ active StorySeries
      ├─ SeriesReplacementPlan[]
      └─ SeriesSchedule[]

StorySeries
 ├─ SeriesBible (1:1 structured tables / versioned sections — not one blob)
 ├─ SeriesCharacter[] → CharacterReferenceAsset (→ MediaAsset)
 ├─ SeriesEpisode[] (unique seriesId+episodeNumber)
 │    ├─ EpisodeScene[] (series script/canon scenes)
 │    ├─ SeriesContinuitySnapshot[] (pre/post)
 │    ├─ SeriesProductionRun[]
 │    └─ links: storyId?, videoProjectId?, videoRenderId?
 ├─ SeriesMemoryEvent[] (immutable)
 └─ quality / approval fields
```

### 5.1 Mapping required product entities → Prisma (planned)

| Product entity | Planned model | Notes |
| --- | --- | --- |
| Global Series config | `SeriesAutomationConfig` | Independent of `AutomationConfig` |
| Morning/Evening lane | `SeriesLane` | Enum `MORNING` \| `EVENING`; unique `(userId, laneType)` |
| Movie | `StorySeries` | Title, slug, genre, visual style, plannedEpisodeCount, lifecycle |
| Bible | `SeriesBible` | Structured columns + optional versioned JSON sections for large arcs |
| Character | `SeriesCharacter` | Canon identity; optional projection → per-episode `CharacterProfile` |
| Reference assets | `CharacterReferenceAsset` **or** reuse `CharacterVisualReference` via bridge | Prefer link to existing `MediaAsset`; avoid duplicate blob storage |
| Episode | `SeriesEpisode` | `@@unique([seriesId, episodeNumber])` |
| Episode scenes (canon) | `EpisodeScene` | Distinct from `StoryScene` until adapter materializes production scenes |
| Continuity | `SeriesContinuitySnapshot` | Pre/post episode structured state |
| Memory | `SeriesMemoryEvent` | Append-only; knowledge/visibility rules |
| Schedule | `SeriesSchedule` | Lane + episode + publish destinations + idempotency key |
| Production attempt | `SeriesProductionRun` | Provider usage summary, Bull job IDs, retries, costs |
| Replacement | `SeriesReplacementPlan` | Unique active plan per `(laneId, sourceSeriesId)` |

Detailed column design → Phase B document `docs/SERIES_STUDIO_DATABASE.md`.

### 5.2 Reuse vs new for character/media

- **Reuse:** `MediaAsset`, fal character-reference queue, signed/time-limited URL helpers, visual style packs where applicable.
- **New:** Series-level character registry and approved reference versions.
- **Adapter:** On episode production start, upsert `CharacterProfile` rows on the episode `Story` from approved `SeriesCharacter` snapshots; set worker flag to **preserve** characters during scene planning.

---

## 6. Service architecture (planned modules)

New Nest module: `apps/api/src/modules/series/`

| Service | Responsibility |
| --- | --- |
| `SeriesConfigService` | GET/PATCH global Series switches; independence from `AutomationConfig` |
| `SeriesLaneService` | Lane CRUD, pause/resume, schedule/timezone, active series pointer |
| `MovieArchitectService` | Multi-step Gemini movie plan → bible + outlines + quality gate |
| `CharacterDirectorService` | Series characters + reference image jobs via Visuals |
| `EpisodeDirectorService` | Continuity-aware episode script + `EpisodeScene` breakdown |
| `ContinuityEngineService` | Load compact context; validate pre-approve / pre-visual |
| `StoryQualityEvaluatorService` | Structured scores + thresholds (not viral prediction) |
| `SeriesReplacementService` | Threshold trigger, candidates, approval, activate next |
| `SeriesPipelineAdapterService` | Episode → Story/project + call existing domain services |
| `SeriesOrchestratorService` | Advance production runs (like automation orchestrator, Series-owned) |
| `SeriesPublishSchedulerService` | Due lane publishes → existing `PublishingService` |
| `SeriesSchedulerCron` | Enqueue-only tick behind Redis lock `cron:series` |
| `SeriesNotificationService` | Wrap `NotificationsService` with Series types |
| `SeriesAuditService` | Audit log (extend `AutomationAuditLog` with series actions **or** `SeriesAuditLog`) |

Shared package addition: `packages/shared/src/series-ai/` (schemas, prompts, JSON schemas, mocks, constants, notification type keys).

Worker: **prefer API-hosted Series planning/orchestrator/publish queues** (Nest DI), same as automation. Media stages remain on `apps/worker`.

---

## 7. Dedicated Series queues

Add to `QUEUE_NAMES` / `ALL_QUEUE_NAMES` (new names only):

| Queue | Host | Purpose |
| --- | --- | --- |
| `series-story-planning` | API | Movie Architect multi-step |
| `series-character-generation` | API | Character Director + enqueue ref images |
| `series-episode-planning` | API | Episode Director |
| `series-episode-production` | API | Adapter + orchestrate existing pipeline |
| `series-continuity-validation` | API | Continuity validator jobs |
| `series-replacement-planning` | API | Replacement workflow |
| `series-publishing` | API | Due schedule → PublishingService |
| `series-maintenance` | API | Stuck recovery, missed slots, cleanup |

**Do not** create parallel `series-ffmpeg` or `series-gemini-story` media queues.

---

## 8. Lane scheduler behaviour

Lightweight cron (every minute, Redis lock `cron:series`, enqueue-only):

For each user with Series enabled, for each **enabled, non-paused** lane:

1. Resolve local time via lane IANA timezone (reuse `packages/shared/src/automation/timezone.ts` / slots helpers where possible).
2. If publish time due: find next unpublished **approved + rendered + validated** episode; create `SeriesSchedule` with unique idempotency key; enqueue `series-publishing`.
3. If production backlog below concurrency and auto-production switches allow: enqueue next episode planning/production.
4. If published episode number ≥ replacement threshold and no open plan: enqueue `series-replacement-planning` (unique per source series).
5. Detect missed schedules → notify; reconcile publish outcomes; recover stuck `SeriesProductionRun`s.
6. Honour global emergency stop / Series emergency switch / per-feature flags.

**Independence rule:** Morning pause skips only MORNING; evening continues.

---

## 9. Episode → existing pipeline adapter

```text
SeriesEpisode (APPROVED script + scenes)
        │
        ▼
SeriesPipelineAdapterService
  • create/update Story (title, narration, duration, style)
  • project SeriesCharacter → CharacterProfile (+ CharacterVisualReference from approved refs)
  • create StoryScenes from EpisodeScenes (no Gemini scene wipe)
  • optionally create VideoProject
        │
        ▼
SeriesOrchestratorService + series-episode-production queue
  MATERIALIZE → VISUAL (skipCharacterReferences) → MOTION → NARRATION → SPEECH → RENDER → DONE
        │
        ▼
Validate render → mark SeriesEpisode RENDERED / production COMPLETED
        │
        ▼
Series publish scheduler → PublishingService.publishRender → social-* worker queues
        │
        ▼
reconcilePublishOutcomes (PublishRecord statuses) → SeriesEpisode PUBLISHED + replacement hooks
```

Character preserve: scene-planning / story-generation workers honour `payload.preserveCharacters` and skip `characterProfile.deleteMany`.

Narration: unattended production auto-approves READY scripts before render (same pattern as standalone automation).

Never publish without successful render validation (existing readiness checks). Live publish requires a completed `VideoRender` with output media; mock/dry-run can still advance scheduler tests without social spend.

---

## 10. Movie Architect / Continuity / Quality (AI design)

### Movie Architect (multi-step)

Avoid one giant completion for 10–60 episodes:

1. Premise + logline + genre + world rules  
2. Character roster + relationships + secrets/knowledge map  
3. Full arc (beginning / middle / climax / ending) — **ending required before any episode production**  
4. Episode outlines (batched, e.g. 5–10 per call) + cliffhanger/payoff map  
5. Quality evaluation gate → accept or regenerate  

All steps: Zod + JSON Schema + retries + cancellation + `ProviderUsage`.

### Continuity Engine

- Persist `SeriesMemoryEvent` + snapshots; never only chat history.
- Build **compact** Gemini context: bible digest, last N episodes summaries, open mysteries, relationship matrix, knowledge sets.
- Validate twice: pre-script-approval and pre-visual.
- On contradiction: structured errors + suggested regen; **no silent canon overwrite**.

### Quality Evaluator

Scores: originality, character depth, engagement, suspense, coherence, progression, cliffhanger/payoff, dialogue, continuity, resolution. Configurable thresholds. Explicitly **not** a virality predictor; analytics remain separate feedback.

---

## 11. Replacement planning

Default (configurable): planned count 10, trigger at episode **8**.

```text
Ep 8 published → series-replacement-planning (idempotent)
  → concepts → quality → full architect → characters/refs → validate
  → SeriesReplacementPlan READY_FOR_REVIEW (+ notify)
Ep 9–10 continue on current series
Activate next series only on explicit approve OR auto-approval flag (default OFF)
Next publish cycle uses new series Ep 1 if ready; else notify “no ready next episode”
```

Unique constraint prevents duplicate plans for the same `(laneId, sourceSeriesId)` while open. Manual `POST .../lanes/:id/replace` allowed anytime.

---

## 12. API surface (planned)

Namespace: `/api/series` (Nest `@Controller('series')`), same auth/`{ success, data }` conventions as `/api/automation`.

| Method | Path | Purpose |
| --- | --- | --- |
| GET/PATCH | `/series/config` | Global Series switches |
| GET | `/series/lanes` | List lanes |
| PATCH | `/series/lanes/:id` | Lane settings |
| POST | `/series/lanes/:id/pause` \| `/resume` | Per-lane control |
| POST | `/series/lanes/:id/replace` | Manual next-movie planning |
| POST | `/series/generate` | Create/plan movie for a lane |
| GET | `/series` | Library |
| GET | `/series/:id` | Detail |
| GET | `/series/:id/bible` | Bible |
| GET | `/series/:id/characters` | Characters |
| GET | `/series/:id/episodes` | Episodes |
| GET | `/series/:id/episodes/:episodeId` | Episode detail |
| POST | `/series/:id/episodes/:episodeId/generate` | Episode Director |
| POST | `/series/:id/episodes/:episodeId/approve` | Approve |
| POST | `/series/:id/episodes/:episodeId/regenerate` | Regenerate |
| POST | `/series/:id/episodes/:episodeId/produce` | Start media pipeline production |
| GET | `/series/:id/episodes/:episodeId/production` | Production run status |
| POST | `/series/:id/episodes/:episodeId/production/cancel` | Cancel production |
| POST | `/series/lanes/:id/ensure-schedule` | Create next publish schedule |
| POST | `/series/schedules/:scheduleId/publish` | Force social publish handoff |
| POST | `/series/publishing/reconcile` | Reconcile PublishRecord outcomes |
| POST | `/series/:id/approve` | Approve series / replacement |
| GET | `/series/scheduler/status` | Scheduler health |
| GET | `/series/:id/continuity` | Snapshots + memory |

Ownership checks on every series/lane/episode; DTO validation; pagination on lists; idempotency keys on generate/publish/replace.

---

## 13. Frontend plan

Nav group: **Series Studio** (`apps/web`).

| Page | Route | Status |
| --- | --- | --- |
| Overview | `/series` | Done — lanes, controls, generate |
| Library | `/series/library` | Done |
| Series detail | `/series/:id` | Done — bible + episodes |
| Episode manager | `/series/:id/episodes/:episodeId` | Done — script/approve/produce |
| Character studio | `/series/:id/characters` | Done |
| Settings | `/series/settings` | Done — feature switches + lane times |

Follows existing PageHeader / card / form patterns; persists via GET/PATCH like Automation Settings. All toggles call real `/api/series` endpoints.

---

## 14. Feature switches (independent)

Persist on `SeriesAutomationConfig` (+ lane-level enable on `SeriesLane`):

- Series Studio enabled  
- Morning / Evening lane enabled  
- Automatic movie planning  
- Automatic character generation  
- Automatic episode script generation  
- Automatic visual / narration / rendering / publishing  
- Automatic replacement planning  
- Automatic replacement approval (**default OFF**)  
- Episode approval requirement  
- Budget + concurrency limits  
- Emergency stop (Series-scoped and/or honour global ops stop)

Disabled switch ⇒ scheduler/orchestrator **no-ops** for that capability. Pause lane ⇒ other lane unaffected. Disable publishing ⇒ keep assets.

---

## 15. Notifications & audit

Reuse `Notification` (`userId` + `dedupeKey`) with new types, e.g.:

- `series.movie_planned`, `series.replacement_ready`, `series.episode_needs_approval`
- `series.episode_rendered`, `series.episode_scheduled`, `series.episode_published`
- `series.production_failed`, `series.no_ready_episode`, `series.budget_reached`

Audit: record config changes, approvals, pause/resume, replacement decisions (Series audit table or namespaced actions in existing audit log).

---

## 16. Testing strategy (Phase I)

| Layer | Focus | Status |
| --- | --- | --- |
| Unit | Continuity rules, lane timezone scheduling, replacement trigger, Zod schemas, adapter mapping, security defaults | Done (Series specs under `apps/api` + `packages/shared`) |
| Integration | Config independence from `AutomationConfig`; dual-lane isolation; idempotent schedule keys | Covered in unit helpers; full DB integration via CI recommended |
| E2E (mock AI) | Full morning+evening movies; replacement approval gate; pause isolation; publish reconcile | Not executed live in this delivery — see completion report non-claims |
| Explicit non-claims | Live Gemini / fal / Hailuo / social / VPS only when authorized and recorded in completion report | Documented |

Regression: existing `automation.e2e-spec.ts` and story pipeline e2e must stay green in CI before promote.

---

## 17. Implementation sequence

| Phase | Deliverable | Production code? |
| --- | --- | --- |
| **A** | This document + conflict report | **Docs only** ✓ |
| **B** | Prisma models, migration, domain config/lane services | **Done** — see `SERIES_STUDIO_DATABASE.md`; `/api/series/config` + lanes |
| **C** | Movie Architect, bible, characters, quality | **Done** — multi-step Gemini + mocks; `/api/series/generate`, library, bible, characters, approve |
| **D** | Episode Director + Continuity Engine | **Done** — episode scripts/scenes/memory; continuity validate pre-approve + pre-visual; `/api/series/:id/episodes/...` + `/continuity` |
| **E** | Queues, scheduler, replacement planning | **Done** — see `SERIES_STUDIO_SCHEDULER.md`; lane cron + replacement + dry-run publish state machine |
| **F** | Pipeline adapter → existing video stages | **Done** — `SeriesPipelineAdapterService` materializes Story/scenes/characters (preserve refs); `SeriesOrchestratorService` advances VISUAL→MOTION→NARRATION→SPEECH→RENDER; queue `series-episode-production`; `POST .../produce`; worker `preserveCharacters` |
| **G** | Social publishing integration | **Done** — live `PublishingService.publishRender` handoff; `SeriesSchedule.publishRecordIds` + reconcile; dry-run retained via `SERIES_PUBLISH_DRY_RUN` / `SOCIAL_USE_MOCK` |
| **H** | Frontend Series Studio | **Done** — nav group + `/series` overview, library, detail, episode manager, characters, settings; real API toggles/actions |
| **I** | Tests, security review, ops docs, controlled deploy | **Done** — unit suites; security review (0 critical/high); `SERIES_STUDIO_API.md`, `OPERATIONS.md`, `COMPLETION_REPORT.md` |

Follow-on docs:

- `SERIES_STUDIO_DATABASE.md`
- `SERIES_STUDIO_API.md`
- `SERIES_STUDIO_SCHEDULER.md`
- `SERIES_STUDIO_OPERATIONS.md`
- `SERIES_STUDIO_COMPLETION_REPORT.md`
- `SERIES_GROK_LITE_PHASE1.md`
- `SERIES_CHARACTER_IDENTITY_PHASE2.md`
- `SERIES_DURATION_LEVELS.md`

---

## 18. Explicit non-goals / do-not-touch list

**Do not duplicate:** Gemini provider, fal/Hailuo/Kling/xAI video adapters, TTS, FFmpeg, MinIO, ProviderUsage ledger, social OAuth/publish processors, JWT auth.

**Do not silently modify:** `AutomationConfig` defaults, automation cron behaviour, daily planner fingerprints, or standalone story UX as part of Series work.

**Do not:** queue large binaries in Redis; run two FFmpeg renders by default; auto-approve replacements by default; claim production readiness from compile/mocks alone.

---

## 19. Phase A verdict

| Question | Answer |
| --- | --- |
| Can Series Studio be added cleanly? | **Yes**, as a parallel module + DB namespace + queues, adapting episodes into `Story` pipeline. |
| Biggest technical conflict? | **Story-scoped character wipe on regen** — must be solved in adapter + worker preserve path before episodic production. |
| Biggest product conflict? | **Single `AutomationConfig` / single-story schedules** — lanes and series state must be new tables. |
| Safe to start Phase B? | **Yes**, after stakeholder acceptance of this architecture. |
| Production code changed in Phase A? | **No.** |

---

## 20. Recommended Phase B first commits (preview)

1. `packages/shared` Series constants, enums, Zod stubs, queue name constants.  
2. Prisma models + migration (empty services behind feature flag `seriesStudioEnabled=false` default).  
3. Nest `SeriesModule` with config/lane GET-PATCH only.  
4. Unit tests proving `AutomationConfig` untouched when Series config changes.  

No worker media changes until Phase F adapter lands with character-preserve safeguards.
`)