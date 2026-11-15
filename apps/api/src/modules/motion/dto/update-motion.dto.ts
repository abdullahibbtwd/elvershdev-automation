import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateMotionDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(2500)
  motionPrompt?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  negativePrompt?: string;

  @ApiPropertyOptional({ description: 'Select this clip as the preferred scene clip' })
  @IsOptional()
  @IsBoolean()
  isSelected?: boolean;
}
