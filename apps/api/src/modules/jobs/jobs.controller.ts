import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateJobDto } from './dto/create-job.dto';
import { ListJobsDto } from './dto/list-jobs.dto';
import { JobsService } from './jobs.service';

@ApiTags('jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @ApiOperation({ summary: 'Create and enqueue a generation job' })
  async create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateJobDto) {
    const job = await this.jobsService.create(user.id, dto);
    return { success: true, data: job };
  }

  @Get()
  @ApiOperation({ summary: 'List generation jobs' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListJobsDto) {
    const result = await this.jobsService.list(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a generation job' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.jobsService.getById(user.id, id);
    return { success: true, data: job };
  }

  @Post(':id/cancel')
  @ApiOperation({ summary: 'Cancel a pending/queued job' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.jobsService.cancel(user.id, id);
    return { success: true, data: job };
  }

  @Post(':id/retry')
  @ApiOperation({ summary: 'Retry a failed or cancelled job' })
  async retry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const job = await this.jobsService.retry(user.id, id);
    return { success: true, data: job };
  }
}
