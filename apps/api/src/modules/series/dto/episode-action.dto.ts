import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class EpisodeGenerateDto {
  @ApiPropertyOptional({ description: 'Force mock Gemini' })
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;

  @ApiPropertyOptional({ description: 'Enqueue async planning job' })
  @IsOptional()
  @IsBoolean()
  async?: boolean;
}

export class EpisodeValidateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;
}
