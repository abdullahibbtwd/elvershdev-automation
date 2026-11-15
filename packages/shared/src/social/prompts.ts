import type { CaptionSuggestionInput } from '../schemas';

export function buildCaptionSuggestionPrompt(input: CaptionSuggestionInput): string {
  const maxHashtags = input.maxHashtags ?? 12;
  return [
    'You are a social media copywriter optimizing cinematic short stories for reach.',
    `Platform: ${input.platform}`,
    input.storyTitle ? `Story title: ${input.storyTitle}` : null,
    input.storyDescription ? `Story context: ${input.storyDescription}` : null,
    input.existingCaption ? `Existing draft caption: ${input.existingCaption}` : null,
    input.tone ? `Tone: ${input.tone}` : 'Tone: emotional, cinematic, concise',
    '',
    'Return ONLY valid JSON matching this shape:',
    '{',
    '  "title": "optional short title (YouTube/Facebook/TikTok)",',
    '  "caption": "hook-first caption; do NOT dump all hashtags inline — keep body readable",',
    '  "description": "optional longer description",',
    `  "hashtags": ["tag1", "tag2"] // up to ${maxHashtags}, without # prefix`,
    '}',
    '',
    'Hashtag strategy:',
    '- Mix 2–4 broad discovery tags (fyp, reels, shorts, storytime, motivation) with niche/emotion tags',
    '- Include 2–4 mid-size niche tags tied to the story theme',
    '- Include 1–3 specific story/emotion tags',
    '- Avoid banned/spammy repetition; no spaces inside tags',
    '',
    'Rules:',
    '- Lead caption with a curiosity hook or emotional line',
    '- Soft CTA to follow is OK once',
    '- Do not invent brand claims or unsafe content',
    '- Keep caption within typical platform limits',
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
