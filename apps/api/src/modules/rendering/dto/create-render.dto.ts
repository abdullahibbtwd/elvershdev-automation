import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DEFAULT_VIDEO_OUTPUT_PROFILE_ID, VIDEO_OUTPUT_PROFILES } from '@ai-video/shared';

const PROFILE_IDS = Object.keys(VIDEO_OUTPUT_PROFILES);

class SubtitleStyleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  font?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(12)
  @Max(96)
  fontSize?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  primaryColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  outlineColor?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  outlineWidth?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(8)
  shadow?: number;

  @ApiPropertyOptional({ enum: ['bottom', 'center', 'top', 'lower'] })
  @IsOptional()
  @IsIn(['bottom', 'center', 'top', 'lower'])
  alignment?: 'bottom' | 'center' | 'top' | 'lower';

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(800)
  marginV?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(4)
  maxLines?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(12)
  @Max(80)
  maxCharsPerLine?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  backgroundBox?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  backgroundOpacity?: number;
}

class AudioMixDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  narrationVolume?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  musicVolume?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  sfxVolume?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  duckingEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  fadeInSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(5)
  fadeOutSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  sceneGapSeconds?: number;
}

export class CreateRenderDto {
  @ApiPropertyOptional({ enum: PROFILE_IDS, default: DEFAULT_VIDEO_OUTPUT_PROFILE_ID })
  @IsOptional()
  @IsString()
  @IsIn(PROFILE_IDS)
  profileId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  subtitleEnabled?: boolean;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  subtitleBurnedIn?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  backgroundMusicAssetId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1.5)
  transitionDurationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  scenePaddingSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  kenBurnsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1.2)
  kenBurnsZoom?: number;

  @ApiPropertyOptional({ enum: ['crop', 'blur_pad'] })
  @IsOptional()
  @IsIn(['crop', 'blur_pad'])
  fitMode?: 'crop' | 'blur_pad';

  @ApiPropertyOptional({
    enum: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'],
  })
  @IsOptional()
  @IsIn(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'])
  qualityPreset?: string;

  @ApiPropertyOptional({ type: SubtitleStyleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubtitleStyleDto)
  subtitleStyle?: SubtitleStyleDto;

  @ApiPropertyOptional({ type: AudioMixDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudioMixDto)
  audioMix?: AudioMixDto;

  @ApiPropertyOptional({ description: 'Test-only simulated failure' })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}

export class UpdateRenderSettingsDto {
  @ApiPropertyOptional({ enum: PROFILE_IDS })
  @IsOptional()
  @IsString()
  @IsIn(PROFILE_IDS)
  profileId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subtitleEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  subtitleBurnedIn?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  backgroundMusicAssetId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1.5)
  transitionDurationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(2)
  scenePaddingSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  kenBurnsEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(1.2)
  kenBurnsZoom?: number;

  @ApiPropertyOptional({ enum: ['crop', 'blur_pad'] })
  @IsOptional()
  @IsIn(['crop', 'blur_pad'])
  fitMode?: 'crop' | 'blur_pad';

  @ApiPropertyOptional()
  @IsOptional()
  @IsIn(['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow'])
  qualityPreset?: string;

  @ApiPropertyOptional({ type: SubtitleStyleDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => SubtitleStyleDto)
  @IsObject()
  subtitleStyle?: SubtitleStyleDto;

  @ApiPropertyOptional({ type: AudioMixDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AudioMixDto)
  @IsObject()
  audioMix?: AudioMixDto;
}
