import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaType, Prisma } from '@prisma/client';
import { verifySignedMediaContent } from '@ai-video/shared';
import { randomUUID } from 'node:crypto';
import type { Readable } from 'node:stream';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../../storage/storage.service';
import { ProjectsService } from '../projects/projects.service';
import { ALL_ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES } from './media.constants';
import { ListMediaDto } from './dto/list-media.dto';
import { PresignUploadDto } from './dto/presign-upload.dto';

@Injectable()
export class MediaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly projectsService: ProjectsService,
    private readonly config: ConfigService,
  ) {}

  async upload(
    userId: string,
    file: Express.Multer.File,
    videoProjectId?: string,
  ) {
    this.validateFile(file);
    if (videoProjectId) {
      await this.projectsService.ensureOwned(userId, videoProjectId);
    }

    const type = this.resolveMediaType(file.mimetype);
    const storageKey = this.buildStorageKey(userId, file.originalname);

    await this.storage.uploadObject(storageKey, file.buffer, file.mimetype);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        videoProjectId,
        type,
        storageKey,
        originalName: file.originalname,
        mimeType: file.mimetype,
        fileSize: BigInt(file.size),
        metadata: {
          uploadedVia: 'multipart',
        },
      },
    });

    return this.serialize(asset);
  }

  async createPresignedUpload(userId: string, dto: PresignUploadDto) {
    this.assertMimeType(dto.contentType);
    if (dto.sizeBytes && dto.sizeBytes > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
    }
    if (dto.videoProjectId) {
      await this.projectsService.ensureOwned(userId, dto.videoProjectId);
    }

    const type = this.resolveMediaType(dto.contentType);
    const storageKey = this.buildStorageKey(userId, dto.filename);
    const uploadUrl = await this.storage.getPresignedUploadUrl(storageKey, dto.contentType, 900);

    const asset = await this.prisma.mediaAsset.create({
      data: {
        userId,
        videoProjectId: dto.videoProjectId,
        type,
        storageKey,
        originalName: dto.filename,
        mimeType: dto.contentType,
        fileSize: dto.sizeBytes ? BigInt(dto.sizeBytes) : null,
        metadata: {
          uploadPending: true,
        },
      },
    });

    return {
      asset: this.serialize(asset),
      uploadUrl,
      expiresIn: 900,
    };
  }

  async list(userId: string, query: ListMediaDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.MediaAssetWhereInput = {
      userId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.videoProjectId ? { videoProjectId: query.videoProjectId } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    return {
      items: items.map((item) => this.serialize(item)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getById(userId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, userId } });
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    return this.serialize(asset);
  }

  async getDownloadUrl(userId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, userId } });
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    const url = await this.storage.getPresignedDownloadUrl(asset.storageKey, 900);
    return { url, expiresIn: 900 };
  }

  async streamSignedContent(
    key: string,
    exp: string,
    sig: string,
  ): Promise<{ body: Readable; contentType?: string; contentLength?: number }> {
    const secret =
      this.config.get<string>('security.credentialsEncryptionKey')?.trim() ||
      this.config.get<string>('jwt.accessSecret')?.trim();
    if (!secret) {
      throw new UnauthorizedException('Media signing is not configured');
    }
    if (
      !verifySignedMediaContent({
        storageKey: key,
        exp,
        sig,
        secret,
      })
    ) {
      throw new UnauthorizedException('Invalid or expired media signature');
    }
    return this.storage.getObjectStream(key);
  }

  async remove(userId: string, id: string) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, userId } });
    if (!asset) {
      throw new NotFoundException('Media asset not found');
    }
    await this.storage.deleteObject(asset.storageKey);
    await this.prisma.mediaAsset.delete({ where: { id } });
    return { deleted: true };
  }

  async countByUser(userId: string) {
    return this.prisma.mediaAsset.count({ where: { userId } });
  }

  async checkConnectivity() {
    return this.storage.ping();
  }

  private validateFile(file?: Express.Multer.File) {
    if (!file) {
      throw new BadRequestException('File is required');
    }
    this.assertMimeType(file.mimetype);
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new BadRequestException(`File exceeds maximum size of ${MAX_UPLOAD_BYTES} bytes`);
    }
  }

  private assertMimeType(mimeType: string) {
    if (!(ALL_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
      throw new BadRequestException(`Unsupported MIME type: ${mimeType}`);
    }
  }

  private resolveMediaType(mimeType: string): MediaType {
    if (mimeType.startsWith('image/')) return MediaType.IMAGE;
    if (mimeType.startsWith('audio/')) return MediaType.AUDIO;
    if (mimeType.startsWith('video/')) return MediaType.VIDEO;
    return MediaType.OTHER;
  }

  private buildStorageKey(userId: string, filename: string) {
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    return `users/${userId}/${randomUUID()}-${safeName}`;
  }

  private serialize(asset: {
    id: string;
    userId: string;
    videoProjectId: string | null;
    type: MediaType;
    storageKey: string;
    originalName: string | null;
    mimeType: string | null;
    fileSize: bigint | null;
    metadata: Prisma.JsonValue;
    createdAt: Date;
  }) {
    return {
      id: asset.id,
      userId: asset.userId,
      videoProjectId: asset.videoProjectId,
      type: asset.type,
      storageKey: asset.storageKey,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      fileSize: asset.fileSize !== null ? Number(asset.fileSize) : null,
      metadata: asset.metadata,
      createdAt: asset.createdAt,
    };
  }
}
