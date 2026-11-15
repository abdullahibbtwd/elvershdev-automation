import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateRenderDto, UpdateRenderSettingsDto } from './dto/create-render.dto';
import { RenderingService } from './rendering.service';

@ApiTags('rendering')
@ApiBearerAuth()
@Controller('stories/:storyId/renders')
export class StoryRendersController {
  constructor(private readonly renderingService: RenderingService) {}

  @Get('readiness')
  @ApiOperation({ summary: 'Get story render readiness checklist' })
  async readiness(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const data = await this.renderingService.getReadiness(user.id, storyId);
    return { success: true, data };
  }

  @Post()
  @ApiOperation({ summary: 'Start a final video render for a story' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: CreateRenderDto,
  ) {
    const data = await this.renderingService.createRender(user.id, storyId, dto);
    return { success: true, data };
  }

  @Get()
  @ApiOperation({ summary: 'List renders for a story' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const data = await this.renderingService.listStoryRenders(user.id, storyId);
    return { success: true, data };
  }

  @Get(':renderId')
  @ApiOperation({ summary: 'Get a story render by id' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) _storyId: string,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.getRender(user.id, renderId);
    return { success: true, data };
  }
}

@ApiTags('rendering')
@ApiBearerAuth()
@Controller('renders')
export class RendersController {
  constructor(private readonly renderingService: RenderingService) {}

  @Get(':renderId')
  @ApiOperation({ summary: 'Get a render by id' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.getRender(user.id, renderId);
    return { success: true, data };
  }

  @Get(':renderId/progress')
  @ApiOperation({ summary: 'Get render progress' })
  async progress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.getProgress(user.id, renderId);
    return { success: true, data };
  }

  @Post(':renderId/retry')
  @ApiOperation({ summary: 'Retry a failed or cancelled render' })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.retryRender(user.id, renderId);
    return { success: true, data };
  }

  @Post(':renderId/cancel')
  @ApiOperation({ summary: 'Cancel an in-progress render' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.cancelRender(user.id, renderId);
    return { success: true, data };
  }

  @Post(':renderId/preview')
  @ApiOperation({ summary: 'Get a short-lived preview URL for a completed render' })
  async preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.getPreview(user.id, renderId);
    return { success: true, data };
  }

  @Get(':renderId/download')
  @ApiOperation({ summary: 'Get a short-lived download URL for the final MP4' })
  async download(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.getDownload(user.id, renderId);
    return { success: true, data };
  }

  @Get(':renderId/subtitles')
  @ApiOperation({ summary: 'Get a short-lived download URL for subtitles' })
  async subtitles(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.renderingService.getSubtitles(user.id, renderId);
    return { success: true, data };
  }

  @Patch(':renderId/settings')
  @ApiOperation({ summary: 'Update render settings before re-running' })
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
    @Body() dto: UpdateRenderSettingsDto,
  ) {
    const data = await this.renderingService.updateSettings(user.id, renderId, dto);
    return { success: true, data };
  }
}
