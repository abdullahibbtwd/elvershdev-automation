import { ConfigService } from '@nestjs/config';
import { EncryptionService } from './encryption.service';

describe('EncryptionService', () => {
  it('encrypts and decrypts with AES-256-GCM', () => {
    const config = {
      get: (key: string) =>
        key === 'security.credentialsEncryptionKey'
          ? 'unit-test-credentials-encryption-key!!'
          : undefined,
    } as ConfigService;

    const service = new EncryptionService(config);
    service.onModuleInit();

    const encrypted = service.encrypt('social-access-token');
    expect(encrypted).not.toContain('social-access-token');
    expect(service.decrypt(encrypted)).toBe('social-access-token');
  });
});
