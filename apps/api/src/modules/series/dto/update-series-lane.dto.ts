import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

const PRODUCTION_START_MODES = ['IMMEDIATE', 'NEXT_WINDOW', 'CUSTOM', 'MANUAL'] as const;

export class UpdateSeriesLaneDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  publishTime?: string;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ default: 240, description: 'Minutes before publishTime to open production window' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(24 * 60)
  productionLeadTimeMinutes?: number;

  @ApiPropertyOptional({ example: '04:00', description: 'Optional preferred production start HH:MM' })
  @IsOptional()
  @ValidateIf((_, value) => value !== null && value !== undefined && value !== '')
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  preferredProductionTime?: string | null;

  @ApiPropertyOptional({ enum: PRODUCTION_START_MODES })
  @IsOptional()
  @IsIn(PRODUCTION_START_MODES)
  productionStartMode?: (typeof PRODUCTION_START_MODES)[number];

  @ApiPropertyOptional({ description: 'Required when productionStartMode is CUSTOM' })
  @IsOptional()
  @IsDateString()
  customProductionStartAt?: string | null;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  plannedEpisodeCount?: number;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1800)
  targetEpisodeDurationSeconds?: number;

  @ApiPropertyOptional({ description: 'Complete story/movie duration for this lane' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(3600)
  targetStoryDurationSeconds?: number | null;

  @ApiPropertyOptional({ default: 15, description: 'Max Grok Lite clip seconds (≤15)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(15)
  maxClipDurationSeconds?: number;

  @ApiPropertyOptional({ default: 8 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  replacementTriggerEpisode?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  activeSeriesId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  publishingConfig?: Record<string, unknown>;

  @ApiPropertyOptional({ description: 'Lane-specific creative settings' })
  @IsOptional()
  @IsObject()
  creativeSettings?: Record<string, unknown>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(1000)
  sortOrder?: number;
}
