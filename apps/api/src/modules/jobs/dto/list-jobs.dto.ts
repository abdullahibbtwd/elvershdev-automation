import { ApiPropertyOptional } from '@nestjs/swagger';
import { GenerationJobType, JobStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class ListJobsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: JobStatus })
  @IsOptional()
  @IsEnum(JobStatus)
  status?: JobStatus;

  @ApiPropertyOptional({ enum: GenerationJobType })
  @IsOptional()
  @IsEnum(GenerationJobType)
  jobType?: GenerationJobType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoProjectId?: string;
}
