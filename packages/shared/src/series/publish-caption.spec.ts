import {
  buildSeriesEpisodePostCaption,
  buildSeriesEpisodePostTitle,
} from './publish-caption';

describe('series publish caption', () => {
  it('builds title with episode number and name', () => {
    expect(
      buildSeriesEpisodePostTitle({
        episodeNumber: 1,
        episodeTitle: 'The Shoal of Scylla',
        plannedEpisodeCount: 10,
      }),
    ).toBe('Ep 1/10: The Shoal of Scylla');
  });

  it('builds caption with episode header, series name, and body', () => {
    const caption = buildSeriesEpisodePostCaption({
      seriesTitle: 'A Fragile Threshold',
      episodeNumber: 3,
      episodeTitle: 'The Gilded Keel',
      plannedEpisodeCount: 10,
      body: 'Elena confronts the salvage claim before dawn.',
    });
    expect(caption).toContain('Ep 3/10: The Gilded Keel');
    expect(caption).toContain('A Fragile Threshold');
    expect(caption).toContain('Elena confronts the salvage claim before dawn.');
  });
});
