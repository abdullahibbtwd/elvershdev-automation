import type { CaptionSuggestionInput } from '../schemas';

export function buildCaptionSuggestionPrompt(input: CaptionSuggestionInput): string {
  const maxHashtags = input.maxHashtags ?? 8;
  return [
    'You are a social media copywriter for short-form video.',
    `Platform: ${input.platform}`,
    input.storyTitle ? `Story title: ${input.storyTitle}` : null,
    input.storyDescription ? `Story context: ${input.storyDescription}` : null,
    input.existingCaption ? `Existing draft caption: ${input.existingCaption}` : null,
    input.tone ? `Tone: ${input.tone}` : 'Tone: engaging and concise',
    '',
    'Return ONLY valid JSON matching this shape:',
    '{',
    '  "title": "optional short title (YouTube/Facebook/TikTok)",',
    '  "caption": "platform-ready caption including inline hashtags if natural",',
    '  "description": "optional longer description",',
    `  "hashtags": ["tag1", "tag2"] // up to ${maxHashtags}, without # prefix`,
    '}',
    '',
    'Rules:',
    '- Do not invent brand claims or unsafe content.',
    '- Keep caption within typical platform limits.',
    '- Prefer actionable hooks for short-form video.',
  ]
    .filter(Boolean)
    .join('\n');
}

export function createMockCaptionSuggestion(
  input: CaptionSuggestionInput,
): {
  title?: string;
  caption: string;
  description?: string;
  hashtags: string[];
} {
  const base = input.existingCaption?.trim() || input.storyTitle || 'New story video';
  const hashtags = ['ai', 'story', 'shortform', input.platform.toLowerCase()].slice(
    0,
    input.maxHashtags ?? 8,
  );
  return {
    title: input.storyTitle?.slice(0, 100) || base.slice(0, 100),
    caption: `${base} #${hashtags.join(' #')}`.slice(0, 2200),
    description: input.storyDescription?.slice(0, 5000),
    hashtags,
  };
}
