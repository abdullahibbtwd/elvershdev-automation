# Series Studio — Lifecycle Audit (Phase 1)

**Date:** 2026-11-16  
**Method:** Backend + unit tests only (frontend switches are not evidence of behaviour).

---

## Stage-by-stage audit

| Stage | Trigger | Queue / service | Setting | Auto-transition? | Missing | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| Movie planning | Manual `POST /series/generate`, Run Now `PLAN_MOVIE`, (intended) cron | `series-story-planning` → `MovieArchitectService` | `automaticMoviePlanning` (stored) | Characters only if `automaticCharacterGeneration` | **Cron never reads `automaticMoviePlanning`** | `series.cron.ts`, `movie-architect.service.ts`, `series-execution.service.ts` |
| Movie approval | Manual `POST …/approve` | `SeriesLibraryService.approveSeries` | Always required today | Sets `StorySeriesStatus.READY` | No `movieApprovalRequired` switch / auto-approve path | `series-library.service.ts` |
| Character generation | After plan if switch ON; Run Now `GENERATE_CHARACTERS` | `series-character-generation` → `CharacterDirectorService` | `automaticCharacterGeneration` | Does **not** auto-start episode scripts | OK for planning isolation | `movie-architect.service.ts` L239 |
| Episode scripting | Cron every min if switch ON; Run Now | `series-episode-planning` → `EpisodeDirectorService` | `automaticEpisodeScriptGeneration` | Continuity inline; then SCRIPT_READY or APPROVED | **No production lead-time / window**; starts immediately | `series.cron.ts` `enqueueNextEpisodeScript` |
| Continuity validation | Inside episode planning | `series-continuity-validation` + inline | N/A | Blocks persist on failure | OK | `episode-director.service.ts`, `continuity-engine.service.ts` |
| Episode approval | Manual unless `episodeApprovalRequired=false` | `EpisodeDirectorService.approveEpisode` | `episodeApprovalRequired` | Cron only produces `APPROVED` | OK | `episode-director.service.ts` L185 |
| Visuals | Production orchestrator | Existing visual queues via `VisualsService` | `automaticVisualGeneration` | Orchestrator advances all stages | **Switch unused inside orchestrator** | `series-orchestrator.service.ts` (no `automatic*` reads) |
| Motion | Orchestrator | Motion queues via `MotionService` | *(none)* | Always runs after visuals | **No `automaticMotionGeneration`** | `SERIES_PRODUCTION_STAGE_ORDER` |
| Narration + speech | Orchestrator | Narration / speech queues | `automaticNarration` | Always runs | **Switch unused in orchestrator** | `ensureNarration` / `ensureSpeech` |
| FFmpeg render | Orchestrator | `video-rendering` via `RenderingService` | `automaticRendering` | → RENDERED | **Switch unused in orchestrator** | `ensureRender` |
| Ready to publish | `completeDone` | Orchestrator | — | Does not publish | OK | orchestrator `completeDone` |
| Publishing | Cron + `SERIES_PUBLISHING` | `SeriesPublishSchedulerService` → social queues | `automaticPublishing` | Due minute + schedule row | Late/MISSED reschedule weak (`@@unique(episodeId,laneId)` + `schedules: none`) | `series-publish-scheduler.service.ts` |
| Replacement planning | Cron threshold | `series-replacement-planning` | `automaticReplacementPlanning` / `automaticReplacementApproval` | Auto-approve only if second switch | OK | `series-replacement.service.ts` |

---

## Cross-cutting findings

| Concern | Status |
| --- | --- |
| Production vs publish schedule | **Missing** — only `publishTime` / `nextPublishAt`; no lead time |
| Master “Automatic Episode Production” | **Missing** — flat list of stage switches only |
| Plan Movies in Advance / Plan All Lanes | **Missing** as dedicated workflow (generate exists per-lane) |
| Production start modes | **Missing** |
| Stage switch enforcement | **Broken** — cron uses OR of visual/narration/render to *start* production; orchestrator never stops on disabled stage |
| Worker restart | **Partial** — `SERIES_MAINTENANCE` requeues stuck production runs | `series-maintenance.service.ts` |
| Budget / emergency stop | Emergency stop in cron; **budget not enforced** on Series cron |
| Standalone automation isolation | **Intact** — separate config, queues, models |
| FFmpeg concurrency | Series production worker concurrency **1** | `series-queue.host.ts` |

---

## Enum adaptation (no duplicate statuses)

| Desired label | Existing mapping |
| --- | --- |
| DRAFT / PLANNING / AWAITING_APPROVAL | `StorySeriesStatus` + `approvalStatus` |
| APPROVED / READY_FOR_PRODUCTION | `READY` + `APPROVED` |
| SCHEDULED_FOR_PRODUCTION | Lane `productionStartMode` + `nextProductionAt` / episode `productionEligibleAt` |
| PRODUCING / READY_TO_PUBLISH / PUBLISHED / FAILED | Episode `PRODUCING` / `RENDERED` / `PUBLISHED` / `FAILED` |

---

## Implementation priority (post-audit)

1. Production lead-time helpers + lane/config fields — **done**
2. Master + motion switches; orchestrator stage gates — **done**
3. Cron: movie planning, prep window, budget — **done**
4. Plan-ahead / Plan All / Prepare Next APIs — **done**
5. MISSED → next-window reschedule — **done**
6. Settings + overview UI — **done**
7. Tests + docs / completion report — **done**
8. Approve → enqueue next / render → ensure schedule — **done** (`SeriesLifecycleHandoffService`)  
