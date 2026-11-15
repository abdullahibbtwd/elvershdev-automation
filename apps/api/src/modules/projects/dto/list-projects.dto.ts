import { ApiPropertyOptional } from '@nestjs/swagger';
import { ProjectStatus, SocialPlatform } from '@prisma/client';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListProjectsDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;

  @ApiPropertyOptional({ enum: ProjectStatus })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({ enum: SocialPlatform })
  @IsOptional()
  @IsEnum(SocialPlatform)
  platform?: SocialPlatform;
}
