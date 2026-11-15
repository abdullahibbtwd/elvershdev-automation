import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AutomationCalendarService } from './automation-calendar.service';
import { AutomationConfigService } from './automation-config.service';
import { AutomationDashboardService } from './automation-dashboard.service';
import { AutomationOrchestratorService } from './automation-orchestrator.service';
import { ContentPlannerService } from './content-planner.service';
import {
  CalendarQueryDto,
  CreatePlanDto,
  ListExecutionsDto,
  ListPlansDto,
  RescheduleCalendarDto,
} from './dto/list-automation.dto';
import { UpdateAutomationConfigDto } from './dto/update-automation-config.dto';

@ApiTags('automation')
@ApiBearerAuth()
@Controller('automation')
export class AutomationController {
  constructor(
    private readonly configService: AutomationConfigService,
    private readonly planner: ContentPlannerService,
    private readonly calendar: AutomationCalendarService,
    private readonly orchestrator: AutomationOrchestratorService,
    private readonly dashboard: AutomationDashboardService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Automation dashboard overview' })
  async dashboardView(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.dashboard.getDashboard(user.id);
    return { success: true, data };
  }

  @Get('config')
  @ApiOperation({ summary: 'Get automation configuration' })
  async getConfig(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.getOrCreate(user.id);
    return { success: true, data };
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update automation configuration' })
  async updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAutomationConfigDto,
  ) {
    const data = await this.configService.update(user.id, dto);
    return { success: true, data };
  }

  @Post('enable')
  async enable(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.enable(user.id);
    return { success: true, data };
  }

  @Post('pause')
  async pause(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.pause(user.id);
    return { success: true, data };
  }

  @Post('resume')
  async resume(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.resume(user.id);
    return { success: true, data };
  }

  @Post('emergency-stop')
  async emergencyStop(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.emergencyStop(user.id);
    return { success: true, data };
  }

  @Post('run-now')
  @ApiOperation({ summary: 'Force daily planning + orchestration for today' })
  async runNow(@CurrentUser() user: AuthenticatedUser) {
    await this.configService.enable(user.id);
    const planned = await this.planner.planDailyForUser(user.id, { force: true });
    return { success: true, data: planned };
  }

  @Post('test-e2e')
  @ApiOperation({
    summary:
      'One-click end-to-end test: enable automation, create an approved plan, and start generate→render→publish immediately',
  })
  async testE2e(@CurrentUser() user: AuthenticatedUser) {
    const providers = this.orchestrator.assertRealProvidersConfigured();
    await this.configService.enable(user.id);
    // Ensure story-brief required fields are never blank (empty strings fail Zod min(2)).
    await this.configService.update(user.id, {
      targetAudience: 'General audience',
      tone: 'Inspirational',
      // Keep E2E short (fewer scenes) when testing the full pipeline.
      targetDurationSeconds: 30,
    });
    const stamp = new Date().toISOString();
    // Rotate prompts so repeated Live E2E clicks don't produce near-identical stories.
    const seeds = [
      {
        topic: 'A lighthouse keeper who receives a mysterious signal from the sea',
        theme: 'mystery',
        genre: 'Cinematic storytelling',
      },
      {
        topic: 'A street musician in Lagos who discovers their melody can pause time for strangers',
        theme: 'wonder',
        genre: 'Magical realism',
      },
      {
        topic: 'An astronaut on a lonely outpost who befriends a drifting seed from Earth',
        theme: 'hope',
        genre: 'Soft sci-fi',
      },
      {
        topic: 'A taxi driver who keeps picking up the same passenger from different years',
        theme: 'destiny',
        genre: 'Urban fantasy',
      },
      {
        topic: 'A young potter whose unfinished vase starts whispering forgotten family secrets',
        theme: 'heritage',
        genre: 'Folktale drama',
      },
    ] as const;
    const seed = seeds[Math.floor(Math.random() * seeds.length)]!;
    const plan = await this.planner.createManualPlan(user.id, {
      ideaTitle: `Live E2E ${stamp}`,
      ideaSummary:
        'Live end-to-end test: plan → generate → render → publish to connected channels.',
      topic: `${seed.topic} (${stamp})`,
      theme: seed.theme,
      genre: seed.genre,
      category: 'Narrative',
    });
    const scheduleId = plan.schedule?.id;
    if (!scheduleId) {
      return {
        success: false,
        data: { planId: plan.id, scheduleId: null },
        message: 'Plan created but no schedule was attached',
      };
    }
    // Publish as soon as render completes (do not wait for the normal staggered window).
    await this.orchestrator.triggerSchedule(user.id, scheduleId, { publishNow: true });
    const live =
      !providers.geminiMock &&
      !providers.falMock &&
      !providers.hailuoMock &&
      !providers.socialMock;
    return {
      success: true,
      data: {
        planId: plan.id,
        scheduleId,
        status: 'QUEUED',
        providers,
        message: live
          ? 'LIVE E2E started (real AI + real publish). This will spend credits and post to connected channels.'
          : 'E2E started. Some providers are still mocked — check GEMINI/FAL/KLING/SOCIAL_USE_MOCK.',
      },
    };
  }

  @Get('plans')
  async listPlans(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPlansDto) {
    const result = await this.planner.listPlans(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Post('plans')
  async createPlan(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreatePlanDto) {
    const data = await this.planner.createManualPlan(user.id, dto);
    return { success: true, data };
  }

  @Get('plans/:id')
  async getPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.planner.getPlan(user.id, id);
    return { success: true, data };
  }

  @Post('plans/:id/approve')
  async approvePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.planner.approvePlan(user.id, id);
    return { success: true, data };
  }

  @Post('plans/:id/cancel')
  async cancelPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.planner.cancelPlan(user.id, id);
    return { success: true, data };
  }

  @Get('calendar')
  async calendarView(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: CalendarQueryDto,
  ) {
    const data = await this.calendar.getCalendar(user.id, query);
    return { success: true, data };
  }

  @Post('calendar/:id/reschedule')
  async reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleCalendarDto,
  ) {
    const data = await this.calendar.reschedule(user.id, id, dto);
    return { success: true, data };
  }

  @Post('calendar/:id/cancel')
  async cancelCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.calendar.cancel(user.id, id);
    return { success: true, data };
  }

  @Post('calendar/:id/trigger')
  async triggerCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orchestrator.triggerSchedule(user.id, id);
    return { success: true, data };
  }

  @Post('calendar/:id/pause')
  async pauseCalendar(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orchestrator.pauseSchedule(user.id, id);
    return { success: true, data };
  }

  @Get('executions')
  async listExecutions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListExecutionsDto,
  ) {
    const result = await this.orchestrator.listExecutions(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('executions/:id')
  async getExecution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orchestrator.getExecution(user.id, id);
    return { success: true, data };
  }

  @Post('executions/:id/retry')
  async retryExecution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.orchestrator.retryExecution(user.id, id);
    return { success: true, data };
  }
}
