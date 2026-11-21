import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  ProjectStatus,
  SeriesEpisodeApprovalStatus,
  SeriesEpisodeStatus,
  StoryStatus,
} from '@prisma/client';
import {
  formatCharacterIdentityForClipPrompt,
  seriesCharacterToIdentityProfile,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

@Injectable()
export class SeriesPipelineAdapterService {
  private readonly logger = new Logger(SeriesPipelineAdapterService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Materialize an approved SeriesEpisode into a Story + StoryScenes + CharacterProfiles
   * without calling Gemini scene planning (avoids character wipe).
   */
  async materializeEpisode(
    userId: string,
    seriesId: string,
    episodeId: string,
    options?: { force?: boolean },
  ) {
    const episode = await this.prisma.seriesEpisode.findFirst({
      where: { id: episodeId, seriesId, series: { userId } },
      include: {
        scenes: { orderBy: { sceneOrder: 'asc' } },
        series: {
          include: {
            characters: {
              orderBy: { sortOrder: 'asc' },
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
    if (episode.approvalStatus !== SeriesEpisodeApprovalStatus.APPROVED) {
      throw new BadRequestException('Episode must be approved before production materialization');
    }
    if (!episode.script?.trim()) {
      throw new BadRequestException('Episode has no script to materialize');
    }
    if (episode.scenes.length === 0) {
      throw new BadRequestException('Episode has no scenes to materialize');
    }

    if (episode.storyId && !options?.force) {
      const existing = await this.prisma.story.findFirst({
        where: { id: episode.storyId, userId },
        include: {
          scenes: { select: { id: true } },
          characters: { select: { id: true } },
        },
      });
      if (existing && existing.scenes.length > 0 && existing.characters.length > 0) {
        const project =
          episode.videoProjectId ??
          (await this.ensureVideoProject(userId, existing.id, episode.title)).id;
        if (!episode.videoProjectId) {
          await this.prisma.seriesEpisode.update({
            where: { id: episode.id },
            data: { videoProjectId: project },
          });
        }
        return {
          storyId: existing.id,
          videoProjectId: project,
          sceneCount: existing.scenes.length,
          characterCount: existing.characters.length,
          reused: true,
        };
      }
    }

    const series = episode.series;
    const episodeMeta = (episode.metadata as Record<string, unknown> | null) ?? {};
    const dialogueDriven = episodeMeta.dialogueDriven === true;
    const dialoguePlan = episodeMeta.dialoguePlan as
      | {
          scenes?: Array<{
            sceneNumber: number;
            shots?: Array<{
              shotOrder: number;
              speaker: string;
              dialogue: string;
              facialExpression?: string;
              bodyLanguage?: string;
              cameraDirection?: string;
              cameraMovement?: string;
              environment?: string;
              lighting?: string;
              durationSeconds?: number;
              charactersVisible?: string[];
              shotType?: string;
            }>;
          }>;
        }
      | undefined;

    const shotRows: Array<{
      sceneNumber: number;
      durationSeconds: number;
      narration: string;
      visualDescription: string;
      imagePrompt: string;
      videoPrompt: string;
      cameraMovement: string;
      lighting: string;
      environment: string;
      characterConsistencyInstructions: string;
    }> = [];

    const characterNotesByName = new Map(
      series.characters.map((character) => {
        const profile = seriesCharacterToIdentityProfile(character);
        const block = formatCharacterIdentityForClipPrompt(profile);
        return [character.name.toLowerCase(), block];
      }),
    );

    if (dialogueDriven && dialoguePlan?.scenes?.length) {
      let sceneNumber = 0;
      for (const scene of dialoguePlan.scenes) {
        for (const shot of scene.shots ?? []) {
          sceneNumber += 1;
          const names = shot.charactersVisible?.length
            ? shot.charactersVisible
            : [shot.speaker];
          const consistency = names
            .map((name) => {
              const note = characterNotesByName.get(name.toLowerCase());
              return note ? `${name}: ${note}` : name;
            })
            .join(' | ');
          const visual = [
            `Semi-realistic cinematic 3D ${shot.shotType?.replace(/_/g, ' ') || 'shot'}.`,
            shot.facialExpression,
            shot.bodyLanguage,
            shot.environment,
            shot.lighting,
            shot.cameraDirection,
          ]
            .filter(Boolean)
            .join(' ');
          shotRows.push({
            sceneNumber,
            durationSeconds: Math.max(2, shot.durationSeconds ?? 4),
            narration: shot.dialogue?.trim() || '',
            visualDescription: visual,
            imagePrompt: visual,
            videoPrompt: visual,
            cameraMovement: shot.cameraMovement?.trim() || 'static',
            lighting: shot.lighting?.trim() || 'natural cinematic lighting',
            environment: shot.environment?.trim() || 'everyday interior',
            characterConsistencyInstructions:
              consistency ||
              'Preserve approved series character identity and wardrobe continuity.',
          });
        }
      }
    }

    const durationPerScene = Math.max(
      2,
      Number((episode.targetDurationSeconds / Math.max(1, episode.scenes.length)).toFixed(2)),
    );

    const result = await this.prisma.$transaction(async (tx) => {
      const storyData = {
        title: episode.title,
        content: episode.script!,
        status: StoryStatus.READY,
        topic: series.genre ?? series.title,
        niche: series.subgenres[0] ?? series.genre ?? 'Series drama',
        targetAudience: series.targetAudience ?? 'General audience',
        language: series.language,
        tone: series.tone ?? undefined,
        category: 'Series Episode',
        targetDurationSeconds: episode.targetDurationSeconds,
        openingHook: episode.hook ?? episode.script!.slice(0, 160),
        narrationScript: dialogueDriven
          ? episode.script!
          : episode.narrationText ?? episode.script!,
        closingMessage: episode.ending ?? episode.cliffhanger ?? 'To be continued.',
        description: episode.synopsis ?? episode.title,
        hashtags: ['series', series.slug],
      };

      let storyId = episode.storyId;
      if (storyId) {
        const owned = await tx.story.findFirst({ where: { id: storyId, userId } });
        if (!owned) storyId = null;
      }

      const story = storyId
        ? await tx.story.update({ where: { id: storyId }, data: storyData })
        : await tx.story.create({
            data: {
              userId,
              ...storyData,
            },
          });

      await tx.storyScene.deleteMany({ where: { storyId: story.id } });

      const sceneData =
        shotRows.length > 0
          ? shotRows.map((row) => ({ storyId: story.id, ...row }))
          : episode.scenes.map((scene) => {
              const names = asStringArray(scene.characters);
              const consistency = names
                .map((name) => {
                  const note = characterNotesByName.get(name.toLowerCase());
                  return note ? `${name}: ${note}` : name;
                })
                .join(' | ');

              return {
                storyId: story.id,
                sceneNumber: scene.sceneOrder,
                durationSeconds: durationPerScene,
                narration: (scene.narration ?? scene.dialogue ?? '').trim() || scene.action,
                visualDescription: scene.visualDescription,
                imagePrompt: scene.visualDescription,
                videoPrompt: scene.visualDescription,
                cameraMovement: scene.shotDirection?.trim() || 'Slow cinematic push-in',
                lighting: scene.emotionalDirection?.trim() || 'Dramatic cinematic lighting',
                environment: scene.location,
                characterConsistencyInstructions:
                  consistency ||
                  'Preserve approved series character identity and wardrobe continuity.',
              };
            });

      await tx.storyScene.createMany({ data: sceneData });

      // Replace story characters with projected series roster (preserves series refs via new CVR rows).
      await tx.characterProfile.deleteMany({ where: { storyId: story.id } });
      const createdProfiles = [];
      for (const character of series.characters) {
        const identity = seriesCharacterToIdentityProfile(character);
        const profile = await tx.characterProfile.create({
          data: {
            storyId: story.id,
            name: character.name,
            appearance:
              character.canonicalVisualDescription?.trim() ||
              character.physicalDescription,
            clothing: character.clothing?.trim() || 'Consistent series wardrobe',
            ageRange: character.ageRange?.trim() || 'adult',
            hair: character.hairFurColor?.trim() || 'as described',
            distinctiveFeatures:
              [
                character.markings,
                character.facialStructure,
                character.eyeColor,
                character.facialHair,
              ]
                .filter(Boolean)
                .join('; ') || character.physicalDescription.slice(0, 200),
            consistencyNotes:
              character.visualConsistencyNotes?.trim() ||
              character.canonicalVisualDescription?.trim() ||
              `Preserve ${character.name} identity across episodes.`,
            genderPresentation: character.genderPresentation ?? undefined,
            skinTone: character.skinTone ?? undefined,
            facialFeatures: character.facialStructure ?? undefined,
            hairstyle: character.hairstyle ?? undefined,
            hairColor: character.hairFurColor ?? undefined,
            bodyBuild: character.bodyProportions ?? undefined,
            accessories: character.accessories ?? undefined,
            canonicalVisualDescription:
              character.canonicalVisualDescription ??
              formatCharacterIdentityForClipPrompt(identity).slice(0, 4000),
            visualConsistencyInstructions: character.visualConsistencyNotes ?? undefined,
          },
        });
        createdProfiles.push({ profile, character });
      }

      for (const { profile, character } of createdProfiles) {
        const refs = character.referenceAssets;
        if (refs.length === 0) continue;
        // Prefer primary approved; otherwise first approved.
        const chosen = refs.find((ref) => ref.isPrimary) ?? refs[0];
        await tx.characterVisualReference.create({
          data: {
            characterProfileId: profile.id,
            mediaAssetId: chosen.mediaAssetId,
            prompt: chosen.prompt,
            isPrimary: true,
          },
        });
      }

      const project = episode.videoProjectId
        ? await tx.videoProject.findFirst({
            where: { id: episode.videoProjectId, userId },
          })
        : null;

      const videoProject =
        project ??
        (await tx.videoProject.create({
          data: {
            userId,
            storyId: story.id,
            title: `${series.title} — Ep ${episode.episodeNumber}: ${episode.title}`,
            description: episode.synopsis ?? undefined,
            status: ProjectStatus.DRAFT,
          },
        }));

      if (project && project.storyId !== story.id) {
        await tx.videoProject.update({
          where: { id: project.id },
          data: { storyId: story.id },
        });
      }

      await tx.seriesEpisode.update({
        where: { id: episode.id },
        data: {
          storyId: story.id,
          videoProjectId: videoProject.id,
          status: SeriesEpisodeStatus.PRODUCING,
          metadata: {
            ...((episode.metadata as Record<string, unknown>) ?? {}),
            pipelineAdapter: {
              materializedAt: new Date().toISOString(),
              preserveCharacters: true,
              dialogueDriven,
              sceneCount: sceneData.length,
              characterCount: series.characters.length,
            },
          } as Prisma.InputJsonValue,
        },
      });

      return {
        storyId: story.id,
        videoProjectId: videoProject.id,
        sceneCount: sceneData.length,
        characterCount: series.characters.length,
        reused: false,
      };
    });

    this.logger.log(
      `Materialized episode ${episodeId} → story ${result.storyId} (${result.sceneCount} scenes, ${result.characterCount} characters)`,
    );
    return result;
  }

  private async ensureVideoProject(userId: string, storyId: string, title: string) {
    const existing = await this.prisma.videoProject.findFirst({
      where: { userId, storyId },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;
    return this.prisma.videoProject.create({
      data: {
        userId,
        storyId,
        title,
        status: ProjectStatus.DRAFT,
      },
    });
  }
}
