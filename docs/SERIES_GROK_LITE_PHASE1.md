# Series Studio — Phase 1: xAI Grok Imagine Video 1.5 Lite

**Status:** Implemented (provider integration)  
**Date:** 2026-11-20  
**Scope:** Reliable Grok Lite video provider behind the existing registry. Does **not** rewrite Series orchestration yet.

## What landed

- Shared T2V + I2V helpers for official xAI REST API (`POST /v1/videos/generations`, `GET /v1/videos/{request_id}`)
- Provider id `xai` (alias `grok`) in `VIDEO_PROVIDER_IDS`
- Model hard-locked to `grok-imagine-video-1.5-lite` (Full rejected)
- Nest `XaiVideoProvider` + worker `xaiVideoProvider`
- Registry / config / motion DTOs / budget guards
- Worker `video-generation` supports xAI I2V and optional T2V (`requestMode: text_to_video`)
- Env examples + verification script

## Environment

```env
XAI_API_KEY=
XAI_VIDEO_ENABLED=false
XAI_VIDEO_MODEL=grok-imagine-video-1.5-lite
XAI_VIDEO_RESOLUTION=720p
XAI_VIDEO_USE_MOCK=false
XAI_VIDEO_PRICE_PER_SECOND_480P_USD=0.02
XAI_VIDEO_PRICE_PER_SECOND_720P_USD=0.03
XAI_VIDEO_PRICE_PER_SECOND_1080P_USD=0.14
```

Keep `XAI_API_KEY` backend-only. Enable with `XAI_VIDEO_ENABLED=true`. Default story provider remains Hailuo unless explicitly changed.

## Verification

```bash
# Mock (no key)
pnpm --filter @ai-video/api xai:verify

# Live (charges xAI; requires XAI_API_KEY)
pnpm --filter @ai-video/api xai:verify:live
```

## Official pricing (720p Lite)

$0.03 / second — [docs.x.ai pricing](https://docs.x.ai/developers/pricing)

## Out of scope (later phases)

- Series orchestrator dialogue → Grok clip pipeline
- `EpisodeVideoClip` model / 10-minute defaults
- Narration-gate removal / soundtrack mix
- Frontend episode progress / `useMockAi` fix
