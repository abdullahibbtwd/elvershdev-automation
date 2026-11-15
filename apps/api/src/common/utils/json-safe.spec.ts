import { installBigIntJson, jsonSafe } from './json-safe';

describe('jsonSafe', () => {
  it('converts BigInt and nested Prisma-like payloads', () => {
    const input = {
      totalViews: 12n,
      nested: { likes: 3n, list: [1n, null] },
      title: 'ok',
    };
    expect(jsonSafe(input)).toEqual({
      totalViews: 12,
      nested: { likes: 3, list: [1, null] },
      title: 'ok',
    });
  });

  it('installs BigInt.toJSON for Express serialization', () => {
    installBigIntJson();
    expect(JSON.stringify({ views: 42n })).toBe('{"views":42}');
  });
});
