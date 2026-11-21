import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class GenerateSeriesDto {
  @ApiProperty({ description: 'Target SeriesLane id (MORNING or EVENING)' })
  @IsUUID()
  laneId!: string;

  @ApiPropertyOptional({ example: 'Cinematic drama' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  genre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  subgenres?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(300)
  theme?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @ApiPropertyOptional({
    default: 10,
    description: 'Episode count. Ignored when targetStoryDurationSeconds is set (derived instead).',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(120)
  plannedEpisodeCount?: number;

  @ApiPropertyOptional({
    default: 60,
    description: 'Individual episode duration in seconds (default 60). Not movie or clip duration.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(1800)
  targetEpisodeDurationSeconds?: number;

  @ApiPropertyOptional({
    description: 'Complete story/movie duration in seconds. Drives episode count with episode duration.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(3600)
  targetStoryDurationSeconds?: number;

  @ApiPropertyOptional({
    default: 15,
    description: 'Max individual Grok Lite clip duration (≤15). Not episode or movie duration.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(15)
  maxClipDurationSeconds?: number;

  @ApiPropertyOptional({ enum: ['episodic', 'standalone'] })
  @IsOptional()
  @IsIn(['episodic', 'standalone'])
  productionFormat?: 'episodic' | 'standalone';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(8000)
  additionalInstructions?: string;

  @ApiPropertyOptional({
    description: 'Option B: user-provided movie idea/premise to expand into a full plan',
  })
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  customPremise?: string;

  @ApiPropertyOptional({
    description: 'generate = AI invents idea from creative settings; custom = expand customPremise',
    enum: ['generate', 'custom'],
  })
  @IsOptional()
  @IsIn(['generate', 'custom'])
  ideaMode?: 'generate' | 'custom';

  @ApiPropertyOptional({
    description: 'If true, mark as replacement candidate and do not activate',
  })
  @IsOptional()
  @IsBoolean()
  asReplacementCandidate?: boolean;

  @ApiPropertyOptional({
    description: 'Set as the lane active series when planning succeeds (default true unless replacement)',
  })
  @IsOptional()
  @IsBoolean()
  setAsActive?: boolean;

  @ApiPropertyOptional({ description: 'Force mock Gemini (tests / no spend)' })
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;

  @ApiPropertyOptional({
    description: 'Enqueue async planning job instead of running inline',
  })
  @IsOptional()
  @IsBoolean()
  async?: boolean;
}
