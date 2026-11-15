import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class PlatformPublishSettingsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  privacyStatus?: string;

  @ApiPropertyOptional()
  @IsOptional()
  disableComment?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  disableDuet?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  disableStitch?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  brandContentToggle?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  brandOrganicToggle?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  isAigc?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  isAiGenerated?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  madeForKids?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  notifySubscribers?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  categoryId?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  tags?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  thumbOffsetMs?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  coverUrl?: string;

  @ApiPropertyOptional()
  @IsOptional()
  shareToFeed?: boolean;
}

export class ChannelPublishTargetDto {
  @ApiProperty()
  @IsUUID()
  channelId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  hashtags?: string[];

  @ApiPropertyOptional({ type: PlatformPublishSettingsDto })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => PlatformPublishSettingsDto)
  platformSettings?: PlatformPublishSettingsDto;
}

export class PublishRenderDefaultsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(30)
  hashtags?: string[];
}

export class PublishRenderDto {
  @ApiProperty({ type: [ChannelPublishTargetDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ChannelPublishTargetDto)
  targets!: ChannelPublishTargetDto[];

  @ApiPropertyOptional({ type: PublishRenderDefaultsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PublishRenderDefaultsDto)
  defaults?: PublishRenderDefaultsDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey?: string;
}
