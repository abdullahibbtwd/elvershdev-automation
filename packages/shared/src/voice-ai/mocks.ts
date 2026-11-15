import {
  estimateSpeakingDurationSeconds,
} from './pricing';
import type { NarrationPlanningInput } from './prompts';
import type { PlannedNarrationScript } from './schemas';
import { DEFAULT_GEMINI_TTS_VOICE } from './voices';

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash || 1;
}

/**
 * Deterministic mock narration plan from approved scene narration text.
 * Does not invent story events beyond polishing existing scene narration.
 */
export function createMockNarrationPlan(input: NarrationPlanningInput): PlannedNarrationScript {
  const scenes = input.scenes.map((scene, index) => {
    const text = scene.narration.trim() || `Scene ${scene.sceneNumber} continues the story.`;
    const estimatedDurationSeconds = Math.min(
      scene.durationSeconds || estimateSpeakingDurationSeconds(text),
      estimateSpeakingDurationSeconds(text),
    );
    return {
      sceneId: scene.sceneId,
      sceneNumber: scene.sceneNumber,
      sequence: index + 1,
      text,
      emotionalTone: input.tone?.toLowerCase().includes('urgent') ? 'urgent' : 'warm',
      speakingStyle: 'clear and measured',
      deliveryInstructions: 'Speak naturally for short-form video narration.',
      pronunciationGuidance: '',
      estimatedDurationSeconds: Number(estimatedDurationSeconds.toFixed(2)),
    };
  });

  return {
    fullText: scenes.map((s) => s.text).join('\n\n'),
    notes: 'Mock narration plan derived from approved scene narration.',
    scenes,
  };
}

/**
 * Build a valid mono 16-bit PCM WAV buffer (24 kHz) with a deterministic tone.
 * Suitable for FFprobe validation and browser playback in mock mode.
 */
export function createMockWavBuffer(options?: {
  text?: string;
  durationSeconds?: number;
  sampleRate?: number;
  voiceId?: string;
}): Uint8Array {
  const sampleRate = options?.sampleRate ?? 24_000;
  const voiceId = options?.voiceId ?? DEFAULT_GEMINI_TTS_VOICE;
  const text = options?.text ?? 'mock narration';
  const estimated = estimateSpeakingDurationSeconds(text);
  const durationSeconds = Math.min(
    12,
    Math.max(0.4, options?.durationSeconds ?? Math.min(estimated, 3)),
  );
  const numSamples = Math.max(1, Math.floor(sampleRate * durationSeconds));
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const baseFreq = 180 + (hashString(voiceId) % 220);
  const textHash = hashString(text);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const envelope = Math.min(1, t * 8) * Math.min(1, (durationSeconds - t) * 8);
    const sample =
      Math.sin(2 * Math.PI * baseFreq * t) * 0.35 +
      Math.sin(2 * Math.PI * (baseFreq * 1.5 + (textHash % 40)) * t) * 0.15;
    const value = Math.max(-1, Math.min(1, sample * envelope));
    view.setInt16(44 + i * 2, Math.floor(value * 32767), true);
  }

  return new Uint8Array(buffer);
}

/** Wrap raw little-endian 16-bit mono PCM in a WAV container. */
export function pcmToWav(
  pcm: Uint8Array,
  sampleRate = 24_000,
  channels = 1,
  bitsPerSample = 16,
): Uint8Array {
  const blockAlign = (channels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm.length;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);
  bytes.set(pcm, 44);
  return bytes;
}

export function isWavBuffer(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  return (
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x41 &&
    bytes[10] === 0x56 &&
    bytes[11] === 0x45
  );
}
