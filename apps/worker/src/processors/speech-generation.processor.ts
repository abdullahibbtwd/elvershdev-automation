import type { Job, Processor } from 'bullmq';
import { AudioGenerationStatus, JobStatus, Prisma } from '@prisma/client';
import {
  buildSpeechStyleInstruction,
  DEFAULT_GEMINI_TTS_VOICE,
  type GenerationQueuePayload,
} from '@ai-video/shared';
import { enqueueAudioValidationJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { uploadObject } from '../lib/storage';
import { createSpeechGenerationProvider } from '../lib/tts';

function tempAudioKey(userId: string, storyId: string, audioGenerationId: string): string {
  return `tmp/users/${userId}/stories/${storyId}/narration/${audioGenerationId}.wav`;
}

async function maybeCompleteParentJob(
  prisma: ReturnType<typeof getPrisma>,
  generationJobId: string | null | undefined,
) {
  if (!generationJobId) return;

  const pending = await prisma.audioGeneration.count({
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

  if (pending > 0) return;

  const failed = await prisma.audioGeneration.count({
    where: { generationJobId, status: AudioGenerationStatus.FAILED },
  });
  const completed = await prisma.audioGeneration.count({
    where: { generationJobId, status: AudioGenerationStatus.COMPLETED },
  });

  const costs = await prisma.audioGeneration.aggregate({
    where: { generationJobId, status: AudioGenerationStatus.COMPLETED },
    _sum: { estimatedCost: true },
  });

  await prisma.generationJob.updateMany({
    where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
    data: {
      status: failed > 0 && completed === 0 ? JobStatus.FAILED : JobStatus.COMPLETED,
      progress: 100,
      actualCost: costs._sum.estimatedCost ?? undefined,
      completedAt: new Date(),
      errorMessage: failed > 0 ? `${failed} audio generation(s) failed` : null,
      result: { completed, failed } as Prisma.InputJsonValue,
    },
  });
}

export function createSpeechGenerationProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    const forceMock = Boolean(data.useMockAi) || process.env.NODE_ENV === 'test';
    const forceRegenerate = payload.forceRegenerate === true;

    const audioGenerationIds: string[] = Array.isArray(payload.audioGenerationIds)
      ? (payload.audioGenerationIds as unknown[]).filter((id): id is string => typeof id === 'string')
      : data.audioGenerationId
        ? [data.audioGenerationId]
        : typeof payload.audioGenerationId === 'string'
          ? [payload.audioGenerationId]
          : [];

    logger.info(
      {
        bullJobId: job.id,
        generationJobId,
        storyId: data.storyId,
        audioCount: audioGenerationIds.length,
        attempt: job.attemptsMade + 1,
      },
      'Speech generation started',
    );

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        return { status: 'cancelled' };
      }

      await prisma.generationJob.updateMany({
        where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
        data: {
          status: JobStatus.PROCESSING,
          progress: 5,
          attempts: job.attemptsMade + 1,
          startedAt: new Date(),
          errorMessage: null,
        },
      });
    }

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in speech-generation');
      }
      if (audioGenerationIds.length === 0) {
        throw new Error('No audioGenerationIds provided for speech generation');
      }

      const provider = createSpeechGenerationProvider(forceMock);
      const configCheck = provider.validateConfiguration();
      if (!configCheck.ok) {
        throw new Error(configCheck.message || 'Speech provider misconfigured');
      }

      let processed = 0;
      for (const audioGenerationId of audioGenerationIds) {
        const audio = await prisma.audioGeneration.findUnique({
          where: { id: audioGenerationId },
          include: {
            sceneNarration: true,
            voiceProfile: true,
          },
        });

        if (!audio) {
          logger.warn({ audioGenerationId }, 'AudioGeneration not found; skipping');
          continue;
        }

        // Idempotency: do not regenerate completed audio unless explicitly requested.
        if (audio.status === AudioGenerationStatus.COMPLETED && !forceRegenerate) {
          logger.info({ audioGenerationId }, 'Skipping completed audio (idempotent)');
          processed += 1;
          continue;
        }

        if (
          audio.status === AudioGenerationStatus.VALIDATING ||
          audio.status === AudioGenerationStatus.STORING
        ) {
          // Downstream already owns this row.
          processed += 1;
          continue;
        }

        await prisma.audioGeneration.update({
          where: { id: audioGenerationId },
          data: {
            status: AudioGenerationStatus.GENERATING,
            progress: 15,
            startedAt: audio.startedAt ?? new Date(),
            errorCode: null,
            errorMessage: null,
            generationJobId: generationJobId ?? audio.generationJobId,
          },
        });

        const speakingStyle =
          audio.speakingStyle ||
          buildSpeechStyleInstruction({
            speakingStyle: audio.sceneNarration?.speakingStyle,
            emotionalTone: audio.sceneNarration?.emotionalTone,
            deliveryInstructions: audio.sceneNarration?.deliveryInstructions,
          }) ||
          (audio.voiceProfile?.configuration as { speakingStyle?: string } | null)?.speakingStyle;

        const voiceId =
          audio.providerVoiceId ||
          audio.voiceProfile?.providerVoiceId ||
          process.env.GEMINI_TTS_DEFAULT_VOICE ||
          DEFAULT_GEMINI_TTS_VOICE;

        const speech = await provider.generateSpeech({
          text: audio.sourceText,
          voiceId,
          speakingStyle: speakingStyle || undefined,
          language: audio.voiceProfile?.language,
          mimeType: 'audio/wav',
        });

        const tempKey = tempAudioKey(audio.userId, audio.storyId, audio.id);
        await uploadObject(tempKey, Buffer.from(speech.audioBytes), speech.mimeType);

        await prisma.audioGeneration.update({
          where: { id: audioGenerationId },
          data: {
            status: AudioGenerationStatus.VALIDATING,
            progress: 45,
            model: speech.model,
            provider: speech.provider,
            providerVoiceId: speech.voiceId,
            format: speech.format,
            sampleRate: speech.sampleRate,
            channels: speech.channels,
            fileSize: BigInt(speech.audioBytes.byteLength),
            estimatedCost: new Prisma.Decimal(speech.estimatedCostUsd),
          },
        });

        await enqueueAudioValidationJob({
          generationJobId: generationJobId ?? audio.generationJobId ?? audioGenerationId,
          audioGenerationId,
          userId: audio.userId,
          storyId: audio.storyId,
          sceneId: audio.sceneId,
          narrationScriptId: audio.narrationScriptId,
          tempObjectKey: tempKey,
          useMockAi: forceMock,
          simulateFailure: Boolean(payload.simulateFailure || data.simulateFailure),
          forceRegenerate,
        });

        processed += 1;
        const progress = Math.min(90, Math.round((processed / audioGenerationIds.length) * 70) + 10);
        await job.updateProgress(progress);
        if (generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: generationJobId },
            data: { progress },
          });
        }
      }

      // Parent job may still be waiting on validation/storage stages.
      await maybeCompleteParentJob(prisma, generationJobId);

      logger.info(
        { generationJobId, processed },
        'Speech generation submitted audio for validation',
      );

      return { status: 'submitted', processed };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ err: error, generationJobId }, 'Speech generation failed');

      for (const audioGenerationId of audioGenerationIds) {
        await prisma.audioGeneration.updateMany({
          where: {
            id: audioGenerationId,
            status: {
              in: [AudioGenerationStatus.PENDING, AudioGenerationStatus.GENERATING],
            },
          },
          data: {
            status: AudioGenerationStatus.FAILED,
            errorCode: 'SPEECH_GENERATION_FAILED',
            errorMessage: message,
            completedAt: new Date(),
          },
        });
      }

      const maxAttempts = job.opts.attempts ?? 3;
      const isFinal = job.attemptsMade + 1 >= maxAttempts;
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId },
          data: {
            status: isFinal ? JobStatus.FAILED : JobStatus.PROCESSING,
            errorMessage: message,
            ...(isFinal ? { completedAt: new Date() } : {}),
          },
        });
      }

      throw error;
    }
  };
}
