import { Injectable, Logger } from '@nestjs/common';
import {
  AUTOMATION_PROGRESS_EVENT,
  AUTOMATION_USER_ROOM,
  type AutomationProgressEvent,
} from './realtime.types';
import { AutomationGateway } from './automation.gateway';

@Injectable()
export class RealtimeEmitterService {
  private readonly logger = new Logger(RealtimeEmitterService.name);

  constructor(private readonly gateway: AutomationGateway) {}

  emitAutomationProgress(
    userId: string,
    payload: Omit<AutomationProgressEvent, 'at'> & { at?: string },
  ) {
    const event: AutomationProgressEvent = {
      ...payload,
      at: payload.at ?? new Date().toISOString(),
    };
    try {
      this.gateway.server
        ?.to(AUTOMATION_USER_ROOM(userId))
        .emit(AUTOMATION_PROGRESS_EVENT, event);
    } catch (error) {
      this.logger.warn(
        `Failed to emit automation.progress for ${userId}: ${(error as Error).message}`,
      );
    }
  }
}
