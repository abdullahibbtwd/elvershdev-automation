import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AutomationGateway } from './automation.gateway';
import { RealtimeEmitterService } from './realtime-emitter.service';

@Module({
  imports: [AuthModule],
  providers: [AutomationGateway, RealtimeEmitterService],
  exports: [RealtimeEmitterService],
})
export class RealtimeModule {}
