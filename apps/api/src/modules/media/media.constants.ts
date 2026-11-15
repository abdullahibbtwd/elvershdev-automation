export const ALLOWED_MIME_TYPES = {
  IMAGE: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  AUDIO: ['audio/mpeg', 'audio/wav', 'audio/mp4', 'audio/ogg', 'audio/x-wav'],
  VIDEO: ['video/mp4', 'video/webm', 'video/quicktime'],
} as const;

export const ALL_ALLOWED_MIME_TYPES = [
  ...ALLOWED_MIME_TYPES.IMAGE,
  ...ALLOWED_MIME_TYPES.AUDIO,
  ...ALLOWED_MIME_TYPES.VIDEO,
] as const;

export const MAX_UPLOAD_BYTES = Number.parseInt(
  process.env.MAX_UPLOAD_BYTES ?? String(100 * 1024 * 1024),
  10,
); // default 100 MB
