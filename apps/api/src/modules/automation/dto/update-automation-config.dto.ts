import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  Matches,
} from 'class-validator';

export class UpdateAutomationConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({ default: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  dailyGenerationTarget?: number;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  monthlyGenerationTarget?: number;

  @ApiPropertyOptional({ example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  timezone?: string;

  @ApiPropertyOptional({ example: [1, 2, 3, 4, 5] })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  preferredPublishingDays?: number[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  includeWeekends?: boolean;

  @ApiPropertyOptional({ example: '09:00' })
  @IsOptional()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  publishingWindowStart?: string;

  @ApiPropertyOptional({ example: '21:00' })
  @IsOptional()
  @Matches(/^([01]?\d|2[0-3]):[0-5]\d$/)
  publishingWindowEnd?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  platformPublishingTimes?: Record<string, string>;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(24 * 60)
  minIntervalMinutes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  maxDailyPublishingAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  channelPublishingEnabled?: Record<string, boolean>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  activeChannelIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contentCategories?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  storyGenres?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  themes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(600)
  targetDurationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  visualStyleId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  narrationVoiceId?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  contentExclusions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  brandIdentity?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10)
  maxConcurrentGeneration?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxConcurrentPublishing?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  maxRetries?: number;

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
  maxCostPerVideoUsd?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxGenerationAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxImageGenerationsPerScene?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxMotionAttemptsPerScene?: number;
}
