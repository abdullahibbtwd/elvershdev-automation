import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AlertsService } from './alerts.service';
import { CleanupService } from './cleanup.service';
import { EmergencyStopService } from './emergency-stop.service';
import { OpsMonitorCron } from './ops-monitor.cron';
import { OpsBootstrapController, OpsController } from './ops.controller';
import { OpsService } from './ops.service';
import { SmtpService } from './smtp.service';
import { TokenMaintenanceCron } from './token-maintenance.cron';

@Module({
  imports: [QueueModule, StorageModule, NotificationsModule, IntegrationsModule],
  controllers: [OpsController, OpsBootstrapController],
  providers: [
    OpsService,
    AlertsService,
    SmtpService,
    CleanupService,
    EmergencyStopService,
    OpsMonitorCron,
    TokenMaintenanceCron,
  ],
  exports: [OpsService, AlertsService, CleanupService, EmergencyStopService],
})
export class OpsModule {}
