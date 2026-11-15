import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService public URL rewrite', () => {
  function makeService(publicUrl?: string) {
    const config = {
      get: (key: string, fallback?: string) => {
        const map: Record<string, string | undefined> = {
          'minio.endpoint': 'http://minio:9000',
          'minio.bucket': 'ai-video',
          'minio.region': 'us-east-1',
          'minio.accessKey': 'minioadmin',
          'minio.secretKey': 'minioadmin',
          'minio.publicUrl': publicUrl,
        };
        return map[key] ?? fallback;
      },
    } as unknown as ConfigService;
    return new StorageService(config);
  }

  it('rewrites internal MinIO origin to media-proxy base', () => {
    const svc = makeService('https://example.com/media-proxy');
    const input =
      'http://minio:9000/ai-video/renders/a.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900';
    const out = svc.rewritePublicUrl(input);
    expect(out.startsWith('https://example.com/media-proxy/ai-video/renders/a.mp4')).toBe(true);
    expect(out).toContain('X-Amz-Expires=900');
  });

  it('leaves URL unchanged when public URL unset', () => {
    const svc = makeService(undefined);
    const input = 'http://minio:9000/ai-video/x.bin?sig=1';
    expect(svc.rewritePublicUrl(input)).toBe(input);
  });
});
