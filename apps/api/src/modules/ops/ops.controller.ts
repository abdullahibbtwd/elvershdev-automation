import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SystemAlertStatus, UserRole } from '@prisma/client';
import { IsBoolean, IsIn, IsOptional, IsString } from 'class-validator';
// BootstrapAdminDto / EmergencyStopDto use IsBoolean + IsString
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { AlertsService } from './alerts.service';
import { CleanupService } from './cleanup.service';
import { EmergencyStopService } from './emergency-stop.service';
import { OpsService } from './ops.service';

class PauseQueueDto {
  @IsString()
  queueName!: string;
}

class RolloutStageDto {
  @IsIn(['A', 'B', 'C', 'D', 'E'])
  stage!: string;
}

class GlobalAutomationDto {
  @IsBoolean()
  paused!: boolean;
}

class PromoteAdminDto {
  @IsString()
  email!: string;
}

class ConfirmDto {
  @IsOptional()
  @IsString()
  confirm?: string;
}

class EmergencyStopDto {
  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  resumeQueues?: boolean;
}

class BootstrapAdminDto {
  @IsString()
  email!: string;

  @IsString()
  token!: string;
}

@ApiTags('ops')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('ops')
export class OpsController {
  constructor(
    private readonly ops: OpsService,
    private readonly alerts: AlertsService,
    private readonly cleanup: CleanupService,
    private readonly emergencyStop: EmergencyStopService,
  ) {}

  @Get('overview')
  async overview() {
    return { success: true, data: await this.ops.getSystemHealth() };
  }

  @Get('queues')
  async queues() {
    return { success: true, data: await this.ops.getQueueHealth() };
  }

  @Get('jobs/active')
  async activeJobs(@Query('limit') limit?: string) {
    return { success: true, data: await this.ops.getActiveJobs(limit ? Number(limit) : 50) };
  }

  @Get('jobs/failed')
  async failedJobs(@Query('limit') limit?: string) {
    return { success: true, data: await this.ops.getFailedJobs(limit ? Number(limit) : 50) };
  }

  @Get('alerts')
  async listAlerts(@Query('status') status?: SystemAlertStatus) {
    return { success: true, data: await this.alerts.list({ status }) };
  }

  @Get('providers')
  async providers() {
    const health = await this.ops.getSystemHealth();
    return { success: true, data: health.providers };
  }

  @Get('rollout')
  async rollout() {
    return { success: true, data: await this.ops.getRolloutStage() };
  }

  @Post('rollout')
  async setRollout(@Body() dto: RolloutStageDto) {
    return { success: true, data: await this.ops.setRolloutStage(dto.stage) };
  }

  @Post('queues/pause')
  async pauseQueue(@Body() dto: PauseQueueDto) {
    return { success: true, data: await this.ops.pauseQueue(dto.queueName) };
  }

  @Post('queues/resume')
  async resumeQueue(@Body() dto: PauseQueueDto) {
    return { success: true, data: await this.ops.resumeQueue(dto.queueName) };
  }

  @Post('jobs/:id/retry')
  async retryJob(@Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.ops.retryFailedJob(id) };
  }

  @Post('backup')
  async triggerBackup(@Body() dto: ConfirmDto) {
    if (dto.confirm !== 'BACKUP') {
      return {
        success: false,
        error: { code: 'CONFIRMATION_REQUIRED', message: 'Send { "confirm": "BACKUP" }' },
      };
    }
    return { success: true, data: await this.ops.triggerBackup() };
  }

  @Post('diagnostics')
  async diagnostics() {
    return { success: true, data: await this.ops.runDiagnostics() };
  }

  @Post('automation/global-pause')
  async globalPause(@Body() dto: GlobalAutomationDto) {
    return { success: true, data: await this.ops.setGlobalAutomationPause(dto.paused) };
  }

  @Post('emergency-stop')
  async activateEmergencyStop(@Body() dto: EmergencyStopDto) {
    return {
      success: true,
      data: await this.emergencyStop.activate(dto.reason ?? 'ops.emergency_stop'),
    };
  }

  @Post('emergency-stop/clear')
  async clearEmergencyStop(@Body() dto: EmergencyStopDto) {
    return {
      success: true,
      data: await this.emergencyStop.clear(dto.resumeQueues === true),
    };
  }

  @Get('emergency-stop')
  async getEmergencyStop() {
    return { success: true, data: { active: await this.emergencyStop.isActive() } };
  }

  @Post('cleanup/temp')
  async cleanupTemp(@Body() dto: ConfirmDto) {
    if (dto.confirm !== 'CLEANUP') {
      return {
        success: false,
        error: { code: 'CONFIRMATION_REQUIRED', message: 'Send { "confirm": "CLEANUP" }' },
      };
    }
    return { success: true, data: await this.cleanup.cleanupTemporaryArtifacts() };
  }

  @Post('promote-admin')
  async promoteAdmin(@Body() dto: PromoteAdminDto) {
    return { success: true, data: await this.ops.promoteAdmin(dto.email) };
  }
}

/**
 * One-time bootstrap — intentionally outside RolesGuard.
 * Available only when zero ADMIN users exist and ADMIN_BOOTSTRAP_TOKEN matches.
 */
@ApiTags('ops-bootstrap')
@Controller('ops')
export class OpsBootstrapController {
  constructor(private readonly ops: OpsService) {}

  @Post('bootstrap-admin')
  async bootstrapAdmin(@Body() dto: BootstrapAdminDto) {
    return { success: true, data: await this.ops.bootstrapAdmin(dto.email, dto.token) };
  }
}
