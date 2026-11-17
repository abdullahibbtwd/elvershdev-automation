import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  DialogueLineStatus,
  EpisodeShotStatus,
  LipSyncJobStatus,
  Prisma,
} from '@prisma/client';
import {
  classifyShotProductionMethod,
  estimateDialogueEpisodeCost,
  flattenDialogueLines,
  getLipSyncCapabilities,
  isDialogueDrivenCreative,
  parseSeriesCreativeSettings,
  resolveLipSyncProviderId,
  resolveSeriesCostMode,
  validateDialogueSpeakers,
  type DialogueEpisodeScriptPlan,
} from '@ai-video/shared';
import { GeminiTtsProvider } from '../../integrations/providers/gemini-tts.provider';
import { LipSyncProvider } from '../../integrations/providers/lip-sync.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { CharacterVoiceService } from './character-voice.service';
import { SeriesConfigService } from './series-config.service';

@Injectable()
export class DialogueProductionService {
  private readonly logger = new Logger(DialogueProductionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly voices: CharacterVoiceService,
    private readonly lipSync: LipSyncProvider,
    private readonly tts: GeminiTtsProvider,
    private readonly storage: StorageService,
    private readonly configService: SeriesConfigService,
  ) {}

  async isDialogueDrivenForEpisode(userId: string, seriesId: string): Promise<boolean> {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      select: { metadata: true, laneId: true },
    });
    if (!series) return false;
    const config = await this.configService.getOrCreate(userId);
    const lane = series.laneId
      ? await this.prisma.seriesLane.findFirst({
          where: { id: series.laneId, userId },
          select: { creativeSettings: true },
        })
      : null;
    const seriesMeta = (series.metadata ?? {}) as Record<string, unknown>;
    const settings = parseSeriesCreativeSettings(
      seriesMeta.creativeSettingsSnapshot ??
        lane?.creativeSettings ??
        config.creativeSettings ??
        {},
    );
    return isDialogueDrivenCreative(settings);
  }

  /**
   * Persist structured dialogue lines + shots from a dialogue script plan.
   * Idempotent per episode (deletes prior draft rows when force=true).
   */
  async materializeDialoguePlan(
    userId: string,
    episodeId: string,
    plan: DialogueEpisodeScriptPlan,
    options?: { force?: boolean },
  ) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, series: { userId } },
      include: { series: { include: { characters: true } } },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    const characterNames = episode.series.characters.map((c) => c.name);
    const speakerErrors = validateDialogueSpeakers(plan, characterNames);
    if (speakerErrors.length) {
      throw new BadRequestException({
        message: 'Dialogue plan failed speaker validation',
        errors: speakerErrors,
      });
    }

    await this.voices.assignVoicesForSeries(userId, episode.seriesId);
    const voiceMap = await this.voices.getVoiceMap(episode.seriesId);

    const lane = await this.prisma.seriesLane.findFirst({
      where: { id: episode.series.laneId, userId },
      select: { creativeSettings: true },
    });
    const seriesMeta = (episode.series as { metadata?: unknown }).metadata;
    const creative = parseSeriesCreativeSettings(
      ((seriesMeta as Record<string, unknown> | null)?.creativeSettingsSnapshot as unknown) ??
        lane?.creativeSettings ??
        {},
    );
    const costMode = resolveSeriesCostMode(creative.costMode);

    if (options?.force) {
      await this.prisma.lipSyncJob.deleteMany({ where: { episodeId } });
      await this.prisma.episodeShot.deleteMany({ where: { episodeId } });
      await this.prisma.episodeDialogueLine.deleteMany({ where: { episodeId } });
    }

    const existingLines = await this.prisma.episodeDialogueLine.count({
      where: { episodeId },
    });
    if (existingLines > 0 && !options?.force) {
      return {
        reused: true,
        lineCount: existingLines,
        shotCount: await this.prisma.episodeShot.count({ where: { episodeId } }),
      };
    }

    let lineOrderGlobal = 0;
    let cursorMs = 0;

    for (const scene of plan.scenes) {
      for (const shot of scene.shots) {
        const hasDialogue = Boolean(shot.dialogue.trim());
        let dialogueLineId: string | null = null;

        if (hasDialogue) {
          lineOrderGlobal += 1;
          const voice = voiceMap.get(shot.speaker.toLowerCase());
          const durationSeconds = shot.durationSeconds;
          const startMs = cursorMs;
          const endMs = cursorMs + Math.round(durationSeconds * 1000);
          cursorMs = endMs;

          const line = await this.prisma.episodeDialogueLine.create({
            data: {
              userId,
              episodeId,
              sceneOrder: scene.sceneNumber,
              shotOrder: shot.shotOrder,
              lineOrder: lineOrderGlobal,
              speakerName: shot.speaker,
              seriesCharacterId: voice?.characterId,
              voiceProfileId: voice?.voiceProfileId,
              text: shot.dialogue.trim(),
              emotion: shot.emotion,
              speakingStyle: this.voices.speakingStyleFor(
                voice?.speakingStyle || 'natural conversational',
                shot.emotion,
              ),
              status: DialogueLineStatus.AUDIO_PENDING,
              durationSeconds,
              startMs,
              endMs,
              idempotencyKey: `${episodeId}:line:${scene.sceneNumber}:${shot.shotOrder}:${lineOrderGlobal}`,
              metadata: {
                facialExpression: shot.facialExpression,
                bodyLanguage: shot.bodyLanguage,
                listeners: shot.listeners,
              } as Prisma.InputJsonValue,
            },
          });
          dialogueLineId = line.id;
        } else {
          cursorMs += Math.round(shot.durationSeconds * 1000);
        }

        const requiresLipSync = hasDialogue ? true : Boolean(shot.requiresLipSync);
        const productionMethod = classifyShotProductionMethod(
          {
            shotType: shot.shotType,
            dialogue: shot.dialogue,
            durationSeconds: shot.durationSeconds,
            requiresLipSync,
            speaker: shot.speaker,
          },
          costMode,
        );

        await this.prisma.episodeShot.create({
          data: {
            userId,
            episodeId,
            sceneOrder: scene.sceneNumber,
            shotOrder: shot.shotOrder,
            shotType: shot.shotType,
            speakerName: shot.speaker,
            dialogueLineId,
            charactersVisible: shot.charactersVisible as Prisma.InputJsonValue,
            cameraDirection: shot.cameraDirection,
            cameraMovement: shot.cameraMovement,
            facialExpression: shot.facialExpression,
            bodyLanguage: shot.bodyLanguage,
            environment: shot.environment,
            lighting: shot.lighting,
            durationSeconds: shot.durationSeconds,
            requiresLipSync,
            status: EpisodeShotStatus.PLANNED,
            prompt: [
              `Semi-realistic cinematic 3D animation still.`,
              `${shot.shotType.replace(/_/g, ' ')} of ${shot.charactersVisible.join(' and ')}.`,
              shot.facialExpression,
              shot.bodyLanguage,
              shot.environment,
              shot.lighting,
              shot.cameraDirection,
            ].join(' '),
            idempotencyKey: `${episodeId}:shot:${scene.sceneNumber}:${shot.shotOrder}`,
            metadata: {
              ambientSound: shot.ambientSound,
              musicDirection: shot.musicDirection,
              productionMethod,
              costMode,
            } as Prisma.InputJsonValue,
          },
        });
      }
    }

    const lines = flattenDialogueLines(plan);
    const flatShots = plan.scenes.flatMap((s) => s.shots);
    const costEstimate = estimateDialogueEpisodeCost({
      mode: costMode,
      episodeTargetSeconds: episode.targetDurationSeconds ?? 50,
      shots: flatShots.map((s) => ({
        shotType: s.shotType,
        dialogue: s.dialogue,
        durationSeconds: s.durationSeconds,
        requiresLipSync: Boolean(s.dialogue.trim()) || Boolean(s.requiresLipSync),
        speaker: s.speaker,
      })),
      newPortraitCount: 0,
    });
    await this.prisma.seriesEpisode.update({
      where: { id: episodeId },
      data: {
        metadata: {
          ...((episode.metadata as Record<string, unknown> | null) ?? {}),
          dialogueDriven: true,
          dialogueLineCount: lines.length,
          shotCount: plan.scenes.reduce((n, s) => n + s.shots.length, 0),
          costMode,
          costEstimate,
        } as Prisma.InputJsonValue,
      },
    });

    return {
      reused: false,
      lineCount: lines.length,
      shotCount: plan.scenes.reduce((n, s) => n + s.shots.length, 0),
      costEstimate,
    };
  }

  async ensureVoiceAssignment(userId: string, seriesId: string) {
    return this.voices.assignVoicesForSeries(userId, seriesId);
  }

  /**
   * Generate per-line dialogue audio with Gemini TTS (real unless explicitly mocked).
   * Uploads WAV bytes to MinIO and stores MediaAsset references.
   */
  async generateDialogueAudioForEpisode(
    userId: string,
    episodeId: string,
    options?: { useMockAi?: boolean },
  ) {
    const lines = await this.prisma.episodeDialogueLine.findMany({
      where: {
        userId,
        episodeId,
        status: { in: [DialogueLineStatus.DRAFT, DialogueLineStatus.AUDIO_PENDING] },
      },
      include: { voiceProfile: true },
      orderBy: [{ sceneOrder: 'asc' }, { shotOrder: 'asc' }, { lineOrder: 'asc' }],
    });

    const forceMock = options?.useMockAi === true;
    const updated = [];
    let anyMocked = false;

    for (const line of lines) {
      const voiceId =
        line.voiceProfile?.providerVoiceId ||
        (typeof (line.metadata as Record<string, unknown> | null)?.providerVoiceId === 'string'
          ? ((line.metadata as Record<string, unknown>).providerVoiceId as string)
          : undefined);

      const speech = await this.tts.generateSpeech({
        text: line.text,
        voiceId,
        speakingStyle: line.speakingStyle || undefined,
        forceMock,
      });
      anyMocked = anyMocked || speech.mocked;
      if (speech.mocked && !forceMock) {
        throw new Error(
          `Dialogue TTS returned mocked audio for line ${line.id} while real mode was required`,
        );
      }

      const storageKey = `series/dialogue/${episodeId}/${line.id}.wav`;
      await this.storage.uploadObject(
        storageKey,
        Buffer.from(speech.audioBytes),
        speech.mimeType,
      );

      const asset = await this.prisma.mediaAsset.create({
        data: {
          userId,
          type: 'AUDIO',
          storageKey,
          originalName: `${line.speakerName}-${line.lineOrder}.wav`,
          mimeType: speech.mimeType,
          fileSize: BigInt(speech.audioBytes.byteLength),
          metadata: {
            mocked: speech.mocked,
            dialogueLineId: line.id,
            speaker: line.speakerName,
            durationSeconds: speech.durationSeconds,
            provider: 'gemini',
            voiceId: speech.voiceId,
            model: speech.model,
          } as Prisma.InputJsonValue,
        },
      });

      const row = await this.prisma.episodeDialogueLine.update({
        where: { id: line.id },
        data: {
          status: DialogueLineStatus.AUDIO_READY,
          audioMediaAssetId: asset.id,
          durationSeconds: speech.durationSeconds,
          provider: 'gemini',
          providerModel: speech.model,
          actualCostUsd: speech.estimatedCostUsd,
          estimatedCostUsd: speech.estimatedCostUsd,
        },
      });

      if (!speech.mocked && speech.estimatedCostUsd > 0) {
        await this.prisma.providerUsage.create({
          data: {
            userId,
            provider: 'gemini',
            model: speech.model,
            requestType: 'dialogue_tts',
            estimatedCost: speech.estimatedCostUsd,
            metadata: {
              episodeId,
              dialogueLineId: line.id,
              speaker: line.speakerName,
              durationSeconds: speech.durationSeconds,
              voiceId: speech.voiceId,
              costKind: 'estimated',
            } as Prisma.InputJsonValue,
          },
        });
      }

      updated.push(row);
    }

    return { updated: updated.length, mocked: anyMocked };
  }

  /**
   * Create lip-sync jobs for every speaking shot that has audio + still ready.
   * Actual fal generation is performed by processLipSyncJobs / worker.
   */
  /**
   * Ensure each speaking shot has a still image (character reference portrait).
   */
  async ensureShotStillsFromCharacterRefs(userId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, series: { userId } },
      include: {
        shots: true,
        series: {
          include: {
            characters: {
              include: {
                referenceAssets: {
                  where: { isApproved: true },
                  orderBy: [{ isPrimary: 'desc' }, { version: 'desc' }],
                },
              },
            },
          },
        },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    const byName = new Map(
      episode.series.characters.map((c) => [
        c.name.toLowerCase(),
        c.referenceAssets[0]?.mediaAssetId,
      ]),
    );

    let updated = 0;
    for (const shot of episode.shots) {
      if (shot.stillMediaAssetId) continue;
      const speaker = shot.speakerName?.toLowerCase();
      const mediaAssetId = speaker ? byName.get(speaker) : undefined;
      if (!mediaAssetId) continue;
      await this.prisma.episodeShot.update({
        where: { id: shot.id },
        data: {
          stillMediaAssetId: mediaAssetId,
          status: EpisodeShotStatus.STILL_READY,
        },
      });
      updated += 1;
    }
    return { updated };
  }

  async createLipSyncJobs(userId: string, episodeId: string, options?: { force?: boolean }) {
    await this.ensureShotStillsFromCharacterRefs(userId, episodeId);

    const shots = await this.prisma.episodeShot.findMany({
      where: { episodeId, userId, requiresLipSync: true },
      include: { dialogueLine: true },
      orderBy: [{ sceneOrder: 'asc' }, { shotOrder: 'asc' }],
    });

    const forceMock = this.lipSync.shouldUseMock();
    if (forceMock && process.env.LIP_SYNC_USE_MOCK !== 'true' && process.env.NODE_ENV !== 'test') {
      throw new BadRequestException(
        'Lip-sync is not configured for real providers (need FAL_API_KEY and LIP_SYNC_USE_MOCK=false)',
      );
    }

    const providerId = forceMock ? 'mock' : this.lipSync.resolveProviderId(false);
    const caps = getLipSyncCapabilities(providerId);

    const created = [];
    for (const shot of shots) {
      if (!shot.dialogueLineId || !shot.dialogueLine) continue;
      const line = shot.dialogueLine;
      if (!line.audioMediaAssetId) {
        throw new BadRequestException(
          `Dialogue line ${line.id} missing audio before lip-sync`,
        );
      }
      if (!shot.stillMediaAssetId) {
        throw new BadRequestException(
          `Shot ${shot.id} (speaker=${shot.speakerName}) missing still image / character reference before lip-sync`,
        );
      }

      const idempotencyKey = `${episodeId}:lipsync:${shot.id}`;
      if (!options?.force) {
        const existing = await this.prisma.lipSyncJob.findFirst({
          where: { idempotencyKey, status: { not: LipSyncJobStatus.FAILED } },
        });
        if (existing) {
          created.push(existing);
          continue;
        }
      } else {
        await this.prisma.lipSyncJob.deleteMany({ where: { idempotencyKey } });
      }

      const job = await this.prisma.lipSyncJob.create({
        data: {
          userId,
          episodeId,
          episodeShotId: shot.id,
          dialogueLineId: line.id,
          provider: caps.providerId,
          providerModel: caps.endpointId,
          status: LipSyncJobStatus.PENDING,
          sourceImageAssetId: shot.stillMediaAssetId,
          sourceAudioAssetId: line.audioMediaAssetId,
          durationSeconds: line.durationSeconds ?? shot.durationSeconds,
          estimatedCostUsd: this.lipSync.estimateCost(
            line.durationSeconds ?? shot.durationSeconds,
            caps.providerId,
          ),
          mocked: forceMock,
          idempotencyKey,
        },
      });
      created.push(job);
    }

    return created;
  }

  private async readMediaAssetBytes(mediaAssetId: string): Promise<{
    bytes: Buffer;
    mimeType: string;
    storageKey: string;
  }> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaAssetId } });
    if (!asset) throw new Error(`MediaAsset ${mediaAssetId} not found`);
    const stream = await this.storage.getObjectStream(asset.storageKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream.body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return {
      bytes: Buffer.concat(chunks),
      mimeType: asset.mimeType || stream.contentType || 'application/octet-stream',
      storageKey: asset.storageKey,
    };
  }

  async processPendingLipSyncJobs(
    userId: string,
    episodeId: string,
    options?: { forceMock?: boolean; limit?: number },
  ) {
    const forceMock = options?.forceMock === true;
    const jobs = await this.prisma.lipSyncJob.findMany({
      where: {
        userId,
        episodeId,
        status: { in: [LipSyncJobStatus.PENDING, LipSyncJobStatus.QUEUED] },
      },
      include: {
        episodeShot: true,
        dialogueLine: true,
      },
      take: options?.limit ?? 20,
      orderBy: { createdAt: 'asc' },
    });

    const results = [];
    for (const job of jobs) {
      try {
        await this.prisma.lipSyncJob.update({
          where: { id: job.id },
          data: {
            status: LipSyncJobStatus.GENERATING,
            startedAt: new Date(),
            progress: 10,
          },
        });

        let imageUrl = job.sourceImageUrl || undefined;
        let audioUrl = job.sourceAudioUrl || undefined;

        if (!forceMock) {
          // Always upload local assets to fal.storage so fal can fetch them.
          if (job.sourceImageAssetId) {
            const image = await this.readMediaAssetBytes(job.sourceImageAssetId);
            imageUrl = await this.lipSync.uploadMediaBytes(
              image.bytes,
              `lipsync-image-${job.id}.png`,
              image.mimeType || 'image/png',
            );
          }
          if (job.sourceAudioAssetId) {
            const audio = await this.readMediaAssetBytes(job.sourceAudioAssetId);
            audioUrl = await this.lipSync.uploadMediaBytes(
              audio.bytes,
              `lipsync-audio-${job.id}.wav`,
              audio.mimeType || 'audio/wav',
            );
          }
        }

        if (!imageUrl || !audioUrl) {
          throw new Error(
            'Lip-sync job missing source image/audio after asset resolution (need still + dialogue audio)',
          );
        }

        await this.prisma.lipSyncJob.update({
          where: { id: job.id },
          data: {
            sourceImageUrl: imageUrl,
            sourceAudioUrl: audioUrl,
            progress: 40,
          },
        });

        const emotion = job.dialogueLine?.emotion || undefined;
        const generated = await this.lipSync.generate(
          {
            imageUrl,
            audioUrl,
            emotion,
            prompt: job.episodeShot?.facialExpression
              ? `Character speaking. Expression: ${job.episodeShot.facialExpression}. Body: ${job.episodeShot.bodyLanguage || 'natural'}.`
              : undefined,
          },
          {
            forceMock,
            durationHintSeconds: job.durationSeconds ?? 4,
          },
        );

        if (generated.mocked && !forceMock) {
          throw new Error(
            `Lip-sync job ${job.id} returned mocked output while real mode was required`,
          );
        }

        let outputMediaAssetId: string | undefined;
        if (!generated.mocked && generated.videoUrl.startsWith('http')) {
          await this.prisma.lipSyncJob.update({
            where: { id: job.id },
            data: { status: LipSyncJobStatus.DOWNLOADING, progress: 70 },
          });
          const videoBytes = await this.lipSync.downloadResult(generated.videoUrl);
          const storageKey = `series/lipsync/${episodeId}/${job.id}.mp4`;
          await this.storage.uploadObject(storageKey, videoBytes, 'video/mp4');
          const output = await this.prisma.mediaAsset.create({
            data: {
              userId,
              type: 'VIDEO',
              storageKey,
              originalName: `${job.id}.mp4`,
              mimeType: 'video/mp4',
              fileSize: BigInt(videoBytes.byteLength),
              metadata: {
                lipSyncJobId: job.id,
                provider: generated.providerId,
                endpointId: generated.endpointId,
                mocked: false,
                sourceVideoUrl: generated.videoUrl,
                durationSeconds: generated.durationSeconds,
              } as Prisma.InputJsonValue,
            },
          });
          outputMediaAssetId = output.id;
        }

        await this.prisma.lipSyncJob.update({
          where: { id: job.id },
          data: {
            status: LipSyncJobStatus.COMPLETED,
            progress: 100,
            mocked: generated.mocked,
            providerRequestId: generated.requestId,
            durationSeconds: generated.durationSeconds,
            actualCostUsd: generated.estimatedCostUsd,
            outputMediaAssetId,
            providerMetadata: {
              videoUrl: generated.videoUrl,
              endpointId: generated.endpointId,
              mocked: generated.mocked,
              requestId: generated.requestId,
            } as Prisma.InputJsonValue,
            completedAt: new Date(),
          },
        });

        if (!generated.mocked && generated.estimatedCostUsd > 0) {
          await this.prisma.providerUsage.create({
            data: {
              userId,
              provider: 'fal',
              model: generated.endpointId || generated.providerId,
              requestType: 'lip_sync_avatar',
              estimatedCost: generated.estimatedCostUsd,
              metadata: {
                episodeId,
                lipSyncJobId: job.id,
                providerId: generated.providerId,
                requestId: generated.requestId,
                durationSeconds: generated.durationSeconds,
                costKind: 'estimated',
              } as Prisma.InputJsonValue,
            },
          });
        }

        if (job.episodeShotId) {
          await this.prisma.episodeShot.update({
            where: { id: job.episodeShotId },
            data: {
              status: EpisodeShotStatus.READY,
              videoMediaAssetId: outputMediaAssetId,
              actualCostUsd: generated.estimatedCostUsd,
              metadata: {
                ...((job.episodeShot?.metadata as Record<string, unknown> | null) ?? {}),
                lipSyncVideoUrl: generated.videoUrl,
                lipSyncMocked: generated.mocked,
                lipSyncProvider: generated.providerId,
              } as Prisma.InputJsonValue,
            },
          });
        }
        if (job.dialogueLineId) {
          await this.prisma.episodeDialogueLine.update({
            where: { id: job.dialogueLineId },
            data: { status: DialogueLineStatus.LIP_SYNC_READY },
          });
        }

        results.push({
          id: job.id,
          status: 'completed',
          mocked: generated.mocked,
          videoUrl: generated.videoUrl,
          outputMediaAssetId,
          provider: generated.providerId,
          costUsd: generated.estimatedCostUsd,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Lip-sync job ${job.id} failed: ${message}`);
        await this.prisma.lipSyncJob.update({
          where: { id: job.id },
          data: {
            status: LipSyncJobStatus.FAILED,
            errorMessage: message,
            retryCount: { increment: 1 },
          },
        });
        results.push({ id: job.id, status: 'failed', error: message });
      }
    }

    return results;
  }

  async evaluateDialogueQuality(userId: string, episodeId: string) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, series: { userId } },
      include: {
        dialogueLines: true,
        shots: true,
        lipSyncJobs: true,
        series: { include: { characters: { include: { characterVoice: true } } } },
      },
    });
    if (!episode) {
      return {
        passed: false,
        checks: [{ id: 'episode', passed: false, hard: true, detail: 'missing' }],
      };
    }

    const meta = (episode.metadata ?? {}) as Record<string, unknown>;
    const dialogueDriven = meta.dialogueDriven === true;
    const checks: Array<{ id: string; passed: boolean; hard?: boolean; detail: string }> = [];

    if (!dialogueDriven) {
      return { passed: true, checks: [{ id: 'dialogue_mode', passed: true, detail: 'not dialogue-driven' }] };
    }

    const speakingLines = episode.dialogueLines.filter((l) => l.text.trim());
    checks.push({
      id: 'dialogue_lines_have_speakers',
      passed: speakingLines.every((l) => Boolean(l.speakerName?.trim())),
      hard: true,
      detail: `${speakingLines.length} speaking lines`,
    });

    const speakers = new Set(speakingLines.map((l) => l.speakerName.toLowerCase()));
    checks.push({
      id: 'min_two_speakers',
      passed: speakers.size >= 2,
      hard: true,
      detail: `${speakers.size} speakers`,
    });

    const voicesAssigned = episode.series.characters.every(
      (c) => !speakingLines.some((l) => l.speakerName.toLowerCase() === c.name.toLowerCase()) ||
        Boolean(c.characterVoice),
    );
    checks.push({
      id: 'voices_assigned',
      passed: voicesAssigned,
      hard: true,
      detail: voicesAssigned ? 'All speaking characters have voices' : 'Missing character voices',
    });

    const audioReady = speakingLines.every(
      (l) => l.audioMediaAssetId || l.status === DialogueLineStatus.AUDIO_READY || l.status === DialogueLineStatus.LIP_SYNC_READY,
    );
    checks.push({
      id: 'dialogue_audio_exists',
      passed: audioReady || speakingLines.every((l) => l.status !== DialogueLineStatus.FAILED),
      hard: true,
      detail: `Audio status for ${speakingLines.length} lines`,
    });

    const requiredLipSync = episode.shots.filter((s) => s.requiresLipSync);
    const lipSyncDone = requiredLipSync.every((s) =>
      episode.lipSyncJobs.some(
        (j) =>
          j.episodeShotId === s.id &&
          j.status === LipSyncJobStatus.COMPLETED &&
          // Real-provider gate: mock jobs fail hard check unless explicitly allowed.
          (j.mocked === false || process.env.LIP_SYNC_USE_MOCK === 'true'),
      ),
    );
    checks.push({
      id: 'lip_sync_required',
      passed: requiredLipSync.length === 0 || lipSyncDone,
      hard: true,
      detail: `${requiredLipSync.length} lip-sync shots`,
    });

    const duration = episode.actualDurationSeconds;
    const target = episode.targetDurationSeconds || 60;
    const durationOk =
      typeof duration !== 'number' ||
      (duration >= Math.min(40, target * 0.6) && duration <= Math.max(60, target * 1.25));
    checks.push({
      id: 'duration_range',
      passed: durationOk,
      hard: false,
      detail: duration != null ? `${duration}s (target ${target}s)` : 'duration pending',
    });

    const hardFailed = checks.some((c) => c.hard && !c.passed);
    return { passed: !hardFailed, checks };
  }

  getConfiguredLipSyncProvider() {
    return {
      providerId: resolveLipSyncProviderId(process.env),
      capabilities: getLipSyncCapabilities(resolveLipSyncProviderId(process.env)),
      mock: this.lipSync.shouldUseMock(),
      validation: this.lipSync.validateConfiguration(),
    };
  }
}
