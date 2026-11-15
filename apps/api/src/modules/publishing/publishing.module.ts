import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../../integrations/integrations.module';
import { QueueModule } from '../../queue/queue.module';
import {
  PublishRendersController,
  PublishingController,
} from './publishing.controller';
import { PublishingService } from './publishing.service';

@Module({
  imports: [QueueModule, IntegrationsModule],
  controllers: [PublishingController, PublishRendersController],
  providers: [PublishingService],
  exports: [PublishingService],
})
export class PublishingModule {}
