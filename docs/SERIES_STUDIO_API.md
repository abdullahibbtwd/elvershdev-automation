# AI Series Studio — API

**Namespace:** `/api/series`  
**Auth:** JWT (global `JwtAuthGuard`)  
**Response shape:** `{ success: true, data: ... }`

---

## Config & control

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/series/config` | Get or create Series config (includes `creativeSettings`, `autonomyMode`, effective approval flags) |
| PATCH | `/series/config` | Update feature switches / budgets / global creative settings / `autonomyMode` |

### Autonomy mode

`autonomyMode`: `MANUAL` (default) | `FULLY_AUTONOMOUS`

- **Safe migration:** existing configs default to `MANUAL` — not silently flipped.
- **FULLY_AUTONOMOUS** overrides routine movie/episode/replacement approval gates via *effective* flags. Stored legacy booleans are preserved for when you switch back to Manual.
- Config response includes: `fullyAutonomous`, `autonomyOverridesApprovals`, `effectiveMovieApprovalRequired`, `effectiveEpisodeApprovalRequired`, `effectiveAutomaticReplacementApproval`, `overriddenByAutonomy`.
- **Independent of mock AI** (`useMockAi` / `GEMINI_USE_MOCK`).
| POST | `/series/config/enable` | Enable Studio + run mode ENABLED |
| POST | `/series/config/pause` | Pause Series work |
| POST | `/series/config/resume` | Resume Series work |
| POST | `/series/config/emergency-stop` | Series-scoped emergency stop |

## Lanes (dynamic)

Default lanes **Series A (Morning)** and **Series B (Evening)** are ensured on first access. Additional **CUSTOM** lanes can be created without code changes.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/series/lanes` | List non-deleted lanes |
| POST | `/series/lanes` | Create a CUSTOM lane |
| PATCH | `/series/lanes/:id` | Update name, schedule, creative settings, etc. |
| POST | `/series/lanes/:id/duplicate` | Duplicate config (no story data) |
| DELETE | `/series/lanes/:id` | Soft-delete CUSTOM lane (defaults protected) |
| POST | `/series/lanes/:id/pause` | Pause one lane |
| POST | `/series/lanes/:id/resume` | Resume one lane |
| POST | `/series/lanes/:id/ensure-schedule` | Create next publish schedule |
| POST | `/series/lanes/:id/replace` | Start replacement planning |
| GET | `/series/lanes/:id/replacements` | List replacement plans |
| GET | `/series/lanes/:id/execution-view` | Dashboard snapshot (next action, schedules, blockers) |
| POST | `/series/lanes/:id/produce-next` | Manually start media for next approved episode |

Lane PATCH also accepts production scheduling fields: `productionLeadTimeMinutes`, `preferredProductionTime`, `productionStartMode`, `customProductionStartAt`.

## Instant execution (Run Now) & plan-ahead

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/series/lanes/:laneId/run-now` | Resolve next eligible action and enqueue it |
| POST | `/series/run-all-now` | Run Now for every eligible enabled lane |
| POST | `/series/plan-movies` | **Plan Movies in Advance** for selected or all enabled lanes |
| POST | `/series/prepare-next-episodes` | Prepare next eligible episodes across lanes |
| GET | `/series/executions` | List execution history (`laneId`, `take`, `skip`) |
| GET | `/series/executions/:executionId` | Get one execution |

### Plan Movies (`POST /series/plan-movies`)

Body:

```json
{
  "lanes": [{ "laneId": "...", "ideaMode": "generate" | "custom", "customPremise": "..." }],
  "startMediaProduction": false,
  "useMockAi": true,
  "async": true
}
```

- Omitting `lanes` plans **all enabled** lanes (Series A + B independently).
- Default **does not** start expensive media (`startMediaProduction` / `startMediaAfterMoviePlanning` must be true).
- Complete bible **including ending** is required before approval.

### Run Now behaviour

1. Requires Series Studio enabled; blocks emergency stop / paused / disabled lanes.
2. Resolves the next action (plan movie, await approval, plan episode, produce, schedule, replace, or idle).
3. **Never bypasses** series/episode approval gates.
4. Records a `SeriesExecution` with trigger `MANUAL`, idempotency key, and queue job ids.
5. Returns immediately after enqueue — jobs may still be running.

Body (optional): `{ useMockAi?, customPremise?, useCustomIdea? }`

## Replacement

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/series/replacements/:planId/approve` | Approve candidate (`activate?: boolean`) |
| POST | `/series/replacements/:planId/activate` | Activate approved candidate |
| POST | `/series/replacements/:planId/reject` | Reject candidate |

## Library & series

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/series/generate` | Movie Architect plan (sync or async). Supports `ideaMode: generate\|custom` + `customPremise` |
| GET | `/series` | Library list |
| GET | `/series/:id` | Detail (bible, characters, episodes) |
| GET | `/series/:id/bible` | Bible only |
| POST | `/series/:id/approve` | Approve series / bible |
| POST | `/series/:id/reject` | Reject series |
| GET | `/series/:id/characters` | Characters + refs |
| POST | `/series/:id/characters/references` | Generate missing portraits |
| POST | `/series/:id/characters/:characterId/references` | One portrait |
| GET | `/series/:id/continuity` | Snapshots + memory |

## Episodes

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/series/:id/episodes` | Episode outlines |
| GET | `/series/:id/episodes/:episodeId` | Episode detail |
| POST | `/series/:id/episodes/:episodeId/generate` | Episode Director |
| POST | `/series/:id/episodes/:episodeId/regenerate` | Regenerate (re-approval required) |
| POST | `/series/:id/episodes/:episodeId/approve` | Approve after continuity |
| POST | `/series/:id/episodes/:episodeId/validate-continuity` | Continuity gate |
| POST | `/series/:id/episodes/:episodeId/produce` | Start media pipeline |
| GET | `/series/:id/episodes/:episodeId/production` | Production runs |
| POST | `/series/:id/episodes/:episodeId/production/cancel` | Cancel production |

## Publishing

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/series/scheduler/status` | Scheduler / queue health |
| POST | `/series/schedules/:scheduleId/publish` | Force publish handoff |
| POST | `/series/publishing/reconcile` | Reconcile PublishRecord outcomes |

---

## Ownership

Every series/lane/episode/execution mutation receives `CurrentUser` and services filter by `userId`.

## Idempotency

- Schedule: `series-sched:{laneId}:{episodeId}`
- Publish job: `series-pub:{scheduleId}`
- Replacement: `series-replace:{laneId}:{sourceSeriesId}`
- Publish records: `series-pub:{scheduleId}:{channelId}` (via PublishingService)
- Manual execution: `series-exec:{laneId}:{action}:{seriesId}:{episodeId}:{5minBucket}`

## Creative settings precedence

1. System safety / quality rules (prompts)
2. Global `SeriesAutomationConfig.creativeSettings`
3. Lane `SeriesLane.creativeSettings`
4. Per-request generate overrides (`genre`, `customPremise`, …)
5. Episode-specific requirements

A `creativeSettingsSnapshot` is stored on the StorySeries `metadata` when a movie is planned so later setting edits do not rewrite existing movies.
