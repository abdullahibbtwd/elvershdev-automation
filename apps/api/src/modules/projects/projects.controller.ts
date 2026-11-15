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
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { ProjectsService } from './projects.service';

@ApiTags('projects')
@ApiBearerAuth()
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a video project' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateProjectDto) {
    const project = await this.projectsService.create(user.id, dto);
    return { success: true, data: project };
  }

  @Get()
  @ApiOperation({ summary: 'List video projects' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListProjectsDto) {
    const result = await this.projectsService.list(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a video project' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const project = await this.projectsService.getById(user.id, id);
    return { success: true, data: project };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a video project' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateProjectDto,
  ) {
    const project = await this.projectsService.update(user.id, id, dto);
    return { success: true, data: project };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a video project' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.projectsService.remove(user.id, id);
    return { success: true, data: result };
  }
}
