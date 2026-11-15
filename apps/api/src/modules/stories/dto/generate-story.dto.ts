import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class GenerateStoryDto {
  @ApiProperty({ example: 'A founder who almost quit before their big break' })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  topic!: string;

  @ApiProperty({ example: 'Motivation' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  niche!: string;

  @ApiProperty({ example: 'Aspiring entrepreneurs' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  targetAudience!: string;

  @ApiPropertyOptional({ example: 'en', default: 'en' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(10)
  language?: string;

  @ApiProperty({ example: 'Inspirational' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  tone!: string;

  @ApiProperty({ example: 60 })
  @IsInt()
  @Min(15)
  @Max(600)
  desiredDurationSeconds!: number;

  @ApiProperty({ example: 'Narrative' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  category!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  additionalInstructions?: string;
}
