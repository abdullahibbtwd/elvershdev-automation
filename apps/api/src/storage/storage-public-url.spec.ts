import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

describe('StorageService public URL rewrite', () => {
  function makeService(opts?: {
    publicUrl?: string;
    publicApiUrl?: string;
    secret?: string;
  }) {
    const config = {
      get: (key: string, fallback?: string) => {
        const map: Record<string, string | undefined> = {
          'minio.endpoint': 'http://minio:9000',
          'minio.bucket': 'ai-video',
          'minio.region': 'us-east-1',
          'minio.accessKey': 'minioadmin',
          'minio.secretKey': 'minioadmin',
          'minio.publicUrl': opts?.publicUrl,
          'app.publicApiUrl': opts?.publicApiUrl,
          'security.credentialsEncryptionKey': opts?.secret,
        };
        return map[key] ?? fallback;
      },
    } as unknown as ConfigService;
    return new StorageService(config);
  }

  it('rewrites internal MinIO origin to media-proxy base', () => {
    const svc = makeService({ publicUrl: 'https://example.com/media-proxy' });
    const input =
      'http://minio:9000/ai-video/renders/a.mp4?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=900';
    const out = svc.rewritePublicUrl(input);
    expect(out.startsWith('https://example.com/media-proxy/ai-video/renders/a.mp4')).toBe(true);
    expect(out).toContain('X-Amz-Expires=900');
  });

  it('leaves URL unchanged when public URL unset', () => {
    const svc = makeService();
    const input = 'http://minio:9000/ai-video/x.bin?sig=1';
    expect(svc.rewritePublicUrl(input)).toBe(input);
  });

  it('builds API content URL when MinIO public URL is unset (Coolify)', () => {
    const svc = makeService({
      publicApiUrl: 'https://automation.example.com',
      secret: 'c'.repeat(32),
    });
    const url = svc.buildApiContentUrl('users/u1/a.mp4', 900);
    expect(url).toContain('https://automation.example.com/api/media/content?');
    expect(url).toContain('key=users%2Fu1%2Fa.mp4');
  });

  it('skips API content URL when media-proxy is configured', () => {
    const svc = makeService({
      publicUrl: 'https://example.com/media-proxy',
      publicApiUrl: 'https://automation.example.com',
      secret: 'c'.repeat(32),
    });
    expect(svc.buildApiContentUrl('users/u1/a.mp4')).toBeNull();
  });
});
