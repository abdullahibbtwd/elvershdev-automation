# AI Series Studio — Database Design

**Phase:** B  
**Migration:** `apps/api/prisma/migrations/20261116130000_series_studio_phase_b`  
**Schema:** `apps/api/prisma/schema.prisma`

Series Studio tables are **additive**. They do not alter `automation_configs`, `content_plans`, or `content_schedules`. Standalone automation continues to use its existing models unchanged.

---

## 1. Design goals

1. Two independent lanes (MORNING / EVENING) per user.
2. Full movie canon (bible, characters, episode outlines) before episode production.
3. Continuity as append-only events + per-episode snapshots — not one ever-growing chat JSON blob.
4. Episode production links into existing `Story` / `VideoProject` / `VideoRender` / `MediaAsset` rows.
5. Idempotent publishing via unique `SeriesSchedule.idempotencyKey`.
6. Replacement planning without immediately replacing the active series.

---

## 2. Entity relationship overview

```text
User
 ├─ SeriesAutomationConfig (1:1)
 ├─ SeriesLane (MORNING, EVENING)
 │    ├─ active StorySeries?
 │    ├─ StorySeries[]
 │    ├─ SeriesSchedule[]
 │    └─ SeriesReplacementPlan[]
 └─ SeriesAuditLog[]

StorySeries
 ├─ SeriesBible (1:1)
 ├─ SeriesCharacter[] → CharacterReferenceAsset[] → MediaAsset
 ├─ SeriesEpisode[] (unique seriesId + episodeNumber)
 │    ├─ EpisodeScene[]
 │    ├─ SeriesContinuitySnapshot[] (BEFORE / AFTER)
 │    ├─ SeriesMemoryEvent[]
 │    ├─ SeriesSchedule[]
 │    └─ SeriesProductionRun[]
 │    └─ optional FK → Story, VideoProject, VideoRender
 └─ SeriesMemoryEvent[]
```

---

## 3. Tables

### `series_automation_configs`

Global Series Studio switches and budgets for a user. **Independent** of `automation_configs`.

| Field | Default / notes |
| --- | --- |
| `series_studio_enabled` | `false` |
| `run_mode` | Reuses `AutomationRunMode` (`ENABLED` / `PAUSED` / `EMERGENCY_STOP`) |
| Lane + stage feature booleans | Morning/evening, planning, characters, scripts, visuals, narration, render, publish |
| `automatic_replacement_approval` | **`false`** |
| `episode_approval_required` | `true` |
| `default_planned_episode_count` | `10` |
| `default_episode_duration_seconds` | `60` |
| `default_replacement_trigger_episode` | `8` |
| `max_concurrent_episode_production` | **`1`** |
| Budget fields | Optional daily/monthly/per-episode USD |

### `series_lanes`

| Constraint | Purpose |
| --- | --- |
| `UNIQUE (user_id, lane_type)` | Exactly one morning and one evening lane |
| `active_series_id` unique nullable FK | One active movie pointer per lane |

Defaults: morning `08:00`, evening `19:00`, timezone `UTC`, status `PAUSED`.

### `story_series`

Movie identity + lifecycle (`DRAFT` → `PLANNING` → `READY` → `ACTIVE` → `COMPLETED` / `SUPERSEDED` / `REPLACEMENT_CANDIDATE`, …).  
`UNIQUE (user_id, slug)`.

### `series_bibles`

Versioned structured canon. Large outline/secret/knowledge maps stored as **typed JSON columns**, not a single history blob. Critical prose fields (`premise`, `ending`, acts) are text columns.

### `series_characters` + `character_reference_assets`

Series-scoped identity (not story-scoped `character_profiles`). Reference portraits reuse **`media_assets`**. Approved versions tracked via `is_approved`, `is_primary`, `version`.

> Episode production (Phase F) will project approved series characters into per-episode `CharacterProfile` rows with a preserve flag so story/scene workers do not wipe them.

### `series_episodes`

`UNIQUE (series_id, episode_number)`. Soft links to production: `story_id`, `video_project_id`, `video_render_id`.

### `episode_scenes`

Canon script scenes for the Episode Director (`UNIQUE (episode_id, scene_order)`). Distinct from pipeline `story_scenes` until the adapter materializes production scenes.

### `series_continuity_snapshots`

`UNIQUE (episode_id, point)` where `point` ∈ `{BEFORE, AFTER}`. Structured character/relationship/location/ownership/knowledge state.

### `series_memory_events`

Append-only chronological events with importance, visibility, and knowledge sets (`known_by_character_ids`, `audience_knows`).

### `series_schedules`

Lane + episode publish intent.  
`UNIQUE (idempotency_key)`, `UNIQUE (episode_id, lane_id)`.

### `series_production_runs`

Attempt ledger: status, stage, costs, Bull job ID list, optional `generation_job_id`.

### `series_replacement_plans`

Lane + source series → proposed next series.  
Partial unique index (SQL): one **open** plan per `(lane_id, source_series_id)` while status ∈ pending/planning/evaluating/ready/approved.

### `series_audit_logs`

Series-specific audit (config, lane pause/resume, future approvals). Separate from `automation_audit_logs` so Series actions do not pollute standalone automation history.

---

## 4. Cascade / delete rules

| Parent | Child | On delete |
| --- | --- | --- |
| User | Series config / lanes / series / schedules / runs / plans / audit | Cascade |
| SeriesLane | StorySeries, schedules, replacement plans | Cascade |
| StorySeries | Bible, characters, episodes, snapshots, memory, runs | Cascade |
| SeriesCharacter | CharacterReferenceAsset | Cascade |
| SeriesEpisode | EpisodeScene, snapshots, schedules, runs | Cascade |
| MediaAsset | CharacterReferenceAsset | Cascade |
| Story / VideoProject / VideoRender | SeriesEpisode FKs | SetNull |

Disabling publishing or pausing a lane **does not** delete episodes, renders, or media.

---

## 5. Indexes of note

- Lane work: `(enabled, status)`, `next_publish_at`
- Episode uniqueness: `(series_id, episode_number)`
- Due publishes: `(state, scheduled_at)`, `(user_id, state, scheduled_at)`
- Memory timeline: `(series_id, created_at)`, `(series_id, episode_number)`
- Open replacement uniqueness: partial unique on `(lane_id, source_series_id)`

---

## 6. Reused existing models (no duplicates)

| Existing | Series usage |
| --- | --- |
| `MediaAsset` | Character refs, posters |
| `Story` | Episode production unit after adapter |
| `StoryScene` / visuals / motion / narration / render | Unchanged pipeline |
| `CharacterProfile` / `CharacterVisualReference` | Projected per episode only |
| `VideoProject` / `VideoRender` / `PublishRecord` | Packaging + publish |
| `GenerationJob` / `ProviderUsage` | Job + cost tracking |
| `AutomationRunMode` enum | Shared run-mode vocabulary |
| `Notification` | Series notification types via `dedupe_key` |

---

## 7. Migration safety

- Additive only; no drops of automation tables.
- Defaults keep Series Studio **off** (`series_studio_enabled = false`, lanes `PAUSED`).
- Circular FK `series_lanes.active_series_id` ↔ `story_series` created after both tables exist.
- Apply with: `pnpm db:deploy` (or `pnpm db:migrate` in development).

---

## 8. Phase B API surface using these tables

| Endpoint | Tables touched |
| --- | --- |
| `GET/PATCH /api/series/config` | `series_automation_configs`, ensures `series_lanes` |
| `GET /api/series/lanes` | `series_lanes` |
| `PATCH /api/series/lanes/:id` | `series_lanes` |
| `POST .../pause` \| `/resume` | `series_lanes`, `series_audit_logs`, `notifications` |
| `GET /api/series/scheduler/status` | Read-only config + lanes (queues not hosted until Phase E) |

Canon / episode / production tables are created now for Phase C+ services; they are unused by the Phase B controllers except through schema readiness.
`)