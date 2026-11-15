import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  AudioGenerationStatus,
  NarrationScriptStatus,
  SceneNarrationStatus,
} from '@prisma/client';
import { NarrationService } from './narration.service';

describe('NarrationService', () => {
  const userId = 'user-1';
  const storyId = 'story-1';
  const sceneId = 'scene-1';
  const scriptId = 'script-1';
  const sceneNarrationId = 'sn-1';

  function createService(overrides?: {
    config?: Record<string, unknown>;
    script?: unknown;
    scriptsByStatus?: { approved?: unknown; ready?: unknown };
    usages?: Array<{ estimatedCost: number }>;
    activeVoiceJobs?: number;
    enqueue?: jest.Mock;
  }) {
    const sceneNarration = {
      id: sceneNarrationId,
      narrationScriptId: scriptId,
      storyId,
      sceneId,
      sequence: 1,
      text: 'Dawn broke over the workshop.',
      emotionalTone: 'warm',
      speakingStyle: 'calm and measured',
      estimatedDuration: 4,
      status: SceneNarrationStatus.APPROVED,
      scene: { sceneNumber: 1 },
    };
    const approvedScript = {
      id: scriptId,
      userId,
      storyId,
      version: 1,
      status: NarrationScriptStatus.APPROVED,
      fullText: 'Dawn broke over the workshop.',
      scenes: [sceneNarration],
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prisma: Record<string, any> = {
      story: {
        findFirst: jest.fn().mockResolvedValue({ id: storyId, userId, scenes: [{ id: sceneId }] }),
        update: jest.fn().mockResolvedValue({}),
      },
      storyScene: {
        findFirst: jest.fn().mockResolvedValue({ id: sceneId, storyId }),
      },
      narrationScript: {
        findFirst: jest.fn().mockImplementation(async ({ where }: { where: { status?: string; id?: string } }) => {
          if (where.id) {
            return overrides?.script ?? { ...approvedScript, scenes: [] };
          }
          if (where.status === NarrationScriptStatus.APPROVED) {
            return overrides?.scriptsByStatus && 'approved' in overrides.scriptsByStatus
              ? overrides.scriptsByStatus.approved
              : approvedScript;
          }
          if (where.status === NarrationScriptStatus.READY) {
            return overrides?.scriptsByStatus?.ready ?? null;
          }
          return null; // latest version lookup
        }),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: scriptId,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
      },
      sceneNarration: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      audioGeneration: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockImplementation(async ({ data }) => ({
          id: 'audio-1',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        })),
        update: jest.fn().mockResolvedValue({}),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      voiceProfile: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'vp-1', ...data })),
        update: jest.fn().mockImplementation(async ({ data }) => ({ id: 'vp-1', ...data })),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        delete: jest.fn().mockResolvedValue({}),
      },
      generationJob: {
        create: jest.fn().mockResolvedValue({
          id: 'job-1',
          status: 'PENDING',
          progress: 0,
          jobType: 'VOICE',
        }),
        update: jest.fn().mockResolvedValue({
          id: 'job-1',
          status: 'QUEUED',
          progress: 0,
          jobType: 'VOICE',
          queueJobId: 'bull-1',
        }),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(overrides?.activeVoiceJobs ?? 0),
      },
      providerUsage: {
        findMany: jest.fn().mockResolvedValue(overrides?.usages ?? []),
      },
      $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
    };

    const queueService = {
      enqueueGenerationJob:
        overrides?.enqueue ??
        jest.fn().mockResolvedValue({
          job: { id: 'bull-1' },
          queueName: 'speech-generation',
        }),
    };

    const storage = {
      getPresignedDownloadUrl: jest.fn().mockResolvedValue('https://example.com/audio.wav'),
    };

    const jobsService = {
      getById: jest.fn(),
      retry: jest.fn(),
      cancel: jest.fn(),
    };

    const configMap: Record<string, unknown> = {
      'integrations.geminiTtsModel': 'gemini-3.8-flash-lite-tts',
      'integrations.geminiTtsCurrency': 'USD',
      'integrations.geminiTtsDefaultVoice': 'Kore',
      'integrations.geminiTtsMaxConcurrency': 2,
      'integrations.geminiTtsMaxCharacters': 4000,
      'integrations.geminiTtsMaxAudioDurationSeconds': 120,
      'integrations.geminiTtsMaxAttemptsPerScene': 10,
      'integrations.geminiUseMock': 'true',
      ...overrides?.config,
    };
    const config = {
      get: jest.fn((key: string, fallback?: unknown) => configMap[key] ?? fallback),
    };

    const service = new NarrationService(
      prisma as never,
      queueService as never,
      storage as never,
      jobsService as never,
      config as never,
    );

    return { service, prisma, queueService, storage, jobsService };
  }

  describe('planNarration', () => {
    it('creates a PLANNING script and enqueues a NARRATION_PLANNING job', async () => {
      const { service, prisma, queueService } = createService();
      prisma.narrationScript.findFirst.mockResolvedValueOnce({ version: 2 });

      const result = await service.planNarration(userId, storyId, { regenerate: true });

      expect(prisma.narrationScript.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          storyId,
          version: 3,
          status: NarrationScriptStatus.PLANNING,
        }),
      });
      expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
        'NARRATION_PLANNING',
        expect.objectContaining({
          storyId,
          narrationScriptId: scriptId,
          jobType: 'NARRATION_PLANNING',
          useMockAi: true,
          payload: expect.objectContaining({
            action: 'plan_narration',
            narrationScriptId: scriptId,
            regenerate: true,
            simulateFailure: false,
          }),
        }),
        expect.any(Object),
      );
      expect(result.job.status).toBe('QUEUED');
    });

    it('rejects when a planning job is already active', async () => {
      const { service, prisma } = createService();
      prisma.generationJob.findFirst.mockResolvedValueOnce({ id: 'active-job' });
      await expect(service.planNarration(userId, storyId, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects stories without scenes', async () => {
      const { service, prisma } = createService();
      prisma.story.findFirst.mockResolvedValue({ id: storyId, userId, scenes: [] });
      await expect(service.planNarration(userId, storyId, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('marks script failed when enqueue fails', async () => {
      const enqueue = jest.fn().mockRejectedValue(new Error('redis down'));
      const { service, prisma } = createService({ enqueue });
      await expect(service.planNarration(userId, storyId, {})).rejects.toThrow('redis down');
      expect(prisma.narrationScript.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: NarrationScriptStatus.FAILED }),
        }),
      );
    });
  });

  describe('ownership', () => {
    it('returns not found for foreign stories', async () => {
      const { service, prisma } = createService();
      prisma.story.findFirst.mockResolvedValue(null);
      await expect(service.getNarration(userId, storyId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getProgress(userId, storyId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.listStoryAudio(userId, storyId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns not found for foreign scenes, scripts, audio and voice profiles', async () => {
      const { service, prisma } = createService();
      prisma.storyScene.findFirst.mockResolvedValue(null);
      prisma.narrationScript.findFirst.mockResolvedValue(null);
      prisma.audioGeneration.findFirst.mockResolvedValue(null);
      prisma.voiceProfile.findFirst.mockResolvedValue(null);

      await expect(service.listSceneAudio(userId, sceneId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.generateSceneAudio(userId, sceneId, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.approveScript(userId, scriptId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.updateScript(userId, scriptId, {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.getAudio(userId, 'audio-1')).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.retryAudio(userId, 'audio-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.selectAudio(userId, 'audio-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.updateVoiceProfile(userId, 'vp-1', {})).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(service.deleteVoiceProfile(userId, 'vp-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('scopes ownership lookups by userId', async () => {
      const { service, prisma } = createService();
      prisma.narrationScript.findFirst.mockResolvedValue(null);
      await expect(service.approveScript(userId, scriptId)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.narrationScript.findFirst).toHaveBeenCalledWith({
        where: { id: scriptId, userId },
      });
    });
  });

  describe('approveScript', () => {
    it('only approves READY scripts', async () => {
      const { service } = createService({
        script: { id: scriptId, userId, storyId, status: NarrationScriptStatus.DRAFT },
      });
      await expect(service.approveScript(userId, scriptId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('approves READY scripts, approves scenes and updates the story narration', async () => {
      const { service, prisma } = createService({
        script: {
          id: scriptId,
          userId,
          storyId,
          version: 1,
          status: NarrationScriptStatus.READY,
          fullText: 'Full narration',
          scenes: [],
        },
      });

      await service.approveScript(userId, scriptId);

      expect(prisma.narrationScript.update).toHaveBeenCalledWith({
        where: { id: scriptId },
        data: expect.objectContaining({ status: NarrationScriptStatus.APPROVED }),
      });
      expect(prisma.sceneNarration.updateMany).toHaveBeenCalledWith({
        where: { narrationScriptId: scriptId },
        data: { status: SceneNarrationStatus.APPROVED },
      });
      expect(prisma.story.update).toHaveBeenCalledWith({
        where: { id: storyId },
        data: { narrationScript: 'Full narration' },
      });
    });
  });

  describe('generateStoryAudio', () => {
    it('requires an approved or ready narration script', async () => {
      const { service } = createService({ scriptsByStatus: { approved: null, ready: null } });
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('creates pending audio with idempotency key and enqueues a VOICE job', async () => {
      const { service, prisma, queueService } = createService();

      const result = await service.generateStoryAudio(userId, storyId, {
        providerVoiceId: 'Puck',
      });

      expect(prisma.audioGeneration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          sceneId,
          sceneNarrationId,
          status: AudioGenerationStatus.PENDING,
          providerVoiceId: 'Puck',
          voiceProfileId: null,
          attemptNumber: 1,
          idempotencyKey: `audio:${sceneNarrationId}:Puck:v1`,
        }),
      });
      expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
        'VOICE',
        expect.objectContaining({
          storyId,
          narrationScriptId: scriptId,
          jobType: 'VOICE',
          payload: expect.objectContaining({
            action: 'generate_speech',
            audioGenerationIds: ['audio-1'],
          }),
        }),
        expect.any(Object),
      );
      expect(result.job?.status).toBe('QUEUED');
      expect(result.audioGenerations).toHaveLength(1);
      expect(result.skippedSceneIds).toEqual([]);
    });

    it('falls back to the READY script when none is approved', async () => {
      const { service, prisma } = createService({
        scriptsByStatus: {
          approved: null,
          ready: {
            id: 'script-ready',
            userId,
            storyId,
            status: NarrationScriptStatus.READY,
            scenes: [
              {
                id: sceneNarrationId,
                sceneId,
                sequence: 1,
                text: 'Hello',
                speakingStyle: 'calm',
                estimatedDuration: 2,
              },
            ],
          },
        },
      });
      await service.generateStoryAudio(userId, storyId, {});
      expect(prisma.audioGeneration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ narrationScriptId: 'script-ready' }),
      });
    });

    it('skips scenes that already have completed audio unless forced', async () => {
      const { service, prisma, queueService } = createService();
      prisma.audioGeneration.findFirst.mockImplementation(
        async ({ where }: { where: { status?: unknown } }) =>
          where.status === AudioGenerationStatus.COMPLETED ? { id: 'done' } : null,
      );

      const skipped = await service.generateStoryAudio(userId, storyId, {});
      expect(skipped.job).toBeNull();
      expect(skipped.skippedSceneIds).toEqual([sceneId]);
      expect(prisma.audioGeneration.create).not.toHaveBeenCalled();
      expect(queueService.enqueueGenerationJob).not.toHaveBeenCalled();

      const forced = await service.generateStoryAudio(userId, storyId, { forceRegenerate: true });
      expect(forced.job).not.toBeNull();
      expect(prisma.audioGeneration.create).toHaveBeenCalledTimes(1);
    });

    it('rejects unsupported voice ids', async () => {
      const { service } = createService();
      await expect(
        service.generateStoryAudio(userId, storyId, { providerVoiceId: 'NotAVoice' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses the user default voice profile when no voice is supplied', async () => {
      const { service, prisma } = createService();
      prisma.voiceProfile.findFirst.mockResolvedValue({
        id: 'vp-default',
        providerVoiceId: 'Charon',
        configuration: { speakingStyle: 'documentary' },
      });
      await service.generateStoryAudio(userId, storyId, {});
      expect(prisma.audioGeneration.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          voiceProfileId: 'vp-default',
          providerVoiceId: 'Charon',
        }),
      });
    });

    it('rejects when a scene already has active audio generation', async () => {
      const { service, prisma } = createService();
      prisma.audioGeneration.findFirst.mockResolvedValueOnce({ id: 'active' });
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects scene ids that do not belong to the story', async () => {
      const { service } = createService();
      await expect(
        service.generateStoryAudio(userId, storyId, {
          sceneIds: ['22222222-2222-4222-8222-222222222222'],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('guards', () => {
    it('rejects when the monthly TTS budget would be exceeded', async () => {
      const { service, prisma, queueService } = createService({
        config: { 'integrations.geminiTtsMaxMonthlySpendUsd': '1.00' },
        usages: [{ estimatedCost: 0.9999999 }, { estimatedCost: 0.5 }],
      });

      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toThrow(
        /Monthly Gemini TTS budget/,
      );
      expect(prisma.audioGeneration.create).not.toHaveBeenCalled();
      expect(queueService.enqueueGenerationJob).not.toHaveBeenCalled();
    });

    it('queries gemini TTS usage only', async () => {
      const { service, prisma } = createService({
        config: { 'integrations.geminiTtsMaxMonthlySpendUsd': '100' },
      });
      await service.generateStoryAudio(userId, storyId, {});
      expect(prisma.providerUsage.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId,
            provider: 'gemini',
            OR: [
              { requestType: { startsWith: 'tts_' } },
              { requestType: { startsWith: 'speech_' } },
              { requestType: { startsWith: 'narration_' } },
            ],
          }),
        }),
      );
    });

    it('allows generation when under budget', async () => {
      const { service } = createService({
        config: { 'integrations.geminiTtsMaxMonthlySpendUsd': '100' },
        usages: [{ estimatedCost: 1 }],
      });
      const result = await service.generateStoryAudio(userId, storyId, {});
      expect(result.job).not.toBeNull();
    });

    it('counts in-flight audio estimates toward the budget', async () => {
      const { service, prisma } = createService({
        config: { 'integrations.geminiTtsMaxMonthlySpendUsd': '0.5' },
      });
      prisma.audioGeneration.findMany.mockResolvedValue([{ estimatedCost: 0.5 }]);
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects when max concurrent speech jobs is reached', async () => {
      const { service } = createService({ activeVoiceJobs: 2 });
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('rejects narration text above the max character limit', async () => {
      const { service } = createService({
        config: { 'integrations.geminiTtsMaxCharacters': 10 },
      });
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toThrow(
        /maximum of 10 characters/,
      );
    });

    it('rejects when max attempts per scene is reached', async () => {
      const { service, prisma } = createService();
      prisma.audioGeneration.count.mockResolvedValue(10);
      await expect(service.generateStoryAudio(userId, storyId, {})).rejects.toThrow(
        /Maximum audio generation attempts per scene/,
      );
    });
  });

  describe('retryAudio / selectAudio', () => {
    it('only retries FAILED audio', async () => {
      const { service, prisma } = createService();
      prisma.audioGeneration.findFirst.mockResolvedValue({
        id: 'audio-1',
        status: AudioGenerationStatus.COMPLETED,
      });
      await expect(service.retryAudio(userId, 'audio-1')).rejects.toBeInstanceOf(ConflictException);
    });

    it('retries failed audio by incrementing retryCount and enqueueing a new job', async () => {
      const { service, prisma, queueService } = createService();
      prisma.audioGeneration.findFirst.mockResolvedValue({
        id: 'audio-1',
        storyId,
        sceneId,
        narrationScriptId: scriptId,
        status: AudioGenerationStatus.FAILED,
        retryCount: 0,
        estimatedCost: 0.001,
        providerVoiceId: 'Kore',
      });

      const result = await service.retryAudio(userId, 'audio-1');

      expect(prisma.audioGeneration.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: expect.objectContaining({
          status: AudioGenerationStatus.PENDING,
          retryCount: { increment: 1 },
        }),
      });
      expect(queueService.enqueueGenerationJob).toHaveBeenCalledWith(
        'VOICE',
        expect.objectContaining({
          audioGenerationId: 'audio-1',
          payload: expect.objectContaining({ audioGenerationIds: ['audio-1'], retry: true }),
        }),
        expect.any(Object),
      );
      expect(result.job.status).toBe('QUEUED');
    });

    it('selects only completed audio and unsets other selections for the scene', async () => {
      const { service, prisma } = createService();
      prisma.audioGeneration.findFirst.mockResolvedValue({
        id: 'audio-1',
        sceneId,
        status: AudioGenerationStatus.COMPLETED,
        audioMediaAssetId: 'media-1',
        storyId,
        narrationScriptId: scriptId,
        sceneNarrationId,
        isSelected: false,
        attemptNumber: 1,
        retryCount: 0,
        progress: 100,
        audioMediaAsset: { storageKey: 'audio/a.wav', mimeType: 'audio/wav' },
      });

      const result = await service.selectAudio(userId, 'audio-1');

      expect(prisma.audioGeneration.updateMany).toHaveBeenCalledWith({
        where: { sceneId, isSelected: true, NOT: { id: 'audio-1' } },
        data: { isSelected: false },
      });
      expect(prisma.audioGeneration.update).toHaveBeenCalledWith({
        where: { id: 'audio-1' },
        data: { isSelected: true },
      });
      expect(result.downloadUrl).toBe('https://example.com/audio.wav');
    });

    it('rejects selecting non-completed audio', async () => {
      const { service, prisma } = createService();
      prisma.audioGeneration.findFirst.mockResolvedValue({
        id: 'audio-1',
        status: AudioGenerationStatus.FAILED,
        audioMediaAssetId: null,
      });
      await expect(service.selectAudio(userId, 'audio-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('voice profiles', () => {
    it('unsets other defaults when creating a default profile', async () => {
      const { service, prisma } = createService();
      await service.createVoiceProfile(userId, {
        name: 'Narrator',
        providerVoiceId: 'Kore',
        isDefault: true,
      });
      expect(prisma.voiceProfile.updateMany).toHaveBeenCalledWith({
        where: { userId, isDefault: true },
        data: { isDefault: false },
      });
      expect(prisma.voiceProfile.create).toHaveBeenCalled();
    });

    it('rejects unsupported voices and invalid configuration', async () => {
      const { service } = createService();
      await expect(
        service.createVoiceProfile(userId, { name: 'Bad', providerVoiceId: 'Nope' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createVoiceProfile(userId, {
          name: 'Bad',
          providerVoiceId: 'Kore',
          configuration: { nope: true } as never,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('unsets other defaults when updating to default', async () => {
      const { service, prisma } = createService();
      prisma.voiceProfile.findFirst.mockResolvedValue({ id: 'vp-1', userId });
      await service.updateVoiceProfile(userId, 'vp-1', { isDefault: true });
      expect(prisma.voiceProfile.updateMany).toHaveBeenCalledWith({
        where: { userId, isDefault: true, NOT: { id: 'vp-1' } },
        data: { isDefault: false },
      });
    });
  });

  describe('getNarration / getProgress', () => {
    it('returns the latest script with audio download URLs', async () => {
      const { service, prisma, storage } = createService();
      prisma.narrationScript.findFirst.mockResolvedValue({
        id: scriptId,
        storyId,
        version: 1,
        status: NarrationScriptStatus.APPROVED,
        scenes: [
          {
            id: sceneNarrationId,
            narrationScriptId: scriptId,
            storyId,
            sceneId,
            sequence: 1,
            text: 'Hello',
            emotionalTone: 'warm',
            speakingStyle: 'calm',
            estimatedDuration: 2,
            status: SceneNarrationStatus.APPROVED,
            scene: { sceneNumber: 1 },
            audioGenerations: [
              {
                id: 'audio-1',
                storyId,
                sceneId,
                narrationScriptId: scriptId,
                sceneNarrationId,
                status: AudioGenerationStatus.COMPLETED,
                progress: 100,
                isSelected: true,
                attemptNumber: 1,
                retryCount: 0,
                audioMediaAsset: { storageKey: 'audio/a.wav', mimeType: 'audio/wav' },
              },
            ],
          },
        ],
      });

      const result = await service.getNarration(userId, storyId);

      expect(result.narrationScript?.scenes[0].audio[0].downloadUrl).toBe(
        'https://example.com/audio.wav',
      );
      expect(storage.getPresignedDownloadUrl).toHaveBeenCalledWith('audio/a.wav', 900);
    });

    it('computes progress counts by status', async () => {
      const { service, prisma } = createService();
      prisma.narrationScript.findFirst.mockResolvedValue({
        id: scriptId,
        version: 1,
        status: NarrationScriptStatus.APPROVED,
        scenes: [
          { id: 'sn-1', sceneId: 's1', status: 'APPROVED' },
          { id: 'sn-2', sceneId: 's2', status: 'APPROVED' },
        ],
      });
      prisma.audioGeneration.findMany.mockResolvedValue([
        { id: 'a1', sceneId: 's1', status: AudioGenerationStatus.COMPLETED, progress: 100 },
        { id: 'a2', sceneId: 's2', status: AudioGenerationStatus.FAILED, progress: 0 },
      ]);

      const progress = await service.getProgress(userId, storyId);

      expect(progress.totalScenes).toBe(2);
      expect(progress.completedScenes).toBe(1);
      expect(progress.failedScenes).toBe(1);
      expect(progress.percentComplete).toBe(50);
      expect(progress.countsByStatus.COMPLETED).toBe(1);
      expect(progress.countsByStatus.FAILED).toBe(1);
    });
  });
});
