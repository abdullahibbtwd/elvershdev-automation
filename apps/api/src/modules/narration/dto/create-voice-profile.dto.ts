import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GEMINI_PREBUILT_VOICE_IDS } from '@ai-video/shared';
import {
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateVoiceProfileDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ enum: ['gemini'], default: 'gemini' })
  @IsOptional()
  @IsIn(['gemini'])
  provider?: 'gemini';

  @ApiProperty({ enum: GEMINI_PREBUILT_VOICE_IDS })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @IsIn(GEMINI_PREBUILT_VOICE_IDS, { message: 'Unsupported Gemini prebuilt voice id' })
  providerVoiceId!: string;

  @ApiPropertyOptional({ default: 'en' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(16)
  language?: string;

  @ApiPropertyOptional({
    description: 'Voice configuration: { speakingStyle?: string; language?: string }',
  })
  @IsOptional()
  @IsObject()
  configuration?: { speakingStyle?: string; language?: string };

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
