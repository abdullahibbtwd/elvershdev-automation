import { ApiPropertyOptional } from '@nestjs/swagger';
import { GEMINI_PREBUILT_VOICE_IDS } from '@ai-video/shared';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateStoryAudioDto {
  @ApiPropertyOptional({ description: 'Saved voice profile id' })
  @IsOptional()
  @IsUUID()
  voiceProfileId?: string;

  @ApiPropertyOptional({
    enum: GEMINI_PREBUILT_VOICE_IDS,
    description: 'Gemini prebuilt voice id (used when no voice profile is supplied)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsIn(GEMINI_PREBUILT_VOICE_IDS, { message: 'Unsupported Gemini prebuilt voice id' })
  providerVoiceId?: string;

  @ApiPropertyOptional({ description: 'Override speaking style (speech_metadata.style)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  speakingStyle?: string;

  @ApiPropertyOptional({ type: [String], description: 'Optional subset of scene IDs' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  sceneIds?: string[];

  @ApiPropertyOptional({ description: 'Regenerate scenes that already have completed audio' })
  @IsOptional()
  @IsBoolean()
  forceRegenerate?: boolean;

  @ApiPropertyOptional({ description: 'Test-only flag to simulate job failure' })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;

  @ApiPropertyOptional({ description: 'Force mock AI (tests / local without API key)' })
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;
}
