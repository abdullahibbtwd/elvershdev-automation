import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class UpdateSceneVisualDto {
  @ApiPropertyOptional({ description: 'Updated visual prompt' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  visualPrompt?: string;

  @ApiPropertyOptional({ description: 'Updated negative prompt' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  negativePrompt?: string;

  @ApiPropertyOptional({ description: 'Mark this visual attempt as the selected one for the scene' })
  @IsOptional()
  @IsBoolean()
  isSelected?: boolean;
}
