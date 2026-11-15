import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import {
  MotionController,
  MotionGenerationJobsController,
  SceneMotionController,
  StoryMotionController,
} from './motion.controller';
import { MotionService } from './motion.service';

@Module({
  imports: [JobsModule],
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
