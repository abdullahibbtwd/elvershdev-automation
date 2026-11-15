import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class GenerateSceneVisualDto {
  @ApiPropertyOptional({ description: 'Optional visual style override for this scene' })
  @IsOptional()
  @IsUUID()
  visualStyleId?: string;

  @ApiPropertyOptional({ description: 'Custom visual prompt override' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  visualPrompt?: string;

  @ApiPropertyOptional({ description: 'Custom negative prompt override' })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  negativePrompt?: string;

  @ApiPropertyOptional({ description: 'Regenerate prompt via visual analysis before rendering' })
  @IsOptional()
  @IsBoolean()
  regeneratePrompt?: boolean;

  @ApiPropertyOptional({ description: 'Test-only flag to simulate job failure' })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
