import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isWavBuffer } from '@ai-video/shared';
import { FfmpegService } from './ffmpeg';

export interface ValidatedAudioMetadata {
  durationSeconds: number | null;
  codec: string | null;
  containerFormat: string | null;
  sampleRate: number | null;
  channels: number | null;
  fileSize: number;
  mimeType: string;
  bitDepth: number | null;
}

export interface AudioValidationResult {
  valid: boolean;
  metadata: ValidatedAudioMetadata;
  errorMessage?: string;
}

export async function validateAudioBuffer(
  buffer: Uint8Array,
  options?: {
    expectedMimeType?: string;
    ffmpeg?: FfmpegService;
    minBytes?: number;
    maxDurationSeconds?: number;
  },
): Promise<AudioValidationResult> {
  const mimeType = options?.expectedMimeType || 'audio/wav';
  const minBytes = options?.minBytes ?? 44;
  const bytes = Buffer.from(buffer);
  const metadata: ValidatedAudioMetadata = {
    durationSeconds: null,
    codec: null,
    containerFormat: null,
    sampleRate: null,
    channels: null,
    fileSize: bytes.length,
    mimeType,
    bitDepth: null,
  };

  if (bytes.length < minBytes) {
    return {
      valid: false,
      metadata,
      errorMessage: `Audio file too small (${bytes.length} bytes)`,
    };
  }

  if (mimeType.includes('wav') && !isWavBuffer(bytes)) {
    return {
      valid: false,
      metadata,
      errorMessage: 'Expected WAV/RIFF container but file header was invalid',
    };
  }

  const ffmpeg = options?.ffmpeg ?? new FfmpegService();
  const dir = mkdtempSync(join(tmpdir(), 'ai-video-audio-'));
  const filePath = join(dir, 'probe.wav');

  try {
    writeFileSync(filePath, bytes);
    const probed = await ffmpeg.probe(filePath);
    const parsed = JSON.parse(probed.stdout) as {
      format?: { format_name?: string; duration?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        sample_rate?: string;
        channels?: number;
        bits_per_sample?: number;
        bits_per_raw_sample?: string;
      }>;
    };

    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    if (!audioStream) {
      return {
        valid: false,
        metadata,
        errorMessage: 'FFprobe found no audio stream',
      };
    }

    const durationSeconds = parsed.format?.duration
      ? Number.parseFloat(parsed.format.duration)
      : null;
    metadata.durationSeconds =
      durationSeconds !== null && Number.isFinite(durationSeconds) ? durationSeconds : null;
    metadata.codec = audioStream.codec_name ?? null;
    metadata.containerFormat = parsed.format?.format_name ?? null;
    metadata.sampleRate = audioStream.sample_rate
      ? Number.parseInt(audioStream.sample_rate, 10)
      : null;
    metadata.channels = audioStream.channels ?? null;
    metadata.bitDepth =
      audioStream.bits_per_sample ??
      (audioStream.bits_per_raw_sample
        ? Number.parseInt(audioStream.bits_per_raw_sample, 10)
        : null);

    if (!metadata.durationSeconds || metadata.durationSeconds <= 0) {
      return {
        valid: false,
        metadata,
        errorMessage: 'FFprobe could not determine a positive audio duration',
      };
    }

    const maxDuration = options?.maxDurationSeconds;
    if (
      typeof maxDuration === 'number' &&
      Number.isFinite(maxDuration) &&
      metadata.durationSeconds > maxDuration
    ) {
      return {
        valid: false,
        metadata,
        errorMessage: `Audio duration ${metadata.durationSeconds}s exceeds max ${maxDuration}s`,
      };
    }

    return { valid: true, metadata };
  } catch (error) {
    return {
      valid: false,
      metadata,
      errorMessage: (error as Error).message || 'FFprobe audio validation failed',
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
}
