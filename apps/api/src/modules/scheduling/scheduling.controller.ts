import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('scheduling')
@Controller('scheduling')
export class SchedulingController {}
