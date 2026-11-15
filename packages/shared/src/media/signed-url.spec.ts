import {
  buildSignedMediaContentUrl,
  verifySignedMediaContent,
} from './signed-url';

describe('signed media content URLs', () => {
  const secret = 'test-credentials-encryption-key-32chars!!';

  it('builds and verifies a content URL', () => {
    const url = buildSignedMediaContentUrl({
      publicApiUrl: 'https://automation.example.com',
      storageKey: 'users/u1/renders/a.mp4',
      secret,
      expiresInSeconds: 600,
    });
    expect(url.startsWith('https://automation.example.com/api/media/content?')).toBe(true);
    const parsed = new URL(url);
    expect(
      verifySignedMediaContent({
        storageKey: parsed.searchParams.get('key')!,
        exp: parsed.searchParams.get('exp')!,
        sig: parsed.searchParams.get('sig')!,
        secret,
      }),
    ).toBe(true);
  });

  it('rejects expired or tampered signatures', () => {
    expect(
      verifySignedMediaContent({
        storageKey: 'users/u1/a.mp4',
        exp: Math.floor(Date.now() / 1000) - 10,
        sig: 'deadbeef',
        secret,
      }),
    ).toBe(false);

    const url = buildSignedMediaContentUrl({
      publicApiUrl: 'https://automation.example.com',
      storageKey: 'users/u1/a.mp4',
      secret,
    });
    const parsed = new URL(url);
    expect(
      verifySignedMediaContent({
        storageKey: 'users/u1/other.mp4',
        exp: parsed.searchParams.get('exp')!,
        sig: parsed.searchParams.get('sig')!,
        secret,
      }),
    ).toBe(false);
  });
});
