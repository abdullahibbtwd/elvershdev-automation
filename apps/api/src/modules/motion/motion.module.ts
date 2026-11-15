import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { JobsModule } from '../jobs/jobs.module';
import {
  MotionController,
  MotionGenerationJobsController,
  SceneMotionController,
  StoryMotionController,
} from './motion.controller';
import { MotionService } from './motion.service';

@Module({
  imports: [JobsModule, IntegrationsModule],
  controllers: [
    StoryMotionController,
    SceneMotionController,
    MotionController,
    MotionGenerationJobsController,
  ],
  providers: [MotionService],
  exports: [MotionService],
})
export class MotionModule {}
