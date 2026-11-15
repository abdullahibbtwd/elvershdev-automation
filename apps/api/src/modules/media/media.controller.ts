import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ListMediaDto } from './dto/list-media.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { MediaService } from './media.service';
import { MAX_UPLOAD_BYTES } from './media.constants';

@ApiTags('media')
@ApiBearerAuth()
@Controller('media')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post('upload')
  @ApiOperation({ summary: 'Upload a media file through the API' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        videoProjectId: { type: 'string', format: 'uuid' },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body('videoProjectId') videoProjectId?: string,
  ) {
    const asset = await this.mediaService.upload(user.id, file, videoProjectId || undefined);
    return { success: true, data: asset };
  }

  @Post('presign')
  @ApiOperation({ summary: 'Create a media record and temporary upload URL' })
  async presign(@CurrentUser() user: AuthenticatedUser, @Body() dto: PresignUploadDto) {
    const result = await this.mediaService.createPresignedUpload(user.id, dto);
    return { success: true, data: result };
  }

  @Get()
  @ApiOperation({ summary: 'List media assets' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListMediaDto) {
    const result = await this.mediaService.list(user.id, query);
    return { success: true, data: result.items, meta: result.meta };
  }

  @Public()
  @Get('content')
  @ApiOperation({
    summary: 'Stream media by HMAC-signed URL (browser/Meta; no MinIO public exposure)',
  })
  async content(
    @Query('key') key: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const object = await this.mediaService.streamSignedContent(key, exp, sig);
    if (object.contentType) {
      res.setHeader('Content-Type', object.contentType);
    }
    if (object.contentLength != null) {
      res.setHeader('Content-Length', String(object.contentLength));
    }
    res.setHeader('Cache-Control', 'private, max-age=300');
    return new StreamableFile(object.body);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get media asset details' })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const asset = await this.mediaService.getById(user.id, id);
    return { success: true, data: asset };
  }

  @Get(':id/download-url')
  @ApiOperation({ summary: 'Get a temporary presigned download URL' })
  async downloadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.mediaService.getDownloadUrl(user.id, id);
    return { success: true, data: result };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a media asset' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const result = await this.mediaService.remove(user.id, id);
    return { success: true, data: result };
  }
}
