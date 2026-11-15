import type { Job, Processor } from 'bullmq';
import {
  GenerationJobType,
  JobStatus,
  Prisma,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  QUEUE_NAMES,
  type GenerationQueuePayload,
} from '@ai-video/shared';
import { enqueueGenerationJob } from '../lib/enqueue';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { analyzeStoryVisuals, resolveVisualStyle } from '../lib/visual-intelligence';

export function createVisualAnalysisProcessor(logger: Logger): Processor {
  return async (job: Job<GenerationQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;
    const generationJobId = data.generationJobId;
    const storyId = data.storyId;
    const payload = (data.payload ?? {}) as Record<string, unknown>;

    logger.info(
      { bullJobId: job.id, generationJobId, storyId, attempt: job.attemptsMade + 1 },
      'Visual analysis started',
    );

    if (generationJobId) {
      const existing = await prisma.generationJob.findUnique({
        where: { id: generationJobId },
        select: { status: true },
      });
      if (existing?.status === JobStatus.CANCELLED) {
        logger.info({ generationJobId }, 'Visual analysis job was cancelled; skipping');
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
        throw new Error('Simulated failure in visual-analysis');
      }
      if (!storyId) {
        throw new Error('storyId is required for visual analysis jobs');
      }

      const story = await prisma.story.findFirst({
        where: { id: storyId, userId: data.userId },
        include: {
          scenes: { orderBy: { sceneNumber: 'asc' } },
          characters: { orderBy: { name: 'asc' } },
          videoProjects: {
            select: { id: true, aspectRatio: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!story) {
        throw new Error(`Story ${storyId} not found`);
      }

      const requestedSceneIds = Array.isArray(payload.sceneIds)
        ? payload.sceneIds.filter((id): id is string => typeof id === 'string')
        : [];
      const targetScenes =
        requestedSceneIds.length > 0
          ? story.scenes.filter((scene) => requestedSceneIds.includes(scene.id))
          : story.scenes;

      if (targetScenes.length === 0) {
        throw new Error('No scenes found for visual analysis');
      }

      const requestedStyleId =
        typeof payload.visualStyleId === 'string' ? payload.visualStyleId : undefined;
      const style = await resolveVisualStyle(prisma, {
        userId: data.userId,
        requestedStyleId,
        storyStyleId: story.visualStyleId,
      });

      const aspectRatio =
        (typeof payload.aspectRatio === 'string' && payload.aspectRatio) ||
        story.videoProjects[0]?.aspectRatio ||
        process.env.FAL_IMAGE_DEFAULT_ASPECT_RATIO ||
        '9:16';

      await job.updateProgress(30);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: { progress: 30 },
        });
      }

      const forceMock = Boolean(data.useMockAi) || process.env.NODE_ENV === 'test';
      const analysisResult = await analyzeStoryVisuals(
        {
          title: story.title,
          story: story.content,
          scenes: targetScenes.map((scene) => ({
            sceneNumber: scene.sceneNumber,
            narration: scene.narration,
            visualDescription: scene.visualDescription,
            imagePrompt: scene.imagePrompt,
            cameraMovement: scene.cameraMovement,
            lighting: scene.lighting,
            environment: scene.environment,
            characterConsistencyInstructions: scene.characterConsistencyInstructions,
          })),
          characters: story.characters.map((character) => ({
            name: character.name,
            appearance: character.appearance,
            clothing: character.clothing,
            ageRange: character.ageRange,
            hair: character.hair,
            distinctiveFeatures: character.distinctiveFeatures,
            consistencyNotes: character.consistencyNotes,
          })),
          style: {
            name: style.name,
            configuration: style.configuration,
          },
          aspectRatio,
        },
        { forceMock },
      );

      await job.updateProgress(65);
      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: { progress: 65 },
        });
      }

      const createdSceneVisuals = await prisma.$transaction(async (tx) => {
        for (const analyzedChar of analysisResult.data.characters) {
          const existingChar = story.characters.find(
            (c) => c.name.toLowerCase() === analyzedChar.name.toLowerCase(),
          );
          if (!existingChar) continue;

          await tx.characterProfile.update({
            where: { id: existingChar.id },
            data: {
              genderPresentation:
                analyzedChar.genderPresentation ?? existingChar.genderPresentation,
              skinTone: analyzedChar.skinTone ?? existingChar.skinTone,
              facialFeatures: analyzedChar.facialFeatures,
              hairstyle: analyzedChar.hairstyle,
              hairColor: analyzedChar.hairColor,
              bodyBuild: analyzedChar.bodyBuild ?? existingChar.bodyBuild,
              accessories: analyzedChar.accessories ?? existingChar.accessories,
              canonicalVisualDescription: analyzedChar.canonicalVisualDescription,
              visualConsistencyInstructions: analyzedChar.visualConsistencyInstructions,
            },
          });
        }

        const created: Array<{ id: string; sceneId: string; sceneNumber: number }> = [];
        for (let index = 0; index < targetScenes.length; index++) {
          const scene = targetScenes[index];
          const sceneAnalysis =
            analysisResult.data.scenes.find((s) => s.sceneNumber === scene.sceneNumber) ??
            analysisResult.data.scenes[index];
          if (!sceneAnalysis) continue;

          const maxAttempt = await tx.sceneVisual.aggregate({
            where: { sceneId: scene.id },
            _max: { attemptNumber: true },
          });

          const sceneVisual = await tx.sceneVisual.create({
            data: {
              sceneId: scene.id,
              visualStyleId: style.id,
              visualPrompt: sceneAnalysis.imagePrompt,
              negativePrompt: sceneAnalysis.negativePrompt,
              structuredBrief: sceneAnalysis as unknown as Prisma.InputJsonValue,
              generationStatus: VisualGenerationStatus.PROMPT_READY,
              isSelected: false,
              attemptNumber: (maxAttempt._max.attemptNumber ?? 0) + 1,
              generationJobId: generationJobId ?? null,
            },
          });

          if (sceneAnalysis.imagePrompt) {
            await tx.storyScene.update({
              where: { id: scene.id },
              data: { imagePrompt: sceneAnalysis.imagePrompt },
            });
          }

          created.push({
            id: sceneVisual.id,
            sceneId: scene.id,
            sceneNumber: scene.sceneNumber,
          });
        }

        return created;
      });

      await prisma.providerUsage.create({
        data: {
          userId: data.userId,
          storyId,
          generationJobId: generationJobId ?? undefined,
          provider: 'gemini',
          model: analysisResult.usage.model,
          requestType: 'visual_analysis',
          inputTokens: analysisResult.usage.inputTokens,
          outputTokens: analysisResult.usage.outputTokens,
          estimatedCost: new Prisma.Decimal(analysisResult.usage.estimatedCostUsd),
          metadata: {
            action: payload.action ?? 'analyze_story_visuals',
            sceneCount: createdSceneVisuals.length,
            characterCount: analysisResult.data.characters.length,
            visualStyleId: style.id,
          } as Prisma.InputJsonValue,
        },
      });

      if (generationJobId) {
        await prisma.generationJob.updateMany({
          where: { id: generationJobId, status: { not: JobStatus.CANCELLED } },
          data: {
            status: JobStatus.COMPLETED,
            progress: 100,
            actualCost: new Prisma.Decimal(analysisResult.usage.estimatedCostUsd),
            result: {
              sceneVisualIds: createdSceneVisuals.map((v) => v.id),
              sceneCount: createdSceneVisuals.length,
              characterCount: story.characters.length,
              visualStyleId: style.id,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
            errorMessage: null,
          },
        });
      }

      await job.updateProgress(100);

      const skipCharacterReferences = Boolean(payload.skipCharacterReferences);
      const videoProjectId = data.videoProjectId ?? story.videoProjects[0]?.id ?? null;

      if (!skipCharacterReferences && story.characters.length > 0) {
        const charRefJob = await prisma.generationJob.create({
          data: {
            userId: data.userId,
            storyId,
            videoProjectId: videoProjectId ?? undefined,
            jobType: GenerationJobType.CHARACTER_REFERENCE,
            status: JobStatus.PENDING,
            provider: 'fal',
            queueName: QUEUE_NAMES.CHARACTER_REFERENCE,
            maxAttempts: 3,
            payload: {
              action: 'generate_character_references',
              visualStyleId: style.id,
              aspectRatio,
              sceneVisualIds: createdSceneVisuals.map((v) => v.id),
            } as Prisma.InputJsonValue,
          },
        });

        const { queueJobId } = await enqueueGenerationJob(
          QUEUE_NAMES.CHARACTER_REFERENCE,
          'CHARACTER_REFERENCE',
          {
            generationJobId: charRefJob.id,
            userId: data.userId,
            storyId,
            videoProjectId,
            jobType: 'CHARACTER_REFERENCE',
            provider: 'fal',
            payload: {
              action: 'generate_character_references',
              visualStyleId: style.id,
              aspectRatio,
              sceneVisualIds: createdSceneVisuals.map((v) => v.id),
            },
            useMockAi: forceMock,
          },
        );

        await prisma.generationJob.update({
          where: { id: charRefJob.id },
          data: { status: JobStatus.QUEUED, queueJobId },
        });

        logger.info(
          { generationJobId, storyId, characterReferenceJobId: charRefJob.id },
          'Visual analysis completed; character references enqueued',
        );

        return {
          status: 'completed',
          storyId,
          sceneVisualIds: createdSceneVisuals.map((v) => v.id),
          nextJobId: charRefJob.id,
          nextQueue: QUEUE_NAMES.CHARACTER_REFERENCE,
        };
      }

      const imageJobIds: string[] = [];
      for (const sv of createdSceneVisuals) {
        const imageJob = await prisma.generationJob.create({
          data: {
            userId: data.userId,
            storyId,
            videoProjectId: videoProjectId ?? undefined,
            jobType: GenerationJobType.IMAGE,
            status: JobStatus.PENDING,
            provider: 'fal',
            queueName: QUEUE_NAMES.IMAGE_GENERATION,
            maxAttempts: 3,
            payload: {
              action: 'generate_scene_image',
              sceneId: sv.sceneId,
              sceneVisualId: sv.id,
              aspectRatio,
            } as Prisma.InputJsonValue,
          },
        });

        const { queueJobId } = await enqueueGenerationJob(
          QUEUE_NAMES.IMAGE_GENERATION,
          'IMAGE',
          {
            generationJobId: imageJob.id,
            userId: data.userId,
            storyId,
            videoProjectId,
            sceneId: sv.sceneId,
            sceneVisualId: sv.id,
            jobType: 'IMAGE',
            provider: 'fal',
            payload: {
              action: 'generate_scene_image',
              sceneId: sv.sceneId,
              sceneVisualId: sv.id,
              aspectRatio,
            },
            useMockAi: forceMock,
          },
        );

        await prisma.generationJob.update({
          where: { id: imageJob.id },
          data: { status: JobStatus.QUEUED, queueJobId },
        });
        imageJobIds.push(imageJob.id);
      }

      logger.info(
        { generationJobId, storyId, imageJobCount: imageJobIds.length },
        'Visual analysis completed; scene image jobs enqueued',
      );

      return {
        status: 'completed',
        storyId,
        sceneVisualIds: createdSceneVisuals.map((v) => v.id),
        imageJobIds,
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

      logger.error({ generationJobId, storyId, err: message }, 'Visual analysis failed');
      throw error;
    }
  };
}
