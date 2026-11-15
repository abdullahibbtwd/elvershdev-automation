import { randomUUID } from 'node:crypto';
import type { Job, Processor } from 'bullmq';
import {
  AudioGenerationStatus,
  JobStatus,
  MediaType,
  Prisma,
} from '@prisma/client';
import type { AudioPipelineQueuePayload } from '@ai-video/shared';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { downloadObject, uploadObject } from '../lib/storage';

function finalAudioKey(params: {
  userId: string;
  storyId: string;
  narrationScriptId: string;
  sceneId: string | null | undefined;
  audioGenerationId: string;
}): string {
  const scenePart = params.sceneId ? `scene-${params.sceneId}` : 'full-story';
  return `users/${params.userId}/stories/${params.storyId}/narration/${params.narrationScriptId}/${scenePart}-${params.audioGenerationId}.wav`;
}

async function finalizeParentJob(
  prisma: ReturnType<typeof getPrisma>,
  generationJobId: string | null | undefined,
) {
  if (!generationJobId) return;

  const active = await prisma.audioGeneration.count({
    where: {
      generationJobId,
      status: {
        in: [
          AudioGenerationStatus.PENDING,
          AudioGenerationStatus.GENERATING,
          AudioGenerationStatus.VALIDATING,
          AudioGenerationStatus.STORING,
        ],
      },
    },
  });
  if (active > 0) return;

  const failed = await prisma.audioGeneration.count({
    where: { generationJobId, status: AudioGenerationStatus.FAILED },
  });
  const completed = await prisma.audioGeneration.count({
    where: { generationJobId, status: AudioGenerationStatus.COMPLETED },
  });
  const costSum = await prisma.audioGeneration.aggregate({
    where: { generationJobId, status: AudioGenerationStatus.COMPLETED },
    _sum: { estimatedCost: true, actualCost: true },
  });

  await prisma.generationJob.updateMany({
    where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
    data: {
      status: failed > 0 && completed === 0 ? JobStatus.FAILED : JobStatus.COMPLETED,
      progress: 100,
      actualCost: costSum._sum.actualCost ?? costSum._sum.estimatedCost ?? undefined,
      completedAt: new Date(),
      errorMessage: failed > 0 ? `${failed} audio generation(s) failed` : null,
      result: { completed, failed } as Prisma.InputJsonValue,
    },
  });
}

export function createAudioStorageProcessor(logger: Logger): Processor {
  return async (job: Job<AudioPipelineQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const { audioGenerationId, generationJobId, tempObjectKey } = data;

    logger.info(
      { bullJobId: job.id, audioGenerationId, generationJobId, attempt: job.attemptsMade + 1 },
      'Audio storage started',
    );

    const audio = await prisma.audioGeneration.findUnique({
      where: { id: audioGenerationId },
    });
    if (!audio) {
      throw new Error(`AudioGeneration ${audioGenerationId} not found`);
    }

    if (audio.status === AudioGenerationStatus.COMPLETED && audio.audioMediaAssetId && !data.forceRegenerate) {
      await finalizeParentJob(prisma, generationJobId);
      return { status: 'already_completed' };
    }

    try {
      if (data.simulateFailure) {
        throw new Error('Simulated failure in audio-storage');
      }
      if (!tempObjectKey) {
        throw new Error('tempObjectKey is required for audio storage');
      }

      await prisma.audioGeneration.update({
        where: { id: audioGenerationId },
        data: {
          status: AudioGenerationStatus.STORING,
          progress: 85,
          errorCode: null,
          errorMessage: null,
        },
      });

      const objectBytes = await downloadObject(tempObjectKey);
      const storageKey = finalAudioKey({
        userId: audio.userId,
        storyId: audio.storyId,
        narrationScriptId: audio.narrationScriptId,
        sceneId: audio.sceneId,
        audioGenerationId: audio.id,
      });

      await uploadObject(storageKey, objectBytes, 'audio/wav');

      const mediaId = randomUUID();
      const media = await prisma.mediaAsset.create({
        data: {
          id: mediaId,
          userId: audio.userId,
          type: MediaType.AUDIO,
          storageKey,
          originalName: `${audio.id}.wav`,
          mimeType: 'audio/wav',
          fileSize: BigInt(objectBytes.byteLength),
          metadata: {
            durationSeconds: audio.duration,
            sampleRate: audio.sampleRate,
            channels: audio.channels,
            format: audio.format ?? 'wav',
            codec: 'pcm_s16le',
            audioGenerationId: audio.id,
            narrationScriptId: audio.narrationScriptId,
            sceneId: audio.sceneId,
            provider: audio.provider,
            model: audio.model,
          } as Prisma.InputJsonValue,
        },
      });

      // Select this version for the scene by default when none selected yet.
      if (audio.sceneId) {
        const selected = await prisma.audioGeneration.findFirst({
          where: {
            sceneId: audio.sceneId,
            isSelected: true,
            status: AudioGenerationStatus.COMPLETED,
          },
          select: { id: true },
        });
        if (!selected) {
          await prisma.audioGeneration.updateMany({
            where: { sceneId: audio.sceneId, isSelected: true },
            data: { isSelected: false },
          });
        }
      }

      const shouldSelect =
        Boolean(audio.sceneId) &&
        !(await prisma.audioGeneration.findFirst({
          where: {
            sceneId: audio.sceneId!,
            isSelected: true,
            status: AudioGenerationStatus.COMPLETED,
            id: { not: audio.id },
          },
          select: { id: true },
        }));

      await prisma.audioGeneration.update({
        where: { id: audioGenerationId },
        data: {
          status: AudioGenerationStatus.COMPLETED,
          progress: 100,
          audioMediaAssetId: media.id,
          fileSize: BigInt(objectBytes.byteLength),
          actualCost: audio.estimatedCost,
          isSelected: shouldSelect || audio.isSelected,
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });

      if (generationJobId) {
        await prisma.providerUsage.create({
          data: {
            userId: audio.userId,
            storyId: audio.storyId,
            generationJobId,
            provider: audio.provider || 'gemini',
            model: audio.model || process.env.GEMINI_TTS_MODEL || 'gemini-3.8-flash-lite-tts',
            requestType: 'speech_generation',
            inputTokens: 0,
            outputTokens: audio.duration
              ? Math.ceil(audio.duration * parseFloat(process.env.GEMINI_TTS_AUDIO_TOKENS_PER_SECOND ?? '25'))
              : 0,
            estimatedCost: audio.estimatedCost ?? new Prisma.Decimal(0),
            metadata: {
              audioGenerationId: audio.id,
              sceneId: audio.sceneId,
              durationSeconds: audio.duration,
              characters: audio.sourceText.length,
              voiceId: audio.providerVoiceId,
              storageKey,
              costIsEstimate: true,
            },
          },
        });
      }

      await finalizeParentJob(prisma, generationJobId);
      await job.updateProgress(100);

      logger.info(
        { audioGenerationId, storageKey, mediaAssetId: media.id },
        'Audio storage completed',
      );

      return { status: 'completed', storageKey, mediaAssetId: media.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, audioGenerationId }, 'Audio storage failed');

      await prisma.audioGeneration.updateMany({
        where: { id: audioGenerationId },
        data: {
          status: AudioGenerationStatus.FAILED,
          errorCode: 'AUDIO_STORAGE_FAILED',
          errorMessage: message,
          completedAt: new Date(),
        },
      });

      await finalizeParentJob(prisma, generationJobId);
      throw error;
    }
  };
}
