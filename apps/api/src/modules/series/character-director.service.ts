import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaType, Prisma, SeriesCharacterRole } from '@prisma/client';
import {
  SERIES_NOTIFICATION_TYPES,
  buildSeriesCanonicalVisualDescription,
  buildSeriesCharacterReferencePrompt,
  formatCharacterIdentityForClipPrompt,
  seriesCharacterToIdentityProfile,
  updateSeriesCharacterIdentitySchema,
  validateCharactersForClipProduction,
  type SeriesCharacterPlan,
  type UpdateSeriesCharacterIdentityInput,
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
          genderPresentation: c.genderPresentation || null,
          skinTone: c.skinTone || null,
          personality: c.personality,
          motivation: c.motivation,
          backstory: c.backstory,
          physicalDescription: c.physicalDescription,
          facialStructure: c.facialStructure,
          eyeColor: c.eyeColor,
          eyeShape: c.eyeShape,
          hairstyle: c.hairstyle || null,
          hairFurColor: c.hairFurColor,
          facialHair: c.facialHair || null,
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
          approvedAt: null,
          sortOrder: i,
        },
      });
      created.push(row);
    }
    return created;
  }

  async getCharacter(userId: string, seriesId: string, characterId: string) {
    await this.assertSeriesOwned(userId, seriesId);
    const character = await this.prisma.seriesCharacter.findFirst({
      where: { id: characterId, seriesId },
      include: {
        referenceAssets: {
          orderBy: [{ isPrimary: 'desc' }, { version: 'desc' }],
          include: { mediaAsset: true },
        },
        characterVoice: true,
      },
    });
    if (!character) throw new NotFoundException('Series character not found');
    return {
      ...character,
      identityProfile: seriesCharacterToIdentityProfile(character),
      clipPromptPreview: formatCharacterIdentityForClipPrompt(
        seriesCharacterToIdentityProfile(character),
      ),
    };
  }

  /**
   * Update identity fields. Bumps identityVersion and clears approval so users
   * must re-approve after edits. Optionally rebuilds canonical description.
   */
  async updateIdentity(
    userId: string,
    seriesId: string,
    characterId: string,
    raw: UpdateSeriesCharacterIdentityInput,
  ) {
    await this.assertSeriesOwned(userId, seriesId);
    const parsed = updateSeriesCharacterIdentitySchema.safeParse(raw);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }
    const input = parsed.data;

    const existing = await this.prisma.seriesCharacter.findFirst({
      where: { id: characterId, seriesId },
    });
    if (!existing) throw new NotFoundException('Series character not found');

    const next = {
      ageRange: input.ageRange ?? existing.ageRange,
      genderPresentation:
        input.genderPresentation !== undefined
          ? input.genderPresentation
          : existing.genderPresentation,
      skinTone: input.skinTone !== undefined ? input.skinTone : existing.skinTone,
      facialStructure:
        input.facialStructure !== undefined
          ? input.facialStructure
          : existing.facialStructure,
      eyeColor: input.eyeColor !== undefined ? input.eyeColor : existing.eyeColor,
      eyeShape: input.eyeShape !== undefined ? input.eyeShape : existing.eyeShape,
      hairstyle: input.hairstyle !== undefined ? input.hairstyle : existing.hairstyle,
      hairFurColor:
        input.hairFurColor !== undefined ? input.hairFurColor : existing.hairFurColor,
      facialHair:
        input.facialHair !== undefined ? input.facialHair : existing.facialHair,
      bodyProportions:
        input.bodyProportions !== undefined
          ? input.bodyProportions
          : existing.bodyProportions,
      heightRelative:
        input.heightRelative !== undefined
          ? input.heightRelative
          : existing.heightRelative,
      clothing: input.clothing !== undefined ? input.clothing : existing.clothing,
      accessories:
        input.accessories !== undefined ? input.accessories : existing.accessories,
      markings: input.markings !== undefined ? input.markings : existing.markings,
      voiceProfile:
        input.voiceProfile !== undefined ? input.voiceProfile : existing.voiceProfile,
      personality: input.personality ?? existing.personality,
      physicalDescription: input.physicalDescription ?? existing.physicalDescription,
      visualConsistencyNotes:
        input.visualConsistencyNotes !== undefined
          ? input.visualConsistencyNotes
          : existing.visualConsistencyNotes,
    };

    let canonicalVisualDescription =
      input.canonicalVisualDescription !== undefined
        ? input.canonicalVisualDescription
        : existing.canonicalVisualDescription;

    if (input.rebuildCanonicalDescription || !canonicalVisualDescription?.trim()) {
      canonicalVisualDescription = buildSeriesCanonicalVisualDescription({
        name: existing.name,
        role: existing.role,
        species: existing.species,
        ...next,
        ageDescription: next.ageRange,
        defaultClothing: next.clothing,
      });
    }

    const updated = await this.prisma.seriesCharacter.update({
      where: { id: characterId },
      data: {
        ...next,
        canonicalVisualDescription,
        identityVersion: existing.identityVersion + 1,
        approvedAt: null,
      },
      include: {
        referenceAssets: {
          orderBy: [{ isPrimary: 'desc' }, { version: 'desc' }],
          include: { mediaAsset: true },
        },
      },
    });

    this.logger.log(
      `Series character identity updated character=${characterId} version=${updated.identityVersion}`,
    );
    return {
      ...updated,
      identityProfile: seriesCharacterToIdentityProfile(updated),
      clipPromptPreview: formatCharacterIdentityForClipPrompt(
        seriesCharacterToIdentityProfile(updated),
      ),
    };
  }

  async approveIdentity(userId: string, seriesId: string, characterId: string) {
    await this.assertSeriesOwned(userId, seriesId);
    const existing = await this.prisma.seriesCharacter.findFirst({
      where: { id: characterId, seriesId },
    });
    if (!existing) throw new NotFoundException('Series character not found');

    let canonical = existing.canonicalVisualDescription?.trim();
    if (!canonical) {
      canonical = buildSeriesCanonicalVisualDescription(
        seriesCharacterToIdentityProfile(existing),
      );
    }

    const updated = await this.prisma.seriesCharacter.update({
      where: { id: characterId },
      data: {
        canonicalVisualDescription: canonical,
        approvedAt: new Date(),
      },
      include: {
        referenceAssets: {
          orderBy: [{ isPrimary: 'desc' }, { version: 'desc' }],
          include: { mediaAsset: true },
        },
      },
    });

    return {
      ...updated,
      identityProfile: seriesCharacterToIdentityProfile(updated),
    };
  }

  async approveAllIdentities(userId: string, seriesId: string) {
    const characters = await this.listCharacters(userId, seriesId);
    const results = [];
    for (const character of characters) {
      results.push(await this.approveIdentity(userId, seriesId, character.id));
    }
    return results;
  }

  /**
   * Pre-clip continuity validation for appearing characters.
   */
  async validateClipCharacters(input: {
    userId: string;
    seriesId: string;
    appearingCharacterNames: string[];
    requireApproved?: boolean;
    screenplayClothingByCharacter?: Record<string, string | undefined>;
    screenplayAppearanceNotesByCharacter?: Record<string, string | undefined>;
  }) {
    const characters = await this.listCharacters(input.userId, input.seriesId);
    const profilesByName: Record<string, ReturnType<typeof seriesCharacterToIdentityProfile>> =
      {};
    for (const character of characters) {
      const profile = seriesCharacterToIdentityProfile(character);
      profilesByName[character.name] = profile;
      profilesByName[character.name.toLowerCase()] = profile;
    }
    return validateCharactersForClipProduction({
      appearingCharacterNames: input.appearingCharacterNames,
      profilesByName,
      requireApproved: input.requireApproved,
      screenplayClothingByCharacter: input.screenplayClothingByCharacter,
      screenplayAppearanceNotesByCharacter: input.screenplayAppearanceNotesByCharacter,
    });
  }

  buildClipIdentityPromptBlock(
    characters: Array<Parameters<typeof seriesCharacterToIdentityProfile>[0]>,
    appearingNames: string[],
    clothingOverrides?: Record<string, string | undefined>,
  ): string {
    const byName = new Map(
      characters.map((character) => [character.name.toLowerCase(), character]),
    );
    return appearingNames
      .map((name) => {
        const character = byName.get(name.toLowerCase());
        if (!character) return `CHARACTER: ${name}\nWARNING: missing series identity profile.`;
        return formatCharacterIdentityForClipPrompt(
          seriesCharacterToIdentityProfile(character),
          { clothingOverride: clothingOverrides?.[name] },
        );
      })
      .join('\n\n');
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
      include: { series: { select: { visualStyle: true } } },
    });
    if (!character) throw new NotFoundException('Series character not found');

    const plan = this.toPlan(character);
    const prompt = buildSeriesCharacterReferencePrompt(plan, {
      visualStyle: character.series.visualStyle,
    });
    const image = await this.fal.generateImage({
      prompt,
      // Match Series Studio / TikTok vertical so I2V refs don't force landscape clips.
      aspectRatio: '9:16',
      negativePrompt:
        'photorealistic, live-action photo, real human skin pores, chibi, deformed face, text, watermark, collage, low quality, 16:9 landscape',
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

  async setPrimaryReference(userId: string, seriesId: string, assetId: string) {
    const asset = await this.prisma.characterReferenceAsset.findFirst({
      where: {
        id: assetId,
        seriesCharacter: { seriesId, series: { userId } },
      },
    });
    if (!asset) throw new NotFoundException('Character reference asset not found');

    await this.prisma.characterReferenceAsset.updateMany({
      where: { seriesCharacterId: asset.seriesCharacterId, isPrimary: true },
      data: { isPrimary: false },
    });

    return this.prisma.characterReferenceAsset.update({
      where: { id: assetId },
      data: {
        isPrimary: true,
        isApproved: true,
        approvedAt: asset.approvedAt ?? new Date(),
      },
      include: { mediaAsset: true },
    });
  }

  async generateReferencesForSeries(userId: string, seriesId: string) {
    const characters = await this.listCharacters(userId, seriesId);
    const results: Array<{
      characterId: string;
      skipped: boolean;
      assetId?: string;
      error?: string;
    }> = [];
    for (const character of characters) {
      const existingApproved = character.referenceAssets.find((a) => a.isApproved && a.isPrimary);
      if (existingApproved) {
        results.push({ characterId: character.id, skipped: true, assetId: existingApproved.id });
        continue;
      }
      try {
        const asset = await this.generateReferencePortrait({
          userId,
          seriesId,
          characterId: character.id,
        });
        results.push({ characterId: character.id, skipped: false, assetId: asset.id });
      } catch (error) {
        const message = (error as Error).message;
        this.logger.warn(
          `Reference portrait failed character=${character.id} series=${seriesId}: ${message}`,
        );
        results.push({ characterId: character.id, skipped: false, error: message });
      }
    }

    const minted = results.filter((r) => r.assetId && !r.skipped).length;
    if (minted > 0 || results.every((r) => r.skipped)) {
      await this.notifications.notify({
        userId,
        type: SERIES_NOTIFICATION_TYPES.MOVIE_PLANNED,
        title: 'Character references ready',
        body: `Generated or reused reference portraits for series ${seriesId}.`,
        dedupeKey: `series-char-refs:${seriesId}:${results
          .map((r) => r.assetId)
          .filter(Boolean)
          .join(',')}`,
        metadata: { seriesId },
      });
    }

    return results;
  }

  private toPlan(character: {
    name: string;
    role: SeriesCharacterRole;
    species: string;
    ageRange: string | null;
    genderPresentation?: string | null;
    skinTone?: string | null;
    personality: string;
    motivation: string;
    backstory: string;
    physicalDescription: string;
    facialStructure: string | null;
    eyeColor: string | null;
    eyeShape: string | null;
    hairstyle?: string | null;
    hairFurColor: string | null;
    facialHair?: string | null;
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
      genderPresentation: character.genderPresentation ?? '',
      skinTone: character.skinTone ?? '',
      personality: character.personality,
      motivation: character.motivation,
      backstory: character.backstory,
      physicalDescription: character.physicalDescription,
      facialStructure: character.facialStructure ?? '',
      eyeColor: character.eyeColor ?? '',
      eyeShape: character.eyeShape ?? '',
      hairstyle: character.hairstyle ?? '',
      hairFurColor: character.hairFurColor ?? '',
      facialHair: character.facialHair ?? '',
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
