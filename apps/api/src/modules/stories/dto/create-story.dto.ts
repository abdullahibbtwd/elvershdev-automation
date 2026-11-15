import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { StoryStatus } from '@prisma/client';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateStoryDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(50_000)
  content!: string;

  @ApiPropertyOptional({ enum: StoryStatus, default: StoryStatus.DRAFT })
  @IsOptional()
  @IsEnum(StoryStatus)
  status?: StoryStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  topic?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  niche?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  targetAudience?: string;

  @ApiPropertyOptional({ default: 'en' })
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
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(600)
  targetDurationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  openingHook?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  narrationScript?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  closingMessage?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5_000)
  description?: string;
}
