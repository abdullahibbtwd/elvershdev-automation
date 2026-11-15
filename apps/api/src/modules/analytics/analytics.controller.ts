import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { jsonSafe } from '../../common/utils/json-safe';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AnalyticsCostService } from './analytics-cost.service';
import { AnalyticsInsightsService } from './analytics-insights.service';
import { AnalyticsService } from './analytics.service';
import { AnalyticsSyncService } from './analytics-sync.service';
import {
  AnalyticsListDto,
  AnalyticsRangeDto,
  StartAnalyticsSyncDto,
  UpdateAnalyticsSettingsDto,
} from './dto/analytics.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly sync: AnalyticsSyncService,
    private readonly costs: AnalyticsCostService,
    private readonly insights: AnalyticsInsightsService,
  ) {}

  @Get('overview')
  async overview(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsRangeDto) {
    return { success: true, data: jsonSafe(await this.analytics.overview(user.id, query)) };
  }

  @Get('trends')
  async trends(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsRangeDto) {
    return { success: true, data: jsonSafe(await this.analytics.trends(user.id, query)) };
  }

  @Get('platforms')
  async platforms(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsRangeDto) {
    return { success: true, data: jsonSafe(await this.analytics.platforms(user.id, query)) };
  }

  @Get('content')
  async content(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsListDto) {
    const result = await this.analytics.content(user.id, query);
    return { success: true, data: jsonSafe(result.items), meta: result.meta };
  }

  @Get('videos/:videoId')
  async video(@CurrentUser() user: AuthenticatedUser, @Param('videoId', ParseUUIDPipe) id: string) {
    return { success: true, data: jsonSafe(await this.analytics.video(user.id, id)) };
  }

  @Get('videos/:videoId/platforms')
  async videoPlatforms(@CurrentUser() user: AuthenticatedUser, @Param('videoId', ParseUUIDPipe) id: string) {
    return { success: true, data: jsonSafe(await this.analytics.videoPlatforms(user.id, id)) };
  }

  @Post('sync')
  async startSync(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartAnalyticsSyncDto) {
    return { success: true, data: await this.sync.start(user.id, dto) };
  }

  @Get('sync')
  async listSync(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.sync.list(user.id) };
  }

  @Get('sync/:id')
  async getSync(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return { success: true, data: await this.sync.get(user.id, id) };
  }

  @Get('costs')
  async costSummary(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsRangeDto) {
    return { success: true, data: jsonSafe(await this.analytics.costsSummary(user.id, query)) };
  }

  @Get('costs/providers')
  async costProviders(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsRangeDto) {
    return { success: true, data: jsonSafe(await this.analytics.costsProviders(user.id, query)) };
  }

  @Get('costs/videos')
  async costVideos(@CurrentUser() user: AuthenticatedUser, @Query() query: AnalyticsRangeDto) {
    return { success: true, data: jsonSafe(await this.analytics.costsVideos(user.id, query)) };
  }

  @Get('costs/projection')
  async projection(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: jsonSafe(await this.costs.projection(user.id)) };
  }

  @Get('insights')
  async listInsights(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.insights.list(user.id) };
  }

  @Post('insights/generate')
  async generateInsights(@CurrentUser() user: AuthenticatedUser) {
    return { success: true, data: await this.insights.generate(user.id) };
  }

  @Patch('insights/settings')
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateAnalyticsSettingsDto,
  ) {
    return { success: true, data: await this.insights.updateSettings(user.id, dto) };
  }
}
