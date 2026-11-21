# Grok Imagine Video cinematic Series Studio — Phases 1–6 complete

**Date:** 2026-11-20  
**Video provider:** xAI Grok Imagine Video **1.5 Lite only** (`grok-imagine-video-1.5-lite`)

## Pipeline

```text
Series / movie
  → story + characters (identity locked)
  → dialogue screenplay + shots
  → ≤15s clip plan
  → Grok Lite generate (T2V / optional I2V)
  → FFmpeg assemble (+ optional music)
  → review / publish
```

Duration levels (independent): **story** · **episode (default 60s)** · **clip (≤15s)**.

## Phase checklist

| Phase | Doc | Status |
| --- | --- | --- |
| 1 Provider | `SERIES_GROK_LITE_PHASE1.md` | Done |
| 2 Character identity | `SERIES_CHARACTER_IDENTITY_PHASE2.md` | Done |
| 3 Clip plan | `SERIES_CLIP_PLAN_PHASE3.md` | Done |
| 4 Clip orchestration | `SERIES_CLIP_GENERATION_PHASE4.md` | Done |
| 5 Assembly + narration bypass | `SERIES_CLIP_ASSEMBLY_PHASE5.md` | Done |
| 6 Frontend + real AI defaults | `SERIES_FRONTEND_PHASE6.md` | Done |

## Real-run requirements

```bash
XAI_VIDEO_ENABLED=true
XAI_API_KEY=...
# Do not force mock unless testing:
# XAI_VIDEO_USE_MOCK=false
# GEMINI_USE_MOCK=false
```

Web: leave **Use mock AI** unchecked (or `VITE_SERIES_USE_MOCK_AI` unset).

## Not in scope

- Grok Full / Hailuo-as-default for this cinematic path
- Multi-reference face lock (unsupported on Lite)
- Fancy transitions between clips
