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
  @ApiPropertyOptional({ type: [String], description: 'Optional subset of scene IDs' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  sceneIds?: string[];

  @ApiPropertyOptional({ enum: [5, 10], description: 'Kling clip duration in seconds' })
  @IsOptional()
  @IsInt()
  @IsIn([5, 10])
  durationSeconds?: 5 | 10;

  @ApiPropertyOptional({ enum: ['720p', '1080p'] })
  @IsOptional()
  @IsIn(['720p', '1080p'])
  resolution?: '720p' | '1080p';

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
