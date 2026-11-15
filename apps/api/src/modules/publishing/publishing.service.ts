import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  GenerationJobType,
  JobStatus,
  Prisma,
  PublishStatus,
  SocialConnectionStatus,
  VideoRenderStatus,
  type PublishRecord,
  type SocialChannel,
  type VideoRender,
} from '@prisma/client';
import {
  DEFAULT_CAPABILITIES,
  QUEUE_NAMES,
  type PublishingCapabilities,
  type SocialPlatformKey,
  type SocialPublishQueuePayload,
  type SocialPublishStatusQueuePayload,
} from '@ai-video/shared';
import { randomBytes } from 'node:crypto';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { GeminiProvider } from '../../integrations/providers/gemini.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { ListPublishingDto } from './dto/list-publishing.dto';
import {
  ChannelPublishTargetDto,
  PublishRenderDto,
} from './dto/publish-render.dto';
import { SuggestCaptionDto } from './dto/suggest-caption.dto';
import { UpdatePublicationDto } from './dto/update-publication.dto';

const IN_PROGRESS_STATUSES: PublishStatus[] = [
  PublishStatus.QUEUED,
  PublishStatus.VALIDATING,
  PublishStatus.UPLOADING,
  PublishStatus.PROCESSING,
  PublishStatus.PUBLISHING,
  PublishStatus.SCHEDULED,
  PublishStatus.ACTION_REQUIRED,
];

const IDEMPOTENT_REUSE_STATUSES: PublishStatus[] = [
  PublishStatus.PUBLISHED,
  ...IN_PROGRESS_STATUSES,
];

const PUBLICATION_INCLUDE = {
  channel: {
    select: {
      id: true,
      accountName: true,
      username: true,
      platform: true,
      connectionStatus: true,
      profileImageUrl: true,
      isActive: true,
    },
  },
  videoRender: {
    select: {
      id: true,
      storyId: true,
      status: true,
      duration: true,
      aspectRatio: true,
      width: true,
      height: true,
      outputMediaAssetId: true,
      completedAt: true,
    },
  },
  videoProject: { select: { id: true, title: true } },
  generationJob: {
    select: {
      id: true,
      status: true,
      progress: true,
      errorMessage: true,
      queueJobId: true,
      queueName: true,
    },
  },
} as const;

type PublicationWithRelations = Prisma.PublishRecordGetPayload<{
  include: typeof PUBLICATION_INCLUDE;
}>;

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly gemini: GeminiProvider,
  ) {}

  async list(userId: string, query: ListPublishingDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.PublishRecordWhereInput = {
      userId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.videoProjectId ? { videoProjectId: query.videoProjectId } : {}),
      ...(query.videoRenderId ? { videoRenderId: query.videoRenderId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.publishRecord.findMany({
        where,
        include: PUBLICATION_INCLUDE,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.publishRecord.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serialize(item)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getById(userId: string, id: string) {
    const record = await this.requirePublication(userId, id);
    return this.serialize(record);
  }

  async getProgress(userId: string, id: string) {
    const record = await this.requirePublication(userId, id);
    return {
      id: record.id,
      status: record.status,
      uploadProgress: record.uploadProgress,
      postUrl: record.postUrl,
      providerUploadId: record.providerUploadId,
      providerPublishId: record.providerPublishId,
      providerPostId: record.providerPostId,
      errorCode: record.errorCode,
      errorMessage: record.errorMessage,
      retryCount: record.retryCount,
      submittedAt: record.submittedAt,
      publishedAt: record.publishedAt,
      generationJob: record.generationJob,
      channel: record.channel,
      videoRender: record.videoRender,
    };
  }

  async listByRender(userId: string, renderId: string) {
    const render = await this.prisma.videoRender.findFirst({
      where: { id: renderId, userId },
      select: { id: true },
    });
    if (!render) {
      throw new NotFoundException('Render not found');
    }
    const items = await this.prisma.publishRecord.findMany({
      where: { userId, videoRenderId: renderId },
      include: PUBLICATION_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return items.map((item) => this.serialize(item));
  }

  async publishRender(userId: string, renderId: string, dto: PublishRenderDto) {
    await this.assertPublishAllowed();
    const render = await this.requireCompletedRender(userId, renderId);
    const mimeType = render.outputMediaAsset?.mimeType ?? 'video/mp4';
    const publications = [];

    for (const target of dto.targets) {
      const channel = await this.prisma.socialChannel.findFirst({
        where: { id: target.channelId, userId },
      });
      if (!channel) {
        throw new NotFoundException(`Channel ${target.channelId} not found`);
      }
      this.assertChannelEligible(channel, mimeType);

      const idempotencyKey = dto.idempotencyKey
        ? `${dto.idempotencyKey}:${channel.id}`
        : `pub_${randomBytes(16).toString('hex')}`;

      const existing = await this.prisma.publishRecord.findUnique({
        where: { idempotencyKey },
        include: PUBLICATION_INCLUDE,
      });
      if (existing) {
        if (
          existing.userId === userId &&
          existing.videoRenderId === renderId &&
          existing.channelId === channel.id &&
          IDEMPOTENT_REUSE_STATUSES.includes(existing.status)
        ) {
          publications.push(this.serialize(existing));
          continue;
        }
        throw new ConflictException(
          `Idempotency key already used for a different publication (${existing.id})`,
        );
      }

      const merged = this.mergeTargetFields(target, dto.defaults);
      const created = await this.createAndEnqueuePublication({
        userId,
        render,
        channel,
        fields: merged,
        idempotencyKey,
      });
      publications.push(created);
    }

    return publications;
  }

  private async assertPublishAllowed(publishRecordId?: string) {
    const emergency = await this.prisma.setting.findUnique({
      where: { key: 'system:automation:emergencyStop' },
    });
    const active =
      !!emergency &&
      typeof emergency.value === 'object' &&
      emergency.value !== null &&
      (emergency.value as { active?: boolean }).active === true;
    if (active) {
      throw new ServiceUnavailableException(
        'Global emergency stop is active — publishing is blocked',
      );
    }
    if (publishRecordId) {
      const blocked = await this.prisma.interruptedTask.findFirst({
        where: {
          entityType: 'publish_record',
          entityId: publishRecordId,
          republishBlocked: true,
          resolvedAt: null,
        },
      });
      if (blocked) {
        throw new ConflictException(
          'Publication was interrupted by emergency stop and must be reconciled before republish',
        );
      }
    }
  }

  async retry(userId: string, id: string) {
    await this.assertPublishAllowed(id);
    const record = await this.requirePublication(userId, id);

    if (record.status === PublishStatus.PUBLISHED) {
      throw new ConflictException('Publication is already published');
    }
    if (
      record.status !== PublishStatus.FAILED &&
      record.status !== PublishStatus.ACTION_REQUIRED
    ) {
      throw new ConflictException(
        `Only FAILED or ACTION_REQUIRED publications can be retried (current: ${record.status})`,
      );
    }
    if (!record.videoRenderId || !record.channelId) {
      throw new BadRequestException('Publication is missing render or channel reference');
    }

    const hasProviderIds = Boolean(
      record.providerUploadId || record.providerPublishId || record.providerPostId,
    );

    const retryCount = record.retryCount + 1;
    let generationJob = record.generationJobId
      ? await this.prisma.generationJob.findUnique({ where: { id: record.generationJobId } })
      : null;

    if (!generationJob) {
      generationJob = await this.prisma.generationJob.create({
        data: {
          userId,
          storyId: record.videoRender?.storyId ?? null,
          jobType: GenerationJobType.PUBLISH,
          status: JobStatus.PENDING,
          provider: record.platform.toLowerCase(),
          queueName: QUEUE_NAMES.SOCIAL_PUBLISHING,
          maxAttempts: 3,
          payload: {
            publishRecordId: record.id,
            videoRenderId: record.videoRenderId,
            channelId: record.channelId,
            platform: record.platform,
          } as Prisma.InputJsonValue,
        },
      });
    } else {
      generationJob = await this.prisma.generationJob.update({
        where: { id: generationJob.id },
        data: {
          status: JobStatus.PENDING,
          progress: 0,
          errorMessage: null,
          completedAt: null,
          startedAt: null,
          attempts: 0,
        },
      });
    }

    const basePayload: SocialPublishQueuePayload = {
      generationJobId: generationJob.id,
      publishRecordId: record.id,
      userId,
      videoRenderId: record.videoRenderId,
      channelId: record.channelId,
      platform: record.platform as SocialPlatformKey,
      forceRetry: true,
    };

    let queueName: string = QUEUE_NAMES.SOCIAL_PUBLISHING;
    let bullJobId: string | undefined;

    try {
      if (hasProviderIds) {
        queueName = QUEUE_NAMES.SOCIAL_PUBLISH_STATUS;
        const statusPayload: SocialPublishStatusQueuePayload = {
          ...basePayload,
          pollAttempt: 0,
          maxPollAttempts: 60,
          pollIntervalSeconds: 10,
        };
        const job = await this.queueService.getQueue(QUEUE_NAMES.SOCIAL_PUBLISH_STATUS).add(
          'status',
          statusPayload,
          { jobId: `${generationJob.id}:status:${retryCount}` },
        );
        bullJobId = job.id;
        await this.prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.PROCESSING,
            retryCount,
            errorCode: null,
            errorMessage: null,
            generationJobId: generationJob.id,
          },
        });
      } else {
        const job = await this.queueService.getQueue(QUEUE_NAMES.SOCIAL_PUBLISHING).add(
          'publish',
          basePayload,
          { jobId: `${generationJob.id}:retry:${retryCount}` },
        );
        bullJobId = job.id;
        await this.prisma.publishRecord.update({
          where: { id: record.id },
          data: {
            status: PublishStatus.QUEUED,
            retryCount,
            uploadProgress: 0,
            errorCode: null,
            errorMessage: null,
            generationJobId: generationJob.id,
          },
        });
      }

      await this.prisma.generationJob.update({
        where: { id: generationJob.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: bullJobId,
          queueName,
        },
      });
    } catch (error) {
      await this.prisma.generationJob.update({
        where: { id: generationJob.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      throw error;
    }

    return this.getById(userId, id);
  }

  async cancel(userId: string, id: string) {
    const record = await this.requirePublication(userId, id);
    const cancellable =
      record.status === PublishStatus.DRAFT ||
      record.status === PublishStatus.QUEUED ||
      record.status === PublishStatus.VALIDATING ||
      (record.status === PublishStatus.UPLOADING &&
        !record.providerUploadId &&
        !record.providerPublishId &&
        !record.providerPostId);

    if (!cancellable) {
      throw new ConflictException(
        `Cannot cancel publication in status ${record.status} once provider upload has started`,
      );
    }

    if (record.generationJobId) {
      try {
        await this.queueService.removeJob(QUEUE_NAMES.SOCIAL_PUBLISHING, record.generationJobId);
      } catch (error) {
        this.logger.warn(
          `Failed to remove publish queue job ${record.generationJobId}: ${(error as Error).message}`,
        );
      }
      await this.prisma.generationJob.updateMany({
        where: { id: record.generationJobId, userId },
        data: {
          status: JobStatus.CANCELLED,
          completedAt: new Date(),
        },
      });
    }

    const updated = await this.prisma.publishRecord.update({
      where: { id: record.id },
      data: {
        status: PublishStatus.CANCELLED,
        errorCode: null,
        errorMessage: null,
      },
      include: PUBLICATION_INCLUDE,
    });

    return this.serialize(updated);
  }

  async update(userId: string, id: string, dto: UpdatePublicationDto) {
    const record = await this.requirePublication(userId, id);
    if (
      record.status !== PublishStatus.DRAFT &&
      record.status !== PublishStatus.QUEUED &&
      record.status !== PublishStatus.ACTION_REQUIRED
    ) {
      throw new ConflictException(
        `Metadata can only be updated for DRAFT, QUEUED, or ACTION_REQUIRED (current: ${record.status})`,
      );
    }

    const updated = await this.prisma.publishRecord.update({
      where: { id: record.id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.caption !== undefined ? { caption: dto.caption } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.hashtags !== undefined ? { hashtags: dto.hashtags } : {}),
        ...(dto.platformSettings !== undefined
          ? { platformSettings: dto.platformSettings as Prisma.InputJsonValue }
          : {}),
      },
      include: PUBLICATION_INCLUDE,
    });

    return this.serialize(updated);
  }

  async suggestCaption(_userId: string, dto: SuggestCaptionDto) {
    const result = await this.gemini.suggestSocialCaption({
      platform: dto.platform,
      storyTitle: dto.storyTitle,
      storyDescription: dto.storyDescription,
      existingCaption: dto.existingCaption,
      tone: dto.tone,
      maxHashtags: dto.maxHashtags ?? 8,
    });
    return {
      suggestion: result.data,
      usage: result.usage,
    };
  }

  async countByUser(userId: string) {
    return this.prisma.publishRecord.count({ where: { userId } });
  }

  private async createAndEnqueuePublication(input: {
    userId: string;
    render: VideoRender & {
      outputMediaAsset: { id: string; mimeType: string | null } | null;
      storyId: string;
    };
    channel: SocialChannel;
    fields: {
      title?: string;
      caption?: string;
      description?: string;
      hashtags?: string[];
      platformSettings?: Record<string, unknown>;
    };
    idempotencyKey: string;
  }) {
    const { userId, render, channel, fields, idempotencyKey } = input;

    const { record, generationJob } = await this.prisma.$transaction(async (tx) => {
      const generationJob = await tx.generationJob.create({
        data: {
          userId,
          storyId: render.storyId,
          jobType: GenerationJobType.PUBLISH,
          status: JobStatus.PENDING,
          provider: channel.platform.toLowerCase(),
          queueName: QUEUE_NAMES.SOCIAL_PUBLISHING,
          maxAttempts: 3,
          payload: {
            videoRenderId: render.id,
            channelId: channel.id,
            platform: channel.platform,
          } as Prisma.InputJsonValue,
        },
      });

      const record = await tx.publishRecord.create({
        data: {
          userId,
          videoRenderId: render.id,
          channelId: channel.id,
          platform: channel.platform,
          status: PublishStatus.QUEUED,
          title: fields.title ?? null,
          caption: fields.caption ?? null,
          description: fields.description ?? null,
          hashtags: fields.hashtags ?? [],
          platformSettings: (fields.platformSettings ?? {}) as Prisma.InputJsonValue,
          idempotencyKey,
          generationJobId: generationJob.id,
          uploadProgress: 0,
        },
      });

      await tx.generationJob.update({
        where: { id: generationJob.id },
        data: {
          payload: {
            publishRecordId: record.id,
            videoRenderId: render.id,
            channelId: channel.id,
            platform: channel.platform,
          } as Prisma.InputJsonValue,
        },
      });

      return { record, generationJob };
    });

    const payload: SocialPublishQueuePayload = {
      generationJobId: generationJob.id,
      publishRecordId: record.id,
      userId,
      videoRenderId: render.id,
      channelId: channel.id,
      platform: channel.platform as SocialPlatformKey,
    };

    try {
      const job = await this.queueService.getQueue(QUEUE_NAMES.SOCIAL_PUBLISHING).add(
        'publish',
        payload,
        { jobId: generationJob.id },
      );
      await this.prisma.generationJob.update({
        where: { id: generationJob.id },
        data: {
          status: JobStatus.QUEUED,
          queueJobId: job.id,
          queueName: QUEUE_NAMES.SOCIAL_PUBLISHING,
        },
      });
    } catch (error) {
      await this.prisma.publishRecord.update({
        where: { id: record.id },
        data: {
          status: PublishStatus.FAILED,
          errorCode: 'ENQUEUE_FAILED',
          errorMessage: (error as Error).message,
        },
      });
      await this.prisma.generationJob.update({
        where: { id: generationJob.id },
        data: {
          status: JobStatus.FAILED,
          errorMessage: (error as Error).message,
          completedAt: new Date(),
        },
      });
      throw error;
    }

    return this.getById(userId, record.id);
  }

  private mergeTargetFields(
    target: ChannelPublishTargetDto,
    defaults?: PublishRenderDto['defaults'],
  ) {
    return {
      title: target.title ?? defaults?.title,
      caption: target.caption ?? defaults?.caption,
      description: target.description ?? defaults?.description,
      hashtags: target.hashtags ?? defaults?.hashtags,
      platformSettings: target.platformSettings as Record<string, unknown> | undefined,
    };
  }

  private assertChannelEligible(channel: SocialChannel, mimeType: string) {
    if (!channel.isActive) {
      throw new BadRequestException(`Channel ${channel.id} is inactive`);
    }

    const capabilities = this.parseCapabilities(channel);
    const eligibleStatus =
      channel.connectionStatus === SocialConnectionStatus.PUBLIC_READY ||
      channel.connectionStatus === SocialConnectionStatus.TEST_ONLY ||
      (channel.connectionStatus === SocialConnectionStatus.CONNECTED &&
        capabilities.canPublishVideo);

    if (!eligibleStatus) {
      throw new BadRequestException(
        `Channel ${channel.id} is not eligible to publish (status: ${channel.connectionStatus})`,
      );
    }

    if (!capabilities.canPublishVideo) {
      throw new BadRequestException(`Channel ${channel.id} cannot publish video`);
    }

    if (
      capabilities.supportedMimeTypes?.length &&
      mimeType &&
      !capabilities.supportedMimeTypes.includes(mimeType) &&
      !capabilities.supportedMimeTypes.includes('application/octet-stream')
    ) {
      throw new BadRequestException(
        `MIME type ${mimeType} is not supported for ${channel.platform}`,
      );
    }
  }

  private parseCapabilities(channel: SocialChannel): PublishingCapabilities {
    const stored = channel.publishingCapabilities;
    const defaults = DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey];
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const caps = stored as Partial<PublishingCapabilities>;
      if (typeof caps.canPublishVideo === 'boolean') {
        return {
          ...defaults,
          ...caps,
          supportedMimeTypes: caps.supportedMimeTypes ?? defaults.supportedMimeTypes,
          flags: caps.flags ?? defaults.flags,
          warnings: caps.warnings ?? defaults.warnings,
          unsupportedReasons: caps.unsupportedReasons ?? defaults.unsupportedReasons,
        };
      }
    }
    return defaults;
  }

  private async requireCompletedRender(userId: string, renderId: string) {
    const render = await this.prisma.videoRender.findFirst({
      where: { id: renderId, userId },
      include: {
        outputMediaAsset: {
          select: { id: true, mimeType: true, storageKey: true, fileSize: true },
        },
      },
    });
    if (!render) {
      throw new NotFoundException('Render not found');
    }
    if (render.status !== VideoRenderStatus.COMPLETED) {
      throw new BadRequestException('Render must be COMPLETED before publishing');
    }
    if (!render.outputMediaAssetId || !render.outputMediaAsset) {
      throw new BadRequestException('Render has no output media asset');
    }
    return render;
  }

  private async requirePublication(userId: string, id: string): Promise<PublicationWithRelations> {
    const record = await this.prisma.publishRecord.findFirst({
      where: { id, userId },
      include: PUBLICATION_INCLUDE,
    });
    if (!record) {
      throw new NotFoundException('Publication not found');
    }
    return record;
  }

  private serialize(record: PublicationWithRelations | PublishRecord) {
    const full = record as PublicationWithRelations;
    return {
      id: full.id,
      userId: full.userId,
      videoProjectId: full.videoProjectId,
      videoRenderId: full.videoRenderId,
      channelId: full.channelId,
      platform: full.platform,
      status: full.status,
      title: full.title,
      caption: full.caption,
      description: full.description,
      hashtags: full.hashtags,
      platformSettings: full.platformSettings,
      providerUploadId: full.providerUploadId,
      providerPublishId: full.providerPublishId,
      providerPostId: full.providerPostId,
      externalPostId: full.externalPostId,
      postUrl: full.postUrl,
      uploadProgress: full.uploadProgress,
      errorCode: full.errorCode,
      errorMessage: full.errorMessage,
      retryCount: full.retryCount,
      idempotencyKey: full.idempotencyKey,
      generationJobId: full.generationJobId,
      scheduledAt: full.scheduledAt,
      submittedAt: full.submittedAt,
      publishedAt: full.publishedAt,
      createdAt: full.createdAt,
      updatedAt: full.updatedAt,
      channel: 'channel' in full ? full.channel : undefined,
      videoRender: 'videoRender' in full ? full.videoRender : undefined,
      videoProject: 'videoProject' in full ? full.videoProject : undefined,
      generationJob: 'generationJob' in full ? full.generationJob : undefined,
    };
  }
}
