import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get current user settings' })
  async get(@CurrentUser() user: AuthenticatedUser) {
    const settings = await this.settingsService.getForUser(user.id);
    return { success: true, data: settings };
  }

  @Patch()
  @ApiOperation({ summary: 'Update current user settings' })
  async update(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateSettingsDto) {
    const settings = await this.settingsService.updateForUser(user.id, dto);
    return { success: true, data: settings };
  }
}
