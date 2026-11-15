import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class GenerateCharacterReferenceDto {
  @ApiPropertyOptional({
    description: 'Force regenerating a new character reference even if one already exists',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({
    description: 'Test-only flag to simulate job failure',
  })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
