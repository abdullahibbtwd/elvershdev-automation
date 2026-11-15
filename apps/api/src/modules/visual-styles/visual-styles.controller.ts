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
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CreateVisualStyleDto } from './dto/create-visual-style.dto';
import { UpdateVisualStyleDto } from './dto/update-visual-style.dto';
import { VisualStylesService } from './visual-styles.service';

@ApiTags('visual-styles')
@ApiBearerAuth()
@Controller('visual-styles')
export class VisualStylesController {
  constructor(private readonly visualStylesService: VisualStylesService) {}

  @Get()
  @ApiOperation({ summary: 'List built-in system and user visual styles' })
  async list(@CurrentUser() user: AuthenticatedUser) {
    const styles = await this.visualStylesService.list(user.id);
    return { success: true, data: styles };
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom visual style' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateVisualStyleDto,
  ) {
    const style = await this.visualStylesService.create(user.id, dto);
    return { success: true, data: style };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a user-owned visual style' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateVisualStyleDto,
  ) {
    const style = await this.visualStylesService.update(user.id, id, dto);
    return { success: true, data: style };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a user-owned visual style' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.visualStylesService.remove(user.id, id);
    return { success: true, data: result };
  }
}
