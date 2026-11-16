# Series Studio — Full Autonomy Audit (Phase 1)

**Date:** 2026-11-16  
**Method:** Code + docs inspection (backend services, Prisma, queues, settings/overview UI, existing unit tests).  
**Supersedes stale claims in:** `SERIES_STUDIO_LIFECYCLE_AUDIT.md` where they conflict with current code.

---

## 1. Verdict

Series Studio already has most of the **machinery** for lights-out production:

- Dynamic lanes, creative settings + plan-time snapshot
- Cron (movie planning, production windows, publish tick, replacement, budget, maintenance)
- Orchestrator stage gates + handoffs after episode approve / render
- Publish dry-run vs live split, MISSED recovery, concurrency=1

It is **not** fully autonomous today because:

1. There is **no `autonomyMode`** — only fragmented approval/stage switches.
2. Defaults still require **movie + episode human approval**.
3. **Movie auto-approve skips `afterMovieApproved`**, so the lifecycle can stall until the next cron minute (or forever if cron eligibility does not fire).
4. **Replacement auto-approve does not activate** the next movie (except a limited post-final-publish path).
5. **Post-render series QC** and **pre-visual continuity on the auto path** are missing.
6. Settings/overview UI is still an **approval-oriented** control surface.

**Mock AI ≠ autonomy.** They remain separate concerns.

---

## 2. Existing building blocks (reuse — do not duplicate)

| Area | Entry points |
|------|----------------|
| Config / lanes | `series-config.service.ts`, `series-lane.service.ts` |
| Movie planning | `movie-architect.service.ts`, queue `series-story-planning` |
| Characters | `character-director.service.ts` (refs default approved) |
| Episode scripts | `episode-director.service.ts`, continuity inline |
| Production | `series-orchestrator.service.ts` + existing media queues |
| Handoffs | `series-lifecycle-handoff.service.ts` |
| Cron | `series.cron.ts` |
| Publish | `series-publish-scheduler.service.ts` → `PublishingService` |
| Replacement | `series-replacement.service.ts` |
| Run Now / history | `series-execution.service.ts` |
| Creative merge | `packages/shared/src/series/creative-settings.ts` |
| Scheduler math | `packages/shared/src/series/scheduler.ts` |

---

## 3. Human / policy approval gates (current)

| Gate | Default | Auto-bypass today | Notes |
|------|---------|-------------------|-------|
| Movie approval | ON | `movieApprovalRequired=false` | Auto path does **not** call handoff |
| Episode approval | ON | `episodeApprovalRequired=false` | Auto path **does** call handoff |
| Character refs | N/A | Generated `isApproved: true` | No HTTP approve UX |
| Narration (media) | Auto | Orchestrator `approveScript` | Not a Series human gate |
| Replacement plan | OFF auto | `automaticReplacementApproval` | Does not activate lane |
| Replacement activate | Manual / end-of-series | `maybeActivateReadyReplacement` | Limited |
| Publishing | OFF | `automaticPublishing` | Independent of production |
| Production window | `NEXT_WINDOW` | Lead time | `MANUAL` mode blocks auto produce |
| Stage switches | ON | Orchestrator gates | No silent skip |
| Emergency stop / budget | Active | — | Must remain |

Run Now **never** dispatches when resolved action is `AWAIT_SERIES_APPROVAL` / `AWAIT_EPISODE_APPROVAL`.

---

## 4. Disconnected lifecycle transitions

| Transition | Status |
|------------|--------|
| Plan → movie approve → characters/scripts | Manual approve OK; **auto-approve movie missing handoff** |
| Episode script → produce | Connected when auto-approved or manually approved |
| Render → schedule | Connected via `afterEpisodeRendered` if publishing ON |
| Movie complete → next movie | Replacement planning OK; activation incomplete for autonomy |
| Cron script of unapproved active movie | **Gap** — no approvalStatus check before script enqueue |
| `creativeSettingsSnapshot` | Written at plan; **not read** by episode director |
| Continuity `pre_visual` | Exists; **not** on orchestrator auto path |
| Post-render QC | **Missing** at Series layer |

---

## 5. Defaults vs user intent

| Setting | Code default | User goal for FULLY_AUTONOMOUS |
|---------|--------------|--------------------------------|
| `timezone` | `UTC` | Prefer `Africa/Lagos` for this deployment (lane-configurable) |
| Approvals | Required | No routine approval |
| Publishing | Off | On when channels ready + autonomous |
| Replacement auto-approve | Off | On + activate when policy allows |
| Concurrency | 1 | Keep 1 (VPS) |

**Migration safety:** New `autonomyMode` must default to **`MANUAL`** so existing users are not silently flipped into autonomous publishing/production.

---

## 6. Implementation plan (logical phases)

### Phase 2 — `autonomyMode` (foundation)
- Add enum `MANUAL` | `FULLY_AUTONOMOUS` on `SeriesAutomationConfig` (default `MANUAL`).
- Shared helpers: `isFullyAutonomous`, effective approval flags (autonomy overrides legacy switches without deleting them).
- Wire movie/episode/replacement/execution/cron/handoff.
- Fix auto-approved movie → `afterMovieApproved`.
- UI: primary autonomy control; hide/dim routine approval toggles when autonomous; show override banner.

### Phase 3 — Creative per lane
- Expand lane settings UI (genres, themes, exclusions, duration, episodes, timezone preset).
- Default new lanes / ensureDefaultLanes timezone → `Africa/Lagos` for this product default (document; keep migration non-destructive for existing rows unless explicitly backfilled).
- Episode director: prefer `creativeSettingsSnapshot` from series metadata when present.

### Phase 4–5 — Planning & production
- Mostly present; tighten cron eligibility (approved movie or autonomous), ensure replacement → next plan → first episode without human steps under autonomy.
- When movie completes, ensure successor planning under `automaticMoviePlanning` / replacement.

### Phase 6 — Automated QC
- Series post-render quality check service (duration, render asset, aspect, audio readiness).
- Gate `ensureNextSchedule` / publish on QC pass; retry/regenerate hooks where safe; block + record failures.

### Phase 7–9 — Publishing / scheduler / replacement
- Keep dry-run ≠ live success.
- Auto-activate approved replacement under FULLY_AUTONOMOUS when current movie completes.
- Preserve emergency stop, budgets, MISSED recovery, idempotency.

### Phase 10–12 — UI + observability
- Settings regrouped around Studio / Autonomy / Automation / Production / Creative / Lanes.
- Dashboard = monitoring (statuses, blockers, costs, next publish) — not approval queue.
- Enrich `SeriesExecution` result summaries (trigger, QC, publish).

### Phase 13–14 — Tests + docs
- Unit: autonomy bypasses approvals; MANUAL retains them; handoffs fire.
- Mock E2E acceptance script/test for dual-lane autonomous path.
- Update API/ops/env/completion report with honest verification matrix.

---

## 7. Explicit non-claims (until verified)

- Live Gemini / fal / motion providers under load
- Live Facebook / Instagram / TikTok / YouTube posts
- VPS dual-lane FFmpeg beyond concurrency=1 policy
- Full Nest+Redis+DB integration suite (to be added)

---

## 8. Priority order for coding

1. Schema + shared autonomy helpers + safe migration  
2. Effective approval resolution everywhere  
3. Movie auto-approve handoff fix  
4. Replacement auto-activate under autonomy  
5. Cron approved-movie guard  
6. Post-render QC gate  
7. Settings + overview UI  
8. Tests + documentation  
