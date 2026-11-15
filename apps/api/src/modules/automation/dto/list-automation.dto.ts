import { ApiPropertyOptional } from '@nestjs/swagger';
import { ContentPlanStatus, ContentScheduleStatus, AutomationExecutionStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListPlansDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(ContentPlanStatus)
  status?: ContentPlanStatus;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}

export class ListExecutionsDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsEnum(AutomationExecutionStatus)
  status?: AutomationExecutionStatus;

  @IsOptional()
  @IsString()
  contentScheduleId?: string;
}

export class CalendarQueryDto {
  @ApiPropertyOptional({ enum: ['day', 'week', 'month'], default: 'week' })
  @IsOptional()
  @IsString()
  view?: 'day' | 'week' | 'month';

  @ApiPropertyOptional({ description: 'Anchor date YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  date?: string;
}

export class RescheduleCalendarDto {
  @IsDateString()
  scheduledGenerationAt!: string;

  @IsOptional()
  @IsDateString()
  scheduledPublishAt?: string;
}

export class CreatePlanDto {
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(50)
  slotIndex?: number;

  @IsOptional()
  @IsString()
  ideaTitle?: string;

  @IsOptional()
  @IsString()
  ideaSummary?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsString()
  genre?: string;

  @IsOptional()
  @IsString()
  theme?: string;

  @IsOptional()
  @IsString()
  topic?: string;
}

export class ListSchedulesFilter {
  @IsOptional()
  @IsEnum(ContentScheduleStatus)
  status?: ContentScheduleStatus;
}
