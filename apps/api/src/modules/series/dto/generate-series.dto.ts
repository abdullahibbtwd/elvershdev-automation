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

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(2)
  @Max(60)
  plannedEpisodeCount?: number;

  @ApiPropertyOptional({ default: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(15)
  @Max(600)
  targetEpisodeDurationSeconds?: number;

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
