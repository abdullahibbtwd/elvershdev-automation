import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GenerationJobType } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class CreateJobDto {
  @ApiProperty({ enum: GenerationJobType })
  @IsEnum(GenerationJobType)
  jobType!: GenerationJobType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoProjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10_000)
  estimatedCost?: number;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;

  @ApiPropertyOptional({
    description: 'Test-only flag to force placeholder worker failure',
  })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
