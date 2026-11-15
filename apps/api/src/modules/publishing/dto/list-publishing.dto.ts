import { ApiPropertyOptional } from '@nestjs/swagger';
import { PublishStatus, SocialPlatform } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListPublishingDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: PublishStatus })
  @IsOptional()
  @IsEnum(PublishStatus)
  status?: PublishStatus;

  @ApiPropertyOptional({ enum: SocialPlatform })
  @IsOptional()
  @IsEnum(SocialPlatform)
  platform?: SocialPlatform;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoProjectId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoRenderId?: string;
}
