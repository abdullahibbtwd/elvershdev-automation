import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'node:stream';
import { buildSignedMediaContentUrl } from './signed-media-url';

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const endpoint = this.config.get<string>('minio.endpoint', 'http://localhost:9000');
    this.bucket = this.config.get<string>('minio.bucket', 'ai-video');

    this.client = new S3Client({
      endpoint,
      region: this.config.get<string>('minio.region', 'us-east-1'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: this.config.get<string>('minio.accessKey', 'minioadmin'),
        secretAccessKey: this.config.get<string>('minio.secretKey', 'minioadmin'),
      },
    });
  }

  async onModuleInit() {
    try {
      await this.ensureBucket();
    } catch (error) {
      this.logger.warn(
        `Could not ensure MinIO bucket "${this.bucket}": ${(error as Error).message}`,
      );
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      this.logger.log(`Creating bucket ${this.bucket}`);
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async ping(): Promise<boolean> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    return true;
  }

  async uploadObject(
    key: string,
    body: Buffer | Uint8Array | Readable,
    contentType: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async getPresignedUploadUrl(key: string, contentType: string, expiresIn = 3600) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.rewritePublicUrl(url);
  }

  async getPresignedDownloadUrl(key: string, expiresIn = 3600) {
    // Coolify / locked-down MinIO: serve via API HMAC URL (browser + Meta can fetch).
    const apiProxyUrl = this.buildApiContentUrl(key, expiresIn);
    if (apiProxyUrl) {
      return apiProxyUrl;
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn });
    return this.rewritePublicUrl(url);
  }

  async getObjectStream(key: string): Promise<{
    body: Readable;
    contentType?: string;
    contentLength?: number;
  }> {
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      }),
    );
    if (!response.Body) {
      throw new Error(`Empty object body for key ${key}`);
    }
    return {
      body: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  getBucket() {
    return this.bucket;
  }

  /**
   * Prefer API content proxy when MinIO is not publicly routed (Coolify default).
   * Falls back to MINIO_PUBLIC_URL rewrite when explicitly configured.
   */
  buildApiContentUrl(key: string, expiresIn = 3600): string | null {
    const publicBase =
      this.config.get<string>('minio.publicUrl')?.trim() ||
      this.config.get<string>('integrations.socialPublicMediaBaseUrl')?.trim();
    // Explicit media-proxy still wins when operators configured it.
    if (publicBase) return null;

    const publicApiUrl = this.config.get<string>('app.publicApiUrl')?.trim();
    const secret =
      this.config.get<string>('security.credentialsEncryptionKey')?.trim() ||
      this.config.get<string>('jwt.accessSecret')?.trim();
    if (!publicApiUrl || !secret) return null;

    return buildSignedMediaContentUrl({
      publicApiUrl,
      storageKey: key,
      secret,
      expiresInSeconds: expiresIn,
    });
  }

  /** Rewrite internal MinIO host to MINIO_PUBLIC_URL (e.g. https://domain/media-proxy). */
  rewritePublicUrl(presignedUrl: string): string {
    const publicBase =
      this.config.get<string>('minio.publicUrl')?.trim() ||
      this.config.get<string>('integrations.socialPublicMediaBaseUrl')?.trim();
    if (!publicBase) {
      return presignedUrl;
    }
    try {
      const signed = new URL(presignedUrl);
      const publicOrigin = new URL(publicBase);
      const pathPrefix = publicOrigin.pathname.replace(/\/$/, '');
      const objectPath = signed.pathname;
      signed.protocol = publicOrigin.protocol;
      signed.hostname = publicOrigin.hostname;
      signed.port = publicOrigin.port;
      signed.pathname =
        pathPrefix && pathPrefix !== '/' ? `${pathPrefix}${objectPath}` : objectPath;
      return signed.toString();
    } catch {
      return presignedUrl;
    }
  }
}
