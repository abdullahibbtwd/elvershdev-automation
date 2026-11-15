import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ConnectChannelDto {
  @ApiPropertyOptional({
    description: 'Optional frontend path stored with OAuth state for post-connect navigation',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  redirectPath?: string;
}
