import {
  BUILTIN_VISUAL_STYLES,
  DEFAULT_VISUAL_STYLE_KEY,
  buildCanonicalCharacterDescription,
  createMockVisualAnalysis,
  createVisualStyleSchema,
  estimateFalImageCostUsd,
  generateStoryVisualsSchema,
  getFalModelCapabilities,
  getFalPricingFromEnv,
  resolveBuiltinStyle,
  visualAnalysisBatchSchema,
} from '@ai-video/shared';

describe('visual-ai shared contracts', () => {
  const validStyleConfig = {
    lighting: 'Motivated cinematic lighting',
    colorTreatment: 'Natural skin tones, subtle filmic contrast',
    camera: 'Full-frame cinema camera',
    composition: 'Rule-of-thirds framing',
    imageGenerationInstructions: 'Photorealistic live-action still.',
    avoid: ['cartoon', 'anime'],
  };

  describe('createVisualStyleSchema', () => {
    it('validates a complete visual style payload', () => {
      const parsed = createVisualStyleSchema.parse({
        name: 'Warm Sunset Realism',
        description: 'Golden-hour photorealism for narrative shorts.',
        configuration: validStyleConfig,
        isDefault: false,
      });

      expect(parsed.name).toBe('Warm Sunset Realism');
      expect(parsed.configuration.avoid).toEqual(['cartoon', 'anime']);
    });

    it('applies default avoid list when omitted in configuration', () => {
      const parsed = createVisualStyleSchema.parse({
        name: 'Minimal Style',
        description: 'Clean look',
        configuration: {
          lighting: 'Soft daylight',
          colorTreatment: 'Natural',
          camera: '35mm',
          composition: 'Centered',
          imageGenerationInstructions: 'Photorealistic still.',
        },
      });

      expect(parsed.configuration.avoid).toEqual([
        'cartoon',
        'illustration',
        'anime',
        'cgi render',
      ]);
    });

    it('rejects short names or missing configuration fields', () => {
      expect(() =>
        createVisualStyleSchema.parse({
          name: 'A',
          description: 'Too short',
          configuration: validStyleConfig,
        }),
      ).toThrow();

      expect(() =>
        createVisualStyleSchema.parse({
          name: 'Valid Name',
          description: 'Missing camera',
          configuration: {
            lighting: 'Soft',
            colorTreatment: 'Natural',
            composition: 'Rule of thirds',
            imageGenerationInstructions: 'Still',
          },
        }),
      ).toThrow();
    });
  });

  describe('generateStoryVisualsSchema', () => {
    it('validates empty body and UUID-scoped options', () => {
      expect(generateStoryVisualsSchema.parse({})).toEqual({});

      const styleId = '11111111-1111-4111-8111-111111111111';
      const sceneId = '22222222-2222-4222-8222-222222222222';
      const parsed = generateStoryVisualsSchema.parse({
        visualStyleId: styleId,
        sceneIds: [sceneId],
        skipCharacterReferences: true,
        regeneratePrompts: false,
        simulateFailure: false,
      });

      expect(parsed.visualStyleId).toBe(styleId);
      expect(parsed.sceneIds).toEqual([sceneId]);
      expect(parsed.skipCharacterReferences).toBe(true);
    });

    it('rejects non-UUID visualStyleId or sceneIds', () => {
      expect(() =>
        generateStoryVisualsSchema.parse({ visualStyleId: 'not-a-uuid' }),
      ).toThrow();

      expect(() =>
        generateStoryVisualsSchema.parse({ sceneIds: ['bad-id'] }),
      ).toThrow();
    });
  });

  describe('visualAnalysisBatchSchema', () => {
    it('validates mock visual analysis batch output', () => {
      const style = resolveBuiltinStyle(DEFAULT_VISUAL_STYLE_KEY);
      const batch = createMockVisualAnalysis({
        scenes: [
          {
            sceneNumber: 1,
            visualDescription: 'A founder sits at a desk at dawn',
            imagePrompt: 'Founder at wooden desk, warm sunrise light',
            lighting: 'Golden hour sunlight',
            environment: 'Minimalist studio',
            cameraMovement: 'Slow dolly in',
            characterConsistencyInstructions: 'Keep Ada in navy blazer',
          },
        ],
        characters: [
          {
            name: 'Ada',
            appearance: 'Warm brown eyes, focused expression',
            clothing: 'Navy blazer over white shirt',
            ageRange: 'early 30s',
            hair: 'short curly black hair',
            distinctiveFeatures: 'round wire-frame glasses',
            consistencyNotes: 'Always wears silver watch on left wrist',
          },
        ],
        style: {
          name: style.name,
          configuration: style.configuration,
        },
        aspectRatio: '9:16',
      });

      const parsed = visualAnalysisBatchSchema.parse(batch);
      expect(parsed.scenes).toHaveLength(1);
      expect(parsed.characters).toHaveLength(1);
      expect(parsed.scenes[0]?.sceneNumber).toBe(1);
      expect(parsed.characters[0]?.canonicalVisualDescription).toContain('Ada');
    });

    it('rejects batches with zero scenes or invalid sceneNumber', () => {
      expect(() =>
        visualAnalysisBatchSchema.parse({
          characters: [],
          scenes: [],
        }),
      ).toThrow();

      expect(() =>
        visualAnalysisBatchSchema.parse({
          characters: [],
          scenes: [{ sceneNumber: 0 }],
        }),
      ).toThrow();
    });
  });

  describe('buildCanonicalCharacterDescription', () => {
    it('builds a deterministic canonical description from character fields', () => {
      const desc = buildCanonicalCharacterDescription({
        name: 'Amara',
        appearance: 'expressive dark eyes, warm smile',
        clothing: 'ochre linen jacket',
        ageRange: 'late 20s',
        hair: 'braided black hair',
        distinctiveFeatures: 'small gold hoop earrings',
        consistencyNotes: 'Keep jacket collar open',
        genderPresentation: 'woman',
        skinTone: 'deep brown skin',
        facialFeatures: 'high cheekbones, expressive dark eyes',
        hairstyle: 'waist-length box braids',
        hairColor: 'jet black',
        bodyBuild: 'athletic build',
        accessories: 'thin silver bracelet',
      });

      expect(desc).toContain('Amara');
      expect(desc).toContain('age late 20s');
      expect(desc).toContain('woman');
      expect(desc).toContain('deep brown skin');
      expect(desc).toContain('high cheekbones, expressive dark eyes');
      expect(desc).toContain('hair: waist-length box braids, jet black');
      expect(desc).toContain('athletic build');
      expect(desc).toContain('wearing ochre linen jacket');
      expect(desc).toContain('accessories: thin silver bracelet');
      expect(desc).toContain('distinguishing: small gold hoop earrings');
      expect(desc).toContain('Keep jacket collar open');
    });

    it('falls back to appearance and hair when optional detailed fields are omitted', () => {
      const desc = buildCanonicalCharacterDescription({
        name: 'Kofi',
        appearance: 'sharp jawline',
        clothing: 'charcoal hoodie',
        ageRange: 'mid 30s',
        hair: 'short fade',
        distinctiveFeatures: 'scar above left eyebrow',
      });

      expect(desc).toContain('Kofi');
      expect(desc).toContain('sharp jawline');
      expect(desc).toContain('hair: short fade');
      expect(desc).toContain('wearing charcoal hoodie');
      expect(desc).toContain('distinguishing: scar above left eyebrow');
    });
  });

  describe('resolveBuiltinStyle', () => {
    it('returns the default cinematic photorealism style when input is empty or unknown', () => {
      const defaultStyle = resolveBuiltinStyle();
      const fromNull = resolveBuiltinStyle(null);
      const fromUnknown = resolveBuiltinStyle('non-existent-style');

      expect(defaultStyle.key).toBe(DEFAULT_VISUAL_STYLE_KEY);
      expect(defaultStyle.isDefault).toBe(true);
      expect(fromNull.key).toBe(DEFAULT_VISUAL_STYLE_KEY);
      expect(fromUnknown.key).toBe(DEFAULT_VISUAL_STYLE_KEY);
    });

    it('resolves built-in styles by key or case-insensitive name', () => {
      const byKey = resolveBuiltinStyle('documentary_realism');
      expect(byKey.name).toBe('Documentary realism');

      const byName = resolveBuiltinStyle('  DRAMATIC FILM PHOTOGRAPHY  ');
      expect(byName.key).toBe('dramatic_film_photography');

      expect(BUILTIN_VISUAL_STYLES.length).toBeGreaterThanOrEqual(6);
    });
  });

  describe('fal pricing & capabilities helpers', () => {
    it('reads fal pricing from env with defaults and estimates image cost', () => {
      const defaults = getFalPricingFromEnv({});
      expect(defaults).toEqual({ pricePerImageUsd: 0.025, currency: 'USD' });

      const custom = getFalPricingFromEnv({
        FAL_IMAGE_PRICE_PER_IMAGE: '0.04',
        FAL_IMAGE_CURRENCY: 'EUR',
      });
      expect(custom).toEqual({ pricePerImageUsd: 0.04, currency: 'EUR' });

      const invalid = getFalPricingFromEnv({
        FAL_IMAGE_PRICE_PER_IMAGE: 'not-a-number',
      });
      expect(invalid.pricePerImageUsd).toBe(0.025);

      expect(estimateFalImageCostUsd(3, custom)).toBe(0.12);
      expect(estimateFalImageCostUsd(-2, custom)).toBe(0);
    });

    it('exposes capabilities for fal-ai/flux/dev without reference support', () => {
      const caps = getFalModelCapabilities('fal-ai/flux/dev', {});
      expect(caps.modelId).toBe('fal-ai/flux/dev');
      expect(caps.supportsReferenceImages).toBe(false);
      expect(caps.supportsSeed).toBe(true);
      expect(caps.supportsNegativePrompt).toBe(false);
    });
  });
});
