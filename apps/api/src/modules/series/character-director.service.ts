import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaType, Prisma, SeriesCharacterRole } from '@prisma/client';
import {
  SERIES_NOTIFICATION_TYPES,
  buildSeriesCharacterReferencePrompt,
  type SeriesCharacterPlan,
} from '@ai-video/shared';
import { FalProvider } from '../../integrations/providers/fal.provider';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';

@Injectable()
export class CharacterDirectorService {
  private readonly logger = new Logger(CharacterDirectorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly fal: FalProvider,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  async listCharacters(userId: string, seriesId: string) {
    await this.assertSeriesOwned(userId, seriesId);
    return this.prisma.seriesCharacter.findMany({
      where: { seriesId },
      include: {
        referenceAssets: {
          orderBy: [{ isPrimary: 'desc' }, { version: 'desc' }],
          include: { mediaAsset: true },
        },
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async persistCharacters(
    seriesId: string,
    characters: SeriesCharacterPlan[],
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await tx.seriesCharacter.deleteMany({ where: { seriesId } });
    const created = [];
    for (let i = 0; i < characters.length; i++) {
      const c = characters[i];
      const row = await tx.seriesCharacter.create({
        data: {
          seriesId,
          name: c.name,
          role: c.role as SeriesCharacterRole,
          species: c.species,
          ageRange: c.ageRange,
          personality: c.personality,
          motivation: c.motivation,
          backstory: c.backstory,
          physicalDescription: c.physicalDescription,
          facialStructure: c.facialStructure,
          eyeColor: c.eyeColor,
          eyeShape: c.eyeShape,
          hairFurColor: c.hairFurColor,
          markings: c.markings,
          bodyProportions: c.bodyProportions,
          clothing: c.clothing,
          accessories: c.accessories,
          heightRelative: c.heightRelative,
          voiceProfile: c.voiceProfile,
          emotionalCharacteristics: c.emotionalCharacteristics,
          relationships: c.relationships as Prisma.InputJsonValue,
          secrets: c.secrets as Prisma.InputJsonValue,
          flaws: c.flaws as Prisma.InputJsonValue,
          canonicalVisualDescription: c.canonicalVisualDescription,
          visualConsistencyNotes: c.visualConsistencyNotes,
          identityVersion: 1,
          sortOrder: i,
        },
      });
      created.push(row);
    }
    return created;
  }

  /**
   * Generate a reference portrait via fal (or mock) and store as CharacterReferenceAsset.
   * Approved primary refs must be reused later — never silently replace identity.
   */
  async generateReferencePortrait(input: {
    userId: string;
    seriesId: string;
    characterId: string;
    approve?: boolean;
    setPrimary?: boolean;
  }) {
    const character = await this.prisma.seriesCharacter.findFirst({
      where: { id: input.characterId, seriesId: input.seriesId, series: { userId: input.userId } },
    });
    if (!character) throw new NotFoundException('Series character not found');

    const plan = this.toPlan(character);
    const prompt = buildSeriesCharacterReferencePrompt(plan);
    const image = await this.fal.generateImage({
      prompt,
      aspectRatio: '1:1',
      negativePrompt:
        'children cartoon, chibi, deformed face, text, watermark, collage, low quality',
    });

    const primary = image.images[0];
    if (!primary) throw new BadRequestException('Image provider returned no images');

    const buffer =
      primary.buffer ??
      (primary.url.startsWith('data:')
        ? Buffer.from(primary.url.split(',')[1] ?? '', 'base64')
        : await this.download(primary.url));

    const storageKey = `series/${input.seriesId}/characters/${character.id}/ref-v${Date.now()}.png`;
    await this.storage.uploadObject(storageKey, buffer, primary.contentType ?? 'image/png');

    const media = await this.prisma.mediaAsset.create({
      data: {
        userId: input.userId,
        type: MediaType.IMAGE,
        storageKey,
        originalName: `${character.name}-reference.png`,
        mimeType: primary.contentType ?? 'image/png',
        fileSize: BigInt(buffer.byteLength),
        metadata: {
          seriesCharacterId: character.id,
          provider: 'fal',
          model: image.model,
          prompt,
        },
      },
    });

    const latest = await this.prisma.characterReferenceAsset.findFirst({
      where: { seriesCharacterId: character.id },
      orderBy: { version: 'desc' },
    });
    const version = (latest?.version ?? 0) + 1;
    const approve = input.approve !== false;
    const setPrimary = input.setPrimary !== false;

    if (setPrimary) {
      await this.prisma.characterReferenceAsset.updateMany({
        where: { seriesCharacterId: character.id, isPrimary: true },
        data: { isPrimary: false },
      });
    }

    const asset = await this.prisma.characterReferenceAsset.create({
      data: {
        seriesCharacterId: character.id,
        mediaAssetId: media.id,
        version,
        isApproved: approve,
        isPrimary: setPrimary,
        prompt,
        provider: 'fal',
        providerModel: image.model,
        generationMetadata: {
          estimatedCostUsd: image.estimatedCostUsd,
          seed: image.seed,
          requestId: image.requestId,
          mock: primary.mock === true,
        },
        approvedAt: approve ? new Date() : null,
      },
      include: { mediaAsset: true },
    });

    await this.prisma.providerUsage.create({
      data: {
        userId: input.userId,
        provider: 'fal',
        model: image.model,
        requestType: 'series_character_reference',
        estimatedCost: image.estimatedCostUsd,
        metadata: { seriesId: input.seriesId, characterId: character.id, mediaAssetId: media.id },
      },
    });

    this.logger.log(
      `Series character reference generated character=${character.id} version=${version}`,
    );
    return asset;
  }

  async approveReference(userId: string, seriesId: string, assetId: string) {
    const asset = await this.prisma.characterReferenceAsset.findFirst({
      where: {
        id: assetId,
        seriesCharacter: { seriesId, series: { userId } },
      },
    });
    if (!asset) throw new NotFoundException('Character reference asset not found');

    return this.prisma.characterReferenceAsset.update({
      where: { id: assetId },
      data: { isApproved: true, approvedAt: new Date() },
    });
  }

  async generateReferencesForSeries(userId: string, seriesId: string) {
    const characters = await this.listCharacters(userId, seriesId);
    const results = [];
    for (const character of characters) {
      const existingApproved = character.referenceAssets.find((a) => a.isApproved && a.isPrimary);
      if (existingApproved) {
        results.push({ characterId: character.id, skipped: true, assetId: existingApproved.id });
        continue;
      }
      const asset = await this.generateReferencePortrait({
        userId,
        seriesId,
        characterId: character.id,
      });
      results.push({ characterId: character.id, skipped: false, assetId: asset.id });
    }

    await this.notifications.notify({
      userId,
      type: SERIES_NOTIFICATION_TYPES.MOVIE_PLANNED,
      title: 'Character references ready',
      body: `Generated or reused reference portraits for series ${seriesId}.`,
      dedupeKey: `series-char-refs:${seriesId}:${results.map((r) => r.assetId).join(',')}`,
      metadata: { seriesId },
    });

    return results;
  }

  private toPlan(character: {
    name: string;
    role: SeriesCharacterRole;
    species: string;
    ageRange: string | null;
    personality: string;
    motivation: string;
    backstory: string;
    physicalDescription: string;
    facialStructure: string | null;
    eyeColor: string | null;
    eyeShape: string | null;
    hairFurColor: string | null;
    markings: string | null;
    bodyProportions: string | null;
    clothing: string | null;
    accessories: string | null;
    heightRelative: string | null;
    voiceProfile: string | null;
    emotionalCharacteristics: string | null;
    relationships: unknown;
    secrets: unknown;
    flaws: unknown;
    canonicalVisualDescription: string | null;
    visualConsistencyNotes: string | null;
  }): SeriesCharacterPlan {
    return {
      name: character.name,
      role: character.role,
      species: character.species,
      ageRange: character.ageRange ?? 'adult',
      personality: character.personality,
      motivation: character.motivation,
      backstory: character.backstory,
      physicalDescription: character.physicalDescription,
      facialStructure: character.facialStructure ?? '',
      eyeColor: character.eyeColor ?? '',
      eyeShape: character.eyeShape ?? '',
      hairFurColor: character.hairFurColor ?? '',
      markings: character.markings ?? 'none',
      bodyProportions: character.bodyProportions ?? '',
      clothing: character.clothing ?? '',
      accessories: character.accessories ?? 'none',
      heightRelative: character.heightRelative ?? '',
      voiceProfile: character.voiceProfile ?? '',
      emotionalCharacteristics: character.emotionalCharacteristics ?? '',
      relationships: Array.isArray(character.relationships)
        ? (character.relationships as SeriesCharacterPlan['relationships'])
        : [],
      secrets: Array.isArray(character.secrets) ? (character.secrets as string[]) : [],
      flaws: Array.isArray(character.flaws) ? (character.flaws as string[]) : [],
      canonicalVisualDescription:
        character.canonicalVisualDescription ?? character.physicalDescription,
      visualConsistencyNotes: character.visualConsistencyNotes ?? '',
    };
  }

  private async assertSeriesOwned(userId: string, seriesId: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      select: { id: true },
    });
    if (!series) throw new NotFoundException('Series not found');
  }

  private async download(url: string): Promise<Buffer> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new BadRequestException(`Failed to download generated image (${response.status})`);
    }
    return Buffer.from(await response.arrayBuffer());
  }
}
