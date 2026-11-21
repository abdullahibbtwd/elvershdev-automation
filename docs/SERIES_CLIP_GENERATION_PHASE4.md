# Series Studio Phase 4 — Grok Lite Clip Orchestration

## Goal

Submit planned `EpisodeVideoClip` rows to **xAI Grok Imagine Video 1.5 Lite**, poll until complete, download MP4 into MinIO/`MediaAsset`, and update clip status. No FFmpeg assembly yet (Phase 5).

## Flow

```text
PLANNED → QUEUED → SUBMITTED → GENERATING → DOWNLOADING → COMPLETED
                              ↘ FAILED (retry → QUEUED with force)
```

Per clip (BullMQ `series-clip-generation`, concurrency via `SERIES_CLIP_MAX_CONCURRENCY`, default 1):

1. Claim / queue
2. Mode: `auto` → I2V if approved character still exists, else T2V
3. `XaiVideoProvider.submitTextToVideo` / `submitImageToVideo` (model hard-locked to Lite)
4. Poll `getTaskStatus` until succeeded/failed/timeout
5. `retrieveCompletedVideo` → `series/{seriesId}/episodes/{episodeId}/clips/{clipId}.mp4`
6. Link `videoMediaAssetId`, store `actualCostUsd`, `ProviderUsage` on submit

Idempotent: if `providerRequestId` is set, resume poll (no resubmit) unless `force`.

## API

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/series/:id/episodes/:episodeId/clips` | Status counts + clips |
| `POST` | `/series/:id/episodes/:episodeId/clips/generate` | Fan-out all regenerable clips |
| `POST` | `/series/:id/episodes/:episodeId/clips/:clipId/generate` | One clip |
| `POST` | `/series/:id/episodes/:episodeId/clips/:clipId/retry` | Force regenerate |
| `POST` | `/series/:id/episodes/:episodeId/clips/cancel` | Cancel in-flight |

Body flags: `useMockAi`, `force`, `async` (default true), `mode` (`auto` \| `text_to_video` \| `image_to_video`).

## Requirements

- Clip plan must exist (Phase 3)
- Real runs: `XAI_VIDEO_ENABLED=true` + `XAI_API_KEY`
- Mock: `useMockAi=true` or `XAI_VIDEO_USE_MOCK=true`
- Optional monthly cap: `XAI_VIDEO_MAX_MONTHLY_SPEND_USD`

## UI

Episode page: **Generate clips**, **Cancel clips**, per-clip Retry/Regenerate, auto-refresh while clips are in flight.

## Out of scope

- FFmpeg assembly / music / narration-gate removal (Phase 5)
- Dropping `useMockAi: true` UI defaults (Phase 6)
- Inserting CLIP_GENERATION into the dialogue production stage order

## Verify

```bash
pnpm --filter @ai-video/shared build
pnpm --filter @ai-video/api exec jest --config ./jest.config.ts --watchman=false --testPathPattern='clip-generation.spec' --forceExit
```
