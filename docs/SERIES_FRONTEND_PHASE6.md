# Series Studio Phase 6 — Frontend + Real-AI Defaults

## Goal

Ship a production-ready episode UI for the Grok cinematic path and **stop hard-coding `useMockAi: true`**.

## Changes

### Mock AI defaults

| Before | After |
| --- | --- |
| Episode page always sent `useMockAi: true` | Default **off** (real providers) |
| No UI control on episode page | **Use mock AI** checkbox (same pattern as Series Overview) |
| — | Optional env: `VITE_SERIES_USE_MOCK_AI=true` to default the toggle on |

Actions that respect the toggle: generate / regenerate script, generate / retry clips, produce.

Planning / assemble / approve / validate do not require mock (deterministic or FFmpeg).

### Episode UI

`SeriesEpisodePage`:

- **Cinematic pipeline** strip: Script → Approve → Clip plan → Grok clips → Assemble
- Action groups: Screenplay / Grok Lite clips / Full production
- Clip progress counts (done / failed / cost)
- **Assembly** panel (polls `GET …/assembly`)
- Live poll while clips or production are in flight
- Mock badge when toggle is on

## Env

```bash
# Web (optional)
VITE_SERIES_USE_MOCK_AI=false

# API / providers (real cinematic path)
XAI_VIDEO_ENABLED=true
XAI_API_KEY=...
# Leave XAI_VIDEO_USE_MOCK / GEMINI_USE_MOCK unset or false for real runs
```

## End-to-end operator flow

1. Approve characters (Phase 2 identity)
2. Generate + approve episode screenplay
3. Build clip plan (or auto on approve)
4. Generate clips (Grok Lite) — real key required unless mock toggle
5. Assemble episode (FFmpeg, narration gate bypassed)
6. Or click **Produce** to run the dialogue pipeline through CLIP_GENERATION → ASSEMBLY

## Phase map (complete)

| Phase | Deliverable |
| --- | --- |
| 1 | Grok Lite provider |
| 2 | Character identity |
| 3 | Screenplay → ≤15s clip plan |
| 4 | Clip submit / poll / download |
| 5 | FFmpeg assembly + narration-gate bypass |
| 6 | Frontend + real-AI defaults |

## Verify

1. Open an episode page — confirm **Use mock AI** is unchecked by default
2. Network: generate/produce requests omit `useMockAi: true` unless toggle is on
3. Pipeline strip updates as script / clips / render appear
