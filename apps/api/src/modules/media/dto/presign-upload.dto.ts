import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min, MinLength } from 'class-validator';

export class PresignUploadDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  filename!: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MinLength(3)
  contentType!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100 * 1024 * 1024)
  sizeBytes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  videoProjectId?: string;
}
