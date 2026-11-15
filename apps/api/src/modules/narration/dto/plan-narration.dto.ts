import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class PlanNarrationDto {
  @ApiPropertyOptional({ description: 'Regenerate narration even if a script exists', default: false })
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  @ApiPropertyOptional({ description: 'Test-only flag to simulate job failure' })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;

  @ApiPropertyOptional({ description: 'Force mock AI (tests / local without API key)' })
  @IsOptional()
  @IsBoolean()
  useMockAi?: boolean;
}
