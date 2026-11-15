import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FfmpegService } from './ffmpeg';

export interface ValidatedVideoMetadata {
  durationSeconds: number | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  containerFormat: string | null;
  fileSize: number;
  hasAudio: boolean;
  mimeType: string;
}

export interface VideoValidationResult {
  valid: boolean;
  metadata: ValidatedVideoMetadata;
  errorMessage?: string;
}

function parseFrameRate(rate: string | undefined): number | null {
  if (!rate) return null;
  if (rate.includes('/')) {
    const [num, den] = rate.split('/').map((part) => Number.parseFloat(part));
    if (Number.isFinite(num) && Number.isFinite(den) && den !== 0) {
      return Number((num / den).toFixed(3));
    }
    return null;
  }
  const value = Number.parseFloat(rate);
  return Number.isFinite(value) ? value : null;
}

export async function validateVideoBuffer(
  buffer: Uint8Array,
  options?: {
    expectedMimeType?: string;
    ffmpeg?: FfmpegService;
    minBytes?: number;
  },
): Promise<VideoValidationResult> {
  const mimeType = options?.expectedMimeType || 'video/mp4';
  const minBytes = options?.minBytes ?? 64;
  const bytes = Buffer.from(buffer);
  const metadata: ValidatedVideoMetadata = {
    durationSeconds: null,
    width: null,
    height: null,
    frameRate: null,
    videoCodec: null,
    audioCodec: null,
    containerFormat: null,
    fileSize: bytes.length,
    hasAudio: false,
    mimeType,
  };

  if (bytes.length < minBytes) {
    return {
      valid: false,
      metadata,
      errorMessage: `Video file too small (${bytes.length} bytes)`,
    };
  }

  // Basic ISO BMFF / MP4 signature check
  const ftypOffset = bytes.indexOf(Buffer.from('ftyp'));
  if (ftypOffset < 4 || ftypOffset > 8) {
    return {
      valid: false,
      metadata,
      errorMessage: 'Downloaded file is not a recognizable MP4/ISO BMFF container',
    };
  }

  const ffmpeg = options?.ffmpeg ?? new FfmpegService();
  const dir = mkdtempSync(join(tmpdir(), 'motion-validate-'));
  const filePath = join(dir, 'clip.mp4');

  try {
    writeFileSync(filePath, bytes);
    const probe = await ffmpeg.probe(filePath);
    const parsed = JSON.parse(probe.stdout) as {
      format?: { duration?: string; format_name?: string; size?: string };
      streams?: Array<{
        codec_type?: string;
        codec_name?: string;
        width?: number;
        height?: number;
        avg_frame_rate?: string;
        r_frame_rate?: string;
      }>;
    };

    const videoStream = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audioStream = parsed.streams?.find((stream) => stream.codec_type === 'audio');

    metadata.durationSeconds = parsed.format?.duration
      ? Number.parseFloat(parsed.format.duration)
      : null;
    metadata.containerFormat = parsed.format?.format_name ?? null;
    metadata.width = videoStream?.width ?? null;
    metadata.height = videoStream?.height ?? null;
    metadata.videoCodec = videoStream?.codec_name ?? null;
    metadata.audioCodec = audioStream?.codec_name ?? null;
    metadata.hasAudio = Boolean(audioStream);
    metadata.frameRate =
      parseFrameRate(videoStream?.avg_frame_rate) ?? parseFrameRate(videoStream?.r_frame_rate);

    if (!videoStream) {
      return {
        valid: false,
        metadata,
        errorMessage: 'FFprobe found no video stream',
      };
    }

    if (!metadata.width || !metadata.height) {
      return {
        valid: false,
        metadata,
        errorMessage: 'FFprobe could not determine video dimensions',
      };
    }

    return { valid: true, metadata };
  } catch (error) {
    return {
      valid: false,
      metadata,
      errorMessage: (error as Error).message || 'FFprobe validation failed',
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}
