import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PlatformPublishSettingsDto } from './publish-render.dto';

export class UpdatePublicationDto {
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
