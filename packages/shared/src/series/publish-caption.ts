/** Public social title for a Series episode post. */
export function buildSeriesEpisodePostTitle(input: {
  episodeNumber: number;
  episodeTitle: string;
  plannedEpisodeCount?: number | null;
}): string {
  const title = input.episodeTitle.trim() || `Episode ${input.episodeNumber}`;
  const epLabel =
    input.plannedEpisodeCount && input.plannedEpisodeCount > 0
      ? `Ep ${input.episodeNumber}/${input.plannedEpisodeCount}`
      : `Ep ${input.episodeNumber}`;
  return `${epLabel}: ${title}`;
}

/**
 * Caption body with episode number + name on the first line, then story/synopsis copy.
 */
export function buildSeriesEpisodePostCaption(input: {
  seriesTitle: string;
  episodeNumber: number;
  episodeTitle: string;
  plannedEpisodeCount?: number | null;
  body?: string | null;
}): string {
  const header = buildSeriesEpisodePostTitle(input);
  const series = input.seriesTitle.trim();
  const body = input.body?.trim() || '';
  const parts = [header];
  if (series && series.toLowerCase() !== input.episodeTitle.trim().toLowerCase()) {
    parts.push(series);
  }
  if (body && body !== header && body !== input.episodeTitle.trim()) {
    parts.push(body);
  }
  return parts.join('\n\n');
}
