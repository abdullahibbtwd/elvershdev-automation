import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

let s3Client: S3Client | undefined;
let bucketEnsured = false;

export function getMinioBucket(): string {
  return process.env.MINIO_BUCKET ?? 'ai-video';
}

export function getMinioEndpoint(): string {
  return process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
}

function getClient(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      endpoint: getMinioEndpoint(),
      region: process.env.MINIO_REGION ?? 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'minioadmin',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'minioadmin',
      },
    });
  }
  return s3Client;
}

export async function ensureBucket(): Promise<void> {
  if (bucketEnsured) return;
  const client = getClient();
  const bucket = getMinioBucket();
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
  } catch {
    await client.send(new CreateBucketCommand({ Bucket: bucket }));
  }
  bucketEnsured = true;
}

export async function uploadObject(
  key: string,
  body: Buffer | Uint8Array | Readable,
  contentType: string,
): Promise<void> {
  const client = getClient();
  const bucket = getMinioBucket();

  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  } catch (error) {
    const code = (error as { name?: string; Code?: string })?.name ?? (error as { Code?: string })?.Code;
    if (code === 'NoSuchBucket') {
      bucketEnsured = false;
      await ensureBucket();
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
      return;
    }
    throw error;
  }
}

export async function deleteObject(key: string): Promise<void> {
  const client = getClient();
  await client.send(
    new DeleteObjectCommand({
      Bucket: getMinioBucket(),
      Key: key,
    }),
  );
}

export async function getPresignedDownloadUrl(key: string, expiresIn = 900): Promise<string> {
  const client = getClient();
  const command = new GetObjectCommand({
    Bucket: getMinioBucket(),
    Key: key,
  });
  const url = await getSignedUrl(client, command, { expiresIn });
  return rewritePublicUrl(url);
}

/** Rewrite internal MinIO host to MINIO_PUBLIC_URL / SOCIAL_PUBLIC_MEDIA_BASE_URL. */
export function rewritePublicUrl(presignedUrl: string): string {
  const publicBase =
    process.env.MINIO_PUBLIC_URL?.trim() ||
    process.env.SOCIAL_PUBLIC_MEDIA_BASE_URL?.trim();
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

export async function downloadObject(key: string): Promise<Buffer> {
  const client = getClient();
  const response = await client.send(
    new GetObjectCommand({
      Bucket: getMinioBucket(),
      Key: key,
    }),
  );
  const body = response.Body;
  if (!body) {
    throw new Error(`Empty object body for key ${key}`);
  }

  const chunks: Buffer[] = [];
  // AWS SDK v3 Body is async iterable in Node
  for await (const chunk of body as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}
