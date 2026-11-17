# Series Dialogue Real-Provider Pilot Report

**Date:** 2026-11-17  
**Mode:** Real providers only (`LIP_SYNC_USE_MOCK=false`, `GEMINI_TTS_USE_MOCK=false`, `FAL_USE_MOCK=false`, `SOCIAL_USE_MOCK=false`)  
**Artifacts:** `/tmp/series-dialogue-pilot/`

---

## Verdict

Dialogue-driven pilot completed end-to-end on real providers and published to Facebook StoryVault.

| Gate | Result |
| --- | --- |
| Implementation | Done |
| Mock-only test | Skipped (real-only run) |
| Real provider test | Passed |
| Render + inspect | Passed |
| Social publish | Passed |

---

## Pipeline evidence

| Stage | Provider | Result |
| --- | --- | --- |
| Character portraits | fal Flux | 4 real refs (Kemi, Tunde, Ada, Mother) |
| Dialogue TTS | Gemini TTS | 4 real lines, not mocked |
| Lip-sync | Kling AI Avatar v2 Standard via fal | 4 completed clips, not mocked |
| Assemble | ffmpeg concat | `pilot-episode.mp4` (~15.5s, 720x1280) |
| Publish | Facebook / StoryVault | `PUBLISHED` reel `1447648156915289` |

**Lip-sync cost (pilot):** ~$0.87  
**Hard quality gates:** all passed  
**Soft note:** duration ~15.5s vs 50s target (intentionally trimmed to 4 speaking shots for cost control)

---

## IDs

- Series: `a9da004a-0d49-4eb8-86d2-8c03c6b676b6`
- Episode: `5c4b704c-d3c1-4a6f-b4f1-a7ce61661ebd`
- Publish record: `6573bba4-7644-47b4-815d-fd0bb1782d5c`
- Post URL path: `/reel/1447648156915289/`

---

## Local inspect

- Video: `/tmp/series-dialogue-pilot/pilot-episode.mp4`
- Mid frame: `/tmp/series-dialogue-pilot/inspect-frame.jpg`
- Full JSON: `/tmp/series-dialogue-pilot/pilot-report.json`
