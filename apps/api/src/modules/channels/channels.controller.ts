import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ChannelsService } from './channels.service';
import { ConnectChannelDto } from './dto/connect-channel.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ListChannelsDto } from './dto/list-channels.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { SocialOAuthProviderParam } from './social-oauth.constants';

@ApiTags('channels')
@ApiBearerAuth()
@Controller('channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post()
  @ApiOperation({ summary: 'Connect a social channel (credentials encrypted at rest)' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateChannelDto) {
    const channel = await this.channelsService.create(user.id, dto);
    return { success: true, data: channel };
  }

  @Get()
  @ApiOperation({ summary: 'List connected channels' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListChannelsDto) {
    const result = await this.channelsService.list(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get('capabilities')
  @ApiOperation({ summary: 'List default publishing capabilities per platform' })
  async capabilities() {
    const data = this.channelsService.getCapabilities();
    return { success: true, data };
  }

  @Post(':provider/connect')
  @ApiOperation({ summary: 'Start OAuth connect flow for a social provider' })
  async connect(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider', new ParseEnumPipe(SocialOAuthProviderParam))
    provider: SocialOAuthProviderParam,
    @Body() dto: ConnectChannelDto,
  ) {
    const data = await this.channelsService.startConnect(user.id, provider, dto);
    return { success: true, data };
  }

  @Public()
  @Get(':provider/callback')
  @ApiOperation({ summary: 'OAuth callback (browser redirect; public)' })
  async callback(
    @Param('provider', new ParseEnumPipe(SocialOAuthProviderParam))
    provider: SocialOAuthProviderParam,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') error: string | undefined,
    @Query('error_description') errorDescription: string | undefined,
    @Res() res: Response,
  ) {
    const redirectUrl = await this.channelsService.handleOAuthCallback(provider, {
      code,
      state,
      error,
      error_description: errorDescription,
    });
    return res.redirect(redirectUrl);
  }

  @Post(':id/refresh')
  @ApiOperation({ summary: 'Refresh channel tokens and re-check publishing capabilities' })
  async refresh(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const channel = await this.channelsService.refresh(user.id, id);
    return { success: true, data: channel };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a connected channel' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const channel = await this.channelsService.getById(user.id, id);
    return { success: true, data: channel };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a connected channel' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateChannelDto,
  ) {
    const channel = await this.channelsService.update(user.id, id, dto);
    return { success: true, data: channel };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Disconnect a channel' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.channelsService.remove(user.id, id);
    return { success: true, data: result };
  }
}
