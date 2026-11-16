import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class RunSeriesLaneNowDto {
  @ApiPropertyOptional({
    description: 'Force mock AI for planning/production jobs started by Run Now',
  })
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;

  @ApiPropertyOptional({
    description:
      'Optional custom movie premise when Run Now resolves to PLAN_MOVIE (Option B)',
  })
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  customPremise?: string;

  @ApiPropertyOptional({
    description: 'When true with customPremise, expand user idea instead of inventing one',
  })
  @IsOptional()
  @IsBoolean()
  useCustomIdea?: boolean;
}

export class RunAllSeriesNowDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;
}
