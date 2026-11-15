export interface VideoOutputProfile {
  id: string;
  label: string;
  aspectRatio: string;
  width: number;
  height: number;
  frameRate: number;
  videoCodec: string;
  audioCodec: string;
  pixelFormat: string;
  audioSampleRate: number;
  audioChannels: number;
  qualityPreset: string;
  crf: number;
  /** Enable MP4 fast-start (moov atom at beginning) */
  fastStart: boolean;
}

export const VIDEO_OUTPUT_PROFILES: Record<string, VideoOutputProfile> = {
  'vertical-9x16-1080p30': {
    id: 'vertical-9x16-1080p30',
    label: 'Vertical 9:16 1080×1920 @ 30fps',
    aspectRatio: '9:16',
    width: 1080,
    height: 1920,
    frameRate: 30,
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    audioSampleRate: 48000,
    audioChannels: 2,
    qualityPreset: 'medium',
    crf: 23,
    fastStart: true,
  },
  'square-1x1-1080p30': {
    id: 'square-1x1-1080p30',
    label: 'Square 1:1 1080×1080 @ 30fps',
    aspectRatio: '1:1',
    width: 1080,
    height: 1080,
    frameRate: 30,
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    audioSampleRate: 48000,
    audioChannels: 2,
    qualityPreset: 'medium',
    crf: 23,
    fastStart: true,
  },
  'landscape-16x9-1080p30': {
    id: 'landscape-16x9-1080p30',
    label: 'Landscape 16:9 1920×1080 @ 30fps',
    aspectRatio: '16:9',
    width: 1920,
    height: 1080,
    frameRate: 30,
    videoCodec: 'libx264',
    audioCodec: 'aac',
    pixelFormat: 'yuv420p',
    audioSampleRate: 48000,
    audioChannels: 2,
    qualityPreset: 'medium',
    crf: 23,
    fastStart: true,
  },
} as const;

export const DEFAULT_VIDEO_OUTPUT_PROFILE_ID = 'vertical-9x16-1080p30';

export function getVideoOutputProfile(profileId?: string | null): VideoOutputProfile {
  if (profileId && VIDEO_OUTPUT_PROFILES[profileId]) {
    return VIDEO_OUTPUT_PROFILES[profileId];
  }
  return VIDEO_OUTPUT_PROFILES[DEFAULT_VIDEO_OUTPUT_PROFILE_ID];
}

export const VIDEO_RENDER_STATUSES = [
  'PENDING',
  'PLANNING',
  'PREPARING_ASSETS',
  'RENDERING_SCENES',
  'MIXING_AUDIO',
  'GENERATING_SUBTITLES',
  'COMBINING',
  'VALIDATING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

export type VideoRenderStatusName = (typeof VIDEO_RENDER_STATUSES)[number];

export const ACTIVE_VIDEO_RENDER_STATUSES: VideoRenderStatusName[] = [
  'PENDING',
  'PLANNING',
  'PREPARING_ASSETS',
  'RENDERING_SCENES',
  'MIXING_AUDIO',
  'GENERATING_SUBTITLES',
  'COMBINING',
  'VALIDATING',
  'UPLOADING',
];

export const TERMINAL_VIDEO_RENDER_STATUSES: VideoRenderStatusName[] = [
  'COMPLETED',
  'FAILED',
  'CANCELLED',
];
