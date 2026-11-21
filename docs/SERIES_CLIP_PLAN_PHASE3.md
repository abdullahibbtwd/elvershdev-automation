# Series Studio Phase 3 — Screenplay + ≤15s Clip Planning

## Goal

Turn an approved dialogue screenplay into an ordered **Grok Imagine Video 1.5 Lite** clip plan. Each clip is ≤15 seconds, shot-aware, identity-enriched, and cost-estimated.

## Concepts

| Layer | Model / artifact | Role |
| --- | --- | --- |
| Story duration | Lane / series creative settings | Complete movie runtime |
| Episode duration | `SeriesEpisode.targetDurationSeconds` (default **60s**) | One episode |
| Screenplay shot | `EpisodeShot` (+ `EpisodeDialogueLine`) | Coverage / dialogue beat (may be >15s) |
| Video clip | **`EpisodeVideoClip`** | One Lite generation request (≤15s) |

Shots are **not** clips. Long shots are split; short consecutive same-scene shots may be packed when dialogue stays coherent.

## Planner

Shared module: `packages/shared/src/series/clip-plan.ts`

- `buildEpisodeClipPlan` — packs / splits shots, builds prompts, estimates cost (`duration × $0.03/s` default)
- `splitShotIntoClipSegments` — splits >15s shots; keeps dialogue on the first segment
- `assertClipPlanValid` — hard guard: no clip > max

Prompts include: clip info, visual style, character identity blocks (Phase 2), location, action, camera, dialogue, audio, continuity (previous/next), restrictions.

## Persistence

Prisma: `EpisodeVideoClip` + `EpisodeVideoClipStatus`

Migration: `20261120120000_episode_video_clips`

## API

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/series/:id/episodes/:episodeId` | Includes `shots` + `videoClips` |
| `GET` | `/series/:id/episodes/:episodeId/clip-plan` | Persisted plan summary |
| `POST` | `/series/:id/episodes/:episodeId/clip-plan` | Build + persist (`force`, `persist`) |
| `POST` | `/series/:id/episodes/:episodeId/clip-plan/estimate` | Dry-run estimate |

Approving an episode **best-effort** rebuilds the clip plan (`force: true`).

## UI

`SeriesEpisodePage`: screenplay shots list, clip plan section (duration/cost/prompt), **Build clip plan** action.

## Out of scope (later phases)

- Phase 4: submit clips to Grok Lite / poll / download
- Phase 5: FFmpeg assembly, music, narration-gate removal
- Phase 6: full production UI (drop `useMockAi: true` defaults)

## Verify

```bash
pnpm --filter @ai-video/api exec prisma migrate deploy
pnpm --filter @ai-video/api test -- --watchman=false clip-plan.spec.ts
```
