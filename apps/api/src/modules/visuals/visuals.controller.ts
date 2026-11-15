import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { GenerateCharacterReferenceDto } from './dto/generate-character-reference.dto';
import { GenerateSceneVisualDto } from './dto/generate-scene-visual.dto';
import { GenerateStoryVisualsDto } from './dto/generate-story-visuals.dto';
import { UpdateSceneVisualDto } from './dto/update-scene-visual.dto';
import { VisualsService } from './visuals.service';

@ApiTags('visuals')
@ApiBearerAuth()
@Controller('stories/:storyId/visuals')
export class StoryVisualsController {
  constructor(private readonly visualsService: VisualsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Analyze story scenes and enqueue visual generation' })
  async generateForStory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: GenerateStoryVisualsDto,
  ) {
    const result = await this.visualsService.generateForStory(
      user.id,
      storyId,
      dto,
    );
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List scenes, visuals, and character references for a story' })
  async listStoryVisuals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const result = await this.visualsService.listStoryVisuals(user.id, storyId);
    return { success: true, data: result };
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get visual generation progress for a story' })
  async getProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const progress = await this.visualsService.getProgress(user.id, storyId);
    return { success: true, data: progress };
  }
}

@ApiTags('visuals')
@ApiBearerAuth()
@Controller('scenes/:sceneId/visuals')
export class SceneVisualsController {
  constructor(private readonly visualsService: VisualsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a visual image for a specific scene' })
  async generateForScene(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: GenerateSceneVisualDto,
  ) {
    const result = await this.visualsService.generateForScene(
      user.id,
      sceneId,
      dto,
    );
    return { success: true, data: result };
  }

  @Post('regenerate')
  @ApiOperation({ summary: 'Regenerate a new visual attempt for a specific scene' })
  async regenerateForScene(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: GenerateSceneVisualDto,
  ) {
    const result = await this.visualsService.regenerateForScene(
      user.id,
      sceneId,
      dto,
    );
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List visual attempts for a scene' })
  async listSceneVisuals(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    const visuals = await this.visualsService.listSceneVisuals(user.id, sceneId);
    return { success: true, data: visuals };
  }

  @Patch(':visualId')
  @ApiOperation({ summary: 'Update a scene visual prompt or select preferred attempt' })
  async updateSceneVisual(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Param('visualId', ParseUUIDPipe) visualId: string,
    @Body() dto: UpdateSceneVisualDto,
  ) {
    const visual = await this.visualsService.updateSceneVisual(
      user.id,
      sceneId,
      visualId,
      dto,
    );
    return { success: true, data: visual };
  }
}

@ApiTags('visuals')
@ApiBearerAuth()
@Controller('characters/:characterId/visual-reference')
export class CharacterVisualsController {
  constructor(private readonly visualsService: VisualsService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a canonical visual reference portrait for a character' })
  async generateCharacterReference(
    @CurrentUser() user: AuthenticatedUser,
    @Param('characterId', ParseUUIDPipe) characterId: string,
    @Body() dto: GenerateCharacterReferenceDto,
  ) {
    const result = await this.visualsService.generateCharacterReference(
      user.id,
      characterId,
      dto,
    );
    return { success: true, data: result };
  }
}

@ApiTags('visuals')
@ApiBearerAuth()
@Controller('visual-generation/jobs')
export class VisualGenerationJobsController {
  constructor(private readonly visualsService: VisualsService) {}

  @Get(':jobId')
  @ApiOperation({ summary: 'Get a visual generation job status' })
  async getJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.visualsService.getJob(user.id, jobId);
    return { success: true, data: job };
  }

  @Post(':jobId/retry')
  @ApiOperation({ summary: 'Retry a failed or cancelled visual generation job' })
  async retryJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.visualsService.retryJob(user.id, jobId);
    return { success: true, data: job };
  }

  @Post(':jobId/cancel')
  @ApiOperation({ summary: 'Cancel a pending or queued visual generation job' })
  async cancelJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.visualsService.cancelJob(user.id, jobId);
    return { success: true, data: job };
  }
}
