# AI Series Studio — Operations

**Audience:** operators deploying/running Series Studio alongside the existing video platform.  
**Related:** `SERIES_STUDIO_SCHEDULER.md`, `SERIES_STUDIO_DATABASE.md`, `.env.production.example`

---

## 1. Process roles

| Concern | Gate |
| --- | --- |
| Cron tick | `shouldRunSchedulers()` / `PROCESS_ROLE` |
| Queue host workers | `shouldRunQueueHosts()` / `PROCESS_ROLE` |
| Redis lock | `cron:series` via `DistributedLockService` |

Disable without code changes:

```bash
SERIES_CRON_DISABLED=true
SERIES_QUEUE_HOST_DISABLED=true
```

---

## 2. Feature switches (runtime)

Persisted on `SeriesAutomationConfig` (UI: `/series/settings`):

| Switch | Default intent |
| --- | --- |
| `seriesStudioEnabled` | **false** until explicitly enabled |
| `autonomyMode` | **`MANUAL`** — existing rows stay Manual after migration; set `FULLY_AUTONOMOUS` for lights-out |
| Lane morning/evening flags | Gate MORNING/EVENING lanes; CUSTOM lanes use their own `enabled` |
| `automaticEpisodeProduction` | **Master** for auto scripts + media; individual stage switches still apply |
| `automaticMoviePlanning` | Cron may plan a movie when a lane has no active series |
| `automaticPublishing` | Off until channels + render path ready (independent of production) |
| `automaticReplacementPlanning` | Prepare next movie before current ends |
| `automaticReplacementApproval` | **OFF** in Manual; treated as ON under `FULLY_AUTONOMOUS` (also auto-activates) |
| `movieApprovalRequired` / `episodeApprovalRequired` | **ON** in Manual; **effectively OFF** under `FULLY_AUTONOMOUS` (stored values kept) |
| `startMediaAfterMoviePlanning` | **OFF** — plan-ahead does not spend media credits |
| Stage switches (visual/motion/narration/render/script/character) | If OFF while master ON, automatic run **stops** at that stage (no silent skip) |
| `creativeSettings` | Global Series creative defaults (not standalone automation) |
| New lane timezone default | `Africa/Lagos` (existing lane rows are not rewritten) |

**FULLY_AUTONOMOUS behaviour:** auto-approve movie plans (and call lifecycle handoff), auto-approve episode scripts, auto-approve/activate replacements, skip Run Now approval waits, post-render quality gate still required before publish scheduling. Emergency stop, budgets, and stage switches remain.

### Production vs publishing schedule (per lane)

| Field | Role |
| --- | --- |
| `publishTime` + `timezone` | When a rendered episode may publish |
| `productionLeadTimeMinutes` | How early auto prep/media may start (default 240) |
| `preferredProductionTime` | Optional HH:MM override for production open |
| `productionStartMode` | `IMMEDIATE` \| `NEXT_WINDOW` (default) \| `CUSTOM` \| `MANUAL` |
| `nextProductionAt` / `nextPublishAt` | Computed anchors refreshed by cron / lane save |

**Late publish policy:** do not publish incomplete video; mark schedule `MISSED` / delayed; continue production; when rendered, reschedule the **same** `SeriesSchedule` row to the next publish window (`@@unique(episodeId, laneId)` prevents duplicates).

Global emergency stop (`system:automation:emergencyStop`) also skips new Series cron work and blocks **Run Now**. Budget limits reuse `AutomationBudgetService` against Series cron enqueue.

---

## 3. Dynamic lanes

- Defaults: Series A (Morning), Series B (Evening) auto-created.
- Additional CUSTOM lanes via `POST /series/lanes` or UI **Add lane**.
- Duplicate copies config only (no story / bible / characters).
- Soft-delete CUSTOM lanes; morning/evening cannot be deleted (pause/disable).
- Each lane keeps independent active movie, bible, characters, schedule, creative settings, executions.

---

## 4. Run Now / Run All

| Action | Effect |
| --- | --- |
| Per-lane **Run Now** | Resolves next eligible step; enqueues existing queue jobs |
| **Run All Enabled Lanes Now** | Independent per-lane evaluation; one failure does not stop others |

Safety:

- Respects Studio enable, lane pause/disable, emergency stop
- Never bypasses series or episode approvals
- Database-backed `SeriesExecution` + idempotency keys
- Does **not** change the lane publish schedule
- Manual and scheduled paths share Movie Architect / Episode Director / Orchestrator / PublishScheduler

VPS: keep `maxConcurrentEpisodeProduction=1` so FFmpeg/render stays serial. Story planning jobs may share existing queue policies; media rendering remains concurrency-controlled on the worker.

---

## 5. Publish modes

| Mode | When |
| --- | --- |
| Live | Completed `VideoRender` + eligible social channels → `PublishingService` → `social-*` queues |
| Dry-run | `SERIES_PUBLISH_DRY_RUN=true` **or** `SOCIAL_USE_MOCK=true` **or** `NODE_ENV=test` **or** `useMockSocial` |

Dry-run marks schedules/episodes `PUBLISHED` for scheduler/replacement tests **without** social spend. Never treat dry-run as genuine live social publishing.

Reconcile:

```http
POST /api/series/publishing/reconcile
```

---

## 6. Queues (API-hosted, concurrency 1)

- `series-story-planning`
- `series-character-generation`
- `series-episode-planning`
- `series-episode-production`
- `series-continuity-validation`
- `series-replacement-planning`
- `series-publishing`
- `series-maintenance`

Media stages (visual/motion/narration/render) remain on `apps/worker` via existing generation queues.

---

## 7. Safe rollout checklist

1. Migrate DB (`series_studio` Phase B + `20261116160000_series_studio_dynamic_lanes_run_now`).
2. Deploy API + worker with `seriesStudioEnabled=false` default.
3. Confirm Redis auth in production (`REDIS_PASSWORD` set).
4. Enable Studio for one user; leave `automaticPublishing=false`.
5. Generate with `useMockAi=true` / `GEMINI_USE_MOCK=true` first.
6. Approve series → episode → produce with mocks.
7. Use **Run Now** on one lane; confirm execution row + queue job.
8. Flip live AI only with provider keys + budget caps.
9. Enable publishing only with connected channels + completed renders; keep `SERIES_PUBLISH_DRY_RUN=true` until first live post is intentional.
10. Keep `automaticReplacementApproval=false` until ops trust the quality gate.

---

## 8. Monitoring signals

- Notifications: `series.*` types (`EPISODE_NEEDS_APPROVAL`, `PRODUCTION_FAILED`, `NO_READY_EPISODE`, …)
- `GET /api/series/scheduler/status` — run mode, queues, dry-run flags
- `GET /api/series/executions` — manual/scheduled execution history
- `SeriesProductionRun` / `SeriesSchedule` states in DB
- Existing provider usage ledger (no separate Series cost table)

---

## 9. Recovery

| Symptom | Action |
| --- | --- |
| Stuck SCRIPTING episode | Maintenance marks FAILED after 30m |
| Stuck production run | Maintenance requeues `series-episode-production` recover |
| Stuck QUEUED/PUBLISHING without records | Mark FAILED; retry ensure-schedule / publish |
| Stuck PUBLISHING with records | `POST /series/publishing/reconcile` |
| Missed publish window | State `MISSED`; create/recover schedule manually |
| Run Now after refresh | Query `GET /series/executions` / lane execution-view |

---

## 10. Explicit non-claims

Ops must **not** treat the following as proven by this rollout alone:

- Live Gemini / fal / Hailuo / Kling spend under production load
- Live social posts on Facebook / Instagram / TikTok / YouTube
- Multi-region HA / VPS capacity for dual-lane concurrent FFmpeg
- Virality or engagement outcomes from the quality evaluator
