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
import { ListPublishingDto } from './dto/list-publishing.dto';
import { PublishRenderDto } from './dto/publish-render.dto';
import { SuggestCaptionDto } from './dto/suggest-caption.dto';
import { UpdatePublicationDto } from './dto/update-publication.dto';
import { PublishingService } from './publishing.service';

@ApiTags('publishing')
@ApiBearerAuth()
@Controller('publishing')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Get()
  @ApiOperation({ summary: 'List publishing history' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPublishingDto) {
    const result = await this.publishingService.list(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Post('suggest-caption')
  @ApiOperation({ summary: 'Suggest a social caption via Gemini' })
  async suggestCaption(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SuggestCaptionDto,
  ) {
    const data = await this.publishingService.suggestCaption(user.id, dto);
    return { success: true, data };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a publication by id' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.publishingService.getById(user.id, id);
    return { success: true, data };
  }

  @Get(':id/progress')
  @ApiOperation({ summary: 'Get publication progress' })
  async progress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.publishingService.getProgress(user.id, id);
    return { success: true, data };
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or action-required publication' })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.publishingService.retry(user.id, id);
    return { success: true, data };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a queued or early publication' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const data = await this.publishingService.cancel(user.id, id);
    return { success: true, data };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update publication metadata before or during action-required' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePublicationDto,
  ) {
    const data = await this.publishingService.update(user.id, id, dto);
    return { success: true, data };
  }
}

@ApiTags('publishing')
@ApiBearerAuth()
@Controller('renders')
export class PublishRendersController {
  constructor(private readonly publishingService: PublishingService) {}

  @Post(':renderId/publish')
  @ApiOperation({ summary: 'Publish a completed render to one or more social channels' })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
    @Body() dto: PublishRenderDto,
  ) {
    const data = await this.publishingService.publishRender(user.id, renderId, dto);
    return { success: true, data };
  }

  @Get(':renderId/publications')
  @ApiOperation({ summary: 'List publications for a render' })
  async listByRender(
    @CurrentUser() user: AuthenticatedUser,
    @Param('renderId', ParseUUIDPipe) renderId: string,
  ) {
    const data = await this.publishingService.listByRender(user.id, renderId);
    return { success: true, data };
  }
}
