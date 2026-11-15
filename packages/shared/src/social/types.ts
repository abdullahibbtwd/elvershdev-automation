import type { SocialPlatformKey } from '../queues';

export type PublishingCapabilityFlag =
  | 'video'
  | 'reels'
  | 'shorts'
  | 'public_publish'
  | 'private_publish'
  | 'test_only'
  | 'schedule'
  | 'thumbnail'
  | 'comments_control'
  | 'hashtags'
  | 'title'
  | 'description'
  | 'disclosure_required';

export interface PublishingCapabilities {
  canPublishVideo: boolean;
  canPublishPublic: boolean;
  testOrPrivateOnly: boolean;
  requiresDisclosure: boolean;
  supportsTitle: boolean;
  supportsDescription: boolean;
  supportsHashtags: boolean;
  supportsThumbnail: boolean;
  supportsCommentsToggle: boolean;
  supportsPrivacySettings: boolean;
  maxCaptionLength: number;
  maxTitleLength?: number;
  maxDescriptionLength?: number;
  maxDurationSeconds?: number;
  supportedMimeTypes: string[];
  flags: PublishingCapabilityFlag[];
  warnings: string[];
  unsupportedReasons: string[];
}

export interface ConnectedAccountInfo {
  platformAccountId: string;
  displayName: string;
  username?: string | null;
  profileImageUrl?: string | null;
  accountType?: string | null;
  grantedScopes: string[];
  metadata?: Record<string, unknown>;
}

export interface TokenBundle {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[];
}

export interface PublishVideoInput {
  accessToken: string;
  platformAccountId: string;
  /** Local absolute path preferred for direct/chunk uploads */
  localFilePath?: string;
  /** Time-limited HTTPS URL for platforms that pull media */
  mediaUrl?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  title?: string;
  caption?: string;
  description?: string;
  hashtags?: string[];
  platformSettings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type ProviderPublishPhase =
  | 'initialized'
  | 'uploading'
  | 'uploaded'
  | 'processing'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'action_required';

export interface PublishVideoResult {
  phase: ProviderPublishPhase;
  providerUploadId?: string;
  providerPublishId?: string;
  providerPostId?: string;
  postUrl?: string;
  uploadProgress?: number;
  errorCode?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
  /** When true, caller should poll getPublishStatus */
  requiresStatusPoll?: boolean;
  /** Suggested poll delay in ms */
  pollAfterMs?: number;
}

export interface PublishStatusResult {
  phase: ProviderPublishPhase;
  providerUploadId?: string;
  providerPublishId?: string;
  providerPostId?: string;
  postUrl?: string;
  uploadProgress?: number;
  errorCode?: string;
  errorMessage?: string;
  raw?: Record<string, unknown>;
  requiresStatusPoll?: boolean;
  pollAfterMs?: number;
}

export interface PostDetailsResult {
  providerPostId: string;
  postUrl?: string;
  title?: string;
  caption?: string;
  privacyStatus?: string;
  raw?: Record<string, unknown>;
}

export const DEFAULT_CAPABILITIES: Record<SocialPlatformKey, PublishingCapabilities> = {
  FACEBOOK: {
    canPublishVideo: true,
    canPublishPublic: true,
    testOrPrivateOnly: false,
    requiresDisclosure: false,
    supportsTitle: true,
    supportsDescription: true,
    supportsHashtags: true,
    supportsThumbnail: false,
    supportsCommentsToggle: false,
    supportsPrivacySettings: false,
    maxCaptionLength: 2200,
    maxTitleLength: 255,
    maxDescriptionLength: 5000,
    maxDurationSeconds: 90,
    supportedMimeTypes: ['video/mp4', 'video/quicktime'],
    flags: ['video', 'reels', 'public_publish', 'hashtags', 'title', 'description'],
    warnings: [
      'Publishing targets Facebook Pages only (not personal profiles).',
      'Requires pages_manage_posts and pages_read_engagement (and related) permissions with App Review for production.',
    ],
    unsupportedReasons: [],
  },
  INSTAGRAM: {
    canPublishVideo: true,
    canPublishPublic: true,
    testOrPrivateOnly: false,
    requiresDisclosure: false,
    supportsTitle: false,
    supportsDescription: false,
    supportsHashtags: true,
    supportsThumbnail: true,
    supportsCommentsToggle: false,
    supportsPrivacySettings: false,
    maxCaptionLength: 2200,
    maxDurationSeconds: 90,
    supportedMimeTypes: ['video/mp4'],
    flags: ['video', 'reels', 'public_publish', 'hashtags', 'thumbnail'],
    warnings: [
      'Only Instagram Professional accounts (Business or Creator) linked to a Facebook Page are supported.',
      'Personal Instagram accounts cannot publish via the Content Publishing API.',
      'Media URL must be publicly reachable by Meta servers, or use resumable upload.',
    ],
    unsupportedReasons: [],
  },
  TIKTOK: {
    canPublishVideo: true,
    canPublishPublic: false,
    testOrPrivateOnly: true,
    requiresDisclosure: true,
    supportsTitle: true,
    supportsDescription: false,
    supportsHashtags: true,
    supportsThumbnail: true,
    supportsCommentsToggle: true,
    supportsPrivacySettings: true,
    maxCaptionLength: 2200,
    maxTitleLength: 2200,
    maxDurationSeconds: 600,
    supportedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    flags: [
      'video',
      'test_only',
      'private_publish',
      'hashtags',
      'title',
      'comments_control',
      'disclosure_required',
    ],
    warnings: [
      'Unaudited TikTok apps may only post with SELF_ONLY privacy and are subject to a 5-user / 24h cap.',
      'Public posting requires TikTok audit approval for the video.publish scope.',
      'Creator info must be queried before each Direct Post.',
    ],
    unsupportedReasons: [],
  },
  YOUTUBE: {
    canPublishVideo: true,
    canPublishPublic: true,
    testOrPrivateOnly: false,
    requiresDisclosure: false,
    supportsTitle: true,
    supportsDescription: true,
    supportsHashtags: true,
    supportsThumbnail: true,
    supportsCommentsToggle: false,
    supportsPrivacySettings: true,
    maxCaptionLength: 5000,
    maxTitleLength: 100,
    maxDescriptionLength: 5000,
    maxDurationSeconds: 43200,
    supportedMimeTypes: ['video/mp4', 'video/webm', 'video/quicktime', 'application/octet-stream'],
    flags: ['video', 'shorts', 'public_publish', 'private_publish', 'title', 'description', 'hashtags', 'thumbnail'],
    warnings: [
      'Uploads use YouTube Data API v3 videos.insert (resumable). Default scope: youtube.upload.',
      'Quota cost for videos.insert is significant; monitor daily quota.',
      'Unverified OAuth apps are limited to test users.',
    ],
    unsupportedReasons: [],
  },
};
