import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PlanMovieLaneDto {
  @IsUUID()
  laneId!: string;

  @ApiPropertyOptional({ enum: ['generate', 'custom'] })
  @IsOptional()
  @IsIn(['generate', 'custom'])
  ideaMode?: 'generate' | 'custom';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(12000)
  customPremise?: string;
}

export class PlanMoviesDto {
  @ApiPropertyOptional({
    description: 'Lanes to plan. Defaults to all enabled lanes when omitted.',
    type: [PlanMovieLaneDto],
  })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PlanMovieLaneDto)
  lanes?: PlanMovieLaneDto[];

  @ApiPropertyOptional({
    description:
      'When true, also start expensive media after approval eligibility. Default false (plan only).',
  })
  @IsOptional()
  @IsBoolean()
  startMediaProduction?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;

  @ApiPropertyOptional({ description: 'Enqueue async planning jobs (default true)' })
  @IsOptional()
  @IsBoolean()
  async?: boolean;
}

export class PrepareNextEpisodesDto {
  @ApiPropertyOptional({ description: 'Limit to these lane ids; default all enabled' })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  laneIds?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;

  @ApiPropertyOptional({
    description: 'When true, ignore production window and start eligible work now',
  })
  @IsOptional()
  @IsBoolean()
  ignoreScheduleWindow?: boolean;
}
