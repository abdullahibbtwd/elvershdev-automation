import { OmitType } from '@nestjs/swagger';
import { GenerateStoryAudioDto } from './generate-story-audio.dto';

export class GenerateSceneAudioDto extends OmitType(GenerateStoryAudioDto, ['sceneIds'] as const) {}
