import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { QueueModule } from '../../queue/queue.module';
import { StorageModule } from '../../storage/storage.module';
import { RendersController, StoryRendersController } from './rendering.controller';
import { RenderingService } from './rendering.service';

@Module({
  imports: [PrismaModule, QueueModule, StorageModule],
  controllers: [StoryRendersController, RendersController],
  providers: [RenderingService],
  exports: [RenderingService],
})
export class RenderingModule {}
