import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus, SocialPlatform } from '@prisma/client';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateProjectDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  storyId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3600)
  duration?: number;

  @ApiPropertyOptional({ example: '16:9' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  aspectRatio?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ enum: SocialPlatform, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(SocialPlatform, { each: true })
  targetPlatforms?: SocialPlatform[];
}
