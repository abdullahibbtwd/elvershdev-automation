import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { open as openFile } from 'node:fs/promises';
import type {
  ConnectedAccountInfo,
  NormalizedPostMetrics,
  PostDetailsResult,
  PublishingCapabilities,
  PublishStatusResult,
  PublishVideoInput,
  PublishVideoResult,
  TokenBundle,
} from '@ai-video/shared';
import { availableMetric, DEFAULT_CAPABILITIES, unavailableMetric } from '@ai-video/shared';
import { mockPostAnalytics } from '../analytics/mock-analytics';
import { truncateRawProviderResponse } from '../analytics/normalize';
import { HttpClientService } from '../http-client.service';
import {
  YOUTUBE_SCOPES,
  type AuthorizationUrlParams,
  type ExchangeCodeParams,
  type ExchangeCodeResult,
  type SocialPublishingProvider,
} from '../social/social-publishing.types';
import {
  axiosErrorMessage,
  buildCaption,
  expiresAtFromSeconds,
  getLocalFileSize,
  mockId,
  resolveSocialShouldUseMock,
} from '../social/social-provider.utils';
import { BaseProvider } from './base.provider';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YOUTUBE_UPLOAD_BASE = 'https://www.googleapis.com/upload/youtube/v3';
const YOUTUBE_CHUNK_SIZE = 8 * 1024 * 1024; // 8 MiB (multiple of 256 KiB)

type GoogleTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
};

@Injectable()
export class YouTubeProvider extends BaseProvider implements SocialPublishingProvider {
  readonly platform = 'YOUTUBE' as const;
  private readonly logger = new Logger(YouTubeProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('integrations.youtubeClientId') &&
      this.config.get<string>('integrations.youtubeClientSecret'),
    );
  }

  shouldUseMock(): boolean {
    return resolveSocialShouldUseMock({
      config: this.config,
      platformUseMockKey: 'integrations.youtubeUseMock',
      isConfigured: this.isConfigured(),
    });
  }

  private clientId(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.youtubeClientId'),
      'YOUTUBE_CLIENT_ID',
    );
  }

  private clientSecret(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.youtubeClientSecret'),
      'YOUTUBE_CLIENT_SECRET',
    );
  }

  private defaultRedirectUri(): string {
    return (
      this.config.get<string>('integrations.youtubeRedirectUri') ??
      'http://localhost:3000/api/channels/youtube/callback'
    );
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const clientId = this.shouldUseMock()
      ? (this.config.get<string>('integrations.youtubeClientId') ?? 'mock-youtube-client')
      : this.clientId();
    const redirectUri = params.redirectUri || this.defaultRedirectUri();
    const scope = (params.scopes?.length ? params.scopes : [...YOUTUBE_SCOPES]).join(' ');
    const url = new URL(GOOGLE_AUTH_URL);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', scope);
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', params.state);
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeAuthorizationCode(params: ExchangeCodeParams): Promise<ExchangeCodeResult> {
    if (this.shouldUseMock()) {
      const tokens: TokenBundle = {
        accessToken: 'mock-youtube-access-token',
        refreshToken: 'mock-youtube-refresh-token',
        expiresAt: new Date(Date.now() + 3600 * 1000),
        scopes: [...YOUTUBE_SCOPES],
      };
      return {
        tokens,
        accounts: [
          {
            platformAccountId: 'mock-yt-channel-1',
            displayName: 'Mock YouTube Channel',
            username: 'mock_yt',
            profileImageUrl: null,
            accountType: 'channel',
            grantedScopes: [...YOUTUBE_SCOPES],
          },
        ],
      };
    }

    const client = this.http.create();
    const body = new URLSearchParams({
      code: params.code,
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      redirect_uri: params.redirectUri || this.defaultRedirectUri(),
      grant_type: 'authorization_code',
    });

    const tokenRes = await client.post<GoogleTokenResponse>(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const token = tokenRes.data;
    const scopes = (token.scope ?? YOUTUBE_SCOPES.join(' ')).split(/\s+/).filter(Boolean);
    const accounts = await this.listMineChannels(token.access_token, scopes);

    return {
      tokens: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token ?? null,
        expiresAt: expiresAtFromSeconds(token.expires_in),
        scopes,
      },
      accounts,
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenBundle> {
    if (this.shouldUseMock()) {
      return {
        accessToken: 'mock-youtube-access-token-refreshed',
        refreshToken,
        expiresAt: new Date(Date.now() + 3600 * 1000),
        scopes: [...YOUTUBE_SCOPES],
      };
    }

    const client = this.http.create();
    const body = new URLSearchParams({
      client_id: this.clientId(),
      client_secret: this.clientSecret(),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const res = await client.post<GoogleTokenResponse>(GOOGLE_TOKEN_URL, body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token ?? refreshToken,
      expiresAt: expiresAtFromSeconds(res.data.expires_in),
      scopes: (res.data.scope ?? YOUTUBE_SCOPES.join(' ')).split(/\s+/).filter(Boolean),
    };
  }

  private async listMineChannels(
    accessToken: string,
    scopes: string[],
  ): Promise<ConnectedAccountInfo[]> {
    const client = this.http.create(YOUTUBE_API_BASE);
    const res = await client.get<{
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
        };
      }>;
    }>('/channels', {
      params: { part: 'snippet', mine: 'true' },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    return (res.data.items ?? []).map((ch) => ({
      platformAccountId: ch.id,
      displayName: ch.snippet?.title ?? ch.id,
      username: ch.snippet?.customUrl ?? null,
      profileImageUrl: ch.snippet?.thumbnails?.default?.url ?? null,
      accountType: 'channel',
      grantedScopes: scopes,
    }));
  }

  async getConnectedAccount(
    accessToken: string,
    platformAccountId: string,
  ): Promise<ConnectedAccountInfo> {
    if (this.shouldUseMock()) {
      return {
        platformAccountId: platformAccountId || 'mock-yt-channel-1',
        displayName: 'Mock YouTube Channel',
        username: 'mock_yt',
        profileImageUrl: null,
        accountType: 'channel',
        grantedScopes: [...YOUTUBE_SCOPES],
      };
    }

    const client = this.http.create(YOUTUBE_API_BASE);
    const res = await client.get<{
      items?: Array<{
        id: string;
        snippet?: {
          title?: string;
          customUrl?: string;
          thumbnails?: { default?: { url?: string } };
        };
      }>;
    }>('/channels', {
      params: platformAccountId
        ? { part: 'snippet', id: platformAccountId }
        : { part: 'snippet', mine: 'true' },
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const ch = res.data.items?.find((i) => i.id === platformAccountId) ?? res.data.items?.[0];
    if (!ch) {
      throw new Error(`YouTube channel not found: ${platformAccountId}`);
    }

    return {
      platformAccountId: ch.id,
      displayName: ch.snippet?.title ?? ch.id,
      username: ch.snippet?.customUrl ?? null,
      profileImageUrl: ch.snippet?.thumbnails?.default?.url ?? null,
      accountType: 'channel',
      grantedScopes: [...YOUTUBE_SCOPES],
    };
  }

  async getPublishingCapabilities(
    _accessToken: string,
    _account: ConnectedAccountInfo,
  ): Promise<PublishingCapabilities> {
    return structuredClone(DEFAULT_CAPABILITIES.YOUTUBE);
  }

  async publishVideo(input: PublishVideoInput): Promise<PublishVideoResult> {
    if (this.shouldUseMock()) {
      const id = mockId('mock-yt-video', input.platformAccountId);
      return {
        phase: 'processing',
        providerUploadId: id,
        providerPublishId: id,
        providerPostId: id,
        postUrl: `https://www.youtube.com/watch?v=${id}`,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 3_000,
        raw: { mock: true },
      };
    }

    if (!input.localFilePath) {
      throw new Error('YouTube uploads require localFilePath for resumable videos.insert');
    }

    const privacyStatus = this.resolvePrivacy(input.platformSettings?.privacyStatus);
    const title = (input.title ?? 'Untitled').slice(0, 100);
    const description = buildCaption({
      caption: input.caption,
      description: input.description,
      hashtags: input.hashtags,
    }).slice(0, 5000);
    const mimeType = input.mimeType ?? 'video/mp4';
    const fileSize = await getLocalFileSize(input.localFilePath, input.fileSizeBytes);

    try {
      const client = this.http.create();
      const metadata = {
        snippet: {
          title,
          description,
          categoryId: String(input.platformSettings?.categoryId ?? '22'),
        },
        status: {
          privacyStatus,
          selfDeclaredMadeForKids: Boolean(input.platformSettings?.madeForKids ?? false),
        },
      };

      const initRes = await client.post(`${YOUTUBE_UPLOAD_BASE}/videos`, metadata, {
        params: {
          uploadType: 'resumable',
          part: 'snippet,status',
        },
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Type': mimeType,
          'X-Upload-Content-Length': String(fileSize),
        },
        maxRedirects: 0,
        validateStatus: (s) => s === 200 || s === 201,
      });

      const uploadUrl = initRes.headers.location as string | undefined;
      if (!uploadUrl) {
        throw new Error('YouTube resumable init did not return Location upload URL');
      }

      this.logger.log(`YouTube resumable upload started for channel ${input.platformAccountId}`);

      const videoId = await this.putResumableChunks({
        uploadUrl,
        localFilePath: input.localFilePath,
        fileSize,
        mimeType,
        accessToken: input.accessToken,
      });

      return {
        phase: 'processing',
        providerUploadId: videoId,
        providerPublishId: videoId,
        providerPostId: videoId,
        postUrl: `https://www.youtube.com/watch?v=${videoId}`,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: { privacyStatus },
      };
    } catch (err) {
      const message = axiosErrorMessage(err, 'YouTube publish failed');
      this.logger.error(`YouTube publish failed for ${input.platformAccountId}: ${message}`);
      return {
        phase: 'failed',
        errorCode: 'YOUTUBE_PUBLISH_FAILED',
        errorMessage: message,
        requiresStatusPoll: false,
      };
    }
  }

  private resolvePrivacy(value: unknown): 'public' | 'unlisted' | 'private' {
    const v = String(value ?? 'private').toLowerCase();
    if (v === 'public' || v === 'unlisted' || v === 'private') return v;
    return 'private';
  }

  private async putResumableChunks(params: {
    uploadUrl: string;
    localFilePath: string;
    fileSize: number;
    mimeType: string;
    accessToken: string;
  }): Promise<string> {
    const handle = await openFile(params.localFilePath, 'r');
    const client = this.http.create();
    try {
      let offset = 0;
      let videoId: string | undefined;

      while (offset < params.fileSize) {
        const length = Math.min(YOUTUBE_CHUNK_SIZE, params.fileSize - offset);
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const payload = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
        const start = offset;
        const end = offset + payload.length - 1;
        const isLast = end >= params.fileSize - 1;

        const res = await client.put(params.uploadUrl, payload, {
          headers: {
            Authorization: `Bearer ${params.accessToken}`,
            'Content-Type': params.mimeType,
            'Content-Length': String(payload.length),
            'Content-Range': `bytes ${start}-${end}/${params.fileSize}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600_000,
          validateStatus: (s) => s === 200 || s === 201 || s === 308,
        });

        if (isLast && (res.status === 200 || res.status === 201)) {
          videoId = (res.data as { id?: string })?.id;
          break;
        }

        offset += payload.length;
      }

      if (!videoId) {
        throw new Error('YouTube resumable upload completed without a video id');
      }
      return videoId;
    } finally {
      await handle.close();
    }
  }

  async getPublishStatus(input: {
    accessToken: string;
    platformAccountId: string;
    providerUploadId?: string;
    providerPublishId?: string;
    providerPostId?: string;
  }): Promise<PublishStatusResult> {
    const videoId = input.providerPostId ?? input.providerPublishId ?? input.providerUploadId;

    if (this.shouldUseMock() || videoId?.startsWith('mock-yt-')) {
      const id = videoId ?? mockId('mock-yt-video', input.platformAccountId);
      return {
        phase: 'published',
        providerPostId: id,
        postUrl: `https://www.youtube.com/watch?v=${id}`,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: { mock: true, uploadStatus: 'processed' },
      };
    }

    if (!videoId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_VIDEO_ID',
        errorMessage: 'providerPostId is required for YouTube status',
        requiresStatusPoll: false,
      };
    }

    try {
      const client = this.http.create(YOUTUBE_API_BASE);
      const res = await client.get<{
        items?: Array<{
          id: string;
          status?: {
            uploadStatus?: string;
            privacyStatus?: string;
            rejectionReason?: string;
            failureReason?: string;
          };
          processingDetails?: {
            processingStatus?: string;
            processingFailureReason?: string;
          };
          snippet?: { title?: string; description?: string };
        }>;
      }>('/videos', {
        params: {
          part: 'status,processingDetails,snippet',
          id: videoId,
        },
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });

      const item = res.data.items?.[0];
      if (!item) {
        return {
          phase: 'failed',
          errorCode: 'YOUTUBE_VIDEO_NOT_FOUND',
          errorMessage: `Video ${videoId} not found`,
          requiresStatusPoll: false,
        };
      }

      const uploadStatus = item.status?.uploadStatus;
      const processingStatus = item.processingDetails?.processingStatus;

      if (uploadStatus === 'rejected' || uploadStatus === 'failed') {
        return {
          phase: 'failed',
          providerPostId: videoId,
          errorCode: 'YOUTUBE_UPLOAD_FAILED',
          errorMessage:
            item.status?.rejectionReason ||
            item.status?.failureReason ||
            item.processingDetails?.processingFailureReason ||
            'YouTube upload failed',
          requiresStatusPoll: false,
          raw: item as unknown as Record<string, unknown>,
        };
      }

      if (processingStatus === 'failed') {
        return {
          phase: 'failed',
          providerPostId: videoId,
          errorCode: 'YOUTUBE_PROCESSING_FAILED',
          errorMessage:
            item.processingDetails?.processingFailureReason || 'YouTube processing failed',
          requiresStatusPoll: false,
          raw: item as unknown as Record<string, unknown>,
        };
      }

      if (uploadStatus === 'processed' || processingStatus === 'succeeded') {
        return {
          phase: 'published',
          providerPostId: videoId,
          postUrl: `https://www.youtube.com/watch?v=${videoId}`,
          uploadProgress: 100,
          requiresStatusPoll: false,
          raw: item as unknown as Record<string, unknown>,
        };
      }

      return {
        phase: processingStatus === 'processing' ? 'processing' : 'uploading',
        providerPostId: videoId,
        postUrl: `https://www.youtube.com/watch?v=${videoId}`,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: item as unknown as Record<string, unknown>,
      };
    } catch (err) {
      return {
        phase: 'failed',
        errorCode: 'YOUTUBE_STATUS_FAILED',
        errorMessage: axiosErrorMessage(err),
        requiresStatusPoll: false,
      };
    }
  }

  async getPostDetails(input: {
    accessToken: string;
    platformAccountId: string;
    providerPostId: string;
  }): Promise<PostDetailsResult> {
    if (this.shouldUseMock() || input.providerPostId.startsWith('mock-yt-')) {
      return {
        providerPostId: input.providerPostId,
        postUrl: `https://www.youtube.com/watch?v=${input.providerPostId}`,
        title: 'Mock YouTube video',
        caption: 'Mock description',
        privacyStatus: 'private',
        raw: { mock: true },
      };
    }

    const client = this.http.create(YOUTUBE_API_BASE);
    const res = await client.get<{
      items?: Array<{
        id: string;
        snippet?: { title?: string; description?: string };
        status?: { privacyStatus?: string };
      }>;
    }>('/videos', {
      params: { part: 'snippet,status', id: input.providerPostId },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });

    const item = res.data.items?.[0];
    if (!item) {
      throw new Error(`YouTube video not found: ${input.providerPostId}`);
    }

    return {
      providerPostId: item.id,
      postUrl: `https://www.youtube.com/watch?v=${item.id}`,
      title: item.snippet?.title,
      caption: item.snippet?.description,
      privacyStatus: item.status?.privacyStatus,
      raw: item as unknown as Record<string, unknown>,
    };
  }

  async getPostAnalytics(input: {
    accessToken: string;
    platformAccountId: string;
    providerPostId: string;
    postUrl?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<NormalizedPostMetrics> {
    if (this.shouldUseMock() || input.providerPostId.startsWith('mock-')) {
      return mockPostAnalytics('YOUTUBE', input.providerPostId, input.postUrl);
    }

    const client = this.http.create(YOUTUBE_API_BASE);
    const res = await client.get<{
      items?: Array<{
        id: string;
        snippet?: { title?: string; publishedAt?: string };
        statistics?: {
          viewCount?: string;
          likeCount?: string;
          commentCount?: string;
        };
      }>;
    }>('/videos', {
      params: {
        part: 'statistics,snippet',
        id: input.providerPostId,
      },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const video = res.data.items?.[0];
    if (!video) {
      throw new Error(`YouTube video not found: ${input.providerPostId}`);
    }
    const unavailable = (reason: string, nativeName?: string) =>
      unavailableMetric(reason, { nativeName });
    const countMetric = (value: string | undefined, nativeName: string) => {
      if (value == null || value === '') {
        return unavailable(`YouTube did not return ${nativeName} for this video.`, nativeName);
      }
      const parsed = Number(value);
      return Number.isFinite(parsed)
        ? availableMetric(parsed, { nativeName })
        : unavailable(`YouTube returned an invalid ${nativeName}.`, nativeName);
    };
    const scopes = Array.isArray(input.metadata?.grantedScopes)
      ? input.metadata.grantedScopes.map(String)
      : [];
    const hasAnalyticsScope = scopes.some((scope) => scope.includes('yt-analytics'));
    const analyticsReason = hasAnalyticsScope
      ? 'YouTube videos.list does not expose this metric; the Analytics API is not queried by this adapter.'
      : 'YouTube Analytics API access with a yt-analytics scope is required for this metric.';

    return {
      platform: 'YOUTUBE',
      providerPostId: input.providerPostId,
      postUrl: input.postUrl ?? `https://www.youtube.com/watch?v=${input.providerPostId}`,
      publishedAt: video.snippet?.publishedAt ?? null,
      views: countMetric(video.statistics?.viewCount, 'statistics.viewCount'),
      reach: unavailable(analyticsReason),
      impressions: unavailable(analyticsReason),
      likes: countMetric(video.statistics?.likeCount, 'statistics.likeCount'),
      comments: countMetric(video.statistics?.commentCount, 'statistics.commentCount'),
      shares: unavailable(analyticsReason),
      saves: unavailable(
        'YouTube Data API does not expose playlist saves for an individual video.',
      ),
      watchTimeSeconds: unavailable(analyticsReason),
      averageWatchSeconds: unavailable(analyticsReason),
      completionRate: unavailable(analyticsReason),
      followersGained: unavailable(
        'YouTube videos.list does not expose video-attributed subscribers gained.',
      ),
      metricSource: 'PROVIDER_API',
      platformNotes: {
        views: 'statistics.viewCount is YouTube’s public video view count.',
        engagement:
          'statistics.likeCount and statistics.commentCount are public counters when enabled.',
        analytics: analyticsReason,
      },
      raw: truncateRawProviderResponse(res.data),
    };
  }

  async disconnectAccount(_accessToken: string, platformAccountId: string): Promise<void> {
    this.logger.log(`YouTube disconnect best-effort for ${platformAccountId}`);
  }
}
