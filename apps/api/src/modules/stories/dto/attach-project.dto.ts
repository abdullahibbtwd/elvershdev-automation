import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class AttachStoryToProjectDto {
  @ApiPropertyOptional({
    description: 'Existing project to attach. Omit to create a new draft project.',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    description: 'Title for a new project when projectId is omitted',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  projectTitle?: string;
}
