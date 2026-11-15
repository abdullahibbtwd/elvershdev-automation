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
import { GenerateSceneMotionDto } from './dto/generate-scene-motion.dto';
import { GenerateStoryMotionDto } from './dto/generate-story-motion.dto';
import { UpdateMotionDto } from './dto/update-motion.dto';
import { MotionService } from './motion.service';

@ApiTags('motion')
@ApiBearerAuth()
@Controller('stories/:storyId/motion')
export class StoryMotionController {
  constructor(private readonly motionService: MotionService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate motion clips for story scenes' })
  async generateForStory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
    @Body() dto: GenerateStoryMotionDto,
  ) {
    const result = await this.motionService.generateForStory(user.id, storyId, dto);
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List motion generations for a story' })
  async listStoryMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const result = await this.motionService.listStoryMotion(user.id, storyId);
    return { success: true, data: result };
  }

  @Get('progress')
  @ApiOperation({ summary: 'Get motion generation progress for a story' })
  async getProgress(
    @CurrentUser() user: AuthenticatedUser,
    @Param('storyId', ParseUUIDPipe) storyId: string,
  ) {
    const progress = await this.motionService.getProgress(user.id, storyId);
    return { success: true, data: progress };
  }
}

@ApiTags('motion')
@ApiBearerAuth()
@Controller('scenes/:sceneId/motion')
export class SceneMotionController {
  constructor(private readonly motionService: MotionService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Generate a motion clip for a scene' })
  async generateForScene(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: GenerateSceneMotionDto,
  ) {
    const result = await this.motionService.generateForScene(user.id, sceneId, dto);
    return { success: true, data: result };
  }

  @Post('regenerate')
  @ApiOperation({ summary: 'Regenerate a motion clip for a scene' })
  async regenerateForScene(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
    @Body() dto: GenerateSceneMotionDto,
  ) {
    const result = await this.motionService.regenerateForScene(user.id, sceneId, dto);
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List motion generation attempts for a scene' })
  async listSceneMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sceneId', ParseUUIDPipe) sceneId: string,
  ) {
    const motions = await this.motionService.listSceneMotion(user.id, sceneId);
    return { success: true, data: motions };
  }
}

@ApiTags('motion')
@ApiBearerAuth()
@Controller('motion')
export class MotionController {
  constructor(private readonly motionService: MotionService) {}

  @Get('providers')
  @ApiOperation({ summary: 'List video generation providers and availability' })
  async listProviders() {
    const providers = this.motionService.listVideoProviders();
    return { success: true, data: { providers } };
  }

  @Get(':motionId')
  @ApiOperation({ summary: 'Get a motion generation by id' })
  async getMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('motionId', ParseUUIDPipe) motionId: string,
  ) {
    const motion = await this.motionService.getMotion(user.id, motionId);
    return { success: true, data: motion };
  }

  @Patch(':motionId')
  @ApiOperation({ summary: 'Update motion prompt or selection' })
  async updateMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('motionId', ParseUUIDPipe) motionId: string,
    @Body() dto: UpdateMotionDto,
  ) {
    const motion = await this.motionService.updateMotion(user.id, motionId, dto);
    return { success: true, data: motion };
  }

  @Post(':motionId/retry')
  @ApiOperation({ summary: 'Retry a failed motion generation' })
  async retryMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('motionId', ParseUUIDPipe) motionId: string,
  ) {
    const result = await this.motionService.retryMotion(user.id, motionId);
    return { success: true, data: result };
  }

  @Post(':motionId/cancel')
  @ApiOperation({ summary: 'Cancel an eligible pending/in-progress motion generation' })
  async cancelMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('motionId', ParseUUIDPipe) motionId: string,
  ) {
    const motion = await this.motionService.cancelMotion(user.id, motionId);
    return { success: true, data: motion };
  }

  @Post(':motionId/select')
  @ApiOperation({ summary: 'Select a preferred motion clip for its scene' })
  async selectMotion(
    @CurrentUser() user: AuthenticatedUser,
    @Param('motionId', ParseUUIDPipe) motionId: string,
  ) {
    const motion = await this.motionService.selectMotion(user.id, motionId);
    return { success: true, data: motion };
  }
}

@ApiTags('motion')
@ApiBearerAuth()
@Controller('motion-generation/jobs')
export class MotionGenerationJobsController {
  constructor(private readonly motionService: MotionService) {}

  @Get(':jobId')
  @ApiOperation({ summary: 'Get a motion-related generation job' })
  async getJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.motionService.getJob(user.id, jobId);
    return { success: true, data: job };
  }

  @Post(':jobId/retry')
  @ApiOperation({ summary: 'Retry a failed motion generation job' })
  async retryJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.motionService.retryJob(user.id, jobId);
    return { success: true, data: job };
  }

  @Post(':jobId/cancel')
  @ApiOperation({ summary: 'Cancel a pending/queued motion generation job' })
  async cancelJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    const job = await this.motionService.cancelJob(user.id, jobId);
    return { success: true, data: job };
  }
}
