import { Module } from '@nestjs/common';
import { JobsModule } from '../jobs/jobs.module';
import { VisualStylesModule } from '../visual-styles/visual-styles.module';
import {
  CharacterVisualsController,
  SceneVisualsController,
  StoryVisualsController,
  VisualGenerationJobsController,
} from './visuals.controller';
import { VisualsService } from './visuals.service';

@Module({
  imports: [VisualStylesModule, JobsModule],
  controllers: [
    StoryVisualsController,
    SceneVisualsController,
    CharacterVisualsController,
    VisualGenerationJobsController,
  ],
  providers: [VisualsService],
  exports: [VisualsService],
})
export class VisualsModule {}
