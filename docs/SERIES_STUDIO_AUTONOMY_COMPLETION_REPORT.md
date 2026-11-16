# Series Studio — Full Autonomy Completion Report (in progress)

**Date:** 2026-11-16  
**Audit:** `docs/SERIES_STUDIO_AUTONOMY_AUDIT.md`

---

## 1. Verdict

Phase 1 audit complete. Phase 2 foundation (`autonomyMode`), critical handoff fix, replacement auto-activate under autonomy, cron movie-approval guard, post-render quality gate, Settings/Overview autonomy UX, and unit acceptance tests for the autonomy policy are **implemented**.

**Not yet complete:** full mock-provider Nest+Redis+DB E2E for dual-lane lights-out path; live AI/social/VPS verification; full Settings creative parity for every lane field; episode director reading `creativeSettingsSnapshot`.

---

## 2. Implemented

| Item | Status |
| --- | --- |
| Autonomy audit document | Done |
| `SeriesAutonomyMode` enum + migration `20261116200000_series_studio_autonomy_mode` | Done (default `MANUAL`) |
| Shared policy helpers (`packages/shared/src/series/autonomy.ts`) | Done |
| Effective approval resolution in architect / episode director / execution / cron / replacement | Done |
| Auto-approved movie → `afterMovieApproved` handoff | Done |
| FULLY_AUTONOMOUS replacement approve + activate | Done |
| Cron skips scripting unapproved movies when approval still required | Done |
| Post-render `SeriesEpisodeQualityService` gate before publish handoff | Done |
| Settings: Autonomous Mode primary control; hide routine approvals when autonomous | Done |
| Overview: autonomy badge + monitoring copy | Done |
| New lane timezone default `Africa/Lagos` | Done (new rows only) |
| creativeSettingsSnapshot retained on successful persist | Done |
| Unit tests (autonomy policy, execution gates, quality, security defaults) | Done |

---

## 3. Verification matrix

| Claim | Status |
| --- | --- |
| Unit tested (autonomy policy, Run Now gates, quality, security) | **Yes** |
| Integration tested (full Nest + Redis + DB lifecycle) | **Not yet verified** |
| Mock-provider end-to-end dual-lane autonomous path | **Not yet verified** |
| Real AI providers | **Not verified** |
| Real social publishing | **Not verified** |
| VPS / FFmpeg concurrency under load | **Not verified** (policy remains maxConcurrent=1) |

---

## 4. Files changed (primary)

- `packages/shared/src/series/autonomy.ts` (+ spec)
- `packages/shared/src/series/constants.ts` (timezone, autonomyMode default)
- `apps/api/prisma/schema.prisma` + migration `20261116200000_series_studio_autonomy_mode`
- `series-config.service.ts`, `dto/update-series-config.dto.ts`
- `movie-architect.service.ts`, `episode-director.service.ts`
- `series-execution.service.ts` (+ spec)
- `series.cron.ts`, `series-replacement.service.ts`
- `series-lifecycle-handoff.service.ts`
- `series-episode-quality.service.ts` (+ spec)
- `series-orchestrator.service.ts`, `series.module.ts`
- `SeriesSettingsPage.tsx`, `SeriesOverviewPage.tsx`, `series-api.ts`
- Docs: `SERIES_STUDIO_AUTONOMY_AUDIT.md`, API/ops updates, this report

---

## 5. Migration / deploy steps

1. Deploy API with migration: `pnpm db:deploy` (applies `20261116200000_series_studio_autonomy_mode`).
2. Confirm existing configs show `autonomyMode: MANUAL`.
3. Rebuild `@ai-video/shared` / restart API + worker.
4. In Settings: set lane creative + schedules (timezone `Africa/Lagos` recommended), enable Studio, set **Fully Autonomous**, enable automatic planning/production/publishing as desired.
5. Start with `GEMINI_USE_MOCK=true` / `SOCIAL_USE_MOCK=true` or `SERIES_PUBLISH_DRY_RUN=true` before live providers.

---

## 6. Known limitations

- Episode director does not yet re-merge from `creativeSettingsSnapshot` (snapshot is stored for freeze; outlines already baked into bible/episodes at plan time).
- Lane Settings UI still exposes a subset of creative JSON fields.
- Dry-run publish still marks schedule `PUBLISHED` for scheduler tests — distinct from live social spend, but operators must not treat dry-run as real posts.
- Full dual-lane mock E2E acceptance script not yet automated in CI.

---

## 7. Next implementation slices

1. Mock E2E harness: enable studio + FULLY_AUTONOMOUS + two lanes → plan → script → produce (mock) → QC → schedule without any approve API calls.
2. Episode director / continuity: prefer snapshot creative metadata when regenerating.
3. Expand lane creative UI (exclusions, audience, visual style, episode count/duration per lane).
4. Stronger publish FAILED auto-retry + scripting stuck recovery.
5. Controlled real-provider dry-run then live publish checklist.
