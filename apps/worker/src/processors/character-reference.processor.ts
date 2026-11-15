import { randomUUID } from 'node:crypto';
import type { Job, Processor } from 'bullmq';
import {
  GenerationJobType,
  JobStatus,
  MediaType,
  Prisma,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  buildCanonicalCharacterDescription,
  buildCharacterReferencePrompt,
  type GenerationQueuePayload,
} from '@ai-video/shared';
import { enqueueGenerationJob } from '../lib/enqueue';
import { generateImage } from '../lib/fal';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { uploadObject } from '../lib/storage';
import { resolveVisualStyle } from '../lib/visual-intelligence';

export function createCharacterReferenceProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    const characterProfileId =
      data.characterProfileId ??
      (typeof payload.characterProfileId === 'string' ? payload.characterProfileId : undefined);
    const action =
      (typeof payload.action === 'string' ? payload.action : undefined) ??
      (characterProfileId ? 'generate_character_reference' : 'generate_character_references');
    const isSingle = action === 'generate_character_reference' && Boolean(characterProfileId);

    logger.info(
      {
        bullJobId: job.id,
        generationJobId,
        storyId: data.storyId,
        characterProfileId,
        action,
        attempt: job.attemptsMade + 1,
      },
      'Character reference generation started',
    );

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        logger.info({ generationJobId }, 'Character reference job was cancelled; skipping');
        return { status: 'cancelled' };
      }

      await prisma.generationJob.updateMany({
        where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
        data: {
          status: JobStatus.PROCESSING,
          progress: 10,
          attempts: job.attemptsMade + 1,
          startedAt: new Date(),
          errorMessage: null,
        },
      });
    }

    try {
      if (payload.simulateFailure || data.simulateFailure) {
        throw new Error('Simulated failure in character-reference-generation');
      }

      let resolvedStoryId = data.storyId ?? undefined;
      let storyVisualStyleId: string | null = null;
      let defaultVideoProjectId: string | null = data.videoProjectId ?? null;
      let characters;

      if (isSingle && characterProfileId) {
        const character = await prisma.characterProfile.findUnique({
          where: { id: characterProfileId },
          include: {
            story: {
              include: {
                videoProjects: {
                  select: { id: true },
                  orderBy: { createdAt: 'desc' },
                  take: 1,
                },
              },
            },
          },
        });
        if (!character || character.story.userId !== data.userId) {
          throw new Error(`CharacterProfile ${characterProfileId} not found`);
        }
        resolvedStoryId = character.storyId;
        storyVisualStyleId = character.story.visualStyleId;
        defaultVideoProjectId =
          defaultVideoProjectId ?? character.story.videoProjects[0]?.id ?? null;
        characters = [character];
      } else {
        if (!resolvedStoryId) {
          throw new Error('storyId is required for batch character reference generation');
        }
        const story = await prisma.story.findFirst({
          where: { id: resolvedStoryId, userId: data.userId },
          include: {
            characters: { orderBy: { name: 'asc' } },
            videoProjects: {
              select: { id: true },
              orderBy: { createdAt: 'desc' },
              take: 1,
            },
          },
        });
        if (!story) {
          throw new Error(`Story ${resolvedStoryId} not found`);
        }
        storyVisualStyleId = story.visualStyleId;
        defaultVideoProjectId = defaultVideoProjectId ?? story.videoProjects[0]?.id ?? null;
        characters = story.characters;
      }

      const requestedStyleId =
        typeof payload.visualStyleId === 'string' ? payload.visualStyleId : undefined;
      const style = await resolveVisualStyle(prisma, {
        userId: data.userId,
        requestedStyleId,
        storyStyleId: storyVisualStyleId,
      });

      const forceMock = Boolean(data.useMockAi) || process.env.NODE_ENV === 'test';
      const refAspectRatio =
        (typeof payload.characterAspectRatio === 'string' && payload.characterAspectRatio) ||
        '3:4';

      const generatedReferences: Array<{
        characterProfileId: string;
        referenceId: string;
        mediaAssetId: string;
      }> = [];
      let totalCostUsd = 0;

      for (let i = 0; i < characters.length; i++) {
        const character = characters[i];
        const canonicalVisualDescription =
          character.canonicalVisualDescription ||
          buildCanonicalCharacterDescription(character);

        const prompt = buildCharacterReferencePrompt({
          name: character.name,
          canonicalVisualDescription,
          styleName: style.name,
          styleInstructions: style.configuration.imageGenerationInstructions,
        });

        const falResult = await generateImage(
          {
            prompt,
            negativePrompt: style.configuration.avoid.join(', '),
            aspectRatio: refAspectRatio,
          },
          { forceMock },
        );

        const image = falResult.images[0];
        if (!image?.buffer) {
          throw new Error(`Character reference generation returned empty buffer for ${character.name}`);
        }

        const assetId = randomUUID();
        const storageKey = `users/${data.userId}/stories/${resolvedStoryId}/characters/${character.id}/references/${assetId}.png`;
        const mimeType = image.contentType ?? 'image/png';
        const fileSize = BigInt(image.buffer.length);

        await uploadObject(storageKey, image.buffer, mimeType);

        const created = await prisma.$transaction(async (tx) => {
          const asset = await tx.mediaAsset.create({
            data: {
              id: assetId,
              userId: data.userId,
              videoProjectId: defaultVideoProjectId ?? undefined,
              type: MediaType.IMAGE,
              storageKey,
              originalName: `${character.name.replace(/[^a-zA-Z0-9._-]/g, '_')}-reference.png`,
              mimeType,
              fileSize,
              metadata: {
                kind: 'character_reference',
                storyId: resolvedStoryId,
                characterProfileId: character.id,
                provider: 'fal',
                model: falResult.model,
                seed: falResult.seed ?? null,
              } as Prisma.InputJsonValue,
            },
          });

          await tx.characterVisualReference.updateMany({
            where: { characterProfileId: character.id, isPrimary: true },
            data: { isPrimary: false },
          });

          const reference = await tx.characterVisualReference.create({
            data: {
              characterProfileId: character.id,
              mediaAssetId: asset.id,
              prompt,
              isPrimary: true,
              generationJobId: generationJobId ?? null,
            },
          });

          return { asset, reference };
        });

        await prisma.providerUsage.create({
          data: {
            userId: data.userId,
            storyId: resolvedStoryId,
            generationJobId: generationJobId ?? undefined,
            provider: 'fal',
            model: falResult.model,
            requestType: 'character_reference',
            estimatedCost: new Prisma.Decimal(falResult.estimatedCostUsd),
            metadata: {
              action,
              characterProfileId: character.id,
              characterName: character.name,
              mediaAssetId: created.asset.id,
              referenceId: created.reference.id,
              usedReferenceImages: falResult.usedReferenceImages,
            } as Prisma.InputJsonValue,
          },
        });

        totalCostUsd += falResult.estimatedCostUsd;
        generatedReferences.push({
          characterProfileId: character.id,
          referenceId: created.reference.id,
          mediaAssetId: created.asset.id,
        });

        const progress = Math.min(90, 15 + Math.round(((i + 1) / Math.max(1, characters.length)) * 75));
        await job.updateProgress(progress);
        if (generationJobId) {
          await prisma.generationJob.updateMany({
            where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
            data: { progress },
          });
        }
      }

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            actualCost: new Prisma.Decimal(Number(totalCostUsd.toFixed(6))),
            result: {
              action,
              generatedCount: generatedReferences.length,
              references: generatedReferences,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
            errorMessage: null,
          },
        });
      }

      await job.updateProgress(100);

      const enqueuedImageJobs: string[] = [];
      if (!isSingle && resolvedStoryId && payload.chainSceneImages !== false) {
        const requestedVisualIds = Array.isArray(payload.sceneVisualIds)
          ? payload.sceneVisualIds.filter((id): id is string => typeof id === 'string')
          : [];

        const pendingVisuals = await prisma.sceneVisual.findMany({
          where: {
            generationStatus: VisualGenerationStatus.PROMPT_READY,
            ...(requestedVisualIds.length > 0
              ? { id: { in: requestedVisualIds } }
              : { scene: { storyId: resolvedStoryId } }),
          },
          include: {
            scene: { select: { id: true, sceneNumber: true } },
          },
          orderBy: { scene: { sceneNumber: 'asc' } },
        });

        const sceneAspectRatio =
          typeof payload.aspectRatio === 'string' ? payload.aspectRatio : undefined;

        for (const sv of pendingVisuals) {
          const imageJob = await prisma.generationJob.create({
            data: {
              userId: data.userId,
              storyId: resolvedStoryId,
              videoProjectId: defaultVideoProjectId ?? undefined,
              jobType: GenerationJobType.IMAGE,
              status: JobStatus.PENDING,
              provider: 'fal',
              queueName: QUEUE_NAMES.IMAGE_GENERATION,
              maxAttempts: 3,
              payload: {
                action: 'generate_scene_image',
                sceneId: sv.sceneId,
                sceneVisualId: sv.id,
                ...(sceneAspectRatio ? { aspectRatio: sceneAspectRatio } : {}),
              } as Prisma.InputJsonValue,
            },
          });

          const { queueJobId } = await enqueueGenerationJob(
            QUEUE_NAMES.IMAGE_GENERATION,
            'IMAGE',
            {
              generationJobId: imageJob.id,
              userId: data.userId,
              storyId: resolvedStoryId,
              videoProjectId: defaultVideoProjectId,
              sceneId: sv.sceneId,
              sceneVisualId: sv.id,
              jobType: 'IMAGE',
              provider: 'fal',
              payload: {
                action: 'generate_scene_image',
                sceneId: sv.sceneId,
                sceneVisualId: sv.id,
                ...(sceneAspectRatio ? { aspectRatio: sceneAspectRatio } : {}),
              },
              useMockAi: forceMock,
            },
          );

          await prisma.generationJob.update({
            where: { id: imageJob.id },
            data: { status: JobStatus.QUEUED, queueJobId },
          });
          enqueuedImageJobs.push(imageJob.id);
        }
      }

      logger.info(
        {
          generationJobId,
          storyId: resolvedStoryId,
          generatedCount: generatedReferences.length,
          enqueuedImageJobs: enqueuedImageJobs.length,
        },
        'Character reference generation completed',
      );

      return {
        status: 'completed',
        storyId: resolvedStoryId,
        references: generatedReferences,
        enqueuedImageJobs,
      };
    } catch (error) {
      const message = (error as Error).message;
      const maxAttempts = job.opts.attempts ?? 3;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: isFinalAttempt ? JobStatus.FAILED : JobStatus.PROCESSING,
            progress: isFinalAttempt ? 100 : Math.min(90, Number(job.progress) || 0),
            errorMessage: message,
            attempts: job.attemptsMade + 1,
            ...(isFinalAttempt ? { completedAt: new Date() } : {}),
          },
        });
      }

      logger.error(
        { generationJobId, storyId: data.storyId, characterProfileId, err: message },
        'Character reference generation failed',
      );
      throw error;
    }
  };
}
