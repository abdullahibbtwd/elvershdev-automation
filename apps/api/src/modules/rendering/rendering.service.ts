import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ACTIVE_VIDEO_RENDER_STATUSES,
  DEFAULT_VIDEO_OUTPUT_PROFILE_ID,
  getVideoOutputProfile,
  planRenderTimeline,
  QUEUE_NAMES,
  renderSettingsSchema,
  VIDEO_OUTPUT_PROFILES,
  type RenderSettingsInput,
  type TimelineSceneInput,
  type VideoRenderQueuePayload,
} from '@ai-video/shared';
import {
  AudioGenerationStatus,
  GenerationJobType,
  JobStatus,
  MediaType,
  MotionGenerationStatus,
  NarrationScriptStatus,
  Prisma,
  SceneNarrationStatus,
  VideoRenderSceneStatus,
  VideoRenderStatus,
  VisualGenerationStatus,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { CreateRenderDto, UpdateRenderSettingsDto } from './dto/create-render.dto';

type StorySceneWithAssets = {
  id: string;
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  visuals: Array<{
    id: string;
    isSelected: boolean;
    generationStatus: VisualGenerationStatus;
    generatedImageMediaId: string | null;
    generatedImageMedia: { id: string; storageKey: string } | null;
  }>;
  motionGenerations: Array<{
    id: string;
    isSelected: boolean;
    status: MotionGenerationStatus;
    durationSeconds: number;
    outputMediaAssetId: string | null;
    outputMediaAsset: { id: string; storageKey: string } | null;
  }>;
  audioGenerations: Array<{
    id: string;
    isSelected: boolean;
    status: AudioGenerationStatus;
    duration: number | null;
    audioMediaAssetId: string | null;
    audioMediaAsset: { id: string; storageKey: string } | null;
    sceneNarrationId: string | null;
  }>;
  sceneNarrations: Array<{
    id: string;
    text: string;
    status: SceneNarrationStatus;
    estimatedDuration: number;
    narrationScript: { id: string; status: NarrationScriptStatus };
  }>;
};

export type SceneReadiness = {
  sceneId: string;
  sceneNumber: number;
  ready: boolean;
  missing: string[];
  selectedVisualId: string | null;
  selectedMotionGenerationId: string | null;
  selectedAudioGenerationId: string | null;
  hasVisual: boolean;
  hasMotion: boolean;
  hasNarrationAudio: boolean;
  narrationApproved: boolean;
  estimatedDurationSeconds: number | null;
};

@Injectable()
export class RenderingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
  ) {}

  async getReadiness(userId: string, storyId: string) {
    const story = await this.requireStory(userId, storyId);
    const scenes = await this.loadScenesWithAssets(storyId);
    const sceneReadiness = scenes.map((scene) => this.evaluateSceneReadiness(scene));
    const readyScenes = sceneReadiness.filter((s) => s.ready).length;
    const missing = sceneReadiness.flatMap((s) =>
      s.missing.map((item) => `Scene ${s.sceneNumber}: ${item}`),
    );

    const approvedScript = await this.prisma.narrationScript.findFirst({
      where: { storyId, userId, status: NarrationScriptStatus.APPROVED },
      orderBy: { version: 'desc' },
    });

    return {
      storyId,
      storyTitle: story.title,
      totalScenes: scenes.length,
      readyScenes,
      visualsAvailable: sceneReadiness.filter((s) => s.hasVisual).length,
      motionClipsAvailable: sceneReadiness.filter((s) => s.hasMotion).length,
      narrationTracksApproved: sceneReadiness.filter((s) => s.hasNarrationAudio).length,
      narrationScriptApproved: Boolean(approvedScript),
      canRender: scenes.length > 0 && missing.length === 0,
      missing,
      scenes: sceneReadiness,
      outputProfiles: Object.values(VIDEO_OUTPUT_PROFILES),
    };
  }

  async createRender(userId: string, storyId: string, dto: CreateRenderDto) {
    await this.requireStory(userId, storyId);

    const active = await this.prisma.videoRender.findFirst({
      where: {
        storyId,
        userId,
        status: { in: ACTIVE_VIDEO_RENDER_STATUSES as VideoRenderStatus[] },
      },
    });
    if (active) {
      throw new ConflictException(
        `A render is already in progress (${active.status}). Cancel it or wait for completion.`,
      );
    }

    const readiness = await this.getReadiness(userId, storyId);
    if (!readiness.canRender) {
      throw new BadRequestException({
        message: 'Story is not ready to render. Resolve missing assets first.',
        missing: readiness.missing,
      });
    }

    const settings = this.parseSettings(dto);
    const profile = getVideoOutputProfile(settings.profileId);

    if (dto.backgroundMusicAssetId) {
      await this.requireOwnedAudioAsset(userId, dto.backgroundMusicAssetId);
    }

    const scenes = await this.loadScenesWithAssets(storyId);
    const timelineInputs = scenes.map((scene) => this.toTimelineInput(scene));
    // Validate planning deterministically before enqueue (worker rebuilds from DB)
    planRenderTimeline(timelineInputs, settings);

    const render = await this.prisma.$transaction(async (tx) => {
      const generationJob = await tx.generationJob.create({
        data: {
          userId,
          storyId,
          jobType: GenerationJobType.RENDER,
          status: JobStatus.PENDING,
          progress: 0,
          provider: 'ffmpeg',
          queueName: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
          payload: {
            simulateFailure: dto.simulateFailure === true,
          } as Prisma.InputJsonValue,
          maxAttempts: 3,
        },
      });

      const created = await tx.videoRender.create({
        data: {
          userId,
          storyId,
          status: VideoRenderStatus.PENDING,
          renderType: 'final',
          aspectRatio: profile.aspectRatio,
          width: profile.width,
          height: profile.height,
          frameRate: profile.frameRate,
          videoCodec: profile.videoCodec,
          audioCodec: profile.audioCodec,
          qualityPreset: settings.qualityPreset,
          subtitleEnabled: settings.subtitleEnabled,
          subtitleBurnedIn: settings.subtitleBurnedIn,
          backgroundMusicAssetId: dto.backgroundMusicAssetId ?? null,
          renderSettings: settings as unknown as Prisma.InputJsonValue,
          totalSceneCount: scenes.length,
          progress: 0,
          generationJobId: generationJob.id,
        },
      });

      return { created, generationJob };
    });

    try {
      const payload: VideoRenderQueuePayload = {
        generationJobId: render.generationJob.id,
        videoRenderId: render.created.id,
        userId,
        storyId,
        simulateFailure: dto.simulateFailure === true,
        stage: 'planning',
      };

      const { job: bullJob } = await this.queueService.enqueueGenerationJob('RENDER', {
        generationJobId: render.generationJob.id,
        userId,
        storyId,
        jobType: 'RENDER',
        provider: 'ffmpeg',
        payload: payload as unknown as Record<string, unknown>,
        simulateFailure: dto.simulateFailure === true,
      });

      await this.prisma.generationJob.update({
        where: { id: render.generationJob.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: bullJob.id,
          queueName: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
        },
      });
    } catch (error) {
      await this.prisma.videoRender.update({
        where: { id: render.created.id },
        data: {
          status: VideoRenderStatus.FAILED,
          errorCode: 'ENQUEUE_FAILED',
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      await this.prisma.generationJob.update({
        where: { id: render.generationJob.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      throw error;
    }

    return this.getRender(userId, render.created.id);
  }

  async listStoryRenders(userId: string, storyId: string) {
    await this.requireStory(userId, storyId);
    const renders = await this.prisma.videoRender.findMany({
      where: { storyId, userId },
      orderBy: { createdAt: 'desc' },
      include: {
        scenes: { orderBy: { sequence: 'asc' } },
        outputMediaAsset: true,
        subtitleMediaAsset: true,
        backgroundMusicAsset: true,
        generationJob: true,
      },
    });
    return Promise.all(renders.map((render) => this.serializeRender(render)));
  }

  async getRender(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    return this.serializeRender(render);
  }

  async getProgress(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    return {
      renderId: render.id,
      storyId: render.storyId,
      status: render.status,
      progress: render.progress,
      currentSceneSequence: render.currentSceneSequence,
      completedSceneCount: render.completedSceneCount,
      totalSceneCount: render.totalSceneCount,
      errorCode: render.errorCode,
      errorMessage: render.errorMessage,
      startedAt: render.startedAt,
      completedAt: render.completedAt,
      scenes: render.scenes.map((scene) => ({
        sceneId: scene.sceneId,
        sequence: scene.sequence,
        status: scene.status,
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration: scene.duration,
        errorMessage: scene.errorMessage,
      })),
    };
  }

  async retryRender(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    if (render.status !== VideoRenderStatus.FAILED && render.status !== VideoRenderStatus.CANCELLED) {
      throw new ConflictException('Only FAILED or CANCELLED renders can be retried');
    }

    const active = await this.prisma.videoRender.findFirst({
      where: {
        storyId: render.storyId,
        userId,
        status: { in: ACTIVE_VIDEO_RENDER_STATUSES as VideoRenderStatus[] },
        NOT: { id: renderId },
      },
    });
    if (active) {
      throw new ConflictException('Another render is already in progress for this story');
    }

    const readiness = await this.getReadiness(userId, render.storyId);
    if (!readiness.canRender) {
      throw new BadRequestException({
        message: 'Story is not ready to render. Resolve missing assets first.',
        missing: readiness.missing,
      });
    }

    const generationJob = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId: render.storyId,
        jobType: GenerationJobType.RENDER,
        status: JobStatus.QUEUED,
        progress: 0,
        provider: 'ffmpeg',
        queueName: QUEUE_NAMES.VIDEO_RENDER_PLANNING,
        payload: { retryOf: renderId } as Prisma.InputJsonValue,
        maxAttempts: 3,
      },
    });

    const updated = await this.prisma.videoRender.update({
      where: { id: renderId },
      data: {
        status: VideoRenderStatus.PENDING,
        progress: 0,
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        currentSceneSequence: null,
        completedSceneCount: 0,
        outputMediaAssetId: null,
        subtitleMediaAssetId: null,
        duration: null,
        fileSize: null,
        processingTimeMs: null,
        timeline: Prisma.JsonNull,
        generationJobId: generationJob.id,
        retryCount: { increment: 1 },
      },
    });

    await this.prisma.videoRenderScene.deleteMany({ where: { videoRenderId: renderId } });

    const payload: VideoRenderQueuePayload = {
      generationJobId: generationJob.id,
      videoRenderId: updated.id,
      userId,
      storyId: updated.storyId,
      forceRerender: true,
      stage: 'planning',
    };

    const { job: bullJob } = await this.queueService.enqueueGenerationJob('RENDER', {
      generationJobId: generationJob.id,
      userId,
      storyId: updated.storyId,
      jobType: 'RENDER',
      provider: 'ffmpeg',
      payload: payload as unknown as Record<string, unknown>,
    });

    await this.prisma.generationJob.update({
      where: { id: generationJob.id },
      data: { queueJobId: bullJob.id },
    });

    return this.getRender(userId, renderId);
  }

  async cancelRender(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    if (!ACTIVE_VIDEO_RENDER_STATUSES.includes(render.status as (typeof ACTIVE_VIDEO_RENDER_STATUSES)[number])) {
      throw new ConflictException(`Cannot cancel a render in status ${render.status}`);
    }

    if (render.generationJob?.queueJobId && render.generationJob.queueName) {
      const queueName = render.generationJob.queueName as keyof typeof QUEUE_NAMES extends never
        ? never
        : (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
      try {
        await this.queueService.removeJob(
          queueName as (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES],
          render.generationJob.queueJobId,
        );
      } catch {
        // active jobs cannot always be removed; worker checks CANCELLED status
      }
    }

    await this.prisma.videoRender.update({
      where: { id: renderId },
      data: {
        status: VideoRenderStatus.CANCELLED,
        errorCode: 'CANCELLED',
        errorMessage: 'Cancelled by user',
        completedAt: new Date(),
      },
    });

    if (render.generationJobId) {
      await this.prisma.generationJob.update({
        where: { id: render.generationJobId },
        data: {
          status: JobStatus.CANCELLED,
          completedAt: new Date(),
          errorMessage: 'Cancelled by user',
        },
      });
    }

    return this.getRender(userId, renderId);
  }

  async updateSettings(userId: string, renderId: string, dto: UpdateRenderSettingsDto) {
    const render = await this.requireRender(userId, renderId, false);
    if (
      render.status !== VideoRenderStatus.PENDING &&
      render.status !== VideoRenderStatus.FAILED &&
      render.status !== VideoRenderStatus.CANCELLED
    ) {
      throw new ConflictException('Settings can only be updated before rendering starts or after failure');
    }

    const current = renderSettingsSchema.parse(render.renderSettings ?? {});
    const merged = renderSettingsSchema.parse({
      ...current,
      ...dto,
      subtitleStyle: { ...current.subtitleStyle, ...(dto.subtitleStyle ?? {}) },
      audioMix: { ...current.audioMix, ...(dto.audioMix ?? {}) },
    });
    const profile = getVideoOutputProfile(merged.profileId);

    if (dto.backgroundMusicAssetId) {
      await this.requireOwnedAudioAsset(userId, dto.backgroundMusicAssetId);
    }

    const updated = await this.prisma.videoRender.update({
      where: { id: renderId },
      data: {
        renderSettings: merged as unknown as Prisma.InputJsonValue,
        aspectRatio: profile.aspectRatio,
        width: profile.width,
        height: profile.height,
        frameRate: profile.frameRate,
        videoCodec: profile.videoCodec,
        audioCodec: profile.audioCodec,
        qualityPreset: merged.qualityPreset,
        subtitleEnabled: merged.subtitleEnabled,
        subtitleBurnedIn: merged.subtitleBurnedIn,
        backgroundMusicAssetId:
          dto.backgroundMusicAssetId === undefined
            ? undefined
            : dto.backgroundMusicAssetId,
      },
      include: {
        scenes: { orderBy: { sequence: 'asc' } },
        outputMediaAsset: true,
        subtitleMediaAsset: true,
        backgroundMusicAsset: true,
        generationJob: true,
      },
    });

    return this.serializeRender(updated);
  }

  async getPreview(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    if (render.status !== VideoRenderStatus.COMPLETED || !render.outputMediaAsset) {
      throw new ConflictException('Preview is only available for completed renders');
    }
    const url = await this.storage.getPresignedDownloadUrl(render.outputMediaAsset.storageKey, 900);
    return {
      renderId,
      previewUrl: url,
      expiresInSeconds: 900,
      mimeType: render.outputMediaAsset.mimeType ?? 'video/mp4',
      duration: render.duration,
      width: render.width,
      height: render.height,
    };
  }

  async getDownload(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    if (render.status !== VideoRenderStatus.COMPLETED || !render.outputMediaAsset) {
      throw new ConflictException('Download is only available for completed renders');
    }
    const url = await this.storage.getPresignedDownloadUrl(render.outputMediaAsset.storageKey, 900);
    return {
      renderId,
      downloadUrl: url,
      expiresInSeconds: 900,
      fileName: render.outputMediaAsset.originalName ?? `render-${renderId}.mp4`,
      mimeType: render.outputMediaAsset.mimeType ?? 'video/mp4',
      fileSize: render.fileSize ? Number(render.fileSize) : null,
    };
  }

  async getSubtitles(userId: string, renderId: string) {
    const render = await this.requireRender(userId, renderId, true);
    if (render.status !== VideoRenderStatus.COMPLETED) {
      throw new ConflictException('Subtitles are only available for completed renders');
    }
    if (!render.subtitleMediaAsset) {
      throw new NotFoundException('No subtitle file was generated for this render');
    }
    const url = await this.storage.getPresignedDownloadUrl(render.subtitleMediaAsset.storageKey, 900);
    return {
      renderId,
      downloadUrl: url,
      expiresInSeconds: 900,
      fileName: render.subtitleMediaAsset.originalName ?? `render-${renderId}-subtitles.srt`,
      mimeType: render.subtitleMediaAsset.mimeType ?? 'application/x-subrip',
    };
  }

  private parseSettings(dto: CreateRenderDto | UpdateRenderSettingsDto): RenderSettingsInput {
    return renderSettingsSchema.parse({
      profileId: dto.profileId ?? DEFAULT_VIDEO_OUTPUT_PROFILE_ID,
      subtitleEnabled: dto.subtitleEnabled,
      subtitleBurnedIn: dto.subtitleBurnedIn,
      transitionDurationSeconds: dto.transitionDurationSeconds,
      scenePaddingSeconds: dto.scenePaddingSeconds,
      kenBurnsEnabled: dto.kenBurnsEnabled,
      kenBurnsZoom: dto.kenBurnsZoom,
      fitMode: dto.fitMode,
      qualityPreset: dto.qualityPreset,
      subtitleStyle: dto.subtitleStyle,
      audioMix: dto.audioMix,
    });
  }

  private evaluateSceneReadiness(scene: StorySceneWithAssets): SceneReadiness {
    const missing: string[] = [];
    const selectedVisual =
      scene.visuals.find((v) => v.isSelected && v.generationStatus === VisualGenerationStatus.COMPLETED) ??
      scene.visuals.find((v) => v.generationStatus === VisualGenerationStatus.COMPLETED);
    const selectedMotion =
      scene.motionGenerations.find(
        (m) => m.isSelected && m.status === MotionGenerationStatus.COMPLETED && m.outputMediaAsset,
      ) ??
      scene.motionGenerations.find(
        (m) => m.status === MotionGenerationStatus.COMPLETED && m.outputMediaAsset,
      );
    const selectedAudio =
      scene.audioGenerations.find(
        (a) => a.isSelected && a.status === AudioGenerationStatus.COMPLETED && a.audioMediaAsset,
      ) ?? null;

    const approvedNarration = scene.sceneNarrations.find(
      (n) =>
        n.narrationScript.status === NarrationScriptStatus.APPROVED &&
        (n.status === SceneNarrationStatus.APPROVED || n.status === SceneNarrationStatus.READY),
    );

    const hasVisual = Boolean(selectedVisual?.generatedImageMedia);
    const hasMotion = Boolean(selectedMotion?.outputMediaAsset);
    const hasNarrationAudio = Boolean(selectedAudio?.audioMediaAsset);
    const narrationApproved = Boolean(approvedNarration);

    if (!hasVisual && !hasMotion) missing.push('missing visual image or motion clip');
    if (!narrationApproved) missing.push('narration script not approved for scene');
    if (!hasNarrationAudio) missing.push('selected narration audio missing');

    return {
      sceneId: scene.id,
      sceneNumber: scene.sceneNumber,
      ready: missing.length === 0,
      missing,
      selectedVisualId: selectedVisual?.id ?? null,
      selectedMotionGenerationId: selectedMotion?.id ?? null,
      selectedAudioGenerationId: selectedAudio?.id ?? null,
      hasVisual,
      hasMotion,
      hasNarrationAudio,
      narrationApproved,
      estimatedDurationSeconds: selectedAudio?.duration ?? approvedNarration?.estimatedDuration ?? null,
    };
  }

  private toTimelineInput(scene: StorySceneWithAssets): TimelineSceneInput {
    const readiness = this.evaluateSceneReadiness(scene);
    if (!readiness.ready) {
      throw new BadRequestException(
        `Scene ${scene.sceneNumber} is not ready: ${readiness.missing.join(', ')}`,
      );
    }

    const selectedVisual =
      scene.visuals.find((v) => v.id === readiness.selectedVisualId) ??
      scene.visuals.find((v) => v.isSelected) ??
      scene.visuals[0];
    const selectedMotion = scene.motionGenerations.find(
      (m) => m.id === readiness.selectedMotionGenerationId,
    );
    const selectedAudio = scene.audioGenerations.find(
      (a) => a.id === readiness.selectedAudioGenerationId,
    )!;
    const narration =
      scene.sceneNarrations.find(
        (n) => n.narrationScript.status === NarrationScriptStatus.APPROVED,
      ) ?? scene.sceneNarrations[0];

    return {
      sceneId: scene.id,
      sequence: scene.sceneNumber,
      sceneNumber: scene.sceneNumber,
      narrationText: narration?.text ?? scene.narration,
      narrationDurationSeconds: selectedAudio.duration ?? narration?.estimatedDuration ?? scene.durationSeconds,
      motionDurationSeconds: selectedMotion?.durationSeconds ?? null,
      hasMotionClip: Boolean(selectedMotion?.outputMediaAsset),
      hasImage: Boolean(selectedVisual?.generatedImageMedia),
      selectedMotionGenerationId: selectedMotion?.id ?? null,
      selectedVisualId: selectedVisual?.id ?? null,
      selectedAudioGenerationId: selectedAudio.id,
      motionStorageKey: selectedMotion?.outputMediaAsset?.storageKey ?? null,
      imageStorageKey: selectedVisual?.generatedImageMedia?.storageKey ?? null,
      audioStorageKey: selectedAudio.audioMediaAsset!.storageKey,
    };
  }

  private async loadScenesWithAssets(storyId: string): Promise<StorySceneWithAssets[]> {
    return this.prisma.storyScene.findMany({
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
  }

  private async requireStory(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({ where: { id: storyId, userId } });
    if (!story) throw new NotFoundException('Story not found');
    return story;
  }

  private async requireRender(userId: string, renderId: string, withRelations: boolean) {
    const render = await this.prisma.videoRender.findFirst({
      where: { id: renderId, userId },
      include: withRelations
        ? {
            scenes: { orderBy: { sequence: 'asc' } },
            outputMediaAsset: true,
            subtitleMediaAsset: true,
            backgroundMusicAsset: true,
            generationJob: true,
          }
        : undefined,
    });
    if (!render) throw new NotFoundException('Render not found');
    return render as Prisma.VideoRenderGetPayload<{
      include: {
        scenes: true;
        outputMediaAsset: true;
        subtitleMediaAsset: true;
        backgroundMusicAsset: true;
        generationJob: true;
      };
    }>;
  }

  private async requireOwnedAudioAsset(userId: string, assetId: string) {
    const asset = await this.prisma.mediaAsset.findFirst({
      where: { id: assetId, userId, type: MediaType.AUDIO },
    });
    if (!asset) {
      throw new BadRequestException('Background music asset not found or not owned by user');
    }
    return asset;
  }

  private async serializeRender(
    render: Prisma.VideoRenderGetPayload<{
      include: {
        scenes: true;
        outputMediaAsset: true;
        subtitleMediaAsset: true;
        backgroundMusicAsset: true;
        generationJob: true;
      };
    }>,
  ) {
    const previewUrl =
      render.status === VideoRenderStatus.COMPLETED && render.outputMediaAsset
        ? await this.storage.getPresignedDownloadUrl(render.outputMediaAsset.storageKey, 900)
        : null;
    const subtitleUrl =
      render.status === VideoRenderStatus.COMPLETED && render.subtitleMediaAsset
        ? await this.storage.getPresignedDownloadUrl(render.subtitleMediaAsset.storageKey, 900)
        : null;

    return {
      id: render.id,
      storyId: render.storyId,
      status: render.status,
      renderType: render.renderType,
      aspectRatio: render.aspectRatio,
      width: render.width,
      height: render.height,
      frameRate: render.frameRate,
      videoCodec: render.videoCodec,
      audioCodec: render.audioCodec,
      qualityPreset: render.qualityPreset,
      subtitleEnabled: render.subtitleEnabled,
      subtitleBurnedIn: render.subtitleBurnedIn,
      backgroundMusicAssetId: render.backgroundMusicAssetId,
      renderSettings: render.renderSettings,
      timeline: render.timeline,
      duration: render.duration,
      fileSize: render.fileSize ? Number(render.fileSize) : null,
      processingTimeMs: render.processingTimeMs,
      retryCount: render.retryCount,
      currentSceneSequence: render.currentSceneSequence,
      completedSceneCount: render.completedSceneCount,
      totalSceneCount: render.totalSceneCount,
      progress: render.progress,
      errorCode: render.errorCode,
      errorMessage: render.errorMessage,
      startedAt: render.startedAt,
      completedAt: render.completedAt,
      createdAt: render.createdAt,
      updatedAt: render.updatedAt,
      previewUrl,
      subtitleUrl,
      outputMediaAssetId: render.outputMediaAssetId,
      subtitleMediaAssetId: render.subtitleMediaAssetId,
      generationJob: render.generationJob
        ? {
            id: render.generationJob.id,
            status: render.generationJob.status,
            progress: render.generationJob.progress,
            jobType: render.generationJob.jobType,
            errorMessage: render.generationJob.errorMessage,
          }
        : null,
      scenes: render.scenes.map((scene) => ({
        id: scene.id,
        sceneId: scene.sceneId,
        sequence: scene.sequence,
        startTime: scene.startTime,
        endTime: scene.endTime,
        duration: scene.duration,
        selectedMotionGenerationId: scene.selectedMotionGenerationId,
        selectedVisualId: scene.selectedVisualId,
        selectedAudioGenerationId: scene.selectedAudioGenerationId,
        transitionIn: scene.transitionIn,
        transitionOut: scene.transitionOut,
        status: scene.status as VideoRenderSceneStatus,
        errorMessage: scene.errorMessage,
      })),
    };
  }
}
