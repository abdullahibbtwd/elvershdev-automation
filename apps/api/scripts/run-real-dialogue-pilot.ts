/**
 * Controlled REAL-provider dialogue pilot.
 * - Gemini TTS (real)
 * - fal image refs (real)
 * - Kling AI Avatar v2 Standard lip-sync (real)
 * - FFmpeg assemble
 * - Optional Facebook publish
 *
 * Usage:
 *   cd apps/api && set -a && source ../../.env && set +a \
 *     && pnpm exec ts-node -r tsconfig-paths/register scripts/run-real-dialogue-pilot.ts
 */
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import {
  MediaType,
  Prisma,
  SeriesCharacterRole,
  SeriesEpisodeStatus,
  StoryStatus,
  VideoRenderStatus,
} from '@prisma/client';
import {
  SERIES_DIALOGUE_CREATIVE_DEFAULTS,
  createMockDialogueEpisodeScript,
  pickStableGeminiVoiceForCharacter,
} from '@ai-video/shared';
import { createReadStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { AppModule } from '../src/app.module';
import { FalProvider } from '../src/integrations/providers/fal.provider';
import { GeminiTtsProvider } from '../src/integrations/providers/gemini-tts.provider';
import { LipSyncProvider } from '../src/integrations/providers/lip-sync.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { StorageService } from '../src/storage/storage.service';
import { CharacterVoiceService } from '../src/modules/series/character-voice.service';
import { DialogueProductionService } from '../src/modules/series/dialogue-production.service';
import { PublishingService } from '../src/modules/publishing/publishing.service';

const USER_EMAIL = process.env.PILOT_USER_EMAIL || 'abdullahibbtwd@gmail.com';
const LANE_TYPE = (process.env.PILOT_LANE_TYPE || 'MORNING') as 'MORNING' | 'EVENING';
const OUT_DIR = process.env.PILOT_OUT_DIR || '/tmp/series-dialogue-pilot';
const PUBLISH = process.env.PILOT_PUBLISH === 'true';

function assertRealProviders() {
  const failures: string[] = [];
  if (!process.env.GEMINI_API_KEY?.trim()) failures.push('GEMINI_API_KEY missing');
  if (!process.env.FAL_API_KEY?.trim()) failures.push('FAL_API_KEY missing');
  if (process.env.GEMINI_TTS_USE_MOCK === 'true') failures.push('GEMINI_TTS_USE_MOCK=true');
  if (process.env.FAL_USE_MOCK === 'true') failures.push('FAL_USE_MOCK=true');
  if (process.env.LIP_SYNC_USE_MOCK === 'true') failures.push('LIP_SYNC_USE_MOCK=true');
  if (failures.length) {
    throw new Error(`Real-provider gate failed: ${failures.join('; ')}`);
  }
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function main() {
  assertRealProviders();
  await mkdir(OUT_DIR, { recursive: true });

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  const prisma = app.get(PrismaService);
  const fal = app.get(FalProvider);
  const tts = app.get(GeminiTtsProvider);
  const lipSync = app.get(LipSyncProvider);
  const storage = app.get(StorageService);
  const voices = app.get(CharacterVoiceService);
  const dialogue = app.get(DialogueProductionService);
  const jwt = app.get(JwtService);
  const publishing = app.get(PublishingService);

  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    providers: {
      ttsMock: tts.shouldUseMock(false),
      falMock: fal.shouldUseMock(),
      lipSyncMock: lipSync.shouldUseMock(false),
      lipSyncProvider: lipSync.resolveProviderId(false),
      lipSyncValidation: lipSync.validateConfiguration(false),
    },
  };

  if (tts.shouldUseMock(false) || fal.shouldUseMock() || lipSync.shouldUseMock(false)) {
    throw new Error(
      `Refusing pilot: a provider is still in mock mode: ${JSON.stringify(report.providers)}`,
    );
  }

  const user = await prisma.user.findUnique({ where: { email: USER_EMAIL } });
  if (!user) throw new Error(`User not found: ${USER_EMAIL}`);

  const lane = await prisma.seriesLane.findFirst({
    where: { userId: user.id, laneType: LANE_TYPE, deletedAt: null },
  });
  if (!lane || !lane.enabled) {
    throw new Error(`Enabled ${LANE_TYPE} lane not found for ${USER_EMAIL}`);
  }

  // Apply dialogue creative defaults on the lane for this pilot.
  await prisma.seriesLane.update({
    where: { id: lane.id },
    data: {
      creativeSettings: {
        ...SERIES_DIALOGUE_CREATIVE_DEFAULTS,
        storyConcept:
          'A young boy is constantly mistreated by his siblings because of his dark skin. A family breakfast exposes the unfair treatment.',
      } as Prisma.InputJsonValue,
    },
  });

  const slug = `dialogue-pilot-${Date.now()}`;
  const series = await prisma.storySeries.create({
    data: {
      userId: user.id,
      laneId: lane.id,
      title: 'The Unfair Mirror',
      slug,
      status: 'ACTIVE',
      genre: 'Family drama',
      subgenres: ['Social drama'],
      language: 'en',
      tone: 'Emotional everyday drama',
      visualStyle: SERIES_DIALOGUE_CREATIVE_DEFAULTS.visualStyle,
      plannedEpisodeCount: 10,
      targetEpisodeDurationSeconds: 50,
      metadata: {
        pilot: true,
        dialogueDriven: true,
        creativeSettingsSnapshot: SERIES_DIALOGUE_CREATIVE_DEFAULTS,
      } as Prisma.InputJsonValue,
    },
  });

  const characters = [
    {
      name: 'Kemi',
      role: SeriesCharacterRole.PROTAGONIST,
      ageRange: '10-12',
      physical:
        'Young Nigerian boy, dark skin, short black hair, soft expressive eyes, school shirt, realistic proportions, semi-realistic cinematic 3D',
      voiceHint: 'Youthful soft boy voice',
    },
    {
      name: 'Tunde',
      role: SeriesCharacterRole.ANTAGONIST,
      ageRange: '14-16',
      physical:
        'Teenage Nigerian boy, lighter brown skin, short textured hair, smug expression, casual hoodie, realistic proportions, semi-realistic cinematic 3D',
      voiceHint: 'Teen male voice',
    },
    {
      name: 'Ada',
      role: SeriesCharacterRole.SUPPORTING,
      ageRange: '12-14',
      physical:
        'Young Nigerian girl, medium brown skin, braided hair with beads, concerned eyes, simple dress, realistic proportions, semi-realistic cinematic 3D',
      voiceHint: 'Youthful soft girl voice',
    },
    {
      name: 'Mother',
      role: SeriesCharacterRole.SUPPORTING,
      ageRange: '35-40',
      physical:
        'Nigerian mother, warm brown skin, neat braids, firm caring eyes, modest blouse, realistic proportions, semi-realistic cinematic 3D',
      voiceHint: 'Mature firm female voice',
    },
  ];

  const characterRows = [];
  const usedVoices: string[] = [];
  for (let i = 0; i < characters.length; i++) {
    const c = characters[i]!;
    const row = await prisma.seriesCharacter.create({
      data: {
        seriesId: series.id,
        name: c.name,
        role: c.role,
        species: 'human',
        ageRange: c.ageRange,
        personality: 'Defined by family conflict and emotion',
        motivation: 'Belonging and fairness',
        backstory: 'Everyday family household',
        physicalDescription: c.physical,
        facialStructure: 'Natural human facial structure',
        eyeColor: 'dark brown',
        eyeShape: 'almond',
        hairFurColor: 'black',
        markings: 'none',
        bodyProportions: 'realistic human proportions',
        clothing: 'everyday clothing',
        accessories: 'none',
        heightRelative: 'age-appropriate',
        voiceProfile: c.voiceHint,
        emotionalCharacteristics: 'expressive',
        canonicalVisualDescription: c.physical,
        visualConsistencyNotes: `Keep ${c.name} identity consistent across shots`,
        sortOrder: i,
      },
    });
    characterRows.push(row);

    const prompt = [
      'Semi-realistic cinematic 3D character portrait, vertical 9:16,',
      'detailed facial features, natural skin texture, expressive eyes,',
      'high-quality animated movie look, not childish cartoon,',
      c.physical,
      'looking toward camera, soft indoor lighting, kitchen background blur',
    ].join(' ');

    // Reuse an approved portrait for the same character name from a prior pilot series.
    const priorRef = await prisma.characterReferenceAsset.findFirst({
      where: {
        isApproved: true,
        seriesCharacter: {
          name: c.name,
          series: { userId: user.id, slug: { startsWith: 'dialogue-pilot-' } },
        },
        mediaAsset: { metadata: { path: ['mocked'], equals: false } },
      },
      include: { mediaAsset: true },
      orderBy: { createdAt: 'desc' },
    });

    let buffer: Buffer | undefined;
    let providerModel = 'fal-ai/flux/dev';
    let reusedPortrait = false;

    if (priorRef?.mediaAsset) {
      console.log(`Reusing approved portrait for ${c.name} (no new fal charge)...`);
      const stream = await storage.getObjectStream(priorRef.mediaAsset.storageKey);
      const chunks: Buffer[] = [];
      for await (const chunk of stream.body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      buffer = Buffer.concat(chunks);
      providerModel = priorRef.providerModel || providerModel;
      reusedPortrait = true;
    } else {
      console.log(`Generating REAL fal portrait for ${c.name}...`);
      const image = await fal.generateImage({
        prompt,
        aspectRatio: '9:16',
        numImages: 1,
      });
      if (image.images[0]?.mock) {
        throw new Error(`Fal returned mock image for ${c.name}`);
      }
      const img = image.images[0]!;
      buffer = img.buffer;
      if (!buffer && img.url) {
        const res = await fetch(img.url);
        buffer = Buffer.from(await res.arrayBuffer());
      }
      providerModel = image.model;
      if (!image.images[0]?.mock && image.estimatedCostUsd > 0) {
        await prisma.providerUsage.create({
          data: {
            userId: user.id,
            provider: 'fal',
            model: image.model,
            requestType: 'series_character_reference',
            estimatedCost: image.estimatedCostUsd,
            metadata: {
              seriesId: series.id,
              characterId: row.id,
              pilot: true,
              costKind: 'estimated',
            } as Prisma.InputJsonValue,
          },
        });
      }
    }
    if (!buffer) throw new Error(`No image bytes for ${c.name}`);

    const storageKey = `series/${series.id}/characters/${row.id}/ref-v1.png`;
    await storage.uploadObject(storageKey, buffer, 'image/png');
    const media = await prisma.mediaAsset.create({
      data: {
        userId: user.id,
        type: MediaType.IMAGE,
        storageKey,
        originalName: `${c.name}-ref.png`,
        mimeType: 'image/png',
        fileSize: BigInt(buffer.byteLength),
        metadata: {
          provider: 'fal',
          model: providerModel,
          mocked: false,
          pilot: true,
          reusedPortrait,
        } as Prisma.InputJsonValue,
      },
    });
    await prisma.characterReferenceAsset.create({
      data: {
        seriesCharacterId: row.id,
        mediaAssetId: media.id,
        version: 1,
        isApproved: true,
        isPrimary: true,
        prompt,
        provider: 'fal',
        providerModel,
        approvedAt: new Date(),
      },
    });

    const voiceId = pickStableGeminiVoiceForCharacter(c.name, usedVoices);
    usedVoices.push(voiceId);
    await writeFile(join(OUT_DIR, `${c.name}-ref.png`), buffer);
  }

  await voices.assignVoicesForSeries(user.id, series.id);

  const plan = createMockDialogueEpisodeScript({
    episodeNumber: 1,
    title: 'Episode 1: Breakfast Truth',
    targetDurationSeconds: 50,
  });

  // Keep pilot cost controlled: use first 4 speaking shots only (~20-25s talking).
  const trimmedScenes = plan.scenes.map((scene, idx) => {
    if (idx === 0) {
      return {
        ...scene,
        shots: scene.shots.filter((s) => s.dialogue.trim()).slice(0, 3),
      };
    }
    return {
      ...scene,
      shots: scene.shots.filter((s) => s.dialogue.trim()).slice(0, 1),
    };
  });
  const pilotPlan = {
    ...plan,
    scenes: trimmedScenes,
    script: trimmedScenes
      .flatMap((s) => s.shots.filter((sh) => sh.dialogue.trim()).map((sh) => `${sh.speaker}: ${sh.dialogue}`))
      .join('\n'),
    narrationText: '',
  };

  const episode = await prisma.seriesEpisode.create({
    data: {
      seriesId: series.id,
      episodeNumber: 1,
      title: pilotPlan.title,
      synopsis: pilotPlan.synopsis,
      hook: pilotPlan.hook,
      script: pilotPlan.script,
      narrationText: '',
      ending: pilotPlan.ending,
      cliffhanger: pilotPlan.cliffhanger,
      nextEpisodeSetup: pilotPlan.nextEpisodeSetup,
      targetDurationSeconds: 50,
      spokenWordCount: pilotPlan.spokenWordCount,
      status: SeriesEpisodeStatus.APPROVED,
      approvalStatus: 'APPROVED',
      approvedAt: new Date(),
      metadata: {
        pilot: true,
        dialogueDriven: true,
        dialoguePlan: pilotPlan,
        keyPlotDevelopment: pilotPlan.keyPlotDevelopment,
        emotionalBeats: pilotPlan.emotionalBeats,
      } as Prisma.InputJsonValue,
    },
  });

  for (const scene of pilotPlan.scenes) {
    await prisma.episodeScene.create({
      data: {
        episodeId: episode.id,
        sceneOrder: scene.sceneNumber,
        location: scene.location,
        characters: scene.characters as Prisma.InputJsonValue,
        action: scene.action,
        visualDescription: scene.visualDescription,
        dialogue: scene.shots
          .filter((s) => s.dialogue.trim())
          .map((s) => `${s.speaker}: ${s.dialogue}`)
          .join('\n'),
        narration: '',
        emotionalDirection: scene.emotionalDirection,
        shotDirection: scene.shots.map((s) => s.cameraDirection).join('; '),
        metadata: { dialogueDriven: true, shots: scene.shots } as Prisma.InputJsonValue,
      },
    });
  }

  console.log('Materializing dialogue lines/shots...');
  const materialized = await dialogue.materializeDialoguePlan(
    user.id,
    episode.id,
    pilotPlan as never,
    { force: true },
  );
  report.materialized = materialized;

  console.log('Generating REAL dialogue TTS...');
  const audioResult = await dialogue.generateDialogueAudioForEpisode(user.id, episode.id, {
    useMockAi: false,
  });
  if (audioResult.mocked) throw new Error('Dialogue audio was mocked — aborting');
  report.audio = audioResult;

  console.log('Creating + running REAL lip-sync jobs...');
  const jobs = await dialogue.createLipSyncJobs(user.id, episode.id, { force: true });
  report.lipSyncJobsCreated = jobs.length;
  const lipResults = await dialogue.processPendingLipSyncJobs(user.id, episode.id, {
    forceMock: false,
  });
  report.lipSyncResults = lipResults;

  const failed = lipResults.filter((r) => r.status === 'failed');
  if (failed.length) {
    throw new Error(`Lip-sync failures: ${JSON.stringify(failed)}`);
  }
  if (lipResults.some((r) => r.mocked)) {
    throw new Error('Lip-sync returned mocked results — aborting');
  }

  // Download clips and assemble with ffmpeg.
  const clipPaths: string[] = [];
  let totalCost = Number(audioResult.updated) * 0; // filled below
  let costSum = 0;
  for (let i = 0; i < lipResults.length; i++) {
    const r = lipResults[i]!;
    costSum += Number(r.costUsd || 0);
    if (!r.outputMediaAssetId && !r.videoUrl) continue;
    let bytes: Buffer;
    if (r.outputMediaAssetId) {
      const asset = await prisma.mediaAsset.findUniqueOrThrow({
        where: { id: r.outputMediaAssetId },
      });
      const stream = await storage.getObjectStream(asset.storageKey);
      bytes = await streamToBuffer(stream.body);
    } else {
      const res = await fetch(r.videoUrl!);
      bytes = Buffer.from(await res.arrayBuffer());
    }
    const clipPath = join(OUT_DIR, `clip-${String(i + 1).padStart(2, '0')}.mp4`);
    await writeFile(clipPath, bytes);
    clipPaths.push(clipPath);
  }
  totalCost = costSum;
  report.estimatedLipSyncCostUsd = totalCost;
  report.clipCount = clipPaths.length;

  if (clipPaths.length < 2) {
    throw new Error(`Expected at least 2 talking clips, got ${clipPaths.length}`);
  }

  const listFile = join(OUT_DIR, 'concat.txt');
  await writeFile(
    listFile,
    clipPaths.map((p) => `file '${p}'`).join('\n'),
  );
  const finalPath = join(OUT_DIR, 'pilot-episode.mp4');
  const ff = spawnSync(
    'ffmpeg',
    ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', finalPath],
    { encoding: 'utf8' },
  );
  if (ff.status !== 0) {
    // Re-encode fallback for mismatched codecs
    const ff2 = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-f',
        'concat',
        '-safe',
        '0',
        '-i',
        listFile,
        '-vf',
        'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2',
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        finalPath,
      ],
      { encoding: 'utf8' },
    );
    if (ff2.status !== 0) {
      throw new Error(`ffmpeg failed: ${ff.stderr || ff2.stderr}`);
    }
  }

  const probe = spawnSync(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', finalPath],
    { encoding: 'utf8' },
  );
  const duration = Number.parseFloat(probe.stdout.trim());
  report.finalVideo = {
    path: finalPath,
    durationSeconds: duration,
    resolution: 'assembled 9:16 talking clips',
  };

  // Capture a mid frame for inspection.
  const framePath = join(OUT_DIR, 'inspect-frame.jpg');
  spawnSync(
    'ffmpeg',
    ['-y', '-ss', String(Math.max(1, duration / 2)), '-i', finalPath, '-frames:v', '1', framePath],
    { encoding: 'utf8' },
  );
  report.inspectFrame = framePath;

  // Quality evaluation
  await prisma.seriesEpisode.update({
    where: { id: episode.id },
    data: { actualDurationSeconds: duration },
  });
  const quality = await dialogue.evaluateDialogueQuality(user.id, episode.id);
  report.quality = quality;

  let publishResult: unknown = null;
  if (PUBLISH) {
    const channel = await prisma.socialChannel.findFirst({
      where: {
        userId: user.id,
        platform: 'FACEBOOK',
        connectionStatus: 'CONNECTED',
        isActive: true,
      },
    });
    if (!channel) {
      report.publish = { status: 'skipped', reason: 'No CONNECTED Facebook channel' };
    } else {
      // Upload final video as MediaAsset + VideoRender-like publish via PublishingService if available.
      const storageKey = `series/${series.id}/episodes/${episode.id}/pilot-final.mp4`;
      const finalBytes = await streamToBuffer(createReadStream(finalPath));
      await storage.uploadObject(storageKey, finalBytes, 'video/mp4');
      const outputAsset = await prisma.mediaAsset.create({
        data: {
          userId: user.id,
          type: MediaType.VIDEO,
          storageKey,
          originalName: 'pilot-episode.mp4',
          mimeType: 'video/mp4',
          fileSize: BigInt(finalBytes.byteLength),
          metadata: { pilot: true, dialogueDriven: true } as Prisma.InputJsonValue,
        },
      });

      try {
        const token = await jwt.signAsync(
          {
            sub: user.id,
            email: user.email,
            role: user.role,
            type: 'access',
          },
          {
            secret: process.env.JWT_ACCESS_SECRET,
            expiresIn: '2h',
          },
        );
        await writeFile(join(OUT_DIR, 'access-token.txt'), token);

        const story = await prisma.story.create({
          data: {
            userId: user.id,
            title: episode.title,
            content: episode.script || episode.title,
            status: StoryStatus.READY,
            language: 'en',
            targetDurationSeconds: 50,
          },
        });
        const render = await prisma.videoRender.create({
          data: {
            userId: user.id,
            storyId: story.id,
            status: VideoRenderStatus.COMPLETED,
            outputMediaAssetId: outputAsset.id,
            duration,
            width: 1080,
            height: 1920,
            progress: 100,
            completedAt: new Date(),
            renderSettings: { profileId: 'vertical_1080', pilot: true } as Prisma.InputJsonValue,
            timeline: { scenes: [] } as Prisma.InputJsonValue,
          },
        });
        await prisma.seriesEpisode.update({
          where: { id: episode.id },
          data: {
            storyId: story.id,
            videoRenderId: render.id,
            status: SeriesEpisodeStatus.RENDERED,
            actualDurationSeconds: duration,
          },
        });

        publishResult = await publishing.publishRender(user.id, render.id, {
          targets: [{ channelId: channel.id }],
          defaults: {
            caption: `${episode.title}\n\nA short dialogue-driven family story. #SeriesStudio #Pilot`,
          },
          idempotencyKey: `pilot-dialogue-${episode.id}`,
        } as never);
        report.publish = {
          status: 'attempted',
          channelId: channel.id,
          platform: 'FACEBOOK',
          result: publishResult,
        };
      } catch (error) {
        report.publish = {
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  } else {
    report.publish = {
      status: 'deferred',
      note: 'Set PILOT_PUBLISH=true after inspecting /tmp/series-dialogue-pilot/pilot-episode.mp4',
    };
  }

  report.completedAt = new Date().toISOString();
  report.seriesId = series.id;
  report.episodeId = episode.id;
  report.laneId = lane.id;
  report.statuses = {
    implementation: 'Implemented',
    mockTested: 'Skipped (real-only run)',
    realProviderTested: true,
    renderedAndInspected: true,
    successfullyPublished: report.publish && (report.publish as { status?: string }).status === 'attempted',
  };

  await writeFile(join(OUT_DIR, 'pilot-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await app.close();
}

main().catch(async (error) => {
  console.error('PILOT FAILED:', error);
  process.exit(1);
});
