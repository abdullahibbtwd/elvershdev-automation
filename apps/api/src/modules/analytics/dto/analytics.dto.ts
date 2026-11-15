import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export enum AnalyticsDatePreset {
  LAST_7_DAYS = 'last_7_days',
  LAST_30_DAYS = 'last_30_days',
  LAST_90_DAYS = 'last_90_days',
  THIS_MONTH = 'this_month',
  PREVIOUS_MONTH = 'previous_month',
  CUSTOM = 'custom',
}

export class AnalyticsRangeDto {
  @IsOptional()
  @IsEnum(AnalyticsDatePreset)
  preset: AnalyticsDatePreset = AnalyticsDatePreset.LAST_30_DAYS;

  @ValidateIf((value: AnalyticsRangeDto) => value.preset === AnalyticsDatePreset.CUSTOM)
  @IsDateString()
  from?: string;

  @ValidateIf((value: AnalyticsRangeDto) => value.preset === AnalyticsDatePreset.CUSTOM)
  @IsDateString()
  to?: string;
}

export class AnalyticsListDto extends AnalyticsRangeDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;

  @IsOptional()
  @IsString()
  platform?: string;
}

export class StartAnalyticsSyncDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @IsOptional()
  @IsBoolean()
  useMockAnalytics?: boolean;
}

export class UpdateAnalyticsSettingsDto {
  @IsOptional() @IsBoolean() performanceOptimizationEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) minSampleSizeForOptimization?: number;
  @IsOptional() @IsBoolean() preferStrongCategories?: boolean;
  @IsOptional() @IsBoolean() avoidWeakFormats?: boolean;
  @IsOptional() @IsBoolean() suggestDurationAdjustments?: boolean;
  @IsOptional() @IsBoolean() suggestCaptionExperiments?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100) diversityFloorPercent?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(7) @Max(365) insightLookbackDays?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) syncRecentHours?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) syncOlderHours?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) recentPostMaxAgeDays?: number;
}
