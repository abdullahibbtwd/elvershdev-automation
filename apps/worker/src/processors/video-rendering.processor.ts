import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Job, Processor } from 'bullmq';
import {
  Prisma,
  VideoRenderSceneStatus,
  VideoRenderStatus,
} from '@prisma/client';
import {
  buildAss,
  buildSrt,
  getVideoOutputProfile,
  renderSettingsSchema,
  type PlannedTimelineScene,
  type RenderTimeline,
  type VideoRenderQueuePayload,
} from '@ai-video/shared';
import { FfmpegService } from '../lib/ffmpeg';
import { enqueueVideoRenderValidationJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import {
  isRenderCancelled,
  markRenderFailed,
  tempRenderPrefix,
  updateRenderProgress,
} from '../lib/render-helpers';
import { downloadObject, uploadObject } from '../lib/storage';

async function downloadToFile(storageKey: string, destPath: string): Promise<void> {
  const buffer = await downloadObject(storageKey);
  await writeFile(destPath, buffer);
}

export function createVideoRenderingProcessor(logger: Logger): Processor {
  return async (job: Job<VideoRenderQueuePayload>) => {
    const prisma = getPrisma();
    const ffmpeg = new FfmpegService();
    const data = job.data;
    const { videoRenderId, generationJobId } = data;
    const abort = new AbortController();

    logger.info(
      { bullJobId: job.id, videoRenderId, generationJobId, attempt: job.attemptsMade + 1 },
      'Video rendering started',
    );

    const render = await prisma.videoRender.findUnique({
      where: { id: videoRenderId },
      include: {
        backgroundMusicAsset: true,
        scenes: { orderBy: { sequence: 'asc' } },
      },
    });
    if (!render) throw new Error(`VideoRender ${videoRenderId} not found`);
    if (await isRenderCancelled(prisma, videoRenderId)) return { status: 'cancelled' };

    let workDir: string | null = null;

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in video-rendering');
      }

      await ffmpeg.ensureAvailable();
      workDir = await ffmpeg.createTempDir(`render-${videoRenderId}-`);
      const assetsDir = join(workDir, 'assets');
      const segmentsDir = join(workDir, 'segments');
      await mkdir(assetsDir, { recursive: true });
      await mkdir(segmentsDir, { recursive: true });

      const settings = renderSettingsSchema.parse(render.renderSettings ?? {});
      const profile = getVideoOutputProfile(settings.profileId);
      const timeline = render.timeline as unknown as RenderTimeline | null;
      if (!timeline?.scenes?.length) {
        throw new Error('Render timeline is missing; planning must run first');
      }

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.PREPARING_ASSETS,
        progress: 18,
      });

      const localAssets = new Map<string, string>();
      const ensureLocal = async (key: string | null | undefined, fileName: string) => {
        if (!key) return null;
        if (localAssets.has(key)) return localAssets.get(key)!;
        const dest = join(assetsDir, fileName);
        await downloadToFile(key, dest);
        localAssets.set(key, dest);
        return dest;
      };

      const segmentPaths: string[] = [];
      const narrationClips: Array<{ path: string; startSeconds: number; durationSeconds: number }> =
        [];

      for (let i = 0; i < timeline.scenes.length; i += 1) {
        if (await isRenderCancelled(prisma, videoRenderId)) {
          abort.abort();
          await ffmpeg.cleanupTemporaryFiles([workDir]);
          return { status: 'cancelled' };
        }

        const scene = timeline.scenes[i] as PlannedTimelineScene;
        await updateRenderProgress(prisma, videoRenderId, {
          status: VideoRenderStatus.RENDERING_SCENES,
          progress: 20 + Math.floor((i / timeline.scenes.length) * 35),
          currentSceneSequence: scene.sequence,
        });

        await prisma.videoRenderScene.updateMany({
          where: { videoRenderId, sceneId: scene.sceneId },
          data: { status: VideoRenderSceneStatus.RENDERING },
        });

        const motionPath = await ensureLocal(scene.motionStorageKey, `motion-${scene.sequence}.mp4`);
        const imagePath = await ensureLocal(scene.imageStorageKey, `image-${scene.sequence}.png`);
        const audioPath = await ensureLocal(scene.audioStorageKey, `audio-${scene.sequence}.wav`);
        if (!audioPath) throw new Error(`Missing narration audio for scene ${scene.sequence}`);

        const segmentPath = join(segmentsDir, `scene-${String(scene.sequence).padStart(3, '0')}.mp4`);
        const existingScene = render.scenes.find((s) => s.sceneId === scene.sceneId);
        if (existingScene?.segmentStorageKey && !data.forceRerender) {
          try {
            await downloadToFile(existingScene.segmentStorageKey, segmentPath);
            segmentPaths.push(segmentPath);
            narrationClips.push({
              path: audioPath,
              startSeconds: scene.startTime,
              durationSeconds: scene.narrationDurationSeconds,
            });
            await prisma.videoRenderScene.updateMany({
              where: { videoRenderId, sceneId: scene.sceneId },
              data: { status: VideoRenderSceneStatus.COMPLETED },
            });
            continue;
          } catch {
            // fall through to re-render
          }
        }

        await ffmpeg.createSceneSegment({
          motionPath,
          imagePath,
          outputPath: segmentPath,
          durationSeconds: scene.duration,
          motionTrimSeconds: scene.trimMotionToSeconds,
          extendWithImageSeconds: scene.extendWithImageSeconds,
          profile,
          kenBurns: settings.kenBurnsEnabled,
          kenBurnsZoom: settings.kenBurnsZoom,
          fitMode: settings.fitMode,
          signal: abort.signal,
          workDir: segmentsDir,
        });

        const segmentKey = `${tempRenderPrefix(render.userId, videoRenderId)}/segments/scene-${scene.sequence}.mp4`;
        const segmentBuffer = await readFile(segmentPath);
        await uploadObject(segmentKey, segmentBuffer, 'video/mp4');

        await prisma.videoRenderScene.updateMany({
          where: { videoRenderId, sceneId: scene.sceneId },
          data: {
            status: VideoRenderSceneStatus.COMPLETED,
            segmentStorageKey: segmentKey,
          },
        });

        segmentPaths.push(segmentPath);
        narrationClips.push({
          path: audioPath,
          startSeconds: scene.startTime,
          durationSeconds: scene.narrationDurationSeconds,
        });

        await updateRenderProgress(prisma, videoRenderId, {
          completedSceneCount: i + 1,
          progress: 20 + Math.floor(((i + 1) / timeline.scenes.length) * 35),
        });
      }

      if (await isRenderCancelled(prisma, videoRenderId)) {
        abort.abort();
        await ffmpeg.cleanupTemporaryFiles([workDir]);
        return { status: 'cancelled' };
      }

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.MIXING_AUDIO,
        progress: 60,
      });

      const silentVideoPath = join(workDir, 'video-silent.mp4');
      await ffmpeg.combineSegments({
        segmentPaths,
        outputPath: silentVideoPath,
        profile,
        signal: abort.signal,
        workDir,
      });

      const narrationPath = join(workDir, 'narration.m4a');
      await ffmpeg.synchronizeNarration({
        sceneAudioPaths: narrationClips,
        outputPath: narrationPath,
        totalDurationSeconds: timeline.totalDurationSeconds,
        profile,
        narrationVolume: settings.audioMix.narrationVolume,
        fadeInSeconds: settings.audioMix.fadeInSeconds,
        fadeOutSeconds: settings.audioMix.fadeOutSeconds,
        signal: abort.signal,
      });

      let musicPath: string | null = null;
      if (render.backgroundMusicAsset?.storageKey) {
        musicPath = await ensureLocal(
          render.backgroundMusicAsset.storageKey,
          'background-music.audio',
        );
      }

      const mixedAudioPath = join(workDir, 'mixed-audio.m4a');
      await ffmpeg.mixAudio({
        narrationPath,
        musicPath,
        outputPath: mixedAudioPath,
        totalDurationSeconds: timeline.totalDurationSeconds,
        profile,
        musicVolume: settings.audioMix.musicVolume,
        duckingEnabled: settings.audioMix.duckingEnabled,
        duckingThresholdDb: settings.audioMix.duckingThresholdDb,
        duckingRatio: settings.audioMix.duckingRatio,
        duckingAttackMs: settings.audioMix.duckingAttackMs,
        duckingReleaseMs: settings.audioMix.duckingReleaseMs,
        musicFadeInSeconds: settings.audioMix.fadeInSeconds,
        musicFadeOutSeconds: settings.audioMix.fadeOutSeconds,
        signal: abort.signal,
      });

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.GENERATING_SUBTITLES,
        progress: 72,
      });

      const srtPath = join(workDir, 'subtitles.srt');
      const assPath = join(workDir, 'subtitles.ass');
      const srtContent = settings.subtitleEnabled ? buildSrt(timeline.subtitleCues) : '';
      const assContent = settings.subtitleEnabled
        ? buildAss(timeline.subtitleCues, settings.subtitleStyle, profile.width, profile.height)
        : '';
      await ffmpeg.generateSubtitles({ srtContent, assContent, srtPath, assPath });

      await updateRenderProgress(prisma, videoRenderId, {
        status: VideoRenderStatus.COMBINING,
        progress: 82,
      });

      const finalPath = join(workDir, 'final.mp4');
      await ffmpeg.muxFinalVideo({
        videoPath: silentVideoPath,
        audioPath: mixedAudioPath,
        outputPath: finalPath,
        profile,
        assSubtitlePath: settings.subtitleEnabled ? assPath : null,
        srtSubtitlePath: settings.subtitleEnabled ? srtPath : null,
        burnSubtitles: settings.subtitleEnabled && settings.subtitleBurnedIn,
        signal: abort.signal,
      });

      const tempFinalKey = `${tempRenderPrefix(render.userId, videoRenderId)}/final.mp4`;
      const finalBuffer = await readFile(finalPath);
      await uploadObject(tempFinalKey, finalBuffer, 'video/mp4');

      let tempSrtKey: string | null = null;
      let tempAssKey: string | null = null;
      if (settings.subtitleEnabled && srtContent) {
        tempSrtKey = `${tempRenderPrefix(render.userId, videoRenderId)}/subtitles.srt`;
        tempAssKey = `${tempRenderPrefix(render.userId, videoRenderId)}/subtitles.ass`;
        await uploadObject(tempSrtKey, Buffer.from(srtContent, 'utf8'), 'application/x-subrip');
        await uploadObject(tempAssKey, Buffer.from(assContent, 'utf8'), 'text/x-ass');
      }

      await updateRenderProgress(prisma, videoRenderId, {
        progress: 88,
        status: VideoRenderStatus.VALIDATING,
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: {
            progress: 88,
            result: {
              tempFinalKey,
              tempSrtKey,
              tempAssKey,
              workDirHint: workDir,
            } as Prisma.InputJsonValue,
          },
        });
      }

      // Persist temp keys on render settings blob for next stages
      await prisma.videoRender.update({
        where: { id: videoRenderId },
        data: {
          renderSettings: {
            ...settings,
            _temp: { tempFinalKey, tempSrtKey, tempAssKey },
          } as unknown as Prisma.InputJsonValue,
        },
      });

      const { queueJobId } = await enqueueVideoRenderValidationJob({
        generationJobId: generationJobId ?? render.generationJobId ?? '',
        videoRenderId,
        userId: render.userId,
        storyId: render.storyId,
        stage: 'validation',
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: {
            queueName: 'video-render-validation',
            queueJobId: queueJobId ?? undefined,
          },
        });
      }

      await ffmpeg.cleanupTemporaryFiles([workDir]);
      logger.info({ videoRenderId }, 'Video rendering stage completed');
      return { status: 'rendered', tempFinalKey };
    } catch (error) {
      abort.abort();
      ffmpeg.killActiveProcesses();
      if (workDir) await ffmpeg.cleanupTemporaryFiles([workDir]);
      const message = (error as Error).message || 'Video rendering failed';
      if (message.includes('cancelled')) {
        return { status: 'cancelled' };
      }
      logger.error({ err: error, videoRenderId }, 'Video rendering failed');
      await markRenderFailed(prisma, {
        videoRenderId,
        generationJobId,
        errorCode: 'RENDERING_FAILED',
        errorMessage: message,
      });
      throw error;
    }
  };
}
