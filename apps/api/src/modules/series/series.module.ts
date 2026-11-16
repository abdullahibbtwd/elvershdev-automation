import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { AutomationModule } from '../automation/automation.module';
import { MotionModule } from '../motion/motion.module';
import { NarrationModule } from '../narration/narration.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublishingModule } from '../publishing/publishing.module';
import { RenderingModule } from '../rendering/rendering.module';
import { VisualsModule } from '../visuals/visuals.module';
import { CharacterDirectorService } from './character-director.service';
import { ContinuityEngineService } from './continuity-engine.service';
import { EpisodeDirectorService } from './episode-director.service';
import { MovieArchitectService } from './movie-architect.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesController } from './series.controller';
import { SeriesCronService } from './series.cron';
import { SeriesEpisodeQualityService } from './series-episode-quality.service';
import { SeriesExecutionService } from './series-execution.service';
import { SeriesLaneService } from './series-lane.service';
import { SeriesLibraryService } from './series-library.service';
import { SeriesLifecycleHandoffService } from './series-lifecycle-handoff.service';
import { SeriesMaintenanceService } from './series-maintenance.service';
import { SeriesOrchestratorService } from './series-orchestrator.service';
import { SeriesPipelineAdapterService } from './series-pipeline-adapter.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';
import { SeriesQueueHost } from './series-queue.host';
import { SeriesReplacementService } from './series-replacement.service';
import { StoryQualityEvaluatorService } from './story-quality-evaluator.service';

@Module({
  imports: [
    NotificationsModule,
    IntegrationsModule,
    QueueModule,
    StorageModule,
    AutomationModule,
    VisualsModule,
    MotionModule,
    NarrationModule,
    RenderingModule,
    PublishingModule,
  ],
  controllers: [SeriesController],
  providers: [
    SeriesConfigService,
    SeriesLaneService,
    SeriesExecutionService,
    SeriesLibraryService,
    StoryQualityEvaluatorService,
    CharacterDirectorService,
    ContinuityEngineService,
    EpisodeDirectorService,
    MovieArchitectService,
    SeriesReplacementService,
    SeriesPublishSchedulerService,
    SeriesLifecycleHandoffService,
    SeriesEpisodeQualityService,
    SeriesPipelineAdapterService,
    SeriesOrchestratorService,
    SeriesMaintenanceService,
    SeriesCronService,
    SeriesQueueHost,
  ],
  exports: [
    SeriesConfigService,
    SeriesLaneService,
    SeriesExecutionService,
    SeriesLibraryService,
    MovieArchitectService,
    CharacterDirectorService,
    ContinuityEngineService,
    EpisodeDirectorService,
    SeriesReplacementService,
    SeriesPublishSchedulerService,
    SeriesLifecycleHandoffService,
    SeriesEpisodeQualityService,
    SeriesPipelineAdapterService,
    SeriesOrchestratorService,
    StoryQualityEvaluatorService,
  ],
})
export class SeriesModule {}
