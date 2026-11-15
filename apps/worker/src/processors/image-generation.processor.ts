import { randomUUID } from 'node:crypto';
import type { Job, Processor } from 'bullmq';
import {
  JobStatus,
  MediaType,
  Prisma,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  buildCanonicalCharacterDescription,
  buildSceneImagePrompt,
  type GenerationQueuePayload,
  type SceneVisualAnalysis,
} from '@ai-video/shared';
import { generateImage, getFalCapabilities } from '../lib/fal';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { getMinioEndpoint, getPresignedDownloadUrl, uploadObject } from '../lib/storage';
import { resolveVisualStyle } from '../lib/visual-intelligence';

function isPubliclyFetchableEndpoint(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host !== 'localhost' &&
      host !== '127.0.0.1' &&
      host !== '0.0.0.0' &&
      host !== 'minio' &&
      !host.endsWith('.local')
    );
  } catch {
    return false;
  }
}

async function resolvePublicReferenceUrl(storageKey: string): Promise<string | null> {
  const publicBase =
    process.env.MINIO_PUBLIC_URL?.trim() || process.env.SOCIAL_PUBLIC_MEDIA_BASE_URL?.trim();
  const endpoint = getMinioEndpoint();

  if (publicBase || isPubliclyFetchableEndpoint(endpoint)) {
    return getPresignedDownloadUrl(storageKey, 900);
  }

  return null;
}

export function createImageGenerationProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;
    let targetSceneVisualId =
      data.sceneVisualId ??
      (typeof payload.sceneVisualId === 'string' ? payload.sceneVisualId : undefined);
    const sceneId =
      data.sceneId ?? (typeof payload.sceneId === 'string' ? payload.sceneId : undefined);

    logger.info(
      {
        bullJobId: job.id,
        generationJobId,
        storyId: data.storyId,
        sceneId,
        sceneVisualId: targetSceneVisualId,
        attempt: job.attemptsMade + 1,
      },
      'Scene image generation started',
    );

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        logger.info({ generationJobId }, 'Image generation job was cancelled; skipping');
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
        throw new Error('Simulated failure in image-generation');
      }

      const sceneVisualInclude = {
        visualStyle: true,
        scene: {
          include: {
            story: {
              include: {
                visualStyle: true,
                videoProjects: {
                  select: { id: true, aspectRatio: true },
                  orderBy: { createdAt: 'desc' as const },
                  take: 1,
                },
                characters: {
                  orderBy: { name: 'asc' as const },
                  include: {
                    visualReferences: {
                      where: { isPrimary: true },
                      include: { mediaAsset: true },
                      orderBy: { createdAt: 'desc' as const },
                      take: 1,
                    },
                  },
                },
              },
            },
          },
        },
      };

      const sceneVisual = targetSceneVisualId
        ? await prisma.sceneVisual.findUnique({
            where: { id: targetSceneVisualId },
            include: sceneVisualInclude,
          })
        : sceneId
          ? await prisma.sceneVisual.findFirst({
              where: { sceneId },
              orderBy: { attemptNumber: 'desc' },
              include: sceneVisualInclude,
            })
          : null;

      if (!sceneVisual || sceneVisual.scene.story.userId !== data.userId) {
        throw new Error(`SceneVisual ${targetSceneVisualId ?? sceneId ?? 'unknown'} not found`);
      }

      targetSceneVisualId = sceneVisual.id;
      const scene = sceneVisual.scene;
      const story = scene.story;

      await prisma.sceneVisual.update({
        where: { id: sceneVisual.id },
        data: {
          generationStatus: VisualGenerationStatus.GENERATING,
          errorMessage: null,
          ...(generationJobId ? { generationJobId } : {}),
        },
      });

      await job.updateProgress(25);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: { progress: 25 },
        });
      }

      const style = await resolveVisualStyle(prisma, {
        userId: data.userId,
        requestedStyleId: sceneVisual.visualStyleId,
        storyStyleId: story.visualStyleId,
      });

      const structuredBrief =
        sceneVisual.structuredBrief &&
        typeof sceneVisual.structuredBrief === 'object' &&
        !Array.isArray(sceneVisual.structuredBrief)
          ? (sceneVisual.structuredBrief as Partial<SceneVisualAnalysis>)
          : undefined;

      const charactersPresentNames = Array.isArray(structuredBrief?.charactersPresent)
        ? structuredBrief.charactersPresent.map((n) => n.toLowerCase())
        : null;

      const relevantCharacters =
        charactersPresentNames !== null
          ? story.characters.filter((c) => charactersPresentNames.includes(c.name.toLowerCase()))
          : story.characters;

      const characterDescriptions = relevantCharacters.map(
        (character) =>
          character.canonicalVisualDescription ||
          buildCanonicalCharacterDescription(character),
      );

      const forceMock = Boolean(data.useMockAi) || process.env.NODE_ENV === 'test';
      const capabilities = getFalCapabilities();
      const referenceImageUrls: string[] = [];

      if (!forceMock && capabilities.supportsReferenceImages) {
        for (const character of relevantCharacters) {
          const primaryRef = character.visualReferences[0];
          if (!primaryRef?.mediaAsset?.storageKey) continue;
          const url = await resolvePublicReferenceUrl(primaryRef.mediaAsset.storageKey);
          if (url) {
            referenceImageUrls.push(url);
          }
        }
      }

      const { prompt, negativePrompt } = buildSceneImagePrompt({
        visualPrompt: sceneVisual.visualPrompt,
        characterDescriptions,
        styleInstructions: style.configuration.imageGenerationInstructions,
        negativePrompt: sceneVisual.negativePrompt,
      });

      const aspectRatio =
        (typeof payload.aspectRatio === 'string' && payload.aspectRatio) ||
        (typeof structuredBrief?.aspectRatio === 'string' && structuredBrief.aspectRatio) ||
        story.videoProjects[0]?.aspectRatio ||
        process.env.FAL_IMAGE_DEFAULT_ASPECT_RATIO ||
        '9:16';

      const falResult = await generateImage(
        {
          prompt,
          negativePrompt,
          aspectRatio,
          seed: typeof payload.seed === 'number' ? payload.seed : undefined,
          referenceImageUrls:
            referenceImageUrls.length > 0 ? referenceImageUrls : undefined,
        },
        { forceMock },
      );

      const image = falResult.images[0];
      if (!image?.buffer) {
        throw new Error('fal.ai returned an empty image buffer');
      }

      await job.updateProgress(70);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: { progress: 70 },
        });
      }

      const assetId = randomUUID();
      const storageKey = `users/${data.userId}/stories/${story.id}/scenes/${scene.id}/images/${assetId}.png`;
      const mimeType = image.contentType ?? 'image/png';
      const fileSize = BigInt(image.buffer.length);
      const videoProjectId = data.videoProjectId ?? story.videoProjects[0]?.id ?? null;

      await uploadObject(storageKey, image.buffer, mimeType);

      await prisma.$transaction(async (tx) => {
        const asset = await tx.mediaAsset.create({
          data: {
            id: assetId,
            userId: data.userId,
            videoProjectId: videoProjectId ?? undefined,
            type: MediaType.IMAGE,
            storageKey,
            originalName: `scene-${scene.sceneNumber}-v${sceneVisual.attemptNumber}.png`,
            mimeType,
            fileSize,
            metadata: {
              kind: 'scene_image',
              storyId: story.id,
              sceneId: scene.id,
              sceneVisualId: sceneVisual.id,
              sceneNumber: scene.sceneNumber,
              attemptNumber: sceneVisual.attemptNumber,
              provider: 'fal',
              model: falResult.model,
              seed: falResult.seed ?? null,
            } as Prisma.InputJsonValue,
          },
        });

        await tx.sceneVisual.updateMany({
          where: {
            sceneId: scene.id,
            id: { not: sceneVisual.id },
            isSelected: true,
          },
          data: { isSelected: false },
        });

        await tx.sceneVisual.update({
          where: { id: sceneVisual.id },
          data: {
            generationStatus: VisualGenerationStatus.COMPLETED,
            generatedImageMediaId: asset.id,
            isSelected: true,
            provider: 'fal',
            providerModel: falResult.model,
            seed: falResult.seed ?? null,
            generationParameters: {
              ...falResult.parameters,
              usedReferenceImages: falResult.usedReferenceImages,
              requestId: falResult.requestId ?? null,
            } as Prisma.InputJsonValue,
            errorMessage: null,
          },
        });
      });

      const isRetry =
        job.attemptsMade > 0 ||
        sceneVisual.attemptNumber > 1 ||
        payload.action === 'regenerate_scene_image';

      await prisma.providerUsage.create({
        data: {
          userId: data.userId,
          storyId: story.id,
          generationJobId: generationJobId ?? undefined,
          provider: 'fal',
          model: falResult.model,
          requestType: 'image_generation',
          estimatedCost: new Prisma.Decimal(falResult.estimatedCostUsd),
          metadata: {
            action: payload.action ?? 'generate_scene_image',
            sceneId: scene.id,
            sceneVisualId: sceneVisual.id,
            mediaAssetId: assetId,
            attemptNumber: sceneVisual.attemptNumber,
            bullAttempt: job.attemptsMade + 1,
            isRetry,
            usedReferenceImages: falResult.usedReferenceImages,
          } as Prisma.InputJsonValue,
        },
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            actualCost: new Prisma.Decimal(falResult.estimatedCostUsd),
            result: {
              sceneId: scene.id,
              sceneVisualId: sceneVisual.id,
              mediaAssetId: assetId,
              storageKey,
              provider: 'fal',
              model: falResult.model,
              seed: falResult.seed ?? null,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
            errorMessage: null,
          },
        });
      }

      await job.updateProgress(100);
      logger.info(
        {
          generationJobId,
          storyId: story.id,
          sceneId: scene.id,
          sceneVisualId: sceneVisual.id,
          mediaAssetId: assetId,
        },
        'Scene image generation completed',
      );

      return {
        status: 'completed',
        sceneId: scene.id,
        sceneVisualId: sceneVisual.id,
        mediaAssetId: assetId,
        storageKey,
      };
    } catch (error) {
      const message = (error as Error).message;
      const maxAttempts = job.opts.attempts ?? 3;
      const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

      if (targetSceneVisualId) {
        await prisma.sceneVisual.updateMany({
          where: { id: targetSceneVisualId },
          data: {
            generationStatus: VisualGenerationStatus.FAILED,
            errorMessage: message,
          },
        });
      }

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
        {
          generationJobId,
          sceneId,
          sceneVisualId: targetSceneVisualId,
          err: message,
        },
        'Scene image generation failed',
      );
      throw error;
    }
  };
}
