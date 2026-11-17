/**
 * Publish an already-rendered dialogue pilot video (no regeneration).
 *
 * Usage:
 *   cd apps/api && set -a && source ../../.env && set +a \
 *     && PILOT_EPISODE_ID=... pnpm exec ts-node -r tsconfig-paths/register scripts/publish-dialogue-pilot.ts
 */
import { NestFactory } from '@nestjs/core';
import { MediaType, Prisma, SeriesEpisodeStatus, StoryStatus, VideoRenderStatus } from '@prisma/client';
import { createReadStream } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { PublishingService } from '../src/modules/publishing/publishing.service';

const EPISODE_ID = process.env.PILOT_EPISODE_ID || '5c4b704c-d3c1-4a6f-b4f1-a7ce61661ebd';
const VIDEO_PATH = process.env.PILOT_VIDEO_PATH || '/tmp/series-dialogue-pilot/pilot-episode.mp4';
const OUT_DIR = process.env.PILOT_OUT_DIR || '/tmp/series-dialogue-pilot';
const USER_EMAIL = process.env.PILOT_USER_EMAIL || 'abdullahibbtwd@gmail.com';

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const storage = app.get(StorageService);
  const publishing = app.get(PublishingService);

  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`User not found: ${USER_EMAIL}`);

  const episode = await prisma.seriesEpisode.findFirst({
    where: { id: EPISODE_ID, series: { userId: user.id } },
    include: { series: true },
  });
  if (!episode) throw new Error(`Episode not found: ${EPISODE_ID}`);

  const channel = await prisma.socialChannel.findFirst({
    where: {
      userId: user.id,
      platform: 'FACEBOOK',
      connectionStatus: 'CONNECTED',
      isActive: true,
    },
  });
  if (!channel) throw new Error('No CONNECTED Facebook channel');

  const finalBytes = await streamToBuffer(createReadStream(VIDEO_PATH));
  const storageKey = `series/${episode.seriesId}/episodes/${episode.id}/pilot-final.mp4`;
  await storage.uploadObject(storageKey, finalBytes, 'video/mp4');
  const outputAsset = await prisma.mediaAsset.create({
    data: {
      userId: user.id,
      type: MediaType.VIDEO,
      storageKey,
      originalName: 'pilot-episode.mp4',
      mimeType: 'video/mp4',
      fileSize: BigInt(finalBytes.byteLength),
      metadata: { pilot: true, dialogueDriven: true } as Prisma.InputJsonValue,
    },
  });

  const duration = 15.513;
  const story = await prisma.story.create({
    data: {
      userId: user.id,
      title: episode.title,
      content: episode.script || episode.title,
      status: StoryStatus.READY,
      language: 'en',
      targetDurationSeconds: 50,
    },
  });
  const render = await prisma.videoRender.create({
    data: {
      userId: user.id,
      storyId: story.id,
      status: VideoRenderStatus.COMPLETED,
      outputMediaAssetId: outputAsset.id,
      duration,
      width: 1080,
      height: 1920,
      progress: 100,
      completedAt: new Date(),
      renderSettings: { profileId: 'vertical_1080', pilot: true } as Prisma.InputJsonValue,
      timeline: { scenes: [] } as Prisma.InputJsonValue,
    },
  });
  await prisma.seriesEpisode.update({
    where: { id: episode.id },
    data: {
      storyId: story.id,
      videoRenderId: render.id,
      status: SeriesEpisodeStatus.RENDERED,
      actualDurationSeconds: duration,
    },
  });

  console.log(`Publishing render ${render.id} to Facebook channel ${channel.id}...`);
  const result = await publishing.publishRender(user.id, render.id, {
    targets: [{ channelId: channel.id }],
    defaults: {
      caption: `${episode.title}\n\nA short dialogue-driven family story. #SeriesStudio #Pilot`,
    },
    idempotencyKey: `pilot-dialogue-publish-${episode.id}`,
  } as never);

  const report = {
    episodeId: episode.id,
    seriesId: episode.seriesId,
    renderId: render.id,
    channelId: channel.id,
    platform: 'FACEBOOK',
    videoPath: VIDEO_PATH,
    result,
    publishedAt: new Date().toISOString(),
  };
  await writeFile(join(OUT_DIR, 'publish-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await app.close();
}

main().catch((error) => {
  console.error('PUBLISH FAILED:', error);
  process.exit(1);
});
