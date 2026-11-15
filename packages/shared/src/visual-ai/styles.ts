import type { VisualStyleConfiguration } from './schemas';

export interface BuiltinVisualStyle {
  key: string;
  name: string;
  description: string;
  isDefault?: boolean;
  configuration: VisualStyleConfiguration;
}

export const DEFAULT_VISUAL_STYLE_KEY = 'cinematic_photorealism';

export const BUILTIN_VISUAL_STYLES: BuiltinVisualStyle[] = [
  {
    key: 'cinematic_photorealism',
    name: 'Cinematic photorealism',
    description:
      'Default photorealistic cinematic look suitable for short-form storytelling videos.',
    isDefault: true,
    configuration: {
      lighting: 'Motivated cinematic lighting with soft key light, gentle fill, and natural rim separation',
      colorTreatment: 'Natural skin tones, subtle filmic contrast, muted but rich color grade',
      camera: 'Full-frame cinema camera aesthetic, shallow to moderate depth of field, sharp subject focus',
      composition: 'Rule-of-thirds framing with clear subject hierarchy and intentional negative space',
      imageGenerationInstructions:
        'Photorealistic live-action still. No cartoon, illustration, anime, CGI, or plastic skin.',
      avoid: ['cartoon', 'illustration', 'anime', 'cgi render', '3d render', 'comic book'],
    },
  },
  {
    key: 'photorealistic_storytelling',
    name: 'Photorealistic storytelling',
    description: 'Clean documentary-adjacent realism optimized for narrative clarity.',
    configuration: {
      lighting: 'Natural available light with soft diffusion and realistic shadows',
      colorTreatment: 'True-to-life color with restrained grading',
      camera: '35mm prime lens look, medium depth of field',
      composition: 'Clear storytelling frames that emphasize character action and emotion',
      imageGenerationInstructions: 'Ultra-realistic photographic still from a narrative short film.',
      avoid: ['cartoon', 'illustration', 'stylized painting', 'oversaturated fantasy look'],
    },
  },
  {
    key: 'documentary_realism',
    name: 'Documentary realism',
    description: 'Observational, grounded documentary photography style.',
    configuration: {
      lighting: 'Available light, practical sources, imperfect naturalistic contrast',
      colorTreatment: 'Neutral documentary grade, modest saturation',
      camera: 'Handheld documentary framing, 28–40mm field of view feel',
      composition: 'Observational compositions, environmental context prioritized',
      imageGenerationInstructions: 'Looks like a still from a high-end documentary production.',
      avoid: ['glamour lighting', 'cartoon', 'illustration', 'highly stylized cinema LUT'],
    },
  },
  {
    key: 'cinematic_african_storytelling',
    name: 'Cinematic African storytelling',
    description: 'Cinematic realism with warm African light, textures, and cultural groundedness.',
    configuration: {
      lighting: 'Warm golden and amber daylight, soft dusk glow, rich practical interiors',
      colorTreatment: 'Warm earth tones, deep greens, terracotta accents, natural skin rendering',
      camera: 'Cinematic anamorphic-adjacent framing with intimate character focus',
      composition: 'Human-centered compositions that honor place, community, and atmosphere',
      imageGenerationInstructions:
        'Photorealistic cinematic still rooted in contemporary African storytelling aesthetics.',
      avoid: ['cartoon', 'illustration', 'exoticizing tropes', 'generic stock-photo look'],
    },
  },
  {
    key: 'historical_realism',
    name: 'Historical realism',
    description: 'Period-accurate photorealism for historical narratives.',
    configuration: {
      lighting: 'Period-appropriate practical and natural light with restrained modern polish',
      colorTreatment: 'Muted historical palette with authentic material textures',
      camera: 'Classic cinema framing, controlled depth of field',
      composition: 'Tableau and character-forward historical compositions',
      imageGenerationInstructions:
        'Photorealistic historical film still with accurate clothing, materials, and environment.',
      avoid: ['cartoon', 'anachronistic props', 'modern fashion', 'illustration'],
    },
  },
  {
    key: 'dramatic_film_photography',
    name: 'Dramatic film photography',
    description: 'High-drama film photography with strong contrast and emotional presence.',
    configuration: {
      lighting: 'High-contrast dramatic lighting with defined shadows and expressive highlights',
      colorTreatment: 'Film-inspired contrast, controlled blacks, emotional color accents',
      camera: 'Portrait and mid-shot cinema photography with intentional bokeh',
      composition: 'Bold subject isolation and emotionally charged framing',
      imageGenerationInstructions: 'Dramatic photorealistic film still with cinematic intensity.',
      avoid: ['flat lighting', 'cartoon', 'illustration', 'overprocessed HDR look'],
    },
  },
];

export function resolveBuiltinStyle(nameOrKey?: string | null): BuiltinVisualStyle {
  if (!nameOrKey) {
    return BUILTIN_VISUAL_STYLES.find((s) => s.isDefault) ?? BUILTIN_VISUAL_STYLES[0];
  }
  const needle = nameOrKey.trim().toLowerCase();
  return (
    BUILTIN_VISUAL_STYLES.find(
      (s) => s.key === needle || s.name.toLowerCase() === needle,
    ) ??
    BUILTIN_VISUAL_STYLES.find((s) => s.isDefault) ??
    BUILTIN_VISUAL_STYLES[0]
  );
}
