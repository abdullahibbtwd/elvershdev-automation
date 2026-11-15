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
  TIKTOK_SCOPES,
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
  isTruthyFlag,
  mockId,
  planTikTokChunks,
  resolveSocialShouldUseMock,
} from '../social/social-provider.utils';
import { BaseProvider } from './base.provider';

const TIKTOK_AUTH_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const TIKTOK_API_BASE = 'https://open.tiktokapis.com';

type TikTokTokenResponse = {
  access_token: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_expires_in?: number;
  open_id?: string;
  scope?: string;
  token_type?: string;
};

type TikTokCreatorInfo = {
  creator_username?: string;
  creator_nickname?: string;
  creator_avatar_url?: string;
  privacy_level_options?: string[];
  comment_disabled?: boolean;
  duet_disabled?: boolean;
  stitch_disabled?: boolean;
  max_video_post_duration_sec?: number;
};

@Injectable()
export class TikTokProvider extends BaseProvider implements SocialPublishingProvider {
  readonly platform = 'TIKTOK' as const;
  private readonly logger = new Logger(TikTokProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super();
  }

  isConfigured(): boolean {
    return Boolean(
      this.config.get<string>('integrations.tiktokClientKey') &&
      this.config.get<string>('integrations.tiktokClientSecret'),
    );
  }

  shouldUseMock(): boolean {
    return resolveSocialShouldUseMock({
      config: this.config,
      platformUseMockKey: 'integrations.tiktokUseMock',
      isConfigured: this.isConfigured(),
    });
  }

  private isAudited(): boolean {
    return isTruthyFlag(this.config.get('integrations.tiktokAudited'));
  }

  private clientKey(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.tiktokClientKey'),
      'TIKTOK_CLIENT_KEY',
    );
  }

  private clientSecret(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.tiktokClientSecret'),
      'TIKTOK_CLIENT_SECRET',
    );
  }

  private defaultRedirectUri(): string {
    return (
      this.config.get<string>('integrations.tiktokRedirectUri') ??
      'http://localhost:3000/api/channels/tiktok/callback'
    );
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const clientKey = this.shouldUseMock()
      ? (this.config.get<string>('integrations.tiktokClientKey') ?? 'mock-tiktok-client')
      : this.clientKey();
    const redirectUri = params.redirectUri || this.defaultRedirectUri();
    const scope = (params.scopes?.length ? params.scopes : [...TIKTOK_SCOPES]).join(',');
    const url = new URL(TIKTOK_AUTH_URL);
    url.searchParams.set('client_key', clientKey);
    url.searchParams.set('scope', scope);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('response_type', 'code');
    if (params.codeChallenge) {
      url.searchParams.set('code_challenge', params.codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

  async exchangeAuthorizationCode(params: ExchangeCodeParams): Promise<ExchangeCodeResult> {
    if (this.shouldUseMock()) {
      const tokens: TokenBundle = {
        accessToken: 'mock-tiktok-access-token',
        refreshToken: 'mock-tiktok-refresh-token',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        scopes: [...TIKTOK_SCOPES],
      };
      return {
        tokens,
        accounts: [
          {
            platformAccountId: 'mock-tiktok-open-id',
            displayName: 'Mock TikTok Creator',
            username: 'mock_tiktok',
            profileImageUrl: null,
            accountType: 'creator',
            grantedScopes: [...TIKTOK_SCOPES],
          },
        ],
      };
    }

    if (!params.codeVerifier) {
      throw new Error(
        'TikTok OAuth requires codeVerifier (PKCE) when exchanging the authorization code',
      );
    }

    const client = this.http.create(TIKTOK_API_BASE);
    const body = new URLSearchParams({
      client_key: this.clientKey(),
      client_secret: this.clientSecret(),
      code: params.code,
      grant_type: 'authorization_code',
      redirect_uri: params.redirectUri || this.defaultRedirectUri(),
      code_verifier: params.codeVerifier,
    });

    const res = await client.post<TikTokTokenResponse>('/v2/oauth/token/', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = res.data;
    const scopes = (data.scope ?? TIKTOK_SCOPES.join(',')).split(/[,\s]+/).filter(Boolean);
    const openId = data.open_id ?? 'unknown';

    return {
      tokens: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token ?? null,
        expiresAt: expiresAtFromSeconds(data.expires_in),
        scopes,
      },
      accounts: [
        {
          platformAccountId: openId,
          displayName: openId,
          username: null,
          profileImageUrl: null,
          accountType: 'creator',
          grantedScopes: scopes,
          metadata: { openId },
        },
      ],
    };
  }

  async refreshAccessToken(refreshToken: string): Promise<TokenBundle> {
    if (this.shouldUseMock()) {
      return {
        accessToken: 'mock-tiktok-access-token-refreshed',
        refreshToken: refreshToken || 'mock-tiktok-refresh-token',
        expiresAt: new Date(Date.now() + 24 * 3600 * 1000),
        scopes: [...TIKTOK_SCOPES],
      };
    }

    const client = this.http.create(TIKTOK_API_BASE);
    const body = new URLSearchParams({
      client_key: this.clientKey(),
      client_secret: this.clientSecret(),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });

    const res = await client.post<TikTokTokenResponse>('/v2/oauth/token/', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    const data = res.data;
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: expiresAtFromSeconds(data.expires_in),
      scopes: (data.scope ?? TIKTOK_SCOPES.join(',')).split(/[,\s]+/).filter(Boolean),
    };
  }

  async getConnectedAccount(
    accessToken: string,
    platformAccountId: string,
  ): Promise<ConnectedAccountInfo> {
    if (this.shouldUseMock()) {
      return {
        platformAccountId: platformAccountId || 'mock-tiktok-open-id',
        displayName: 'Mock TikTok Creator',
        username: 'mock_tiktok',
        profileImageUrl: null,
        accountType: 'creator',
        grantedScopes: [...TIKTOK_SCOPES],
      };
    }

    const creator = await this.queryCreatorInfo(accessToken);
    return {
      platformAccountId,
      displayName: creator.creator_nickname ?? creator.creator_username ?? platformAccountId,
      username: creator.creator_username ?? null,
      profileImageUrl: creator.creator_avatar_url ?? null,
      accountType: 'creator',
      grantedScopes: [...TIKTOK_SCOPES],
      metadata: {
        privacyLevelOptions: creator.privacy_level_options,
        maxVideoPostDurationSec: creator.max_video_post_duration_sec,
      },
    };
  }

  async getPublishingCapabilities(
    _accessToken: string,
    _account: ConnectedAccountInfo,
  ): Promise<PublishingCapabilities> {
    const caps = structuredClone(DEFAULT_CAPABILITIES.TIKTOK);
    if (!this.isAudited()) {
      caps.canPublishPublic = false;
      caps.testOrPrivateOnly = true;
      if (!caps.flags.includes('test_only')) caps.flags.push('test_only');
      caps.warnings = [
        ...caps.warnings,
        'TIKTOK_AUDITED is not true; privacy_level is forced to SELF_ONLY.',
      ];
    } else {
      caps.canPublishPublic = true;
      caps.testOrPrivateOnly = false;
      caps.flags = caps.flags.filter((f) => f !== 'test_only');
      if (!caps.flags.includes('public_publish')) caps.flags.push('public_publish');
    }
    return caps;
  }

  private async queryCreatorInfo(accessToken: string): Promise<TikTokCreatorInfo> {
    const client = this.http.create(TIKTOK_API_BASE);
    const res = await client.post<{
      data?: TikTokCreatorInfo;
      error?: { code?: string; message?: string };
    }>(
      '/v2/post/publish/creator_info/query/',
      {},
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    );
    if (res.data.error?.code && res.data.error.code !== 'ok') {
      throw new Error(
        res.data.error.message || `TikTok creator_info error: ${res.data.error.code}`,
      );
    }
    return res.data.data ?? {};
  }

  async publishVideo(input: PublishVideoInput): Promise<PublishVideoResult> {
    if (this.shouldUseMock()) {
      const id = mockId('mock-tiktok-pub', input.platformAccountId);
      return {
        phase: 'processing',
        providerUploadId: id,
        providerPublishId: id,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 3_000,
        raw: { mock: true, privacy_level: 'SELF_ONLY' },
      };
    }

    if (!input.localFilePath) {
      if (input.mediaUrl) {
        throw new Error(
          'TikTok PULL_FROM_URL requires a verified domain ownership in the TikTok developer portal. Provide localFilePath for FILE_UPLOAD instead.',
        );
      }
      throw new Error('TikTok Direct Post requires localFilePath for FILE_UPLOAD chunked upload.');
    }

    const accessToken = input.accessToken;
    const title = buildCaption({
      caption: input.caption,
      description: input.description,
      title: input.title,
      hashtags: input.hashtags,
    }).slice(0, 2200);

    try {
      const creator = await this.queryCreatorInfo(accessToken);
      const settings = input.platformSettings ?? {};
      let privacyLevel = String(settings.privacyLevel ?? settings.privacy_level ?? 'SELF_ONLY');
      if (!this.isAudited()) {
        privacyLevel = 'SELF_ONLY';
      }
      const allowed = creator.privacy_level_options ?? [];
      if (allowed.length && !allowed.includes(privacyLevel)) {
        privacyLevel = allowed.includes('SELF_ONLY') ? 'SELF_ONLY' : allowed[0]!;
      }

      const brandContentToggle = Boolean(
        settings.brandContentToggle ?? settings.brand_content_toggle ?? false,
      );
      const brandOrganicToggle = Boolean(
        settings.brandOrganicToggle ?? settings.brand_organic_toggle ?? false,
      );

      const videoSize = await getLocalFileSize(input.localFilePath, input.fileSizeBytes);
      const { chunkSize, totalChunkCount } = planTikTokChunks(videoSize);

      const client = this.http.create(TIKTOK_API_BASE);
      const initRes = await client.post<{
        data?: { publish_id?: string; upload_url?: string };
        error?: { code?: string; message?: string };
      }>(
        '/v2/post/publish/video/init/',
        {
          post_info: {
            title,
            privacy_level: privacyLevel,
            disable_duet: Boolean(settings.disableDuet ?? false),
            disable_comment: Boolean(settings.disableComment ?? false),
            disable_stitch: Boolean(settings.disableStitch ?? false),
            brand_content_toggle: brandContentToggle,
            brand_organic_toggle: brandOrganicToggle,
            ...(settings.videoCoverTimestampMs != null
              ? { video_cover_timestamp_ms: Number(settings.videoCoverTimestampMs) }
              : {}),
            ...(settings.isAigc != null ? { is_aigc: Boolean(settings.isAigc) } : {}),
          },
          source_info: {
            source: 'FILE_UPLOAD',
            video_size: videoSize,
            chunk_size: chunkSize,
            total_chunk_count: totalChunkCount,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
        },
      );

      if (initRes.data.error?.code && initRes.data.error.code !== 'ok') {
        throw new Error(
          initRes.data.error.message || `TikTok init error: ${initRes.data.error.code}`,
        );
      }

      const publishId = initRes.data.data?.publish_id;
      const uploadUrl = initRes.data.data?.upload_url;
      if (!publishId || !uploadUrl) {
        throw new Error('TikTok video init did not return publish_id/upload_url');
      }

      this.logger.log(`TikTok Direct Post initialized for account ${input.platformAccountId}`);

      await this.uploadTikTokFileByPlan({
        uploadUrl,
        localFilePath: input.localFilePath,
        videoSize,
        chunkSize,
        totalChunkCount,
        mimeType: input.mimeType ?? 'video/mp4',
      });

      return {
        phase: 'processing',
        providerUploadId: publishId,
        providerPublishId: publishId,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: { privacy_level: privacyLevel },
      };
    } catch (err) {
      const message = axiosErrorMessage(err, 'TikTok publish failed');
      this.logger.error(`TikTok publish failed for ${input.platformAccountId}: ${message}`);
      return {
        phase: 'failed',
        errorCode: 'TIKTOK_PUBLISH_FAILED',
        errorMessage: message,
        requiresStatusPoll: false,
      };
    }
  }

  private async uploadTikTokFileByPlan(params: {
    uploadUrl: string;
    localFilePath: string;
    videoSize: number;
    chunkSize: number;
    totalChunkCount: number;
    mimeType: string;
  }): Promise<void> {
    const handle = await openFile(params.localFilePath, 'r');
    const uploadClient = this.http.create();
    try {
      let offset = 0;
      for (let i = 0; i < params.totalChunkCount; i += 1) {
        const isLast = i === params.totalChunkCount - 1;
        const length = isLast ? params.videoSize - offset : params.chunkSize;
        const buffer = Buffer.alloc(length);
        const { bytesRead } = await handle.read(buffer, 0, length, offset);
        const payload = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
        const start = offset;
        const end = offset + payload.length - 1;
        await uploadClient.put(params.uploadUrl, payload, {
          headers: {
            'Content-Type': params.mimeType,
            'Content-Length': String(payload.length),
            'Content-Range': `bytes ${start}-${end}/${params.videoSize}`,
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600_000,
          validateStatus: (s) => s === 200 || s === 201 || s === 206,
        });
        offset += payload.length;
      }
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
    const publishId = input.providerPublishId ?? input.providerUploadId ?? input.providerPostId;

    if (this.shouldUseMock() || publishId?.startsWith('mock-tiktok-')) {
      const id = publishId ?? mockId('mock-tiktok-pub', input.platformAccountId);
      return {
        phase: 'published',
        providerPostId: id,
        postUrl: `https://www.tiktok.com/@mock/video/${id}`,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: { mock: true, status: 'PUBLISH_COMPLETE' },
      };
    }

    if (!publishId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_PUBLISH_ID',
        errorMessage: 'providerPublishId is required for TikTok status',
        requiresStatusPoll: false,
      };
    }

    try {
      const client = this.http.create(TIKTOK_API_BASE);
      const res = await client.post<{
        data?: {
          status?: string;
          fail_reason?: string;
          publicaly_available_post_id?: Array<string | number>;
          publicly_available_post_id?: Array<string | number>;
        };
        error?: { code?: string; message?: string };
      }>(
        '/v2/post/publish/status/fetch/',
        { publish_id: publishId },
        {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            'Content-Type': 'application/json; charset=UTF-8',
          },
        },
      );

      if (res.data.error?.code && res.data.error.code !== 'ok') {
        return {
          phase: 'failed',
          errorCode: res.data.error.code,
          errorMessage: res.data.error.message,
          requiresStatusPoll: false,
          raw: res.data as unknown as Record<string, unknown>,
        };
      }

      const status = res.data.data?.status ?? '';
      const postIds =
        res.data.data?.publicly_available_post_id ??
        res.data.data?.publicaly_available_post_id ??
        [];
      const postId = postIds[0] != null ? String(postIds[0]) : undefined;

      if (status === 'PUBLISH_COMPLETE') {
        return {
          phase: 'published',
          providerPostId: postId ?? publishId,
          postUrl: postId ? `https://www.tiktok.com/@/video/${postId}` : undefined,
          uploadProgress: 100,
          requiresStatusPoll: false,
          raw: res.data.data as Record<string, unknown>,
        };
      }

      if (status === 'FAILED') {
        return {
          phase: 'failed',
          providerPostId: publishId,
          errorCode: 'TIKTOK_PUBLISH_FAILED',
          errorMessage: res.data.data?.fail_reason || 'TikTok publish failed',
          requiresStatusPoll: false,
          raw: res.data.data as Record<string, unknown>,
        };
      }

      const phase =
        status === 'PROCESSING_UPLOAD' || status === 'SENDING_TO_USER_INBOX'
          ? 'uploading'
          : status === 'PROCESSING_DOWNLOAD'
            ? 'processing'
            : status === 'PUBLISHING'
              ? 'publishing'
              : 'processing';

      return {
        phase,
        providerPostId: publishId,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: res.data.data as Record<string, unknown>,
      };
    } catch (err) {
      return {
        phase: 'failed',
        errorCode: 'TIKTOK_STATUS_FAILED',
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
    if (this.shouldUseMock() || input.providerPostId.startsWith('mock-tiktok-')) {
      return {
        providerPostId: input.providerPostId,
        postUrl: `https://www.tiktok.com/@mock/video/${input.providerPostId}`,
        title: 'Mock TikTok video',
        privacyStatus: 'SELF_ONLY',
        raw: { mock: true },
      };
    }

    return {
      providerPostId: input.providerPostId,
      postUrl: `https://www.tiktok.com/@/video/${input.providerPostId}`,
      raw: { note: 'TikTok Content Posting API does not expose a rich post-details endpoint here' },
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
      return mockPostAnalytics('TIKTOK', input.providerPostId, input.postUrl);
    }

    const client = this.http.create(TIKTOK_API_BASE);
    const res = await client.post<{
      data?: {
        videos?: Array<{
          id?: string;
          view_count?: number;
          like_count?: number;
          comment_count?: number;
          share_count?: number;
          share_url?: string;
        }>;
      };
      error?: { code?: string; message?: string };
    }>(
      '/v2/video/query/',
      { filters: { video_ids: [input.providerPostId] } },
      {
        params: {
          fields: 'id,view_count,like_count,comment_count,share_count,share_url',
        },
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    );
    if (res.data.error?.code && res.data.error.code !== 'ok') {
      throw new Error(res.data.error.message || `TikTok video query error: ${res.data.error.code}`);
    }
    const video = res.data.data?.videos?.find((item) => String(item.id) === input.providerPostId);
    const unavailable = (reason: string, nativeName?: string) =>
      unavailableMetric(reason, { nativeName });
    const countMetric = (value: number | undefined, nativeName: string) =>
      value == null
        ? unavailable(`TikTok did not return ${nativeName} for this video.`, nativeName)
        : availableMetric(value, { nativeName });
    const scopes = Array.isArray(input.metadata?.grantedScopes)
      ? input.metadata.grantedScopes.map(String)
      : [];
    const hasBusinessInsightsScope = scopes.some(
      (scope) => scope.includes('video.insights') || scope.includes('business'),
    );
    const businessReason = hasBusinessInsightsScope
      ? 'TikTok video/query does not return this Business analytics metric; no additional endpoint was queried.'
      : 'TikTok reach and watch metrics require approved TikTok Business analytics scopes.';

    return {
      platform: 'TIKTOK',
      providerPostId: input.providerPostId,
      postUrl: input.postUrl ?? video?.share_url ?? null,
      views: countMetric(video?.view_count, 'view_count'),
      reach: unavailable(businessReason),
      impressions: unavailable(businessReason),
      likes: countMetric(video?.like_count, 'like_count'),
      comments: countMetric(video?.comment_count, 'comment_count'),
      shares: countMetric(video?.share_count, 'share_count'),
      saves: unavailable('TikTok video/query does not expose save or favorite count.'),
      watchTimeSeconds: unavailable(businessReason),
      averageWatchSeconds: unavailable(businessReason),
      completionRate: unavailable(businessReason),
      followersGained: unavailable(
        'TikTok video/query does not expose post-attributed followers gained.',
      ),
      metricSource: 'PROVIDER_API',
      platformNotes: {
        views: 'view_count is TikTok’s public video view counter.',
        engagement:
          'Likes, comments, and shares are public counters returned by TikTok video/query.',
        businessMetrics: businessReason,
      },
      raw: truncateRawProviderResponse(res.data),
    };
  }

  async disconnectAccount(_accessToken: string, platformAccountId: string): Promise<void> {
    this.logger.log(`TikTok disconnect best-effort for ${platformAccountId}`);
  }
}
