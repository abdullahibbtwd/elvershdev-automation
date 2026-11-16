# AI Series Studio — Scheduler

**Phase:** E  
**Lock key:** `cron:series` (Redis `DistributedLockService`)  
**Process gate:** `shouldRunSchedulers()` / `PROCESS_ROLE`  
**Disable:** `SERIES_CRON_DISABLED=true`, `SERIES_QUEUE_HOST_DISABLED=true`

---

## 1. Design

The Series scheduler follows the standalone automation pattern:

1. **Cron is enqueue-only** (`SeriesCronService`, every minute).
2. **Workers own side effects** (`SeriesQueueHost` on the API process).
3. **Postgres uniqueness** prevents duplicate schedules/replacements (`idempotency_key`).
4. **Bull job IDs** are deterministic soft locks (`series-pub:{scheduleId}`, `series-replace-job:{planId}`, etc.).
5. Morning and evening lanes are evaluated independently; pausing one never gates the other.

---

## 2. Tick flow

```text
@Cron EVERY_MINUTE
  → Redis lock cron:series
  → if global emergency stop: maintenance only
  → enqueue series-maintenance (recover_stuck, missed_schedules)
  → enqueue series-publishing tick (minute job id)
  → for each enabled SeriesAutomationConfig (ENABLED):
       for each enabled ACTIVE lane (respect morning/evening switches):
         refresh nextPublishAt + nextProductionAt
         budget check (AutomationBudgetService)
         if local publishTime due + automaticPublishing:
           ensureNextSchedule (unique SeriesSchedule)
         if automaticMoviePlanning && no active series:
           enqueue series-story-planning
         if productionEligible (lead time / start mode) && automaticEpisodeProduction:
           if automaticEpisodeScriptGeneration: enqueue next PLANNED script
           if any media stage ON: enqueue next APPROVED+IDLE production
         if automaticReplacementPlanning:
           maybeEnqueueThresholdReplacement
```

Timezone math uses existing helpers (`getZonedParts` / `zonedDateTimeToUtc`) plus Series helpers:

- `isLanePublishDue` / `computeNextPublishAt`
- `computeNextProductionAt` / `isLaneProductionEligible` / `computeProductionClockTime`
- `isSeriesStageAutoEnabled` (master ∧ stage)
- `shouldTriggerReplacement`

Production window is **independent** of publish minute: e.g. publish 08:00 + lead 240 → production opens 04:00. Publishing still waits for the configured publish time and a completed render.

---

## 3. Queues (API-hosted)

| Queue | Concurrency | Role |
| --- | --- | --- |
| `series-story-planning` | 1 | Movie Architect |
| `series-character-generation` | 1 | Character refs |
| `series-episode-planning` | 1 | Episode Director |
| `series-episode-production` | 1 | Adapter + existing media pipeline orchestrator |
| `series-continuity-validation` | 1 | Continuity validator |
| `series-replacement-planning` | 1 | Next movie planning |
| `series-publishing` | 1 | Due schedules → PublishingService / dry-run |
| `series-maintenance` | 1 | Stuck recovery / missed windows |

Default production concurrency remains **1** for Series work.

---

## 4. Publishing state machine (Phase E)

`SeriesSchedule.state`:

`PENDING → SCHEDULED → QUEUED → PUBLISHING → PUBLISHED`  
Recoverable branches: `FAILED`, `MISSED`, `CANCELLED`, `SKIPPED`

**Idempotency**

- Unique `(episodeId, laneId)`
- Unique `idempotencyKey = series-sched:{laneId}:{episodeId}`

**Honesty**

- Without `videoRenderId`, live mode returns to `SCHEDULED` with `Waiting for rendered video`.
- Live mode calls `PublishingService.publishRender` (existing `social-publishing` queues), stores `publishRecordIds`, stays `PUBLISHING` until reconcile.
- `reconcilePublishOutcomes` promotes the schedule/episode to `PUBLISHED` when ≥1 channel succeeds and all records are terminal; all-fail → `FAILED`.
- Dry-run / mock (`SERIES_PUBLISH_DRY_RUN`, `SOCIAL_USE_MOCK`, `NODE_ENV=test`, or `useMockSocial`) can mark `PUBLISHED` to exercise replacement triggers without social spend.

---

## 5. Replacement planning

Default trigger: lane `lastPublishedEpisodeNumber >= replacementTriggerEpisode` (example: 8 of 10).

1. Create/find `SeriesReplacementPlan` with `idempotencyKey = series-replace:{laneId}:{sourceSeriesId}`
2. Partial unique index prevents duplicate **open** plans
3. Movie Architect generates a **replacement candidate** (`asReplacementCandidate`, not activated)
4. Notify `series.replacement_ready`
5. Current series continues through remaining episodes
6. Activation only via explicit approve+activate (or `automaticReplacementApproval`, default **OFF**)
7. On final episode publish (dry-run/live later), an **APPROVED** plan may auto-activate

Manual: `POST /api/series/lanes/:id/replace`

---

## 6. Feature-switch gates

| Switch | Effect when false |
| --- | --- |
| `seriesStudioEnabled` / `runMode` | Cron skips user |
| `morningLaneEnabled` / `eveningLaneEnabled` | That lane skipped |
| Lane `PAUSED` / `DISABLED` | That lane skipped |
| `automaticPublishing` | No new `SeriesSchedule` |
| `automaticEpisodeScriptGeneration` | No auto episode enqueue |
| `automaticReplacementPlanning` | No threshold enqueue |
| Global emergency stop Setting | New Series work skipped |

Disabling publishing does **not** delete schedules, episodes, or media.

---

## 7. API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/series/scheduler/status` | Lanes, switches, queues, replacement sample |
| `POST /api/series/lanes/:id/replace` | Manual next-movie planning |
| `GET /api/series/lanes/:id/replacements` | Replacement history |
| `POST /api/series/replacements/:planId/approve` | Approve candidate |
| `POST /api/series/replacements/:planId/activate` | Make active series |
| `POST /api/series/replacements/:planId/reject` | Reject candidate |
| `POST /api/series/lanes/:id/ensure-schedule` | Create next schedule now |

---

## 8. Multi-instance safety

- Only `PROCESS_ROLE=all|scheduler` runs cron + Series queue hosts.
- Redis lock `cron:series` prevents duplicate ticks.
- Duplicate schedule/replacement inserts collide on unique keys and are treated as no-ops.
- Duplicate Bull adds with the same `jobId` are ignored by BullMQ.

---

## 9. What Phase E does **not** claim

- Live social posts (Phase G) — **Done** via PublishingService handoff + PublishRecord reconcile
- Full video pipeline production orchestration (Phase F) — **Done** via `SeriesOrchestratorService`
- VPS load testing of cron under production traffic
`)