import { fal } from '@fal-ai/client';
import { randomUUID } from 'node:crypto';

function isHttpUrl(value: string | undefined | null): value is string {
  return Boolean(value && /^https?:\/\//i.test(value));
}

/**
 * Upload bytes to fal CDN so lip-sync / video models can fetch them.
 * Local MinIO URLs are not reachable by fal.ai.
 */
export async function uploadBytesToFalStorage(input: {
  apiKey: string;
  bytes: Uint8Array | Buffer;
  fileName: string;
  mimeType: string;
}): Promise<string> {
  fal.config({ credentials: input.apiKey });
  const file = new File([input.bytes], input.fileName || `upload-${randomUUID()}`, {
    type: input.mimeType,
  });
  const uploadedUrl = await fal.storage.upload(file);
  if (!isHttpUrl(uploadedUrl)) {
    throw new Error('fal.storage.upload did not return an HTTP URL');
  }
  return uploadedUrl;
}

export async function downloadUrlToBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
