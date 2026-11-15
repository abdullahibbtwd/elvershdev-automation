import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class VisualStyleConfigurationDto {
  @ApiProperty({ example: 'Motivated cinematic lighting with soft key light' })
  @IsString()
  @MinLength(1)
  lighting!: string;

  @ApiProperty({ example: 'Natural skin tones, subtle filmic contrast' })
  @IsString()
  @MinLength(1)
  colorTreatment!: string;

  @ApiProperty({ example: 'Full-frame cinema camera aesthetic' })
  @IsString()
  @MinLength(1)
  camera!: string;

  @ApiProperty({ example: 'Rule-of-thirds framing with clear subject hierarchy' })
  @IsString()
  @MinLength(1)
  composition!: string;

  @ApiProperty({ example: 'Photorealistic live-action still.' })
  @IsString()
  @MinLength(1)
  imageGenerationInstructions!: string;

  @ApiPropertyOptional({ type: [String], example: ['cartoon', 'illustration', 'anime'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  avoid?: string[];
}

export class CreateVisualStyleDto {
  @ApiProperty({ example: 'Moody Neo-Noir' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name!: string;

  @ApiProperty({ example: 'High-contrast urban night photography look.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ type: VisualStyleConfigurationDto })
  @ValidateNested()
  @Type(() => VisualStyleConfigurationDto)
  configuration!: VisualStyleConfigurationDto;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
