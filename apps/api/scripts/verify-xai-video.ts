/**
 * Phase 1 verification for xAI Grok Imagine Video 1.5 Lite.
 *
 * Usage:
 *   # Mock path (no API key required)
 *   pnpm --filter @ai-video/api xai:verify
 *
 *   # Live path (requires XAI_API_KEY; charges real usage)
 *   pnpm --filter @ai-video/api xai:verify:live
 *
 * Docs: https://docs.x.ai/developers/model-capabilities/video/overview
 */
import {
  assertXaiLiteModel,
  buildXaiTextToVideoRequest,
  costUsdFromXaiTicks,
  createMockMp4Buffer,
  estimateXaiVideoCostUsd,
  mapXaiPollStatus,
  parseXaiPollResponse,
  parseXaiSubmitResponse,
  xaiVideoGenerationsUrl,
  xaiVideoStatusUrl,
  XAI_VIDEO_LITE_MODEL,
} from '@ai-video/shared';

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runMock(): Promise<void> {
  const model = assertXaiLiteModel(XAI_VIDEO_LITE_MODEL);
  const body = buildXaiTextToVideoRequest({
    prompt: 'A realistic cinematic close-up of two actors speaking on a balcony at dusk',
    durationSeconds: 4,
    resolution: '720p',
    aspectRatio: '16:9',
    model,
  });
  const estimated = estimateXaiVideoCostUsd(4, '720p');
  const buffer = createMockMp4Buffer();

  console.log(
    JSON.stringify(
      {
        mode: 'mock',
        ok: true,
        model: body.model,
        request: body,
        estimatedCostUsd: estimated,
        mockVideoBytes: buffer.length,
        note: 'Mock path only — no provider call was made',
      },
      null,
      2,
    ),
  );
}

async function runLive(): Promise<void> {
  const apiKey = process.env.XAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('XAI_API_KEY is required for --live verification');
  }

  const model = assertXaiLiteModel(process.env.XAI_VIDEO_MODEL ?? XAI_VIDEO_LITE_MODEL);
  const durationSeconds = Number.parseInt(process.env.XAI_VIDEO_VERIFY_DURATION ?? '4', 10) || 4;
  const resolution = process.env.XAI_VIDEO_RESOLUTION ?? '720p';
  const body = buildXaiTextToVideoRequest({
    prompt:
      process.env.XAI_VIDEO_VERIFY_PROMPT ||
      'Realistic cinematic two-shot: a man and a woman talk quietly on a rainy city balcony at night, natural lip-synced dialogue, soft practical lighting, no subtitles',
    durationSeconds,
    resolution,
    aspectRatio: '16:9',
    model,
  });

  const estimated = estimateXaiVideoCostUsd(durationSeconds, resolution);
  console.log(
    JSON.stringify(
      { mode: 'live', phase: 'submit', model, estimatedCostUsd: estimated, body },
      null,
      2,
    ),
  );

  const submitResponse = await fetch(xaiVideoGenerationsUrl(), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const submitJson = await submitResponse.json();
  if (!submitResponse.ok) {
    throw new Error(
      `Submit failed HTTP ${submitResponse.status}: ${JSON.stringify(submitJson)}`,
    );
  }

  const { request_id: requestId } = parseXaiSubmitResponse(submitJson);
  console.log(JSON.stringify({ mode: 'live', phase: 'submitted', requestId }, null, 2));

  const pollIntervalMs =
    (Number.parseInt(process.env.XAI_VIDEO_POLL_INTERVAL_SECONDS ?? '5', 10) || 5) * 1000;
  const maxAttempts = Number.parseInt(process.env.XAI_VIDEO_MAX_POLL_ATTEMPTS ?? '120', 10) || 120;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await sleep(pollIntervalMs);
    const statusResponse = await fetch(xaiVideoStatusUrl(requestId), {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const statusJson = await statusResponse.json();
    if (!statusResponse.ok) {
      throw new Error(
        `Poll failed HTTP ${statusResponse.status}: ${JSON.stringify(statusJson)}`,
      );
    }

    const parsed = parseXaiPollResponse(statusJson);
    const status = mapXaiPollStatus(parsed.status);
    console.log(
      JSON.stringify(
        {
          mode: 'live',
          phase: 'poll',
          attempt,
          status,
          progress: parsed.progress ?? null,
        },
        null,
        2,
      ),
    );

    if (status === 'failed') {
      throw new Error(`Generation failed: ${parsed.error?.message || JSON.stringify(parsed)}`);
    }

    if (status === 'succeeded') {
      const url = parsed.video?.url;
      if (!url) {
        throw new Error('Generation succeeded but video.url was missing');
      }

      const download = await fetch(url);
      if (!download.ok) {
        throw new Error(`Download failed HTTP ${download.status}`);
      }
      const bytes = Buffer.from(await download.arrayBuffer());
      const actualCostUsd = costUsdFromXaiTicks(parsed.usage?.cost_in_usd_ticks);

      console.log(
        JSON.stringify(
          {
            mode: 'live',
            ok: true,
            requestId,
            model: parsed.model ?? model,
            videoUrlHost: new URL(url).host,
            videoBytes: bytes.length,
            durationSeconds: parsed.video?.duration ?? durationSeconds,
            estimatedCostUsd: estimated,
            actualCostUsd: actualCostUsd ?? null,
            respectModeration: parsed.video?.respect_moderation ?? null,
          },
          null,
          2,
        ),
      );
      return;
    }
  }

  throw new Error(`Timed out after ${maxAttempts} poll attempts`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--live')) {
    await runLive();
    return;
  }
  await runMock();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2));
  process.exit(1);
});
