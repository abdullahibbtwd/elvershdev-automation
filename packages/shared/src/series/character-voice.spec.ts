import {
  pickStableGeminiVoiceForCharacter,
  buildSpeakingStyleForEmotion,
} from './character-voice';

describe('character voice helpers', () => {
  it('picks a stable voice for the same character name', () => {
    const a = pickStableGeminiVoiceForCharacter('Kemi');
    const b = pickStableGeminiVoiceForCharacter('Kemi');
    expect(a).toBe(b);
  });

  it('avoids already used voices when possible', () => {
    const first = pickStableGeminiVoiceForCharacter('Kemi');
    const second = pickStableGeminiVoiceForCharacter('Tunde', [first]);
    expect(second).not.toBe(first);
  });

  it('appends emotion to speaking style', () => {
    expect(buildSpeakingStyleForEmotion('natural conversational', 'angry')).toContain(
      'angry',
    );
  });
});
