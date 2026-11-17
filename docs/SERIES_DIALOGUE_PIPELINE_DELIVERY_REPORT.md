# Series Studio — Dialogue-Driven Pipeline Delivery Report

**Date:** 2026-11-17  
**Audit:** `docs/SERIES_DIALOGUE_PIPELINE_AUDIT.md`

---

## Status summary (honest)

| Area | Status |
| --- | --- |
| Phase 1 provider audit | **Implemented** |
| Dialogue script schema + prompts + director branch | **Implemented** |
| Character voice assignment | **Implemented** |
| DB models + migration | **Implemented** (apply migration before use) |
| Lip-sync provider abstraction (Kling Avatar / OmniHuman / mock) | **Implemented** |
| Orchestrator dialogue stage branch | **Implemented** |
| Dialogue audio + lip-sync queue workers (API-hosted) | **Implemented** (mock-ready; real TTS/URL wiring partial) |
| Shot-based story materialization | **Implemented** |
| Creative settings + Settings UI fields | **Implemented** |
| Dialogue quality gates | **Implemented** |
| Unit tests (schemas / voice / lip-sync caps / quality ctor) | **Mock tested** |
| End-to-end mock production of full episode video | **Not completed this pass** |
| Real-provider talking-character episode | **Not verified** |
| Live social publish of pilot | **Not executed** |

**Pilot (Phase 14) is not successful yet.** Remaining work is required before claiming a real talking-character episode.

---

## Existing capabilities reused

- Gemini structured JSON (Movie Architect / Episode Director pattern)
- Series bible, continuity, lanes, autonomy, publish scheduler
- `VoiceProfile` + Gemini TTS voice catalog
- fal image generation + character reference assets
- BullMQ Series queues + FFmpeg render stack
- Hailuo kept for **non-speaking / legacy** motion only — **not** claimed as lip-sync

## New capabilities

- Dialogue-first episode schema (`shots[]` with speaker, emotion, facial/body, camera, timing)
- `SERIES_DIALOGUE_PRODUCTION_STAGE_ORDER`
- `SeriesCharacterVoice`, `EpisodeDialogueLine`, `EpisodeShot`, `LipSyncJob`, `EpisodeAudioMix`
- `LipSyncProvider` + fal endpoints:
  - Default: `fal-ai/kling-video/ai-avatar/v2/standard` ($0.0562/s)
  - Optional: Pro / OmniHuman
- Creative defaults for relatable everyday-life + semi-realistic cinematic 3D + narrator avoided

## Providers / models selected

| Stage | Model |
| --- | --- |
| Script | Gemini (existing) |
| Stills / refs | fal image model (existing) |
| Dialogue TTS | Gemini TTS prebuilt voices (persistent per character) |
| Lip-sync | Kling AI Avatar v2 Standard via fal |
| Reaction motion (optional) | Hailuo I2V — **no lip-sync claim** |

## Database

Migration: `apps/api/prisma/migrations/20261117120000_series_dialogue_pipeline`

## Queues / workers

- `series-dialogue-audio`
- `series-lip-sync`
- (registered) `series-shot-stills`, `series-audio-mix`

Hosted on API `SeriesQueueHost` with concurrency 1.

## UI

Series Settings lane creative: dialogue-driven toggle, lip-sync required, subtitles, density, narration preference.

## Tests executed

- Shared unit specs added for dialogue schemas, character voice, lip-sync capabilities.
- Quality service specs updated for new DI.

## Cost estimate (60s episode)

Ballpark **~$3.50–$5.00** with Kling Avatar Standard (~50s talking) — see audit §6.

## VPS

Keep FFmpeg concurrency **1**; Series max concurrent episode production **1**.

## What blocks Phase 14 pilot right now

1. Apply Prisma migration on the running database.
2. Wire **real** public/signed URLs for character stills + dialogue WAV into `LipSyncJob` (do not use fal example URLs except in mock).
3. Generate **real** Gemini TTS WAV bytes into MinIO (current API dialogue-audio path creates MediaAsset metadata placeholders when mocked).
4. Map completed lip-sync MP4s into render timeline / motion outputs.
5. Set `LIP_SYNC_USE_MOCK=false` only after (2)–(4).
6. Confirm Series lane enabled + connected social account before publish.
7. Inspect rendered frames before any live publish.

## Recommended next commands

```bash
pnpm --filter @ai-video/api exec prisma migrate deploy
pnpm --filter @ai-video/shared test -- dialogue-schemas character-voice capabilities
# Then controlled real lip-sync one-shot after still+audio URLs exist
```
