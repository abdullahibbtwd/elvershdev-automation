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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AttachStoryToProjectDto } from './dto/attach-project.dto';
import { CreateStoryDto } from './dto/create-story.dto';
import { GenerateStoryDto } from './dto/generate-story.dto';
import { ListStoriesDto } from './dto/list-stories.dto';
import { RegenerateStoryDto } from './dto/regenerate-story.dto';
import { UpdateStoryDto } from './dto/update-story.dto';
import { StoriesService } from './stories.service';

@ApiTags('stories')
@ApiBearerAuth()
@Controller('stories')
export class StoriesController {
  constructor(private readonly storiesService: StoriesService) {}

  @Post('generate')
  @ApiOperation({ summary: 'Enqueue AI story generation from a brief' })
  async generate(@CurrentUser() user: AuthenticatedUser, @Body() dto: GenerateStoryDto) {
    const result = await this.storiesService.generate(user.id, dto);
    return { success: true, data: result };
  }

  @Post()
  @ApiOperation({ summary: 'Create a story draft' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateStoryDto) {
    const story = await this.storiesService.create(user.id, dto);
    return { success: true, data: story };
  }

  @Get()
  @ApiOperation({ summary: 'List stories for the current user' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListStoriesDto) {
    const result = await this.storiesService.list(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a story by id (includes scenes and characters)' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const story = await this.storiesService.getById(user.id, id);
    return { success: true, data: story };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update / edit a story' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStoryDto,
  ) {
    const story = await this.storiesService.update(user.id, id, dto);
    return { success: true, data: story };
  }

  @Post(':id/regenerate')
  @ApiOperation({ summary: 'Regenerate story content with Gemini' })
  async regenerate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegenerateStoryDto,
  ) {
    const result = await this.storiesService.regenerate(user.id, id, dto);
    return { success: true, data: result };
  }

  @Post(':id/plan-scenes')
  @ApiOperation({ summary: 'Enqueue scene planning for an existing story' })
  async planScenes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.storiesService.planScenes(user.id, id);
    return { success: true, data: result };
  }

  @Post(':id/attach-project')
  @ApiOperation({ summary: 'Attach story to an existing or new video project' })
  async attachProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AttachStoryToProjectDto,
  ) {
    const project = await this.storiesService.attachToProject(user.id, id, dto);
    return { success: true, data: project };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a story' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.storiesService.remove(user.id, id);
    return { success: true, data: result };
  }
}
