# Series Studio — Dialogue-Driven Pipeline Audit (Phase 1)

**Date:** 2026-11-17  
**Status:** Audit complete — implementation baseline  
**Rule:** No invented endpoints, model IDs, or capabilities. Claims below are from inspected code + published fal.ai / Gemini docs.

---

## 1. Verdict

The platform can support a **dedicated Series Studio dialogue-driven workflow** without replacing standalone video automation.

**Gap:** Current Series production still materializes episodes into the **narration + Hailuo motion** path. That path can animate stills, but **does not provide audio-driven lip sync**. Talking-character episodes require a **new lip-sync stage** using a fal.ai avatar model, plus structured per-character dialogue audio.

**Local credentials (as of audit):** Gemini + fal keys are present; `FAL_USE_MOCK=false`, `HAILUO_USE_MOCK=false`, `GEMINI_TTS_USE_MOCK=false`. Real-provider pilot is configuration-feasible. Kling native API remains disabled (`KLING_ENABLED=false`).

---

## 2. Existing capabilities to reuse

| Capability | Location | Reuse for dialogue pipeline |
| --- | --- | --- |
| Movie planning / 10-ep structure | Movie Architect, `SeriesBible`, outlines | Keep |
| Continuity engine | `ContinuityEngineService` | Keep; extend for speaker knowledge |
| Series characters + refs | `SeriesCharacter`, `CharacterReferenceAsset`, fal images | Keep as visual identity |
| Episode director | `EpisodeDirectorService` + Gemini JSON | Upgrade schema → dialogue/shots |
| Pipeline adapter | `SeriesPipelineAdapterService` | Materialize shots / dialogue assets |
| Orchestrator + BullMQ Series queues | `SERIES_EPISODE_PRODUCTION`, etc. | Branch stages when dialogue-driven |
| Gemini TTS + `VoiceProfile` | `voice-ai`, speech processors | Per-character dialogue lines (not one narration track) |
| FFmpeg render | `video-rendering` processors | Assemble shot clips + mix dialogue/music |
| Publish scheduler / autonomy | Series publish + lifecycle handoff | Unchanged publishing contract |
| Cost ledger | `ProviderUsage` | Tag lip-sync / dialogue audio |

**Must not change behaviour:** standalone `AutomationConfig` pipeline, Hailuo as default standalone motion provider, existing narration queues for non-Series stories.

---

## 3. Provider capability matrix

| Need | Current integration | Supports? | Notes |
| --- | --- | --- | --- |
| 1. Image-to-video | Hailuo-02 via fal (`fal-ai/minimax/hailuo-02/standard/image-to-video`); optional Kling I2V | **Yes** | Durations 6/10s (Hailuo). **No audio input → not lip sync.** |
| 2. Text-to-video | Not integrated as primary Series path | **No (current)** | Not required for dialogue avatar path |
| 3. Character reference consistency | fal image gen + Series refs / story character refs | **Partial–Yes** | Consistency via prompts + reference assets; not identity lock |
| 4. Audio-driven facial animation | **Not integrated** | **Missing** | Available on fal as separate models (below) |
| 5. Lip synchronization | **Not integrated** | **Missing** | Hailuo/Kling I2V must **not** be claimed as lip sync |
| 6. Talking-character video | **Not integrated** | **Missing** | fal avatar endpoints |
| 7. Facial expression control | Prompt-only on I2V; avatar models interpret audio (+ optional prompt) | **Partial** | No fine-grained blendshape API in current stack |
| 8. Dialogue audio | Gemini TTS (prebuilt voices) | **Yes** | Per-line generation supported by architecture; Series currently uses narration scripts |
| 9. Voice cloning / persistent identity | Gemini prebuilt voice IDs only | **Persistent assignment Yes; cloning No** | Assign one prebuilt voice per character; no clone API in codebase |

### 3.1 Motion models already wired (explicit non-lip-sync)

| Model | Endpoint / ID | Lip sync? | Limits (from code/docs) | Approx cost |
| --- | --- | --- | --- | --- |
| Hailuo-02 Standard | `fal-ai/minimax/hailuo-02/standard/image-to-video` | **No** | 6 or 10s; 512P/768P; image + text prompt | ~$0.045/s @768P, ~$0.017/s @512P (env) |
| Kling I2V 2.6 | Official Kling API (`kling-2.6`) | Native audio flag in caps; **not Series lip-sync path** | 5/10s; disabled by default | ~$0.07/s (env) |

### 3.2 Lip-sync / talking-avatar models on fal.ai (not yet integrated)

Verified from fal model pages / API docs (2026):

| Model | Endpoint | Inputs | Duration / notes | Published price |
| --- | --- | --- | --- | --- |
| **Kling AI Avatar v2 Standard** (recommended default) | `fal-ai/kling-video/ai-avatar/v2/standard` | `image_url`, `audio_url`, optional `prompt`, `enable_safety_checker` | Output duration matches audio | **$0.0562 / second** |
| Kling AI Avatar v2 Pro | `fal-ai/kling-video/ai-avatar/v2/pro` | Same pattern | Higher fidelity | **$0.115 / second** |
| ByteDance OmniHuman | `fal-ai/bytedance/omnihuman` | `image_url`, `audio_url` | Audio **must be under 30s** | Listed ~$0.14/s on model page |
| VEED Fabric 1.0 | `fal-ai/veed/fabric-1.0` (blog) | Image + audio | Up to ~1 min; 480p/720p | Confirm live pricing before pilot |

**Selected defaults for Series dialogue pipeline:**

| Stage | Provider / model | Why |
| --- | --- | --- |
| Dialogue script | Gemini (existing structured JSON) | Already Series pattern |
| Shot stills / env | fal image (`FAL_IMAGE_MODEL`) | Existing |
| Character refs | fal image + Series refs | Existing |
| Dialogue TTS | Gemini TTS prebuilt voices | Existing; assign per character |
| Lip-sync / talking shot | **Kling AI Avatar v2 Standard** via fal + `FAL_API_KEY` | Explicit audio-driven lip sync; lower $/s than Pro/OmniHuman |
| Optional higher quality | Kling Avatar Pro or OmniHuman | Swappable via lip-sync provider abstraction |
| Reaction / non-speaking motion | Hailuo I2V (optional) | Motion only — **document as non-lip-sync** |
| Music / SFX | Existing render mix path (extend) | Keep dialogue ducking |
| Assembly | FFmpeg (concurrency 1) | Existing |

---

## 4. Architecture gaps (current Series Studio)

| Area | Current state | Required for acceptance |
| --- | --- | --- |
| Episode script schema | `dialogue` + `narration` free text; required `narrationText` | Structured shots with speaker, emotion, facial/body, camera, timing |
| Production stages | `MATERIALIZE → VISUAL → MOTION → NARRATION → SPEECH → RENDER` | Dialogue branch: voice assign → dialogue audio → shot stills → lip-sync → mix → render |
| Character voice | `SeriesCharacter.voiceProfile` **text only** | Persistent `VoiceProfile` assignment per character |
| Audio | Scene-level narration tracks | Per dialogue line audio + timing metadata |
| Lip sync | None | Dedicated provider + jobs + validation gate |
| Quality checks | Episode quality service exists | Dialogue/lip-sync/speaker/voice checks |
| Creative settings | Genres/themes/visual/narration prefs | Dialogue-driven defaults + lip-sync/subtitle/shot style |
| Creative direction (user brief) | Partial overlap | Encode relatable everyday-life + semi-realistic 3D + no narrator default |

---

## 5. Provider abstraction plan

```
LipSyncProvider (interface)
  ├─ KlingAvatarV2StandardProvider  (default, fal)
  ├─ KlingAvatarV2ProProvider       (optional)
  ├─ OmniHumanProvider              (optional, 30s audio cap)
  └─ MockLipSyncProvider            (tests only; must flag mocked=true)

SpeechGenerationProvider (existing)
  └─ Gemini TTS (default) — no voice cloning

VideoMotionProvider (existing Hailuo/Kling)
  └─ Used only for non-speaking reaction/B-roll when enabled
```

Changing lip-sync backend must not require rewriting script, TTS, or FFmpeg assembly — only registry + env.

---

## 6. Cost estimate (60s dialogue episode, planning numbers)

Assumes ~50s of talking-avatar video + Gemini script/TTS + ~8–12 stills. **Estimates only.**

| Item | Rough estimate |
| --- | --- |
| Gemini script + planning | low dollars (token-based) |
| Character/shot stills (fal) | ~8–15 × $0.025 ≈ $0.20–$0.40 |
| Gemini TTS (multi-line) | typically well under $0.10 for short episode |
| Kling Avatar v2 Standard @ 50s | 50 × $0.0562 ≈ **$2.81** |
| Optional Hailuo reaction clips | 1–2 × 6s × $0.045 ≈ $0.27–$0.54 |
| **Ballpark total / episode** | **~$3.50–$5.00** (Standard avatar) |

Pro avatar (~2×) or OmniHuman (~$0.14/s) raises cost sharply. Budget gates must remain enforced.

---

## 7. VPS implications (1 vCPU / 4 GB)

- Keep `VIDEO_RENDER_MAX_CONCURRENCY=1`.
- Do **not** run parallel FFmpeg + heavy downloads for multiple episodes.
- Lip-sync generation is remote (fal); local load is download + assemble.
- Series `maxConcurrentEpisodeProduction` stays **1**.

---

## 8. Honest limitations

1. Avatar models animate **one subject image + one audio** — multi-character scenes need **shot-reverse-shot** assembly, not single-call multi-speaker video.
2. Hailuo does **not** provide accurate lip sync; never report Hailuo clips as lip-synced.
3. Gemini TTS offers **prebuilt voices**, not cloning — consistency = sticky voice ID assignment.
4. Expression/body control is **prompt + audio-driven**, not director-grade animation curves.
5. Two-shot frames with both characters speaking accurately are **out of scope** for current fal avatar APIs; cut between singles.
6. Mock lip-sync must never be labeled a real-provider test.

---

## 9. Implementation order (locked)

1. Creative settings + dialogue script schema  
2. Character voice assignment  
3. Dialogue audio generation (reuse TTS)  
4. Shot stills + lip-sync provider/jobs  
5. Audio mix + FFmpeg assembly + subtitles  
6. Quality gates + orchestrator autonomy branch  
7. Tests (mock) → controlled real-provider pilot → optional live publish  

---

## 10. Pilot prerequisites checklist

| Prerequisite | Status at audit |
| --- | --- |
| `GEMINI_API_KEY` | Present locally |
| `FAL_API_KEY` | Present locally |
| TTS / fal mock flags off | Yes locally |
| Series Studio lane enabled | Must verify in DB/UI before pilot |
| Connected social account | Must verify before Phase 14 publish |
| Budget / emergency stop clear | Must verify before pilot |
