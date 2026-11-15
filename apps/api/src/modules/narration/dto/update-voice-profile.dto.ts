import { OmitType, PartialType } from '@nestjs/swagger';
import { CreateVoiceProfileDto } from './create-voice-profile.dto';

export class UpdateVoiceProfileDto extends PartialType(
  OmitType(CreateVoiceProfileDto, ['provider'] as const),
) {}
