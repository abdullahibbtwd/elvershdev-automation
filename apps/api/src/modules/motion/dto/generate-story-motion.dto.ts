import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateStoryMotionDto {
  @ApiPropertyOptional({
    enum: ['hailuo', 'kling'],
    description: 'Video generation provider (default: VIDEO_GENERATION_PROVIDER / hailuo)',
  })
  @IsOptional()
  @IsIn(['hailuo', 'kling'])
  provider?: 'hailuo' | 'kling';

  @ApiPropertyOptional({ type: [String], description: 'Optional subset of scene IDs' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  sceneIds?: string[];

  @ApiPropertyOptional({
    enum: [5, 6, 10],
    description: 'Clip duration in seconds (Hailuo: 6|10, Kling: 5|10)',
  })
  @IsOptional()
  @IsInt()
  @IsIn([5, 6, 10])
  durationSeconds?: 5 | 6 | 10;

  @ApiPropertyOptional({
    enum: ['720p', '1080p', '512P', '768P'],
    description: 'Clip resolution (Hailuo: 512P|768P, Kling: 720p|1080p)',
  })
  @IsOptional()
  @IsIn(['720p', '1080p', '512P', '768P'])
  resolution?: '720p' | '1080p' | '512P' | '768P';

  @ApiPropertyOptional({ description: 'Optional shared motion prompt override' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2500)
  motionPrompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  negativePrompt?: string;

  @ApiPropertyOptional({
    description: 'Skip Gemini motion analysis and use scene videoPrompt / override',
  })
  @IsOptional()
  @IsBoolean()
  skipAnalysis?: boolean;

  @ApiPropertyOptional({ description: 'Test-only flag to simulate job failure' })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
