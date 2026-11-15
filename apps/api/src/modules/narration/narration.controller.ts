import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GEMINI_PREBUILT_VOICES } from '@ai-video/shared';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateVoiceProfileDto } from './dto/create-voice-profile.dto';
import { GenerateSceneAudioDto } from './dto/generate-scene-audio.dto';
import { GenerateStoryAudioDto } from './dto/generate-story-audio.dto';
import { PlanNarrationDto } from './dto/plan-narration.dto';
import { UpdateNarrationScriptDto } from './dto/update-narration-script.dto';
import { UpdateVoiceProfileDto } from './dto/update-voice-profile.dto';
import { NarrationService } from './narration.service';

@ApiTags('narration')
@ApiBearerAuth()
@Controller('stories/:storyId/narration')
export class StoryNarrationController {
  constructor(private readonly narrationService: NarrationService) {}

  @Post('plan')
  @ApiOperation({ summary: 'Plan narration script for story scenes' })
  async planNarration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: PlanNarrationDto,
  ) {
    const result = await this.narrationService.planNarration(user.id, storyId, dto);
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'Get the latest narration script for a story' })
  async getNarration(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const result = await this.narrationService.getNarration(user.id, storyId);
    return { success: true, data: result };
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get narration / audio generation progress for a story' })
  async progress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const result = await this.narrationService.getProgress(user.id, storyId);
    return { success: true, data: result };
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate narration audio for story scenes' })
  async generateStoryAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: GenerateStoryAudioDto,
  ) {
    const result = await this.narrationService.generateStoryAudio(user.id, storyId, dto);
    return { success: true, data: result };
  }
}

@ApiTags('narration')
@ApiBearerAuth()
@Controller('narration')
export class NarrationScriptController {
  constructor(private readonly narrationService: NarrationService) {}

  @Patch(':scriptId')
  @ApiOperation({ summary: 'Edit a narration script' })
  async updateScript(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scriptId', ParseUUIDPipe) scriptId: string,
    @Body() dto: UpdateNarrationScriptDto,
  ) {
    const result = await this.narrationService.updateScript(user.id, scriptId, dto);
    return { success: true, data: result };
  }

  @Post(':scriptId/approve')
  @ApiOperation({ summary: 'Approve a ready narration script' })
  async approveScript(
    @CurrentUser() user: AuthenticatedUser,
    @Param('scriptId', ParseUUIDPipe) scriptId: string,
  ) {
    const result = await this.narrationService.approveScript(user.id, scriptId);
    return { success: true, data: result };
  }
}

@ApiTags('narration')
@ApiBearerAuth()
@Controller('stories/:storyId/audio')
export class StoryAudioController {
  constructor(private readonly narrationService: NarrationService) {}

  @Get()
  @ApiOperation({ summary: 'List audio generations for a story' })
  async listStoryAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const result = await this.narrationService.listStoryAudio(user.id, storyId);
    return { success: true, data: result };
  }
}

@ApiTags('narration')
@ApiBearerAuth()
@Controller('scenes/:sceneId/narration')
export class SceneNarrationController {
  constructor(private readonly narrationService: NarrationService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate narration audio for a single scene' })
  async generateSceneAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: GenerateSceneAudioDto,
  ) {
    const result = await this.narrationService.generateSceneAudio(user.id, sceneId, dto);
    return { success: true, data: result };
  }
}

@ApiTags('narration')
@ApiBearerAuth()
@Controller('scenes/:sceneId/audio')
export class SceneAudioController {
  constructor(private readonly narrationService: NarrationService) {}

  @Get()
  @ApiOperation({ summary: 'List audio generation attempts for a scene' })
  async listSceneAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    const result = await this.narrationService.listSceneAudio(user.id, sceneId);
    return { success: true, data: result };
  }
}

@ApiTags('narration')
@ApiBearerAuth()
@Controller('audio')
export class AudioController {
  constructor(private readonly narrationService: NarrationService) {}

  @Get(':audioId')
  @ApiOperation({ summary: 'Get an audio generation by id' })
  async getAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('audioId', ParseUUIDPipe) audioId: string,
  ) {
    const result = await this.narrationService.getAudio(user.id, audioId);
    return { success: true, data: result };
  }

  @Post(':audioId/retry')
  @ApiOperation({ summary: 'Retry a failed audio generation' })
  async retryAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('audioId', ParseUUIDPipe) audioId: string,
  ) {
    const result = await this.narrationService.retryAudio(user.id, audioId);
    return { success: true, data: result };
  }

  @Post(':audioId/select')
  @ApiOperation({ summary: 'Select a preferred audio take for its scene' })
  async selectAudio(
    @CurrentUser() user: AuthenticatedUser,
    @Param('audioId', ParseUUIDPipe) audioId: string,
  ) {
    const result = await this.narrationService.selectAudio(user.id, audioId);
    return { success: true, data: result };
  }
}

@ApiTags('voices')
@ApiBearerAuth()
@Controller('voices')
export class VoicesController {
  @Get()
  @ApiOperation({
    summary: 'List available provider voices (Gemini prebuilt voices; no preview audio)',
  })
  listVoices() {
    return {
      success: true,
      data: {
        provider: 'gemini',
        voices: GEMINI_PREBUILT_VOICES.map((voice) => ({
          id: voice.id,
          name: voice.name,
          description: voice.description,
          provider: 'gemini',
        })),
      },
    };
  }
}

@ApiTags('voices')
@ApiBearerAuth()
@Controller('voice-profiles')
export class VoiceProfilesController {
  constructor(private readonly narrationService: NarrationService) {}

  @Get()
  @ApiOperation({ summary: 'List voice profiles for the current user' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.narrationService.listVoiceProfiles(user.id);
    return { success: true, data: result };
  }

  @Post()
  @ApiOperation({ summary: 'Create a voice profile' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateVoiceProfileDto) {
    const result = await this.narrationService.createVoiceProfile(user.id, dto);
    return { success: true, data: result };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a voice profile' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVoiceProfileDto,
  ) {
    const result = await this.narrationService.updateVoiceProfile(user.id, id, dto);
    return { success: true, data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a voice profile' })
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    const result = await this.narrationService.deleteVoiceProfile(user.id, id);
    return { success: true, data: result };
  }
}
