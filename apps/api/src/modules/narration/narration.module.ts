import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { JobsModule } from '../jobs/jobs.module';
import {
  AudioController,
  NarrationScriptController,
  SceneAudioController,
  SceneNarrationController,
  StoryAudioController,
  StoryNarrationController,
  VoiceProfilesController,
  VoicesController,
} from './narration.controller';
import { NarrationService } from './narration.service';

@Module({
  imports: [PrismaModule, QueueModule, StorageModule, JobsModule, ConfigModule],
  controllers: [
    StoryNarrationController,
    NarrationScriptController,
    StoryAudioController,
    SceneNarrationController,
    SceneAudioController,
    AudioController,
    VoicesController,
    VoiceProfilesController,
  ],
  providers: [NarrationService],
  exports: [NarrationService],
})
export class NarrationModule {}
