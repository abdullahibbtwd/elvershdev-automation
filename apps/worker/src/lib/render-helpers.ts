import {
  AudioGenerationStatus,
  JobStatus,
  MotionGenerationStatus,
  NarrationScriptStatus,
  Prisma,
  SceneNarrationStatus,
  VideoRenderStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import {
  planRenderTimeline,
  renderSettingsSchema,
  type RenderTimeline,
  type TimelineSceneInput,
} from '@ai-video/shared';
import type { getPrisma } from './prisma';

export function finalRenderKey(params: {
  userId: string;
  storyId: string;
  renderId: string;
  fileName: string;
}): string {
  return `users/${params.userId}/projects/default/stories/${params.storyId}/renders/${params.renderId}/${params.fileName}`;
}

export function tempRenderPrefix(userId: string, renderId: string): string {
  return `tmp/users/${userId}/renders/${renderId}`;
}

export async function isRenderCancelled(
  prisma: ReturnType<typeof getPrisma>,
  videoRenderId: string,
): Promise<boolean> {
  const render = await prisma.videoRender.findUnique({
    where: { id: videoRenderId },
    select: { status: true },
  });
  return render?.status === VideoRenderStatus.CANCELLED;
}

export async function markRenderFailed(
  prisma: ReturnType<typeof getPrisma>,
  params: {
    videoRenderId: string;
    generationJobId?: string | null;
    errorCode: string;
    errorMessage: string;
  },
) {
  const render = await prisma.videoRender.findUnique({ where: { id: params.videoRenderId } });
  if (!render || render.status === VideoRenderStatus.CANCELLED) return;

  await prisma.videoRender.update({
    where: { id: params.videoRenderId },
    data: {
      status: VideoRenderStatus.FAILED,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage.slice(0, 2000),
      completedAt: new Date(),
    },
  });

  if (params.generationJobId) {
    await prisma.generationJob.updateMany({
      where: { id: params.generationJobId, status: { not: JobStatus.CANCELLED } },
      data: {
        status: JobStatus.FAILED,
        errorMessage: params.errorMessage.slice(0, 2000),
        completedAt: new Date(),
      },
    });
  }
}

export async function updateRenderProgress(
  prisma: ReturnType<typeof getPrisma>,
  videoRenderId: string,
  data: Prisma.VideoRenderUpdateInput,
) {
  const current = await prisma.videoRender.findUnique({
    where: { id: videoRenderId },
    select: { status: true },
  });
  if (!current || current.status === VideoRenderStatus.CANCELLED) {
    return false;
  }
  await prisma.videoRender.update({ where: { id: videoRenderId }, data });
  return true;
}

export async function buildTimelineFromStory(
  prisma: ReturnType<typeof getPrisma>,
  storyId: string,
  renderSettings: unknown,
): Promise<RenderTimeline> {
  const settings = renderSettingsSchema.parse(renderSettings ?? {});
  const scenes = await prisma.storyScene.findMany({
    where: { storyId },
    orderBy: { sceneNumber: 'asc' },
    include: {
      visuals: {
        include: { generatedImageMedia: true },
        orderBy: { createdAt: 'desc' },
      },
      motionGenerations: {
        include: { outputMediaAsset: true },
        orderBy: { createdAt: 'desc' },
      },
      audioGenerations: {
        include: { audioMediaAsset: true },
        orderBy: { createdAt: 'desc' },
      },
      sceneNarrations: {
        include: { narrationScript: true },
        orderBy: { sequence: 'asc' },
      },
    },
  });

  const inputs: TimelineSceneInput[] = scenes.map((scene) => {
    const selectedVisual =
      scene.visuals.find(
        (v) => v.isSelected && v.generationStatus === VisualGenerationStatus.COMPLETED && v.generatedImageMedia,
      ) ??
      scene.visuals.find(
        (v) => v.generationStatus === VisualGenerationStatus.COMPLETED && v.generatedImageMedia,
      );
    const selectedMotion =
      scene.motionGenerations.find(
        (m) => m.isSelected && m.status === MotionGenerationStatus.COMPLETED && m.outputMediaAsset,
      ) ??
      scene.motionGenerations.find(
        (m) => m.status === MotionGenerationStatus.COMPLETED && m.outputMediaAsset,
      );
    const selectedAudio = scene.audioGenerations.find(
      (a) => a.isSelected && a.status === AudioGenerationStatus.COMPLETED && a.audioMediaAsset,
    );
    const narration = scene.sceneNarrations.find(
      (n) =>
        n.narrationScript.status === NarrationScriptStatus.APPROVED &&
        (n.status === SceneNarrationStatus.APPROVED || n.status === SceneNarrationStatus.READY),
    );

    if (!selectedVisual?.generatedImageMedia && !selectedMotion?.outputMediaAsset) {
      throw new Error(`Scene ${scene.sceneNumber} is missing visual assets`);
    }
    if (!narration) {
      throw new Error(`Scene ${scene.sceneNumber} is missing approved narration`);
    }
    if (!selectedAudio?.audioMediaAsset) {
      throw new Error(`Scene ${scene.sceneNumber} is missing selected narration audio`);
    }

    return {
      sceneId: scene.id,
      sequence: scene.sceneNumber,
      sceneNumber: scene.sceneNumber,
      narrationText: narration.text,
      narrationDurationSeconds:
        selectedAudio.duration ?? narration.estimatedDuration ?? scene.durationSeconds,
      motionDurationSeconds: selectedMotion?.durationSeconds ?? null,
      hasMotionClip: Boolean(selectedMotion?.outputMediaAsset),
      hasImage: Boolean(selectedVisual?.generatedImageMedia),
      selectedMotionGenerationId: selectedMotion?.id ?? null,
      selectedVisualId: selectedVisual?.id ?? null,
      selectedAudioGenerationId: selectedAudio.id,
      motionStorageKey: selectedMotion?.outputMediaAsset?.storageKey ?? null,
      imageStorageKey: selectedVisual?.generatedImageMedia?.storageKey ?? null,
      audioStorageKey: selectedAudio.audioMediaAsset.storageKey,
    };
  });

  return planRenderTimeline(inputs, settings);
}
