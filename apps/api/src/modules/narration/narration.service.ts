import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AudioGenerationStatus,
  GenerationJobType,
  JobStatus,
  NarrationScriptStatus,
  Prisma,
  SceneNarrationStatus,
} from '@prisma/client';
import {
  DEFAULT_GEMINI_TTS_VOICE,
  estimateGeminiTtsCostUsd,
  estimateSpeakingDurationSeconds,
  GEMINI_PREBUILT_VOICE_IDS,
  getGeminiTtsPricingFromEnv,
  JOB_TYPE_TO_QUEUE,
  voiceProfileConfigurationSchema,
  type NarrationJobAction,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { StorageService } from '../../storage/storage.service';
import { JobsService } from '../jobs/jobs.service';
import { CreateVoiceProfileDto } from './dto/create-voice-profile.dto';
import { GenerateSceneAudioDto } from './dto/generate-scene-audio.dto';
import { GenerateStoryAudioDto } from './dto/generate-story-audio.dto';
import { PlanNarrationDto } from './dto/plan-narration.dto';
import { UpdateNarrationScriptDto } from './dto/update-narration-script.dto';
import { UpdateVoiceProfileDto } from './dto/update-voice-profile.dto';

const DOWNLOAD_URL_TTL_SECONDS = 900;

const ACTIVE_JOB_STATUSES: JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.QUEUED,
  JobStatus.PROCESSING,
];

const ACTIVE_AUDIO_STATUSES: AudioGenerationStatus[] = [
  AudioGenerationStatus.PENDING,
  AudioGenerationStatus.GENERATING,
  AudioGenerationStatus.VALIDATING,
  AudioGenerationStatus.STORING,
];

const NARRATION_JOB_TYPES: GenerationJobType[] = [
  GenerationJobType.NARRATION_PLANNING,
  GenerationJobType.VOICE,
];

const TTS_USAGE_REQUEST_PREFIXES = ['tts_', 'speech_', 'narration_'];

interface ResolvedVoice {
  /** null when the voice is ephemeral (not persisted as a VoiceProfile). */
  voiceProfileId: string | null;
  providerVoiceId: string;
  speakingStyle?: string;
}

interface SceneNarrationTarget {
  id: string;
  sceneId: string;
  sequence: number;
  text: string;
  speakingStyle: string;
  estimatedDuration: number;
  scene?: { sceneNumber: number } | null;
}

interface AudioRecordLike {
  id: string;
  userId?: string;
  storyId: string;
  sceneId: string | null;
  narrationScriptId: string;
  sceneNarrationId: string | null;
  voiceProfileId?: string | null;
  provider?: string | null;
  model?: string | null;
  status: AudioGenerationStatus;
  progress: number;
  sourceText?: string;
  speakingStyle?: string | null;
  providerVoiceId?: string | null;
  duration?: number | null;
  format?: string | null;
  sampleRate?: number | null;
  channels?: number | null;
  fileSize?: bigint | number | null;
  estimatedCost?: Prisma.Decimal | number | null;
  actualCost?: Prisma.Decimal | number | null;
  currency?: string | null;
  isSelected: boolean;
  attemptNumber: number;
  retryCount: number;
  idempotencyKey?: string | null;
  generationJobId?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
  audioMediaAsset?: { storageKey: string; mimeType?: string | null } | null;
}

@Injectable()
export class NarrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly storage: StorageService,
    private readonly jobsService: JobsService,
    private readonly config: ConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Narration planning
  // ---------------------------------------------------------------------------

  async planNarration(userId: string, storyId: string, dto: PlanNarrationDto) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: { scenes: { select: { id: true } } },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    if (story.scenes.length === 0) {
      throw new BadRequestException('Story must have planned scenes before planning narration');
    }

    const activeJob = await this.prisma.generationJob.findFirst({
      where: {
        storyId,
        userId,
        jobType: GenerationJobType.NARRATION_PLANNING,
        status: { in: ACTIVE_JOB_STATUSES },
      },
      select: { id: true },
    });
    if (activeJob) {
      throw new ConflictException('Narration planning is already in progress for this story');
    }

    const latest = await this.prisma.narrationScript.findFirst({
      where: { storyId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const regenerate = dto.regenerate === true;
    const simulateFailure = dto.simulateFailure === true;

    const script = await this.prisma.narrationScript.create({
      data: {
        userId,
        storyId,
        version: (latest?.version ?? 0) + 1,
        status: NarrationScriptStatus.PLANNING,
      },
    });

    const payload: Record<string, unknown> = {
      action: 'plan_narration' satisfies NarrationJobAction,
      narrationScriptId: script.id,
      regenerate,
      simulateFailure,
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId,
        jobType: GenerationJobType.NARRATION_PLANNING,
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName: JOB_TYPE_TO_QUEUE.NARRATION_PLANNING,
        maxAttempts: simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
      },
    });

    await this.prisma.narrationScript.update({
      where: { id: script.id },
      data: { generationJobId: job.id },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'NARRATION_PLANNING',
        {
          generationJobId: job.id,
          userId,
          storyId,
          narrationScriptId: script.id,
          jobType: 'NARRATION_PLANNING',
          provider: 'gemini',
          payload,
          simulateFailure,
          useMockAi: this.shouldUseMockAi(dto.useMockAi, false),
        },
        { attempts: simulateFailure ? 1 : 3 },
      );

      const queuedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: JobStatus.QUEUED, queueJobId: bullJob.id },
      });

      return {
        job: this.serializeJob(queuedJob),
        narrationScript: this.serializeScriptSummary({
          ...script,
          generationJobId: job.id,
        }),
      };
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, errorMessage: message, completedAt: new Date() },
      });
      await this.prisma.narrationScript.update({
        where: { id: script.id },
        data: { status: NarrationScriptStatus.FAILED, errorMessage: message },
      });
      throw error;
    }
  }

  async getNarration(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const script = await this.prisma.narrationScript.findFirst({
      where: { storyId, userId },
      orderBy: { version: 'desc' },
      include: {
        scenes: {
          orderBy: { sequence: 'asc' },
          include: {
            scene: { select: { id: true, sceneNumber: true, durationSeconds: true } },
            audioGenerations: {
              orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
              include: { audioMediaAsset: true },
            },
          },
        },
      },
    });

    const jobs = await this.prisma.generationJob.findMany({
      where: { storyId, userId, jobType: { in: NARRATION_JOB_TYPES } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const narrationScript = script
      ? {
          ...this.serializeScriptSummary(script),
          scenes: await Promise.all(
            script.scenes.map(async (scene) => ({
              ...this.serializeSceneNarration(scene),
              sceneNumber: scene.scene?.sceneNumber ?? null,
              audio: await Promise.all(
                scene.audioGenerations.map((audio) => this.serializeAudio(audio)),
              ),
            })),
          ),
        }
      : null;

    return {
      storyId,
      narrationScript,
      jobs: jobs.map((job) => this.serializeJob(job)),
    };
  }

  async updateScript(userId: string, scriptId: string, dto: UpdateNarrationScriptDto) {
    const script = await this.ensureScriptOwned(userId, scriptId);
    if (script.status === NarrationScriptStatus.PLANNING) {
      throw new ConflictException('Cannot edit a narration script while it is being planned');
    }
    if (script.status === NarrationScriptStatus.FAILED) {
      throw new ConflictException('Cannot edit a failed narration script');
    }

    const sceneEdits = dto.scenes ?? [];
    if (sceneEdits.length > 0) {
      const existing = await this.prisma.sceneNarration.findMany({
        where: { narrationScriptId: script.id },
        select: { id: true },
      });
      const validIds = new Set(existing.map((scene) => scene.id));
      const invalid = sceneEdits.filter((edit) => !validIds.has(edit.id));
      if (invalid.length > 0) {
        throw new BadRequestException('One or more scenes do not belong to this narration script');
      }
    }

    const wasApproved = script.status === NarrationScriptStatus.APPROVED;

    await this.prisma.$transaction(async (tx) => {
      for (const edit of sceneEdits) {
        await tx.sceneNarration.update({
          where: { id: edit.id },
          data: {
            ...(edit.text !== undefined
              ? {
                  text: edit.text,
                  ...(edit.estimatedDurationSeconds === undefined
                    ? { estimatedDuration: estimateSpeakingDurationSeconds(edit.text) }
                    : {}),
                }
              : {}),
            ...(edit.emotionalTone !== undefined ? { emotionalTone: edit.emotionalTone } : {}),
            ...(edit.speakingStyle !== undefined ? { speakingStyle: edit.speakingStyle } : {}),
            ...(edit.deliveryInstructions !== undefined
              ? { deliveryInstructions: edit.deliveryInstructions }
              : {}),
            ...(edit.pronunciationGuidance !== undefined
              ? { pronunciationGuidance: edit.pronunciationGuidance }
              : {}),
            ...(edit.estimatedDurationSeconds !== undefined
              ? { estimatedDuration: edit.estimatedDurationSeconds }
              : {}),
            ...(wasApproved ? { status: SceneNarrationStatus.READY } : {}),
          },
        });
      }

      let fullText = dto.fullText;
      if (fullText === undefined && sceneEdits.some((edit) => edit.text !== undefined)) {
        const scenes = await tx.sceneNarration.findMany({
          where: { narrationScriptId: script.id },
          orderBy: { sequence: 'asc' },
          select: { text: true },
        });
        fullText = scenes.map((scene) => scene.text).join('\n\n');
      }

      await tx.narrationScript.update({
        where: { id: script.id },
        data: {
          ...(fullText !== undefined ? { fullText } : {}),
          // Editing an approved script requires re-approval.
          ...(wasApproved
            ? { status: NarrationScriptStatus.READY, approvedAt: null }
            : {}),
        },
      });
    });

    return this.getScript(userId, scriptId);
  }

  async approveScript(userId: string, scriptId: string) {
    const script = await this.ensureScriptOwned(userId, scriptId);
    if (script.status !== NarrationScriptStatus.READY) {
      throw new ConflictException('Only READY narration scripts can be approved');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.narrationScript.update({
        where: { id: script.id },
        data: { status: NarrationScriptStatus.APPROVED, approvedAt: new Date() },
      });
      await tx.sceneNarration.updateMany({
        where: { narrationScriptId: script.id },
        data: { status: SceneNarrationStatus.APPROVED },
      });
      if (script.fullText) {
        await tx.story.update({
          where: { id: script.storyId },
          data: { narrationScript: script.fullText },
        });
      }
    });

    return this.getScript(userId, scriptId);
  }

  async getScript(userId: string, scriptId: string) {
    const script = await this.prisma.narrationScript.findFirst({
      where: { id: scriptId, userId },
      include: { scenes: { orderBy: { sequence: 'asc' } } },
    });
    if (!script) {
      throw new NotFoundException('Narration script not found');
    }
    return {
      ...this.serializeScriptSummary(script),
      scenes: script.scenes.map((scene) => this.serializeSceneNarration(scene)),
    };
  }

  // ---------------------------------------------------------------------------
  // Audio generation
  // ---------------------------------------------------------------------------

  async generateStoryAudio(userId: string, storyId: string, dto: GenerateStoryAudioDto) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      include: { scenes: { select: { id: true } } },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }
    if (story.scenes.length === 0) {
      throw new BadRequestException('Story must have planned scenes before generating audio');
    }

    const script = await this.resolveUsableScript(userId, storyId);

    let targets = script.scenes as SceneNarrationTarget[];
    if (dto.sceneIds?.length) {
      const requested = [...new Set(dto.sceneIds)];
      const validIds = new Set(targets.map((scene) => scene.sceneId));
      if (requested.some((id) => !validIds.has(id))) {
        throw new BadRequestException('One or more sceneIds do not belong to this story');
      }
      targets = targets.filter((scene) => requested.includes(scene.sceneId));
    }

    return this.queueAudioGeneration({
      userId,
      storyId,
      scriptId: script.id,
      targets,
      dto,
    });
  }

  async generateSceneAudio(userId: string, sceneId: string, dto: GenerateSceneAudioDto) {
    const scene = await this.ensureSceneOwned(userId, sceneId);
    const script = await this.resolveUsableScript(userId, scene.storyId);

    const target = (script.scenes as SceneNarrationTarget[]).find(
      (narration) => narration.sceneId === sceneId,
    );
    if (!target) {
      throw new BadRequestException('Scene has no narration in the current narration script');
    }

    return this.queueAudioGeneration({
      userId,
      storyId: scene.storyId,
      scriptId: script.id,
      targets: [target],
      dto,
    });
  }

  async listStoryAudio(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const audio = await this.prisma.audioGeneration.findMany({
      where: { storyId, userId },
      orderBy: [{ createdAt: 'desc' }],
      include: { audioMediaAsset: true },
    });
    return Promise.all(audio.map((item) => this.serializeAudio(item)));
  }

  async listSceneAudio(userId: string, sceneId: string) {
    const scene = await this.ensureSceneOwned(userId, sceneId);
    const audio = await this.prisma.audioGeneration.findMany({
      where: { sceneId: scene.id, userId },
      orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
      include: { audioMediaAsset: true },
    });
    return Promise.all(audio.map((item) => this.serializeAudio(item)));
  }

  async getAudio(userId: string, audioId: string) {
    const audio = await this.prisma.audioGeneration.findFirst({
      where: { id: audioId, userId },
      include: { audioMediaAsset: true, generationJob: true },
    });
    if (!audio) {
      throw new NotFoundException('Audio generation not found');
    }
    return {
      ...(await this.serializeAudio(audio)),
      generationJob: audio.generationJob ? this.serializeJob(audio.generationJob) : null,
    };
  }

  async retryAudio(userId: string, audioId: string) {
    const audio = await this.prisma.audioGeneration.findFirst({
      where: { id: audioId, userId },
    });
    if (!audio) {
      throw new NotFoundException('Audio generation not found');
    }
    // COMPLETED audio is never regenerated via retry; use forceRegenerate on generate endpoints.
    if (audio.status !== AudioGenerationStatus.FAILED) {
      throw new ConflictException('Only FAILED audio generations can be retried');
    }

    const maxAttempts = this.maxAttemptsPerScene();
    if (audio.retryCount + 1 >= maxAttempts) {
      throw new BadRequestException(
        `Maximum audio generation attempts per scene (${maxAttempts}) reached`,
      );
    }

    const estimatedCost = Number(audio.estimatedCost ?? 0);
    await this.assertBudgetAllows(userId, estimatedCost);
    await this.assertConcurrencyAllows(userId);

    await this.prisma.audioGeneration.update({
      where: { id: audio.id },
      data: {
        status: AudioGenerationStatus.PENDING,
        progress: 0,
        retryCount: { increment: 1 },
        errorCode: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
      },
    });

    const { job, audios } = await this.createAndEnqueueVoiceJob({
      userId,
      storyId: audio.storyId,
      scriptId: audio.narrationScriptId,
      audios: [{ id: audio.id, sceneId: audio.sceneId, estimatedCost }],
      payloadExtra: { retry: true },
      voiceId: audio.providerVoiceId ?? undefined,
      forceRegenerate: false,
      simulateFailure: false,
      useMockAi: undefined,
    });

    return {
      job: this.serializeJob(job),
      audioGenerations: audios,
    };
  }

  async selectAudio(userId: string, audioId: string) {
    const audio = await this.prisma.audioGeneration.findFirst({
      where: { id: audioId, userId },
    });
    if (!audio) {
      throw new NotFoundException('Audio generation not found');
    }
    if (audio.status !== AudioGenerationStatus.COMPLETED || !audio.audioMediaAssetId) {
      throw new ConflictException('Only completed audio generations can be selected');
    }

    await this.prisma.$transaction(async (tx) => {
      if (audio.sceneId) {
        await tx.audioGeneration.updateMany({
          where: { sceneId: audio.sceneId, isSelected: true, NOT: { id: audio.id } },
          data: { isSelected: false },
        });
      }
      await tx.audioGeneration.update({
        where: { id: audio.id },
        data: { isSelected: true },
      });
    });

    return this.getAudio(userId, audioId);
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.jobsService.getById(userId, jobId);
    if (!NARRATION_JOB_TYPES.includes(job.jobType)) {
      throw new NotFoundException('Narration job not found');
    }
    return job;
  }

  async cancelJob(userId: string, jobId: string) {
    await this.getJob(userId, jobId);
    return this.jobsService.cancel(userId, jobId);
  }

  // ---------------------------------------------------------------------------
  // Voice profiles
  // ---------------------------------------------------------------------------

  async listVoiceProfiles(userId: string) {
    const profiles = await this.prisma.voiceProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });
    return profiles.map((profile) => this.serializeVoiceProfile(profile));
  }

  async createVoiceProfile(userId: string, dto: CreateVoiceProfileDto) {
    this.assertSupportedVoice(dto.providerVoiceId);
    const configuration = this.parseVoiceConfiguration(dto.configuration);

    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault) {
          await tx.voiceProfile.updateMany({
            where: { userId, isDefault: true },
            data: { isDefault: false },
          });
        }
        return tx.voiceProfile.create({
          data: {
            userId,
            name: dto.name,
            provider: dto.provider ?? 'gemini',
            providerVoiceId: dto.providerVoiceId,
            language: dto.language ?? 'en',
            configuration: configuration as Prisma.InputJsonValue,
            isDefault: dto.isDefault === true,
          },
        });
      });
      return this.serializeVoiceProfile(profile);
    } catch (error) {
      throw this.mapVoiceProfileError(error);
    }
  }

  async updateVoiceProfile(userId: string, id: string, dto: UpdateVoiceProfileDto) {
    const existing = await this.prisma.voiceProfile.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException('Voice profile not found');
    }
    if (dto.providerVoiceId !== undefined) {
      this.assertSupportedVoice(dto.providerVoiceId);
    }
    const configuration =
      dto.configuration !== undefined ? this.parseVoiceConfiguration(dto.configuration) : undefined;

    try {
      const profile = await this.prisma.$transaction(async (tx) => {
        if (dto.isDefault === true) {
          await tx.voiceProfile.updateMany({
            where: { userId, isDefault: true, NOT: { id } },
            data: { isDefault: false },
          });
        }
        return tx.voiceProfile.update({
          where: { id },
          data: {
            ...(dto.name !== undefined ? { name: dto.name } : {}),
            ...(dto.providerVoiceId !== undefined
              ? { providerVoiceId: dto.providerVoiceId }
              : {}),
            ...(dto.language !== undefined ? { language: dto.language } : {}),
            ...(configuration !== undefined
              ? { configuration: configuration as Prisma.InputJsonValue }
              : {}),
            ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          },
        });
      });
      return this.serializeVoiceProfile(profile);
    } catch (error) {
      throw this.mapVoiceProfileError(error);
    }
  }

  async deleteVoiceProfile(userId: string, id: string) {
    const existing = await this.prisma.voiceProfile.findFirst({ where: { id, userId } });
    if (!existing) {
      throw new NotFoundException('Voice profile not found');
    }
    await this.prisma.voiceProfile.delete({ where: { id } });
    return { id, deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  async getProgress(userId: string, storyId: string) {
    const story = await this.prisma.story.findFirst({
      where: { id: storyId, userId },
      select: { id: true },
    });
    if (!story) {
      throw new NotFoundException('Story not found');
    }

    const script = await this.prisma.narrationScript.findFirst({
      where: { storyId, userId },
      orderBy: { version: 'desc' },
      include: { scenes: { select: { id: true, sceneId: true, status: true } } },
    });

    const audio = script
      ? await this.prisma.audioGeneration.findMany({
          where: { storyId, userId, narrationScriptId: script.id },
          select: {
            id: true,
            sceneId: true,
            status: true,
            progress: true,
            isSelected: true,
            attemptNumber: true,
            errorMessage: true,
            updatedAt: true,
          },
        })
      : [];

    const countsByStatus: Record<AudioGenerationStatus, number> = {
      PENDING: 0,
      GENERATING: 0,
      VALIDATING: 0,
      STORING: 0,
      COMPLETED: 0,
      FAILED: 0,
      CANCELLED: 0,
    };
    for (const item of audio) {
      countsByStatus[item.status] += 1;
    }

    const completedScenes = new Set(
      audio
        .filter((item) => item.status === AudioGenerationStatus.COMPLETED && item.sceneId)
        .map((item) => item.sceneId),
    ).size;
    const failedScenes = new Set(
      audio
        .filter((item) => item.status === AudioGenerationStatus.FAILED && item.sceneId)
        .map((item) => item.sceneId),
    ).size;

    const activeJobs = await this.prisma.generationJob.findMany({
      where: {
        storyId,
        userId,
        jobType: { in: NARRATION_JOB_TYPES },
        status: { in: ACTIVE_JOB_STATUSES },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    const totalScenes = script?.scenes.length ?? 0;
    const percentComplete =
      totalScenes === 0 ? 0 : Math.round((completedScenes / totalScenes) * 100);

    return {
      storyId,
      narrationScript: script
        ? {
            id: script.id,
            version: script.version,
            status: script.status,
            errorMessage: script.errorMessage,
            updatedAt: script.updatedAt,
          }
        : null,
      totalScenes,
      completedScenes,
      failedScenes,
      percentComplete,
      countsByStatus,
      activeJobs: activeJobs.map((job) => this.serializeJob(job)),
      audioGenerations: audio.map((item) => ({
        id: item.id,
        sceneId: item.sceneId,
        status: item.status,
        progress: item.progress,
        isSelected: item.isSelected,
        attemptNumber: item.attemptNumber,
        errorMessage: item.errorMessage,
        updatedAt: item.updatedAt,
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Generation internals
  // ---------------------------------------------------------------------------

  private async queueAudioGeneration(input: {
    userId: string;
    storyId: string;
    scriptId: string;
    targets: SceneNarrationTarget[];
    dto: GenerateStoryAudioDto | GenerateSceneAudioDto;
  }) {
    const { userId, storyId, scriptId, targets, dto } = input;
    const voice = await this.resolveVoice(userId, dto);
    const forceRegenerate = dto.forceRegenerate === true;

    const toGenerate: Array<{
      target: SceneNarrationTarget;
      attemptNumber: number;
      speakingStyle: string | undefined;
      estimatedCost: number;
    }> = [];
    const skippedSceneIds: string[] = [];

    for (const target of targets) {
      const active = await this.prisma.audioGeneration.findFirst({
        where: {
          sceneNarrationId: target.id,
          status: { in: ACTIVE_AUDIO_STATUSES },
        },
        select: { id: true },
      });
      if (active) {
        throw new ConflictException(
          'Audio generation is already in progress for one or more selected scenes',
        );
      }

      if (!forceRegenerate) {
        const completed = await this.prisma.audioGeneration.findFirst({
          where: {
            sceneNarrationId: target.id,
            status: AudioGenerationStatus.COMPLETED,
          },
          select: { id: true },
        });
        if (completed) {
          skippedSceneIds.push(target.sceneId);
          continue;
        }
      }

      const latest = await this.prisma.audioGeneration.findFirst({
        where: { sceneNarrationId: target.id },
        orderBy: { attemptNumber: 'desc' },
        select: { attemptNumber: true },
      });

      await this.assertSceneAttemptLimits(target.sceneId);

      toGenerate.push({
        target,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
        speakingStyle: dto.speakingStyle ?? (target.speakingStyle || voice.speakingStyle),
        estimatedCost: estimateGeminiTtsCostUsd(
          target.text,
          target.estimatedDuration,
          getGeminiTtsPricingFromEnv(),
        ),
      });
    }

    if (toGenerate.length === 0) {
      return {
        job: null,
        storyId,
        narrationScriptId: scriptId,
        audioGenerations: [],
        skippedSceneIds,
        estimatedCostUsd: 0,
      };
    }

    this.assertLimits(toGenerate.map((item) => item.target));
    const totalEstimate = toGenerate.reduce((sum, item) => sum + item.estimatedCost, 0);
    await this.assertBudgetAllows(userId, totalEstimate);
    await this.assertConcurrencyAllows(userId);

    const model = this.config.get<string>('integrations.geminiTtsModel', 'gemini-3.8-flash-lite-tts');
    const currency = this.config.get<string>('integrations.geminiTtsCurrency', 'USD');

    const created: Array<{ id: string; sceneId: string | null; estimatedCost: number }> = [];
    for (const item of toGenerate) {
      const record = await this.prisma.audioGeneration.create({
        data: {
          userId,
          storyId,
          sceneId: item.target.sceneId,
          narrationScriptId: scriptId,
          sceneNarrationId: item.target.id,
          voiceProfileId: voice.voiceProfileId,
          provider: 'gemini',
          model,
          status: AudioGenerationStatus.PENDING,
          progress: 0,
          sourceText: item.target.text,
          speakingStyle: item.speakingStyle,
          providerVoiceId: voice.providerVoiceId,
          estimatedCost: new Prisma.Decimal(item.estimatedCost),
          currency,
          attemptNumber: item.attemptNumber,
          idempotencyKey: `audio:${item.target.id}:${voice.providerVoiceId}:v${item.attemptNumber}`,
        },
      });
      created.push({
        id: record.id,
        sceneId: item.target.sceneId,
        estimatedCost: item.estimatedCost,
      });
    }

    const { job, audios } = await this.createAndEnqueueVoiceJob({
      userId,
      storyId,
      scriptId,
      audios: created,
      payloadExtra: {
        ...(voice.voiceProfileId ? { voiceProfileId: voice.voiceProfileId } : {}),
        ...(dto.speakingStyle ? { speakingStyle: dto.speakingStyle } : {}),
      },
      voiceId: voice.providerVoiceId,
      forceRegenerate,
      simulateFailure: dto.simulateFailure === true,
      useMockAi: dto.useMockAi,
    });

    return {
      job: this.serializeJob(job),
      storyId,
      narrationScriptId: scriptId,
      audioGenerations: audios,
      skippedSceneIds,
      estimatedCostUsd: Number(totalEstimate.toFixed(6)),
    };
  }

  private async createAndEnqueueVoiceJob(input: {
    userId: string;
    storyId: string;
    scriptId: string;
    audios: Array<{ id: string; sceneId: string | null; estimatedCost: number }>;
    payloadExtra?: Record<string, unknown>;
    voiceId?: string;
    forceRegenerate: boolean;
    simulateFailure: boolean;
    useMockAi?: boolean;
  }) {
    const { userId, storyId, scriptId, audios, simulateFailure } = input;
    const audioGenerationIds = audios.map((audio) => audio.id);
    const singleAudio = audios.length === 1 ? audios[0] : undefined;

    const payload: Record<string, unknown> = {
      action: 'generate_speech' satisfies NarrationJobAction,
      narrationScriptId: scriptId,
      audioGenerationIds,
      ...(input.voiceId ? { voiceId: input.voiceId } : {}),
      forceRegenerate: input.forceRegenerate,
      ...(simulateFailure ? { simulateFailure: true } : {}),
      ...(input.payloadExtra ?? {}),
    };

    const job = await this.prisma.generationJob.create({
      data: {
        userId,
        storyId,
        jobType: GenerationJobType.VOICE,
        status: JobStatus.PENDING,
        provider: 'gemini',
        queueName: JOB_TYPE_TO_QUEUE.VOICE,
        maxAttempts: simulateFailure ? 1 : 3,
        payload: payload as Prisma.InputJsonValue,
        estimatedCost: new Prisma.Decimal(
          audios.reduce((sum, audio) => sum + audio.estimatedCost, 0),
        ),
      },
    });

    await this.prisma.audioGeneration.updateMany({
      where: { id: { in: audioGenerationIds } },
      data: { generationJobId: job.id },
    });

    try {
      const { job: bullJob } = await this.queueService.enqueueGenerationJob(
        'VOICE',
        {
          generationJobId: job.id,
          userId,
          storyId,
          narrationScriptId: scriptId,
          ...(singleAudio?.sceneId ? { sceneId: singleAudio.sceneId } : {}),
          ...(singleAudio ? { audioGenerationId: singleAudio.id } : {}),
          jobType: 'VOICE',
          provider: 'gemini',
          payload,
          simulateFailure,
          useMockAi: this.shouldUseMockAi(input.useMockAi, true),
        },
        { attempts: simulateFailure ? 1 : 3 },
      );

      const queuedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: JobStatus.QUEUED, queueJobId: bullJob.id },
      });

      return {
        job: queuedJob,
        audios: audioGenerationIds.map((id) => ({
          id,
          status: AudioGenerationStatus.PENDING,
          generationJobId: job.id,
          sceneId: audios.find((audio) => audio.id === id)?.sceneId ?? null,
        })),
      };
    } catch (error) {
      const message = (error as Error).message;
      await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { status: JobStatus.FAILED, errorMessage: message, completedAt: new Date() },
      });
      await this.prisma.audioGeneration.updateMany({
        where: { id: { in: audioGenerationIds } },
        data: {
          status: AudioGenerationStatus.FAILED,
          errorMessage: message,
          errorCode: 'ENQUEUE_FAILED',
        },
      });
      throw error;
    }
  }

  /** Prefer latest APPROVED script; fall back to latest READY. */
  private async resolveUsableScript(userId: string, storyId: string) {
    const include = {
      scenes: {
        orderBy: { sequence: 'asc' as const },
        include: { scene: { select: { sceneNumber: true } } },
      },
    };
    let script = await this.prisma.narrationScript.findFirst({
      where: { storyId, userId, status: NarrationScriptStatus.APPROVED },
      orderBy: { version: 'desc' },
      include,
    });
    if (!script) {
      script = await this.prisma.narrationScript.findFirst({
        where: { storyId, userId, status: NarrationScriptStatus.READY },
        orderBy: { version: 'desc' },
        include,
      });
    }
    if (!script) {
      throw new BadRequestException(
        'An approved (or ready) narration script is required before generating audio',
      );
    }
    if (script.scenes.length === 0) {
      throw new BadRequestException('Narration script has no scene narrations');
    }
    return script;
  }

  private async resolveVoice(
    userId: string,
    dto: { voiceProfileId?: string; providerVoiceId?: string; speakingStyle?: string },
  ): Promise<ResolvedVoice> {
    if (dto.voiceProfileId) {
      const profile = await this.prisma.voiceProfile.findFirst({
        where: { id: dto.voiceProfileId, userId },
      });
      if (!profile) {
        throw new NotFoundException('Voice profile not found');
      }
      return this.voiceFromProfile(profile);
    }

    if (dto.providerVoiceId) {
      this.assertSupportedVoice(dto.providerVoiceId);
      // Ephemeral voice: not persisted as a VoiceProfile.
      return { voiceProfileId: null, providerVoiceId: dto.providerVoiceId };
    }

    const defaultProfile = await this.prisma.voiceProfile.findFirst({
      where: { userId, isDefault: true },
    });
    if (defaultProfile) {
      return this.voiceFromProfile(defaultProfile);
    }

    const fallback = this.config.get<string>(
      'integrations.geminiTtsDefaultVoice',
      DEFAULT_GEMINI_TTS_VOICE,
    );
    this.assertSupportedVoice(fallback);
    return { voiceProfileId: null, providerVoiceId: fallback };
  }

  private voiceFromProfile(profile: {
    id: string;
    providerVoiceId: string;
    configuration: Prisma.JsonValue;
  }): ResolvedVoice {
    this.assertSupportedVoice(profile.providerVoiceId);
    const configuration =
      profile.configuration && typeof profile.configuration === 'object'
        ? (profile.configuration as { speakingStyle?: string })
        : {};
    return {
      voiceProfileId: profile.id,
      providerVoiceId: profile.providerVoiceId,
      speakingStyle: configuration.speakingStyle,
    };
  }

  private assertSupportedVoice(voiceId: string) {
    if (!GEMINI_PREBUILT_VOICE_IDS.includes(voiceId)) {
      throw new BadRequestException(`Unsupported Gemini prebuilt voice id: ${voiceId}`);
    }
  }

  private parseVoiceConfiguration(configuration: unknown): Record<string, unknown> {
    const parsed = voiceProfileConfigurationSchema.safeParse(configuration ?? {});
    if (!parsed.success) {
      throw new BadRequestException(
        `Invalid voice profile configuration: ${parsed.error.issues
          .map((issue) => issue.message)
          .join('; ')}`,
      );
    }
    return parsed.data;
  }

  private mapVoiceProfileError(error: unknown): unknown {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('A voice profile with this name already exists');
    }
    return error;
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  private maxAttemptsPerScene(): number {
    return this.config.get<number>('integrations.geminiTtsMaxAttemptsPerScene', 10);
  }

  private assertLimits(targets: SceneNarrationTarget[]) {
    const maxCharacters = this.config.get<number>('integrations.geminiTtsMaxCharacters', 4000);
    if (maxCharacters > 0) {
      const tooLong = targets.filter((target) => target.text.length > maxCharacters);
      if (tooLong.length > 0) {
        throw new BadRequestException(
          `Narration text exceeds the maximum of ${maxCharacters} characters for scenes: ${tooLong
            .map((target) => target.scene?.sceneNumber ?? target.sequence)
            .join(', ')}`,
        );
      }
    }

    const maxDuration = this.config.get<number>(
      'integrations.geminiTtsMaxAudioDurationSeconds',
      120,
    );
    if (maxDuration > 0) {
      const tooLong = targets.filter((target) => target.estimatedDuration > maxDuration);
      if (tooLong.length > 0) {
        throw new BadRequestException(
          `Estimated narration duration exceeds the maximum of ${maxDuration}s for scenes: ${tooLong
            .map((target) => target.scene?.sceneNumber ?? target.sequence)
            .join(', ')}`,
        );
      }
    }
  }

  private async assertSceneAttemptLimits(sceneId: string) {
    const maxAttempts = this.maxAttemptsPerScene();
    if (!(maxAttempts > 0)) return;
    const total = await this.prisma.audioGeneration.count({ where: { sceneId } });
    if (total >= maxAttempts) {
      throw new BadRequestException(
        `Maximum audio generation attempts per scene (${maxAttempts}) reached`,
      );
    }
  }

  private async assertConcurrencyAllows(userId: string) {
    const maxConcurrency = this.config.get<number>('integrations.geminiTtsMaxConcurrency', 2);
    if (!(maxConcurrency > 0)) return;
    const active = await this.prisma.generationJob.count({
      where: {
        userId,
        jobType: GenerationJobType.VOICE,
        status: { in: ACTIVE_JOB_STATUSES },
      },
    });
    if (active >= maxConcurrency) {
      throw new ConflictException(
        `Maximum concurrent speech generation jobs (${maxConcurrency}) reached; wait for running jobs to finish`,
      );
    }
  }

  private async assertBudgetAllows(userId: string, upcomingCostUsd: number) {
    const envLimit = process.env.GEMINI_TTS_MAX_MONTHLY_SPEND_USD?.trim();
    const maxMonthly =
      envLimit && envLimit.length > 0
        ? envLimit
        : this.config.get<string | number | undefined>('integrations.geminiTtsMaxMonthlySpendUsd');
    if (maxMonthly === undefined || maxMonthly === null || maxMonthly === '') return;

    const limit = Number.parseFloat(String(maxMonthly));
    if (!Number.isFinite(limit) || limit <= 0) return;

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const usages = await this.prisma.providerUsage.findMany({
      where: {
        userId,
        provider: 'gemini',
        createdAt: { gte: startOfMonth },
        OR: TTS_USAGE_REQUEST_PREFIXES.map((prefix) => ({
          requestType: { startsWith: prefix },
        })),
      },
      select: { estimatedCost: true },
    });
    const spent = usages.reduce((sum, row) => sum + Number(row.estimatedCost), 0);

    // In-flight audio has no provider usage row yet; count its estimate to avoid overspend races.
    const inFlight = await this.prisma.audioGeneration.findMany({
      where: { userId, status: { in: ACTIVE_AUDIO_STATUSES } },
      select: { estimatedCost: true },
    });
    const pending = inFlight.reduce((sum, row) => sum + Number(row.estimatedCost ?? 0), 0);

    if (spent + pending + upcomingCostUsd > limit) {
      throw new BadRequestException(
        `Monthly Gemini TTS budget of $${limit} would be exceeded (spent $${spent.toFixed(4)}, in-flight ~$${pending.toFixed(4)}, requested ~$${upcomingCostUsd.toFixed(4)})`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Ownership helpers
  // ---------------------------------------------------------------------------

  private async ensureScriptOwned(userId: string, scriptId: string) {
    const script = await this.prisma.narrationScript.findFirst({
      where: { id: scriptId, userId },
    });
    if (!script) {
      throw new NotFoundException('Narration script not found');
    }
    return script;
  }

  private async ensureSceneOwned(userId: string, sceneId: string) {
    const scene = await this.prisma.storyScene.findFirst({
      where: { id: sceneId, story: { userId } },
    });
    if (!scene) {
      throw new NotFoundException('Scene not found');
    }
    return scene;
  }

  // ---------------------------------------------------------------------------
  // Mock & serialization
  // ---------------------------------------------------------------------------

  private shouldUseMockAi(requested: boolean | undefined, tts: boolean): boolean {
    return (
      requested === true ||
      process.env.NODE_ENV === 'test' ||
      this.config.get<string>('integrations.geminiUseMock') === 'true' ||
      process.env.GEMINI_USE_MOCK === 'true' ||
      (tts &&
        (this.config.get<string>('integrations.geminiTtsUseMock') === 'true' ||
          process.env.GEMINI_TTS_USE_MOCK === 'true'))
    );
  }

  private serializeJob(job: {
    id: string;
    status: JobStatus;
    progress: number;
    jobType: GenerationJobType;
    errorMessage?: string | null;
    updatedAt?: Date;
    createdAt?: Date;
  }) {
    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      jobType: job.jobType,
      errorMessage: job.errorMessage ?? null,
      updatedAt: job.updatedAt,
      createdAt: job.createdAt,
    };
  }

  private serializeScriptSummary(script: {
    id: string;
    storyId: string;
    version: number;
    status: NarrationScriptStatus;
    fullText?: string | null;
    notes?: string | null;
    generationJobId?: string | null;
    approvedAt?: Date | null;
    errorMessage?: string | null;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      id: script.id,
      storyId: script.storyId,
      version: script.version,
      status: script.status,
      fullText: script.fullText ?? null,
      notes: script.notes ?? null,
      generationJobId: script.generationJobId ?? null,
      approvedAt: script.approvedAt ?? null,
      errorMessage: script.errorMessage ?? null,
      createdAt: script.createdAt,
      updatedAt: script.updatedAt,
    };
  }

  private serializeSceneNarration(scene: {
    id: string;
    narrationScriptId: string;
    storyId: string;
    sceneId: string;
    sequence: number;
    text: string;
    emotionalTone: string;
    speakingStyle: string;
    deliveryInstructions?: string | null;
    pronunciationGuidance?: string | null;
    estimatedDuration: number;
    status: SceneNarrationStatus;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      id: scene.id,
      narrationScriptId: scene.narrationScriptId,
      storyId: scene.storyId,
      sceneId: scene.sceneId,
      sequence: scene.sequence,
      text: scene.text,
      emotionalTone: scene.emotionalTone,
      speakingStyle: scene.speakingStyle,
      deliveryInstructions: scene.deliveryInstructions ?? null,
      pronunciationGuidance: scene.pronunciationGuidance ?? null,
      estimatedDurationSeconds: scene.estimatedDuration,
      status: scene.status,
      createdAt: scene.createdAt,
      updatedAt: scene.updatedAt,
    };
  }

  private async serializeAudio(audio: AudioRecordLike) {
    return {
      id: audio.id,
      storyId: audio.storyId,
      sceneId: audio.sceneId,
      narrationScriptId: audio.narrationScriptId,
      sceneNarrationId: audio.sceneNarrationId,
      voiceProfileId: audio.voiceProfileId ?? null,
      provider: audio.provider ?? null,
      model: audio.model ?? null,
      status: audio.status,
      progress: audio.progress,
      sourceText: audio.sourceText,
      speakingStyle: audio.speakingStyle ?? null,
      providerVoiceId: audio.providerVoiceId ?? null,
      durationSeconds: audio.duration ?? null,
      format: audio.format ?? null,
      sampleRate: audio.sampleRate ?? null,
      channels: audio.channels ?? null,
      fileSize: audio.fileSize != null ? Number(audio.fileSize) : null,
      mimeType: audio.audioMediaAsset?.mimeType ?? null,
      estimatedCost: audio.estimatedCost != null ? Number(audio.estimatedCost) : null,
      actualCost: audio.actualCost != null ? Number(audio.actualCost) : null,
      currency: audio.currency ?? 'USD',
      isSelected: audio.isSelected,
      attemptNumber: audio.attemptNumber,
      retryCount: audio.retryCount,
      generationJobId: audio.generationJobId ?? null,
      errorCode: audio.errorCode ?? null,
      errorMessage: audio.errorMessage ?? null,
      startedAt: audio.startedAt ?? null,
      completedAt: audio.completedAt ?? null,
      createdAt: audio.createdAt,
      updatedAt: audio.updatedAt,
      downloadUrl: audio.audioMediaAsset
        ? await this.storage.getPresignedDownloadUrl(
            audio.audioMediaAsset.storageKey,
            DOWNLOAD_URL_TTL_SECONDS,
          )
        : null,
    };
  }

  private serializeVoiceProfile(profile: {
    id: string;
    name: string;
    provider: string;
    providerVoiceId: string;
    language: string;
    configuration: Prisma.JsonValue;
    isDefault: boolean;
    createdAt?: Date;
    updatedAt?: Date;
  }) {
    return {
      id: profile.id,
      name: profile.name,
      provider: profile.provider,
      providerVoiceId: profile.providerVoiceId,
      language: profile.language,
      configuration: profile.configuration ?? {},
      isDefault: profile.isDefault,
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }
}
