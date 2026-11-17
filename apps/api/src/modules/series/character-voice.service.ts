import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildSpeakingStyleForEmotion,
  pickStableGeminiVoiceForCharacter,
} from '@ai-video/shared';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CharacterVoiceService {
  private readonly logger = new Logger(CharacterVoiceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Assign a persistent Gemini prebuilt voice to every series character that lacks one.
   * Never rotates an existing locked assignment.
   */
  async assignVoicesForSeries(userId: string, seriesId: string) {
    const series = await this.prisma.storySeries.findFirst({
      where: { id: seriesId, userId },
      include: {
        characters: {
          orderBy: { sortOrder: 'asc' },
          include: { characterVoice: true },
        },
      },
    });
    if (!series) throw new NotFoundException('Series not found');

    const usedVoiceIds = series.characters
      .map((c) => c.characterVoice?.providerVoiceId)
      .filter((id): id is string => Boolean(id));

    const assigned = [];
    for (const character of series.characters) {
      if (character.characterVoice?.consistencyLocked) {
        assigned.push(character.characterVoice);
        continue;
      }

      const providerVoiceId =
        character.characterVoice?.providerVoiceId ||
        pickStableGeminiVoiceForCharacter(character.name, usedVoiceIds);
      usedVoiceIds.push(providerVoiceId);

      const voiceProfileName = `Series:${seriesId}:${character.name}`;
      const voiceProfile = await this.prisma.voiceProfile.upsert({
        where: { userId_name: { userId, name: voiceProfileName } },
        create: {
          userId,
          name: voiceProfileName,
          provider: 'gemini',
          providerVoiceId,
          language: series.language || 'en',
          configuration: {
            seriesId,
            seriesCharacterId: character.id,
            source: 'series_character_voice',
          } as Prisma.InputJsonValue,
          isDefault: false,
        },
        update: {
          providerVoiceId,
          configuration: {
            seriesId,
            seriesCharacterId: character.id,
            source: 'series_character_voice',
          } as Prisma.InputJsonValue,
        },
      });

      const row = await this.prisma.seriesCharacterVoice.upsert({
        where: { seriesCharacterId: character.id },
        create: {
          seriesCharacterId: character.id,
          voiceProfileId: voiceProfile.id,
          provider: 'gemini',
          providerVoiceId,
          voiceDescription: character.voiceProfile || `${character.name} speaking voice`,
          genderPresentation: '',
          approximateVocalAge: character.ageRange || '',
          accent: '',
          pitch: 'medium',
          speakingStyle: 'natural conversational',
          emotionalRange: [
            'angry',
            'sad',
            'happy',
            'frightened',
            'suspicious',
            'calm',
            'excited',
            'whispering',
          ],
          speechSpeed: 'normal',
          consistencyLocked: true,
        },
        update: character.characterVoice?.consistencyLocked
          ? {}
          : {
              voiceProfileId: voiceProfile.id,
              providerVoiceId,
              voiceDescription: character.voiceProfile || undefined,
            },
      });
      assigned.push(row);
    }

    this.logger.log(
      `Assigned ${assigned.length} character voices for series ${seriesId}`,
    );
    return assigned;
  }

  async getVoiceMap(seriesId: string) {
    const characters = await this.prisma.seriesCharacter.findMany({
      where: { seriesId },
      include: { characterVoice: { include: { voiceProfile: true } } },
    });
    const map = new Map<
      string,
      {
        characterId: string;
        voiceProfileId: string;
        providerVoiceId: string;
        speakingStyle: string;
      }
    >();
    for (const character of characters) {
      const voice = character.characterVoice;
      if (!voice) continue;
      map.set(character.name.toLowerCase(), {
        characterId: character.id,
        voiceProfileId: voice.voiceProfileId,
        providerVoiceId: voice.providerVoiceId,
        speakingStyle: voice.speakingStyle || 'natural conversational',
      });
    }
    return map;
  }

  speakingStyleFor(baseStyle: string, emotion: string) {
    return buildSpeakingStyleForEmotion(baseStyle, emotion);
  }
}
