# Series Studio Phase 5 — Clip Assembly + Narration-Gate Bypass

## Goal

Concatenate COMPLETED `EpisodeVideoClip` videos into a final episode MP4, optionally bed background music, link a `VideoRender` for publish, and **stop requiring narration scripts** on the dialogue / Grok cinematic path.

Legacy narration lanes keep `RenderingService` readiness unchanged.

## Dialogue stage order

```text
MATERIALIZE → VOICE_ASSIGNMENT → VISUAL_INTELLIGENCE → DIALOGUE_AUDIO
  → LIP_SYNC → AUDIO_MIX → CLIP_GENERATION → ASSEMBLY → DONE
```

`RENDER` (narration-gated) is **not** on this path anymore.

| Stage | Behavior |
| --- | --- |
| `CLIP_GENERATION` | Ensure clip plan; fan-out Grok Lite generate; wait until all COMPLETED |
| `ASSEMBLY` | FFmpeg concat (+ optional music); create `VideoRender` COMPLETED; set `episode.videoRenderId` |

## Assembly algorithm

1. Download COMPLETED clip MediaAssets in `clipIndex` order
2. FFmpeg concat demuxer `-c copy`
3. On failure: re-encode to 1080×1920 H.264 + AAC
4. Optional music: `amix` bed at `musicGainDb` (default −12 from `EpisodeAudioMix`)
5. Upload `series/{seriesId}/episodes/{episodeId}/assembled/v1.mp4`
6. Create `MediaAsset` + `VideoRender` (`renderSettings.source = clip_assembly`, `narrationGateBypassed: true`)
7. Episode → `RENDERED`, `actualDurationSeconds` set

## API

| Method | Path | Behavior |
| --- | --- | --- |
| `GET` | `/series/:id/episodes/:episodeId/assembly` | Readiness + existing render |
| `POST` | `/series/:id/episodes/:episodeId/assemble` | `force`, `async`, `backgroundMusicAssetId`, `musicGainDb` |

Queue: `series-clip-assembly`.

## Narration gate

| Path | Narration required? |
| --- | --- |
| Legacy `SERIES_PRODUCTION_STAGE_ORDER` → `RENDER` | Yes (`ensureNarrationApproved` + scene readiness) |
| Dialogue → `ASSEMBLY` via `ClipAssemblyService` | **No** |

## UI

Episode page: **Assemble episode** when all clips are COMPLETED; shows linked `videoRenderId`.

## Out of scope (Phase 6)

- Dropping `useMockAi: true` UI defaults
- Crossfades / fancy transitions
- Real AUDIO_MIX stem re-mix
- Music generator / picker UX

## Verify

```bash
pnpm --filter @ai-video/shared build
pnpm --filter @ai-video/api exec jest --config ./jest.config.ts --watchman=false --testPathPattern='clip-assembly.spec' --forceExit
```
