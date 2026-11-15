# Phase 6.1 — MiniMax Hailuo-02 Integration Report

**Date:** 2026-11-15  
**Status:** Implemented and unit-tested locally. Mock mode verified via provider unit tests. Live fal.ai generation: **NOT TESTED** (no `FAL_API_KEY` / credits in local `.env`).

---

## 1. Files created and modified

### Created

| Path | Role |
| --- | --- |
| `packages/shared/src/motion-ai/hailuo-request.ts` | Official request schema builder + fal queue status mapping |
| `packages/shared/src/motion-ai/video-provider-selection.ts` | Provider id normalization, enablement, default selection |
| `apps/worker/src/lib/hailuo.ts` | Worker `HailuoVideoProvider` (`@fal-ai/client` queue API) |
| `apps/worker/src/lib/video-providers.ts` | Runtime provider registry for worker processors |
| `apps/api/src/integrations/providers/hailuo.provider.ts` | NestJS Hailuo provider |
| `apps/api/src/integrations/video/video-provider.registry.ts` | API provider selection / availability / pricing |
| `apps/api/src/integrations/providers/hailuo.provider.spec.ts` | Mock submit / poll / retrieve / pricing tests |
| `apps/api/src/modules/motion/hailuo-request.spec.ts` | Request validation, pricing, selection tests |
| `apps/api/src/integrations/video/video-provider.registry.spec.ts` | Default Hailuo + Kling disabled tests |
| `docs/PHASE6_1_HAILUO_INTEGRATION_REPORT.md` | This report |

### Modified (selected)

| Path | Change |
| --- | --- |
| `packages/shared/src/motion-ai/pricing.ts` | Hailuo pricing + `estimateVideoGenerationCostUsd` |
| `packages/shared/src/motion-ai/model-capabilities.ts` | Hailuo-02 Standard capabilities |
| `packages/shared/src/motion-ai/schemas.ts` | Provider + Hailuo duration/resolution in motion DTOs |
| `packages/shared/src/motion-ai/video-provider.ts` | Optional `imageBytes` / `promptOptimizer` |
| `packages/shared/src/queues/index.ts` | `provider` on poll/download payloads |
| `apps/worker/src/processors/video-generation.processor.ts` | Provider-agnostic submit + long presign / fal upload |
| `apps/worker/src/processors/video-status-polling.processor.ts` | Poll correct provider |
| `apps/worker/src/processors/video-download.processor.ts` | Download via selected provider |
| `apps/worker/src/processors/motion-analysis.processor.ts` | Chain VIDEO jobs with motion’s provider |
| `apps/api/src/modules/motion/motion.service.ts` | Default Hailuo, budget per provider, selection |
| `apps/api/src/modules/motion/motion.controller.ts` | `GET /motion/providers` |
| `apps/api/src/modules/motion/dto/*.ts` | `provider`, Hailuo durations/resolutions |
| `apps/api/src/config/configuration.ts` | Hailuo + `VIDEO_GENERATION_PROVIDER` / `KLING_ENABLED` |
| `apps/web/src/components/story/StoryMotionSection.tsx` | Provider UI, cost, model, status |
| `.env.example`, `.env.production.example` | Hailuo env + Kling disabled by default |
| `docs/ENVIRONMENT_VARIABLES.md`, `README.md` | Documented |
| `apps/api/test/motion-ai.e2e-spec.ts` | Expect Hailuo mock pipeline |

### Preserved (not deleted)

- `apps/api/src/integrations/providers/kling.provider.ts` (+ `.spec.ts`)
- `apps/worker/src/lib/kling.ts`
- Existing Kling env vars and motion-generation history fields
- Phase 8 render pipeline (consumes completed motion clips by status, not provider name)

### Dependencies

- `@fal-ai/client` added to `@ai-video/api` and `@ai-video/worker`

---

## 2. Provider architecture

```
MotionService → VideoProviderRegistry (hailuo | kling)
                     │
                     ▼
Gemini motion brief (provider-independent)
                     │
                     ▼
BullMQ: motion-analysis → video-generation → video-status-polling → video-download
                     │
                     ▼
Worker VideoProviderRegistry → HailuoVideoProvider | KlingVideoProvider
                     │
                     ▼
FFprobe → MinIO → MotionGeneration + ProviderUsage
```

- Interface: existing `VideoGenerationProvider` in `@ai-video/shared`.
- Default: `VIDEO_GENERATION_PROVIDER=hailuo`.
- Kling: registered, selectable only when `KLING_ENABLED=true`.
- No silent fallback to another paid model.

---

## 3. Environment variables

| Variable | Default | Notes |
| --- | --- | --- |
| `VIDEO_GENERATION_PROVIDER` | `hailuo` | Default for new jobs |
| `FAL_API_KEY` | empty | Reused for Hailuo (no second key) |
| `HAILUO_ENABLED` | `true` | |
| `HAILUO_MODEL` | `fal-ai/minimax/hailuo-02/standard/image-to-video` | |
| `HAILUO_DEFAULT_RESOLUTION` | `768P` | |
| `HAILUO_DEFAULT_DURATION` | `6` | |
| `HAILUO_PROMPT_OPTIMIZER` | `true` | |
| `HAILUO_MAX_RETRIES` | `2` | |
| `HAILUO_TIMEOUT_MS` | `600000` | |
| `HAILUO_USE_MOCK` | `true` (example) | Works without credits |
| `HAILUO_POLL_INTERVAL_SECONDS` | `15` | |
| `HAILUO_MAX_POLL_ATTEMPTS` | `80` | |
| `HAILUO_PRICE_PER_SECOND_768P_USD` | `0.045` | |
| `HAILUO_PRICE_PER_SECOND_512P_USD` | `0.017` | |
| `HAILUO_CURRENCY` | `USD` | |
| `HAILUO_MAX_MONTHLY_SPEND_USD` | empty | Optional guard |
| `KLING_ENABLED` | `false` | Future use |

Kling’s previous env block is unchanged aside from `KLING_ENABLED`.

---

## 4. Exact API endpoint and request schema

**Endpoint / model id:** `fal-ai/minimax/hailuo-02/standard/image-to-video`

**Client:** `@fal-ai/client` queue API:

1. `fal.queue.submit(endpoint, { input })` → `request_id`
2. `fal.queue.status(endpoint, { requestId })`
3. `fal.queue.result(endpoint, { requestId })` → `{ video: { url } }`

**Input schema (exact fields used):**

```json
{
  "prompt": "string (required)",
  "image_url": "https://... (required)",
  "duration": "6" | "10",
  "resolution": "512P" | "768P",
  "prompt_optimizer": true,
  "end_image_url": "https://... (optional; 768P only)"
}
```

No invented parameters (no negative prompt / audio fields sent to Hailuo).

---

## 5. Queue integration

| Queue | Behavior |
| --- | --- |
| `motion-analysis` | Provider-independent brief; creates VIDEO jobs with `provider` from `MotionGeneration` |
| `video-generation` | Resolves Hailuo/Kling; idempotent if `providerTaskId` already set; stores request id |
| `video-status-polling` | Polls the same provider; enqueues download on success |
| `video-download` | Retrieves MP4, FFprobe validates, MinIO upload, ProviderUsage complete |

Worker restart safety: persisted `MotionGeneration.providerTaskId` + `provider` resume polling without resubmitting (idempotency).

---

## 6. Pricing implementation

Configurable via env (not hardcoded throughout the app):

- 768P: `$0.045` / second → 6s ≈ **$0.27**
- 512P: `$0.017` / second

Flow:

1. Estimate before submit (`MotionService` + provider `estimateCost`)
2. Monthly budget guard per provider (`HAILUO_MAX_MONTHLY_SPEND_USD` / `KLING_MAX_MONTHLY_SPEND_USD`)
3. Persist provider, model, duration, resolution, estimated cost on `MotionGeneration`
4. `ProviderUsage` on submit (`image_to_video_submit`, `costKind: estimated`) and complete (`image_to_video_complete`)
5. Failed submits do not create a successful completion usage row
6. Idempotent resume avoids double-submit / double-charge attempts

fal.ai queue results do not always expose cash billing; when absent, completion usage records estimated cost with `costKind: estimated` and optional `actualCost` when available.

---

## 7. MinIO image accessibility approach

Hailuo requires a public HTTP(S) `image_url`.

1. If MinIO/public base is externally reachable → **presigned download URL** with TTL ≥ Hailuo timeout + buffer (credentials never exposed).
2. If local/private MinIO → download object bytes and **`fal.storage.upload`** temporary URL for the provider (still no permanent public ACL on user media).
3. Kling path still supports base64 first-frame when URLs are not reachable.
4. Expired/inaccessible URLs surface as provider/submit errors; no silent switch to another paid model.

---

## 8. Tests executed and results

| Suite | Result |
| --- | --- |
| Full API unit suite (`29` files / `160` tests) | **PASS** |
| Hailuo provider unit tests | **PASS** |
| Hailuo request / pricing / selection | **PASS** |
| Video provider registry | **PASS** |
| Kling provider regression | **PASS** |
| Motion schemas / MotionService | **PASS** |
| Shared + API + Worker + Web builds | **PASS** |
| Motion e2e (full stack) | Updated for Hailuo; not re-run in this session (requires DB/Redis/worker runtime) |
| Live fal.ai one-shot 6s test | **NOT TESTED** (`FAL_API_KEY` empty in local `.env`) |

---

## 9. Mock verification evidence

- `HailuoProvider` mock submit returns `mock-hailuo-*` ids, estimated cost ≈ `$0.27` for 6s 768P.
- Mock status transitions to `succeeded` and `retrieveCompletedVideo` returns a valid MP4 buffer (`ftyp` signature).
- Registry lists Hailuo as default/enabled and Kling as disabled with an unavailable reason.
- Invalid Hailuo duration `5` is rejected; `end_image_url` rejected at `512P`.

---

## 10. Live provider verification evidence

| Check | Status |
| --- | --- |
| Real fal.ai credentials available | **No** (`FAL_API_KEY=` empty) |
| Controlled 6-second live generation | **NOT TESTED** |
| Real MP4 / FFprobe / MinIO / DB provider fields | **NOT TESTED** |

Do **not** treat mock success as production readiness for paid Hailuo.

---

## 11. Known limitations

1. Live Hailuo not verified in this environment.
2. fal.ai does not always return billed cash amounts; “actual” cost may equal estimate until billing metadata exists.
3. Provider cancel remains local-only (`cancelTask` → `false`); queue cancellation is not relied upon.
4. Local MinIO requires fal.storage upload for live Hailuo (extra fal hop).
5. Prisma `MotionGeneration.provider` DB default may still say `"kling"` from Phase 6 migration; application code always sets the provider on create (old rows untouched).
6. Full motion e2e against Docker stack not executed in this session after Hailuo updates.

---

## 12. Confirmation that Kling remains preserved

- Kling provider source (`api` + `worker`) retained.
- Kling unit tests still pass.
- Kling configuration env vars retained.
- Kling is registered in `VideoProviderRegistry` / UI as optional/unavailable until `KLING_ENABLED=true`.
- Existing motion records and completed videos are not rewritten when changing the default provider.

---

## Verification matrix

| Capability | Implemented | Tested locally | Mock mode | Real fal.ai | Real video verified |
| --- | --- | --- | --- | --- | --- |
| Hailuo provider registration | Yes | Yes | Yes | No | No |
| Hailuo default selection | Yes | Yes | Yes | No | No |
| Kling preserved / disabled | Yes | Yes | N/A | N/A | N/A |
| Queue reuse + idempotency | Yes | Build + unit | Unit | No | No |
| Pricing + budget hooks | Yes | Yes | Yes | No | No |
| Presign / fal.storage image access | Yes | Build | Unit (mock URL path) | No | No |
| Frontend provider display | Yes | Web build | N/A | No | No |
| Phase 8 compatibility | Untouched | Build | N/A | No | No |
