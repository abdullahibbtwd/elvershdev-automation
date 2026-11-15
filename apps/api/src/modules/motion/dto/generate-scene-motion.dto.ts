import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateSceneMotionDto {
  @ApiPropertyOptional({
    enum: ['hailuo', 'kling'],
    description: 'Video generation provider (default: VIDEO_GENERATION_PROVIDER / hailuo)',
  })
  @IsOptional()
  @IsIn(['hailuo', 'kling'])
  provider?: 'hailuo' | 'kling';

  @ApiPropertyOptional({ enum: [5, 6, 10] })
  @IsOptional()
  @IsInt()
  @IsIn([5, 6, 10])
  durationSeconds?: 5 | 6 | 10;

  @ApiPropertyOptional({ enum: ['720p', '1080p', '512P', '768P'] })
  @IsOptional()
  @IsIn(['720p', '1080p', '512P', '768P'])
  resolution?: '720p' | '1080p' | '512P' | '768P';

  @ApiPropertyOptional()
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

  @ApiPropertyOptional({ description: 'Specific completed SceneVisual to use as source image' })
  @IsOptional()
  @IsUUID()
  sourceVisualId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  skipAnalysis?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
