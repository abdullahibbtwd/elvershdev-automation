export const APP_NAME = 'AI Video Platform';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const JWT_ACCESS_EXPIRES_IN = '15m';
export const JWT_REFRESH_EXPIRES_IN = '7d';

export const FFMPEG_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
export const VIDEO_RENDER_DEFAULT_MAX_CONCURRENCY = 1;
export const VIDEO_RENDER_DEFAULT_MAX_OUTPUT_BYTES = 500 * 1024 * 1024;
export const WORKER_JOB_ATTEMPTS = 3;
export const WORKER_JOB_BACKOFF_MS = 5000;
