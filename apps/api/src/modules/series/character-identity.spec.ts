import {
  buildSeriesCanonicalVisualDescription,
  formatCharacterIdentityForClipPrompt,
  seriesCharacterToIdentityProfile,
  validateCharactersForClipProduction,
} from '@ai-video/shared';

describe('Series character identity helpers', () => {
  const base = seriesCharacterToIdentityProfile({
    name: 'Daniel',
    role: 'PROTAGONIST',
    species: 'human',
    ageRange: '32-year-old adult man',
    genderPresentation: 'Male',
    skinTone: 'Medium-dark complexion',
    facialStructure: 'Distinctive oval facial structure',
    eyeColor: 'dark brown',
    eyeShape: 'almond',
    hairstyle: 'Short',
    hairFurColor: 'black hair',
    facialHair: 'Neatly trimmed beard',
    bodyProportions: 'Average build',
    clothing: 'Dark navy shirt and black trousers',
    accessories: 'none',
    markings: 'none',
    voiceProfile: 'Calm, deep male voice with a natural Nigerian accent',
    personality: 'Reserved, Intelligent, Observant',
    physicalDescription: 'Average build adult man',
    visualConsistencyNotes: 'Keep beard and short black hair identical',
    identityVersion: 2,
    approvedAt: new Date('2026-11-20T00:00:00.000Z'),
  });

  it('builds a stable canonical visual description from structured fields', () => {
    const canonical = buildSeriesCanonicalVisualDescription(base);
    expect(canonical).toContain('Daniel');
    expect(canonical).toContain('Medium-dark complexion');
    expect(canonical).toContain('Short, black hair');
    expect(canonical).toContain('wearing Dark navy shirt and black trousers');
  });

  it('formats clip prompts with locked canonical identity', () => {
    const withCanonical = {
      ...base,
      canonicalVisualDescription: 'Locked Daniel identity block',
    };
    const prompt = formatCharacterIdentityForClipPrompt(withCanonical, {
      clothingOverride: 'Black suit for funeral scene',
    });
    expect(prompt).toContain('CANONICAL IDENTITY (do not redesign): Locked Daniel identity block');
    expect(prompt).toContain('CLOTHING THIS CLIP: Black suit for funeral scene');
    expect(prompt).toContain('VOICE: Calm, deep male voice');
  });

  it('validates clip character readiness', () => {
    const ok = validateCharactersForClipProduction({
      appearingCharacterNames: ['Daniel'],
      profilesByName: {
        Daniel: {
          ...base,
          canonicalVisualDescription: 'Locked Daniel identity block',
        },
      },
      requireApproved: true,
    });
    expect(ok.ok).toBe(true);

    const missing = validateCharactersForClipProduction({
      appearingCharacterNames: ['Daniel', 'Unknown'],
      profilesByName: { Daniel: { ...base, canonicalVisualDescription: '' } },
      requireApproved: true,
    });
    expect(missing.ok).toBe(false);
    expect(missing.issues.some((i) => i.code === 'missing_character')).toBe(true);
    expect(missing.issues.some((i) => i.code === 'missing_canonical_description')).toBe(true);
  });
});
