import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class GenerateStoryVisualsDto {
  @ApiPropertyOptional({ description: 'Visual style ID to apply to story visuals' })
  @IsOptional()
  @IsUUID()
  visualStyleId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: 'Optional subset of scene IDs to generate visuals for',
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  sceneIds?: string[];

  @ApiPropertyOptional({
    description: 'Skip generating canonical character reference portraits',
  })
  @IsOptional()
  @IsBoolean()
  skipCharacterReferences?: boolean;

  @ApiPropertyOptional({
    description: 'Force re-generation of scene visual prompts even if already analyzed',
  })
  @IsOptional()
  @IsBoolean()
  regeneratePrompts?: boolean;

  @ApiPropertyOptional({
    description: 'Test-only flag to simulate job failure',
  })
  @IsOptional()
  @IsBoolean()
  simulateFailure?: boolean;
}
