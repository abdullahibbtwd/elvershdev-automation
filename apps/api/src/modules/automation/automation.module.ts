import { Module } from '@nestjs/common';
import { QueueModule } from '../../queue/queue.module';
import { MotionModule } from '../motion/motion.module';
import { NarrationModule } from '../narration/narration.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PublishingModule } from '../publishing/publishing.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { RenderingModule } from '../rendering/rendering.module';
import { StoriesModule } from '../stories/stories.module';
import { VisualsModule } from '../visuals/visuals.module';
import { AutomationBudgetService } from './automation-budget.service';
import { AutomationCalendarService } from './automation-calendar.service';
import { AutomationConfigService } from './automation-config.service';
import { AutomationController } from './automation.controller';
import { AutomationCronService } from './automation.cron';
import { AutomationDashboardService } from './automation-dashboard.service';
import { AutomationOrchestratorService } from './automation-orchestrator.service';
import { AutomationPublishSchedulerService } from './automation-publish-scheduler.service';
import { AutomationQueueHost } from './automation-queue.host';
import { ContentPlannerService } from './content-planner.service';

@Module({
  imports: [
    QueueModule,
    NotificationsModule,
    RealtimeModule,
    StoriesModule,
    VisualsModule,
    MotionModule,
    NarrationModule,
    RenderingModule,
    PublishingModule,
  ],
  controllers: [AutomationController],
  providers: [
    AutomationConfigService,
    AutomationBudgetService,
    ContentPlannerService,
    AutomationPublishSchedulerService,
    AutomationOrchestratorService,
    AutomationCalendarService,
    AutomationDashboardService,
    AutomationCronService,
    AutomationQueueHost,
  ],
  exports: [
    AutomationConfigService,
    ContentPlannerService,
    AutomationOrchestratorService,
    AutomationPublishSchedulerService,
    AutomationBudgetService,
  ],
})
export class AutomationModule {}
