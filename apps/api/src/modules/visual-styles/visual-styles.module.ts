import { Module } from '@nestjs/common';
import { VisualStylesController } from './visual-styles.controller';
import { VisualStylesService } from './visual-styles.service';

@Module({
  controllers: [VisualStylesController],
  providers: [VisualStylesService],
  exports: [VisualStylesService],
})
export class VisualStylesModule {}
