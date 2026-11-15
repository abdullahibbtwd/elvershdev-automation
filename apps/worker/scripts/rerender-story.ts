/**
 * Enqueue a fresh final render for a story (no HTTP auth required).
 * Usage: pnpm exec tsx scripts/rerender-story.ts [storyId]
 */
import { config } from 'dotenv';
import path from 'node:path';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { GenerationJobType, JobStatus, PrismaClient, VideoRenderStatus } from '@prisma/client';
import { QUEUE_NAMES } from '@ai-video/shared';
import { enqueueVideoRenderPlanningJob } from '../src/lib/enqueue';

config({ path: path.resolve(__dirname, '../../../.env') });

async function main() {
  const storyId = process.argv[2] || '398845f9-d223-40c4-8abf-288203e47203';
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

  try {
    const story = await prisma.story.findUnique({
      where: { id: storyId },
      select: { id: true, userId: true, title: true },
    });
    if (!story) throw new Error(`Story not found: ${storyId}`);

    const active = await prisma.videoRender.findFirst({
      where: {
        storyId,
        status: {
          in: [
            VideoRenderStatus.PENDING,
            VideoRenderStatus.PLANNING,
            VideoRenderStatus.RENDERING_SCENES,
            VideoRenderStatus.MIXING_AUDIO,
            VideoRenderStatus.GENERATING_SUBTITLES,
            VideoRenderStatus.COMBINING,
            VideoRenderStatus.VALIDATING,
            VideoRenderStatus.UPLOADING,
          ],
        },
      },
    });
    if (active) {
      throw new Error(`Render already in progress: ${active.id} (${active.status})`);
    }

    const sceneCount = await prisma.storyScene.count({ where: { storyId } });
    const last = await prisma.videoRender.findFirst({
      where: { storyId, status: VideoRenderStatus.COMPLETED },
      orderBy: { createdAt: 'desc' },
    });

    const generationJob = await prisma.generationJob.create({
      data: {
        userId: story.userId,
        storyId,
        jobType: GenerationJobType.RENDER,
        status: JobStatus.PENDING,
        progress: 0,
        provider: 'ffmpeg',
        queueName: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
        payload: { forceRerender: true, source: 'rerender-story-script' },
        maxAttempts: 3,
      },
    });

    const render = await prisma.videoRender.create({
      data: {
        userId: story.userId,
        storyId,
        status: VideoRenderStatus.PENDING,
        renderType: 'final',
        aspectRatio: last?.aspectRatio ?? '9:16',
        width: last?.width ?? 1080,
        height: last?.height ?? 1920,
        frameRate: last?.frameRate ?? 30,
        videoCodec: last?.videoCodec ?? 'libx264',
        audioCodec: last?.audioCodec ?? 'aac',
        qualityPreset: last?.qualityPreset ?? 'medium',
        subtitleEnabled: last?.subtitleEnabled ?? true,
        subtitleBurnedIn: last?.subtitleBurnedIn ?? true,
        backgroundMusicAssetId: last?.backgroundMusicAssetId ?? null,
        renderSettings: last?.renderSettings ?? {},
        totalSceneCount: sceneCount,
        progress: 0,
        generationJobId: generationJob.id,
      },
    });

    const { queueJobId } = await enqueueVideoRenderPlanningJob({
      generationJobId: generationJob.id,
      videoRenderId: render.id,
      userId: story.userId,
      storyId,
      forceRerender: true,
      stage: 'planning',
    });

    await prisma.generationJob.update({
      where: { id: generationJob.id },
      data: {
        status: JobStatus.QUEUED,
        queueJobId,
        queueName: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
      },
    });

    console.log(
      JSON.stringify(
        {
          storyId,
          title: story.title,
          videoRenderId: render.id,
          generationJobId: generationJob.id,
          queueJobId,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
