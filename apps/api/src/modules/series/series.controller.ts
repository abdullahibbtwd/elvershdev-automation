import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { StorySeriesStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateSeriesLaneDto } from './dto/create-series-lane.dto';
import { EpisodeGenerateDto, EpisodeValidateDto } from './dto/episode-action.dto';
import { GenerateSeriesDto } from './dto/generate-series.dto';
import { PlanMoviesDto, PrepareNextEpisodesDto } from './dto/plan-movies.dto';
import { RunAllSeriesNowDto, RunSeriesLaneNowDto } from './dto/run-series-now.dto';
import { UpdateSeriesConfigDto } from './dto/update-series-config.dto';
import { UpdateSeriesLaneDto } from './dto/update-series-lane.dto';
import { CharacterDirectorService } from './character-director.service';
import { ContinuityEngineService } from './continuity-engine.service';
import { EpisodeDirectorService } from './episode-director.service';
import { MovieArchitectService } from './movie-architect.service';
import { SeriesConfigService } from './series-config.service';
import { SeriesExecutionService } from './series-execution.service';
import { SeriesLaneService } from './series-lane.service';
import { SeriesLibraryService } from './series-library.service';
import { SeriesOrchestratorService } from './series-orchestrator.service';
import { SeriesPublishSchedulerService } from './series-publish-scheduler.service';
import { SeriesReplacementService } from './series-replacement.service';

class ListSeriesQueryDto {
  @IsOptional()
  @IsUUID()
  laneId?: string;

  @IsOptional()
  @IsEnum(StorySeriesStatus)
  status?: StorySeriesStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  take?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip?: number;
}

@ApiTags('series')
@ApiBearerAuth()
@Controller('series')
export class SeriesController {
  constructor(
    private readonly configService: SeriesConfigService,
    private readonly laneService: SeriesLaneService,
    private readonly executions: SeriesExecutionService,
    private readonly architect: MovieArchitectService,
    private readonly library: SeriesLibraryService,
    private readonly characters: CharacterDirectorService,
    private readonly episodes: EpisodeDirectorService,
    private readonly continuity: ContinuityEngineService,
    private readonly replacements: SeriesReplacementService,
    private readonly publishScheduler: SeriesPublishSchedulerService,
    private readonly orchestrator: SeriesOrchestratorService,
  ) {}

  @Get('config')
  @ApiOperation({ summary: 'Get Series Studio configuration' })
  async getConfig(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.getOrCreate(user.id);
    return { success: true, data };
  }

  @Patch('config')
  @ApiOperation({ summary: 'Update Series Studio configuration' })
  async updateConfig(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateSeriesConfigDto,
  ) {
    const data = await this.configService.update(user.id, dto);
    return { success: true, data };
  }

  @Post('config/enable')
  @ApiOperation({ summary: 'Enable Series Studio' })
  async enable(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.enable(user.id);
    return { success: true, data };
  }

  @Post('config/pause')
  @ApiOperation({ summary: 'Pause Series Studio globally' })
  async pause(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.pause(user.id);
    return { success: true, data };
  }

  @Post('config/resume')
  @ApiOperation({ summary: 'Resume Series Studio globally' })
  async resume(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.resume(user.id);
    return { success: true, data };
  }

  @Post('config/emergency-stop')
  @ApiOperation({ summary: 'Emergency stop Series Studio (no new work)' })
  async emergencyStop(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.configService.emergencyStop(user.id);
    return { success: true, data };
  }

  @Get('lanes')
  @ApiOperation({ summary: 'List series lanes (defaults + custom)' })
  async listLanes(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.laneService.list(user.id);
    return { success: true, data };
  }

  @Post('lanes')
  @ApiOperation({ summary: 'Create a custom series lane' })
  async createLane(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSeriesLaneDto,
  ) {
    const data = await this.laneService.create(user.id, dto);
    return { success: true, data };
  }

  @Patch('lanes/:id')
  @ApiOperation({ summary: 'Update a series lane' })
  async updateLane(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateSeriesLaneDto,
  ) {
    const data = await this.laneService.update(user.id, id, dto);
    return { success: true, data };
  }

  @Post('lanes/:id/duplicate')
  @ApiOperation({ summary: 'Duplicate a lane config (no story data copy)' })
  async duplicateLane(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.laneService.duplicate(user.id, id);
    return { success: true, data };
  }

  @Delete('lanes/:id')
  @ApiOperation({
    summary: 'Soft-delete a custom lane (morning/evening defaults protected)',
  })
  async deleteLane(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.laneService.softDelete(user.id, id);
    return { success: true, data };
  }

  @Post('lanes/:id/pause')
  @ApiOperation({ summary: 'Pause a series lane (other lane unaffected)' })
  async pauseLane(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.laneService.pause(user.id, id);
    return { success: true, data };
  }

  @Post('lanes/:id/resume')
  @ApiOperation({ summary: 'Resume a series lane' })
  async resumeLane(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.laneService.resume(user.id, id);
    return { success: true, data };
  }

  @Post('lanes/:id/run-now')
  @ApiOperation({
    summary:
      'Immediately run the next eligible Series action for a lane (never bypasses approvals)',
  })
  async runLaneNow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RunSeriesLaneNowDto,
  ) {
    const data = await this.executions.runLaneNow(user.id, id, dto);
    return { success: true, data };
  }

  @Post('run-all-now')
  @ApiOperation({
    summary: 'Run Now for every eligible enabled lane (independent results)',
  })
  async runAllNow(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: RunAllSeriesNowDto,
  ) {
    const data = await this.executions.runAllEnabledNow(user.id, dto);
    return { success: true, data };
  }

  @Post('plan-movies')
  @ApiOperation({
    summary:
      'Plan Movies in Advance for selected (or all enabled) lanes without starting media unless requested',
  })
  async planMovies(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PlanMoviesDto,
  ) {
    const data = await this.executions.planMoviesForLanes(user.id, dto);
    return { success: true, data };
  }

  @Post('prepare-next-episodes')
  @ApiOperation({
    summary:
      'Prepare next eligible episodes across lanes (respects production windows unless ignoreScheduleWindow)',
  })
  async prepareNextEpisodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PrepareNextEpisodesDto,
  ) {
    const data = await this.executions.prepareNextEpisodes(user.id, dto);
    return { success: true, data };
  }

  @Post('lanes/:id/produce-next')
  @ApiOperation({
    summary: 'Manually start media production for the next approved episode on a lane',
  })
  async produceNext(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { useMockAi?: boolean },
  ) {
    const data = await this.executions.produceNextEpisode(user.id, id, body);
    return { success: true, data };
  }

  @Get('executions')
  @ApiOperation({ summary: 'List Series Studio executions' })
  async listExecutions(
    @CurrentUser() user: AuthenticatedUser,
    @Query('laneId') laneId?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    const data = await this.executions.listExecutions(user.id, {
      laneId,
      take: take ? Number(take) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
    return { success: true, data };
  }

  @Get('executions/:executionId')
  @ApiOperation({ summary: 'Get one Series execution' })
  async getExecution(
    @CurrentUser() user: AuthenticatedUser,
    @Param('executionId', ParseUUIDPipe) executionId: string,
  ) {
    const data = await this.executions.getExecution(user.id, executionId);
    return { success: true, data };
  }

  @Get('lanes/:id/execution-view')
  @ApiOperation({ summary: 'Lane dashboard execution status snapshot' })
  async laneExecutionView(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.executions.getLaneExecutionView(user.id, id);
    return { success: true, data };
  }

  @Get('scheduler/status')
  @ApiOperation({ summary: 'Series scheduler / queue host status' })
  async schedulerStatus(@CurrentUser() user: AuthenticatedUser) {
    const config = await this.configService.getOrCreate(user.id);
    const lanes = await this.laneService.list(user.id);
    const replacements: Awaited<
      ReturnType<SeriesReplacementService['listForLane']>
    > = [];
    for (const lane of lanes) {
      const plans = await this.replacements.listForLane(user.id, lane.id);
      replacements.push(...plans.slice(0, 3));
    }

    return {
      success: true,
      data: {
        seriesStudioEnabled: config.seriesStudioEnabled,
        runMode: config.runMode,
        canScheduleNewWork: this.configService.canScheduleNewWork(config),
        cronDisabled: process.env.SERIES_CRON_DISABLED === 'true',
        queuesHosted: process.env.SERIES_QUEUE_HOST_DISABLED !== 'true',
        phase: 'G',
        lockKey: 'cron:series',
        queues: [
          'series-story-planning',
          'series-character-generation',
          'series-episode-planning',
          'series-episode-production',
          'series-continuity-validation',
          'series-replacement-planning',
          'series-publishing',
          'series-maintenance',
        ],
        automaticPublishing: config.automaticPublishing,
        publishDryRun:
          process.env.SERIES_PUBLISH_DRY_RUN === 'true' ||
          process.env.SOCIAL_USE_MOCK === 'true',
        automaticReplacementPlanning: config.automaticReplacementPlanning,
        automaticReplacementApproval: config.automaticReplacementApproval,
        lanes: lanes.map((lane) => ({
          id: lane.id,
          name: lane.name,
          laneType: lane.laneType,
          enabled: lane.enabled,
          status: lane.status,
          timezone: lane.timezone,
          publishTime: lane.publishTime,
          canAcceptWork: this.laneService.canLaneAcceptWork(lane),
          nextPublishAt: lane.nextPublishAt,
          activeSeriesId: lane.activeSeriesId,
          lastPublishedEpisodeNumber: lane.lastPublishedEpisodeNumber,
          replacementTriggerEpisode: lane.replacementTriggerEpisode,
        })),
        recentReplacementsSample: replacements.slice(0, 5),
      },
    };
  }

  @Post('lanes/:id/replace')
  @ApiOperation({ summary: 'Manually start next-movie replacement planning for a lane' })
  async replaceLane(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body()
    body: {
      async?: boolean;
      useMockAi?: boolean;
      force?: boolean;
      sourceSeriesId?: string;
    },
  ) {
    const data = await this.replacements.requestReplacement(user.id, id, {
      mode: 'manual',
      async: body.async !== false,
      useMockAi: body.useMockAi,
      force: body.force,
      sourceSeriesId: body.sourceSeriesId,
    });
    return { success: true, data };
  }

  @Get('lanes/:id/replacements')
  @ApiOperation({ summary: 'List replacement plans for a lane' })
  async listReplacements(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.replacements.listForLane(user.id, id);
    return { success: true, data };
  }

  @Post('replacements/:planId/approve')
  @ApiOperation({ summary: 'Approve a replacement candidate (optionally activate)' })
  async approveReplacement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: { activate?: boolean },
  ) {
    const data = await this.replacements.approve(user.id, planId, {
      activate: body.activate === true,
    });
    return { success: true, data };
  }

  @Post('replacements/:planId/activate')
  @ApiOperation({ summary: 'Activate an approved replacement as the lane active series' })
  async activateReplacement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planId', ParseUUIDPipe) planId: string,
  ) {
    const data = await this.replacements.activate(user.id, planId);
    return { success: true, data };
  }

  @Post('replacements/:planId/reject')
  @ApiOperation({ summary: 'Reject a replacement candidate' })
  async rejectReplacement(
    @CurrentUser() user: AuthenticatedUser,
    @Param('planId', ParseUUIDPipe) planId: string,
    @Body() body: { reason?: string },
  ) {
    const data = await this.replacements.reject(user.id, planId, body.reason);
    return { success: true, data };
  }

  @Post('lanes/:id/ensure-schedule')
  @ApiOperation({ summary: 'Create next episode publish schedule if publishing is enabled' })
  async ensureSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.publishScheduler.ensureNextSchedule(user.id, id);
    return { success: true, data };
  }

  @Post('schedules/:scheduleId/publish')
  @ApiOperation({ summary: 'Force enqueue a SeriesSchedule for social publish handoff' })
  async publishSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scheduleId', ParseUUIDPipe) scheduleId: string,
    @Body() body: { useMockSocial?: boolean; force?: boolean },
  ) {
    const data = await this.publishScheduler.enqueueOne(scheduleId, {
      userId: user.id,
      force: body.force !== false,
      useMockSocial: body.useMockSocial,
    });
    return { success: true, data };
  }

  @Post('publishing/reconcile')
  @ApiOperation({ summary: 'Reconcile in-flight Series publish outcomes from PublishRecords' })
  async reconcilePublishing(@CurrentUser() user: AuthenticatedUser) {
    const data = await this.publishScheduler.reconcilePublishOutcomes(user.id);
    return { success: true, data };
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate a complete movie plan for a lane (Movie Architect)' })
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: GenerateSeriesDto,
  ) {
    const data = await this.architect.generate(user.id, dto);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List story series library' })
  async listSeries(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListSeriesQueryDto,
  ) {
    const data = await this.library.list(user.id, query);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get series detail including bible, characters, episodes' })
  async getSeries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.architect.getSeriesDetail(user.id, id);
    return { success: true, data };
  }

  @Get(':id/bible')
  @ApiOperation({ summary: 'Get series bible' })
  async getBible(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.library.getBible(user.id, id);
    return { success: true, data };
  }

  @Get(':id/characters')
  @ApiOperation({ summary: 'List series characters and reference assets' })
  async getCharacters(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.characters.listCharacters(user.id, id);
    return { success: true, data };
  }

  @Get(':id/episodes')
  @ApiOperation({ summary: 'List series episodes (outlines)' })
  async getEpisodes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const series = await this.architect.getSeriesDetail(user.id, id);
    return { success: true, data: series.episodes };
  }

  @Get(':id/episodes/:episodeId')
  @ApiOperation({ summary: 'Get episode detail with scenes and continuity' })
  async getEpisode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ) {
    const data = await this.episodes.getEpisode(user.id, id, episodeId);
    return { success: true, data };
  }

  @Post(':id/episodes/:episodeId/generate')
  @ApiOperation({ summary: 'Generate episode script via Episode Director' })
  async generateEpisode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() dto: EpisodeGenerateDto,
  ) {
    const data = await this.episodes.generateEpisode(user.id, id, episodeId, {
      useMockAi: dto.useMockAi,
      async: dto.async,
    });
    return { success: true, data };
  }

  @Post(':id/episodes/:episodeId/regenerate')
  @ApiOperation({ summary: 'Regenerate episode script (requires re-approval)' })
  async regenerateEpisode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() dto: EpisodeGenerateDto,
  ) {
    const data = await this.episodes.generateEpisode(user.id, id, episodeId, {
      useMockAi: dto.useMockAi,
      async: dto.async,
      regenerate: true,
    });
    return { success: true, data };
  }

  @Post(':id/episodes/:episodeId/approve')
  @ApiOperation({ summary: 'Approve episode script after continuity validation' })
  async approveEpisode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ) {
    const data = await this.episodes.approveEpisode(user.id, id, episodeId);
    return { success: true, data };
  }

  @Post(':id/episodes/:episodeId/produce')
  @ApiOperation({ summary: 'Start episode production through the existing media pipeline' })
  async produceEpisode(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body()
    body: {
      async?: boolean;
      useMockAi?: boolean;
      force?: boolean;
    },
  ) {
    const data = await this.orchestrator.startProduction(user.id, id, episodeId, {
      async: body.async !== false,
      useMockAi: body.useMockAi,
      force: body.force,
    });
    return { success: true, data };
  }

  @Get(':id/episodes/:episodeId/production')
  @ApiOperation({ summary: 'Get episode production run status' })
  async getEpisodeProduction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ) {
    const data = await this.orchestrator.getProductionStatus(user.id, id, episodeId);
    return { success: true, data };
  }

  @Post(':id/episodes/:episodeId/production/cancel')
  @ApiOperation({ summary: 'Cancel an active episode production run' })
  async cancelEpisodeProduction(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
  ) {
    const data = await this.orchestrator.cancelProduction(user.id, id, episodeId);
    return { success: true, data };
  }

  @Post(':id/episodes/:episodeId/validate-continuity')
  @ApiOperation({ summary: 'Run continuity validation (pre-script or pre-visual)' })
  async validateEpisodeContinuity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('episodeId', ParseUUIDPipe) episodeId: string,
    @Body() dto: EpisodeValidateDto,
    @Query('stage') stage?: 'pre_script_approval' | 'pre_visual',
  ) {
    if (stage === 'pre_visual') {
      const data = await this.episodes.validateForVisuals(
        user.id,
        id,
        episodeId,
        dto.useMockAi,
      );
      return { success: true, data };
    }
    const data = await this.continuity.validateEpisode({
      userId: user.id,
      seriesId: id,
      episodeId,
      stage: 'pre_script_approval',
      useMockAi: dto.useMockAi,
    });
    return { success: true, data };
  }

  @Get(':id/continuity')
  @ApiOperation({ summary: 'Continuity snapshots and memory events' })
  async getContinuity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.continuity.getContinuityView(user.id, id);
    return { success: true, data };
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a planned series / bible' })
  async approveSeries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.library.approveSeries(user.id, id);
    return { success: true, data };
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a planned series' })
  async rejectSeries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { reason?: string },
  ) {
    const data = await this.library.rejectSeries(user.id, id, body?.reason);
    return { success: true, data };
  }

  @Post(':id/characters/references')
  @ApiOperation({ summary: 'Generate missing character reference portraits' })
  async generateCharacterReferences(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.characters.generateReferencesForSeries(user.id, id);
    return { success: true, data };
  }

  @Post(':id/characters/:characterId/references')
  @ApiOperation({ summary: 'Generate a reference portrait for one character' })
  async generateOneCharacterReference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('characterId', ParseUUIDPipe) characterId: string,
  ) {
    const data = await this.characters.generateReferencePortrait({
      userId: user.id,
      seriesId: id,
      characterId,
    });
    return { success: true, data };
  }
}
