import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { QueueModule } from '../../queue/queue.module';
import { AutomationModule } from '../automation/automation.module';
import { ChannelsModule } from '../channels/channels.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalyticsAggregationService } from './analytics-aggregation.service';
import { AnalyticsCostService } from './analytics-cost.service';
import { AnalyticsCronService } from './analytics-cron.service';
import { AnalyticsInsightsService } from './analytics-insights.service';
import { AnalyticsMetricsService } from './analytics-metrics.service';
import { AnalyticsQueueHost } from './analytics-queue.host';
import { AnalyticsSyncService } from './analytics-sync.service';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [
    QueueModule,
    ChannelsModule,
    NotificationsModule,
    AutomationModule,
    IntegrationsModule,
  ],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    AnalyticsMetricsService,
    AnalyticsCostService,
    AnalyticsAggregationService,
    AnalyticsSyncService,
    AnalyticsInsightsService,
    AnalyticsCronService,
    AnalyticsQueueHost,
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
