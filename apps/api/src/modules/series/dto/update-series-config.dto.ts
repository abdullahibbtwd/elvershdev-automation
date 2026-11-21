import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const PRODUCTION_START_MODES = ['IMMEDIATE', 'NEXT_WINDOW', 'CUSTOM', 'MANUAL'] as const;
const AUTONOMY_MODES = ['MANUAL', 'FULLY_AUTONOMOUS'] as const;

export class UpdateSeriesConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  seriesStudioEnabled?: boolean;

  @ApiPropertyOptional({
    enum: AUTONOMY_MODES,
    description:
      'MANUAL = legacy approval workflow. FULLY_AUTONOMOUS overrides routine movie/episode/replacement approval gates. Independent of mock AI.',
  })
  @IsOptional()
  @IsIn(AUTONOMY_MODES)
  autonomyMode?: (typeof AUTONOMY_MODES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  morningLaneEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  eveningLaneEnabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticMoviePlanning?: boolean;

  @ApiPropertyOptional({
    description:
      'Master switch for automatic episode scripting + media. Individual stage switches still apply.',
  })
  @IsOptional()
  @IsBoolean()
  automaticEpisodeProduction?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticCharacterGeneration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticEpisodeScriptGeneration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticVisualGeneration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticMotionGeneration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticNarration?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticRendering?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticPublishing?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  automaticReplacementPlanning?: boolean;

  @ApiPropertyOptional({ description: 'Default OFF — replacements require manual approval' })
  @IsOptional()
  @IsBoolean()
  automaticReplacementApproval?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  episodeApprovalRequired?: boolean;

  @ApiPropertyOptional({ description: 'When true, movie plans require human approval before production' })
  @IsOptional()
  @IsBoolean()
  movieApprovalRequired?: boolean;

  @ApiPropertyOptional({
    description: 'If false, planning movies never auto-starts expensive media production',
  })
  @IsOptional()
  @IsBoolean()
  startMediaAfterMoviePlanning?: boolean;

  @ApiPropertyOptional({ enum: PRODUCTION_START_MODES })
  @IsOptional()
  @IsIn(PRODUCTION_START_MODES)
  defaultProductionStartMode?: (typeof PRODUCTION_START_MODES)[number];

  @ApiPropertyOptional({ default: 240, description: 'Default minutes before publish to start production' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  defaultProductionLeadTimeMinutes?: number;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  defaultPlannedEpisodeCount?: number;

  @ApiPropertyOptional({
    default: 60,
    description: 'Individual episode duration default (seconds). Not complete-story or clip duration.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1800)
  defaultEpisodeDurationSeconds?: number;

  @ApiPropertyOptional({
    description:
      'Complete story/movie duration default (seconds). Null keeps legacy count×episode derivation.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(3600)
  defaultStoryDurationSeconds?: number | null;

  @ApiPropertyOptional({
    default: 15,
    description: 'Max Grok Lite clip duration (≤15s). Independent from episode/story duration.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(15)
  defaultMaxClipDurationSeconds?: number;

  @ApiPropertyOptional({ enum: ['episodic', 'standalone'] })
  @IsOptional()
  @IsIn(['episodic', 'standalone'])
  defaultProductionFormat?: 'episodic' | 'standalone';

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  defaultReplacementTriggerEpisode?: number;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(4)
  maxConcurrentEpisodeProduction?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

  @ApiPropertyOptional({ default: 0.7 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  qualityAcceptanceThreshold?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  visualDirection?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  visualStyleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  narrationVoiceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  activeChannelIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  channelPublishingEnabled?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  dailyBudgetUsd?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  monthlyBudgetUsd?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxCostPerEpisodeUsd?: number | null;

  @ApiPropertyOptional({
    description: 'Global Series Creative Settings (does not affect standalone automation)',
  })
  @IsOptional()
  @IsObject()
  creativeSettings?: Record<string, unknown>;
}
