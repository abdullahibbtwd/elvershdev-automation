import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SocialPlatform } from '@prisma/client';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateChannelDto {
  @ApiProperty({ enum: SocialPlatform })
  @IsEnum(SocialPlatform)
  platform!: SocialPlatform;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  accountName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  platformAccountId!: string;

  @ApiPropertyOptional({
    description: 'OAuth access token (encrypted at rest). Placeholder allowed in Phase 3.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  accessToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
