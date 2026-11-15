import type {
  ConnectedAccountInfo,
  NormalizedPostMetrics,
  PostDetailsResult,
  PublishingCapabilities,
  PublishStatusResult,
  PublishVideoInput,
  PublishVideoResult,
  SocialPlatformKey,
  TokenBundle,
} from '@ai-video/shared';

export interface AuthorizationUrlParams {
  state: string;
  redirectUri: string;
  codeChallenge?: string;
  scopes?: string[];
}

export interface ExchangeCodeParams {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface ExchangeCodeResult {
  tokens: TokenBundle;
  accounts: ConnectedAccountInfo[];
}

export interface SocialPublishingProvider {
  readonly platform: SocialPlatformKey;

  isConfigured(): boolean;
  shouldUseMock(): boolean;

  getAuthorizationUrl(params: AuthorizationUrlParams): string;
  exchangeAuthorizationCode(params: ExchangeCodeParams): Promise<ExchangeCodeResult>;
  refreshAccessToken?(refreshToken: string): Promise<TokenBundle>;

  getConnectedAccount(accessToken: string, platformAccountId: string): Promise<ConnectedAccountInfo>;
  getPublishingCapabilities(
    accessToken: string,
    account: ConnectedAccountInfo,
  ): Promise<PublishingCapabilities>;

  publishVideo(input: PublishVideoInput): Promise<PublishVideoResult>;
  getPublishStatus(input: {
    accessToken: string;
    platformAccountId: string;
    providerUploadId?: string;
    providerPublishId?: string;
    providerPostId?: string;
  }): Promise<PublishStatusResult>;

  getPostDetails?(input: {
    accessToken: string;
    platformAccountId: string;
    providerPostId: string;
  }): Promise<PostDetailsResult>;

  /**
   * Fetch post-level analytics. Must return UNAVAILABLE (never zero) for metrics
   * the platform API does not expose for this account/permission set.
   */
  getPostAnalytics?(input: {
    accessToken: string;
    platformAccountId: string;
    providerPostId: string;
    postUrl?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<NormalizedPostMetrics>;

  disconnectAccount?(accessToken: string, platformAccountId: string): Promise<void>;
}

export const META_PAGE_SCOPES = [
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_metadata',
  'business_management',
  'read_insights',
] as const;

export const INSTAGRAM_SCOPES = [
  'instagram_basic',
  'instagram_content_publish',
  'instagram_manage_insights',
  'pages_show_list',
  'pages_read_engagement',
  'business_management',
] as const;

export const TIKTOK_SCOPES = ['user.info.basic', 'video.publish', 'video.list'] as const;

export const YOUTUBE_SCOPES = [
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube.readonly',
] as const;
