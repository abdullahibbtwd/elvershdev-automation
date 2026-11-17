# Series Dialogue Cost Audit (Post Real Pilot)

**Date:** 2026-11-17  
**Sources:** `/tmp/series-dialogue-pilot/pilot-report.json`, `ProviderUsage` DB (user `abdullahibbtwd@gmail.com`), fal public list prices, local clip durations  
**Billing portals:** fal.ai / Gemini console invoices were **not** accessible from this environment — figures below are **application estimates + list rates**, not provider invoices.

---

## Verdict

The ~**$10** figure is **not** the dialogue pilot alone.

| Scope | Estimated spend | Notes |
| --- | ---: | --- |
| Dialogue real pilot (published reel) | **~$1.05** | Portraits + TTS + Kling lip-sync |
| Same calendar day (deduped ProviderUsage) | **~$5.39** | Mostly older Hailuo narration-style episode production |
| Raw ProviderUsage day sum (undeduped) | **~$10.25** | Inflated by Hailuo submit+complete double-count |

---

## 1. Dialogue pilot breakdown (actual run)

| Cost category | Requests | Actual / estimated cost |
| --- | ---: | ---: |
| Character portrait generation (fal Flux) | 7 images (3 abandoned + 4 used) | **~$0.175** list ($0.025/MP; 576×1024 → 1 MP each) |
| Dialogue TTS (Gemini) | 4 lines | **~$0.002** app estimate |
| Lip-sync (Kling Avatar v2 Standard) | 4 completed clips / 15.466s | **~$0.869** (15.466 × $0.0562) |
| Other video generation | 0 | **$0** (dialogue path skips Hailuo) |
| Other AI generation | 0 in pilot window | **$0** |
| Retries / failed paid requests | 3 unused portraits from failed Ada-missing run | **~$0.075** of the portrait total |
| Other measurable costs | ffmpeg/local | **$0** |
| **Total (dialogue pilot)** | | **~$1.05** |

Clip durations: 7.2s + 3.2s + 2.133s + 2.933s = **15.466s** talking.

**Not in ProviderUsage for the pilot window:** the pilot script called fal/Kling/TTS outside the normal worker usage path for portraits/lip-sync until this optimization pass. Day totals therefore understated the pilot until lip-sync/TTS usage recording was added.

---

## 2. Where the ~$10 came from

`ProviderUsage` for 2026-11-17 (UTC):

| Provider:requestType | Count | Summed estimatedCost |
| --- | ---: | ---: |
| hailuo:image_to_video_submit | 18 | **$4.86** |
| hailuo:image_to_video_complete | 18 | **$4.86** (same clips; lifecycle duplicate) |
| fal:image_generation | 18 | $0.45 |
| gemini:* (director/continuity/speech/etc.) | many | ~$0.08 |
| **Raw total** | | **~$10.25** |

After deduping Hailuo completes: **~$5.39**.

Those Hailuo jobs ran **05:00–07:00 UTC**, hours before the dialogue pilot (~08:58 UTC), on narration/motion stories (6s @ 768P ≈ $0.27 each). They are **separate Series Studio / standalone motion production**, not Kling lip-sync.

---

## 3. Lifecycle waste on the pilot itself

1. **Four pilot series rows** created across retries (`dialogue-pilot-*`).
2. Two early runs failed before portraits (sandbox network).
3. One run generated **3 portraits** then failed speaker validation (missing Ada) → **~$0.075 wasted**.
4. Successful run regenerated **all 4 portraits** instead of reusing the prior 3.
5. Lip-sync was correctly one job per speaking line; no duplicate Kling charges on the successful episode.
6. Grouping consecutive same-speaker lines does **not** reduce Kling list cost (pure per-second). It only helps latency/ops.

---

## 4. Top 5 cost-reduction opportunities

1. **Never use Hailuo for dialogue-driven episodes** — already true on the dialogue stage path; keep narration/Hailuo lanes separate and budgeted.
2. **Reuse approved character portraits for the whole movie** — generate once; skip on retries/episodes.
3. **Hybrid shot mix** — Kling only for speaking seconds; FFmpeg still-motion for reactions/env to fill 40–60s.
4. **Cap speaking/lip-sync seconds** (~30–45% of episode) via `costMode` / `maxLipSyncSecondsPerEpisode`.
5. **Fix usage accounting** — stop double-counting Hailuo complete; record lip-sync + dialogue TTS in `ProviderUsage`.

---

## 5. Target economics (balanced mode, portraits reused)

For a **50s** episode with ~**20s** lip-sync speech:

| Item | Estimate |
| --- | ---: |
| Kling lip-sync 20s | ~$1.12 |
| Gemini TTS | ~$0.00–0.01 |
| Portraits (amortized / reused) | ~$0.00–0.02 |
| Hailuo | $0 |
| **Episode total** | **~$1.1–1.2** |

vs wall-to-wall Hailuo 50s @ $0.045/s ≈ **$2.25** without lip-sync quality, or wall-to-wall Kling 50s ≈ **$2.81**.

---

## 6. Changes shipped with this audit

- `packages/shared/src/series/episode-cost.ts` — cost planning + dedupe helper
- Creative settings: `costMode`, `reuseCharacterReferences`, `preferFfmpegForReactions`, `maxLipSyncSecondsPerEpisode`
- Dialogue materialize stamps `productionMethod` + `costEstimate`
- ProviderUsage for dialogue TTS + lip-sync
- Hailuo `image_to_video_complete` now records **$0** (billed at submit)
- Pilot script reuses prior approved portraits when present
