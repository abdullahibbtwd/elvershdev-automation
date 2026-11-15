import { appendHashtagsToCaption, buildViralHashtags } from './hashtags';

describe('buildViralHashtags', () => {
  it('merges seed, slot, category and platform tags without #', () => {
    const tags = buildViralHashtags({
      platform: 'INSTAGRAM',
      seedTags: ['#BeaconStory', 'Hope'],
      category: 'Human emotions',
      theme: 'kindness',
      title: 'The Light He Never Turned Off',
      slotKind: 'evening',
      maxTags: 12,
    });
    expect(tags.every((t) => !t.startsWith('#'))).toBe(true);
    expect(tags).toEqual(expect.arrayContaining(['beaconstory', 'hope', 'kindness', 'reels']));
    expect(tags.length).toBeLessThanOrEqual(12);
  });

  it('keeps TikTok tag sets smaller', () => {
    const tags = buildViralHashtags({
      platform: 'TIKTOK',
      seedTags: ['storytime'],
      slotKind: 'morning',
    });
    expect(tags.length).toBeLessThanOrEqual(6);
    expect(tags).toEqual(expect.arrayContaining(['storytime', 'fyp']));
  });
});

describe('appendHashtagsToCaption', () => {
  it('appends missing tags once', () => {
    const caption = appendHashtagsToCaption('A quiet truth.', ['hope', 'storytime']);
    expect(caption).toContain('A quiet truth.');
    expect(caption).toContain('#hope');
    expect(caption).toContain('#storytime');
  });
});
