import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream } from 'node:fs';
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
  INSTAGRAM_SCOPES,
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

type IgContainerStatus = 'FINISHED' | 'ERROR' | 'IN_PROGRESS' | 'EXPIRED' | 'PUBLISHED' | string;

@Injectable()
export class InstagramProvider extends BaseProvider implements SocialPublishingProvider {
  readonly platform = 'INSTAGRAM' as const;
  private readonly logger = new Logger(InstagramProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super();
  }

  isConfigured(): boolean {
    const oauthConfigured = Boolean(
      this.config.get<string>('integrations.instagramAppId') &&
        this.config.get<string>('integrations.instagramAppSecret'),
    );
    // Page token + IG business account ID enables browserless Content Publishing API.
    const pageTokenConfigured = Boolean(
      this.config.get<string>('integrations.facebookPageAccessToken') &&
        this.config.get<string>('integrations.instagramAccountId'),
    );
    return oauthConfigured || pageTokenConfigured;
  }

  shouldUseMock(): boolean {
    return resolveSocialShouldUseMock({
      config: this.config,
      platformUseMockKey: 'integrations.instagramUseMock',
      isConfigured: this.isConfigured(),
    });
  }

  private graphVersion(): string {
    return this.config.get<string>('integrations.facebookGraphVersion') ?? 'v22.0';
  }

  private graphBase(): string {
    return `https://graph.facebook.com/${this.graphVersion()}`;
  }

  private appId(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.instagramAppId'),
      'INSTAGRAM_APP_ID',
    );
  }

  private appSecret(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.instagramAppSecret'),
      'INSTAGRAM_APP_SECRET',
    );
  }

  private defaultRedirectUri(): string {
    return (
      this.config.get<string>('integrations.instagramRedirectUri') ??
      'http://localhost:3000/api/channels/instagram/callback'
    );
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const version = this.graphVersion();
    const clientId = this.shouldUseMock()
      ? (this.config.get<string>('integrations.instagramAppId') ?? 'mock-instagram-app')
      : this.appId();
    const redirectUri = params.redirectUri || this.defaultRedirectUri();
    const scopes = (params.scopes?.length ? params.scopes : [...INSTAGRAM_SCOPES]).join(',');
    const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', params.state);
    url.searchParams.set('scope', scopes);
    url.searchParams.set('response_type', 'code');
    return url.toString();
  }

  async exchangeAuthorizationCode(params: ExchangeCodeParams): Promise<ExchangeCodeResult> {
    if (this.shouldUseMock()) {
      const tokens: TokenBundle = {
        accessToken: 'mock-instagram-user-token',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
        scopes: [...INSTAGRAM_SCOPES],
      };
      return {
        tokens,
        accounts: [
          {
            platformAccountId: 'mock-ig-user-1',
            displayName: 'Mock Instagram Professional',
            username: 'mock_ig_pro',
            profileImageUrl: null,
            accountType: 'BUSINESS',
            grantedScopes: [...INSTAGRAM_SCOPES],
            metadata: { pageId: 'mock-fb-page-1' },
          },
        ],
      };
    }

    const client = this.http.create(this.graphBase());
    const redirectUri = params.redirectUri || this.defaultRedirectUri();

    const shortLived = await client.get<{
      access_token: string;
      expires_in?: number;
    }>('/oauth/access_token', {
      params: {
        client_id: this.appId(),
        client_secret: this.appSecret(),
        redirect_uri: redirectUri,
        code: params.code,
      },
    });

    const longLived = await client.get<{
      access_token: string;
      expires_in?: number;
    }>('/oauth/access_token', {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: this.appId(),
        client_secret: this.appSecret(),
        fb_exchange_token: shortLived.data.access_token,
      },
    });

    const userToken = longLived.data.access_token;
    const pagesRes = await client.get<{
      data?: Array<{
        id: string;
        name?: string;
        access_token?: string;
        instagram_business_account?: {
          id: string;
          username?: string;
          name?: string;
          profile_picture_url?: string;
        };
      }>;
    }>('/me/accounts', {
      params: {
        access_token: userToken,
        fields:
          'id,name,access_token,instagram_business_account{id,username,name,profile_picture_url}',
      },
    });

    const accounts: ConnectedAccountInfo[] = [];
    for (const page of pagesRes.data.data ?? []) {
      const ig = page.instagram_business_account;
      if (!ig?.id) continue;
      accounts.push({
        platformAccountId: ig.id,
        displayName: ig.name ?? ig.username ?? ig.id,
        username: ig.username ?? null,
        profileImageUrl: ig.profile_picture_url ?? null,
        accountType: 'BUSINESS',
        grantedScopes: [...INSTAGRAM_SCOPES],
        metadata: {
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.access_token,
        },
      });
    }

    if (!accounts.length) {
      this.logger.warn(
        'Instagram OAuth succeeded but no Professional accounts linked to Pages were found',
      );
    }

    return {
      tokens: {
        accessToken: userToken,
        refreshToken: null,
        expiresAt: expiresAtFromSeconds(longLived.data.expires_in),
        scopes: [...INSTAGRAM_SCOPES],
      },
      accounts,
    };
  }

  async getConnectedAccount(
    accessToken: string,
    platformAccountId: string,
  ): Promise<ConnectedAccountInfo> {
    if (this.shouldUseMock()) {
      return {
        platformAccountId: platformAccountId || 'mock-ig-user-1',
        displayName: 'Mock Instagram Professional',
        username: 'mock_ig_pro',
        profileImageUrl: null,
        accountType: 'BUSINESS',
        grantedScopes: [...INSTAGRAM_SCOPES],
      };
    }

    const client = this.http.create(this.graphBase());
    const res = await client.get<{
      id: string;
      username?: string;
      name?: string;
      profile_picture_url?: string;
      account_type?: string;
    }>(`/${platformAccountId}`, {
      params: {
        access_token: accessToken,
        fields: 'id,username,name,profile_picture_url,account_type',
      },
    });

    return {
      platformAccountId: res.data.id,
      displayName: res.data.name ?? res.data.username ?? res.data.id,
      username: res.data.username ?? null,
      profileImageUrl: res.data.profile_picture_url ?? null,
      accountType: res.data.account_type ?? 'BUSINESS',
      grantedScopes: [...INSTAGRAM_SCOPES],
    };
  }

  async getPublishingCapabilities(
    _accessToken: string,
    account: ConnectedAccountInfo,
  ): Promise<PublishingCapabilities> {
    const caps = structuredClone(DEFAULT_CAPABILITIES.INSTAGRAM);
    const type = (account.accountType ?? '').toUpperCase();
    const isProfessional =
      !type ||
      type === 'BUSINESS' ||
      type === 'CREATOR' ||
      type === 'MEDIA_CREATOR' ||
      type === 'PROFESSIONAL';

    if (!isProfessional || type === 'PERSONAL') {
      caps.canPublishVideo = false;
      caps.canPublishPublic = false;
      caps.unsupportedReasons = [
        ...caps.unsupportedReasons,
        'Only Instagram Professional accounts (Business or Creator) linked to a Facebook Page are supported. Personal accounts cannot publish via the Content Publishing API.',
      ];
    }
    return caps;
  }

  async publishVideo(input: PublishVideoInput): Promise<PublishVideoResult> {
    if (this.shouldUseMock()) {
      const id = mockId('mock-ig-media', input.platformAccountId);
      return {
        phase: 'published',
        providerUploadId: id,
        providerPublishId: id,
        providerPostId: id,
        postUrl: `https://www.instagram.com/reel/${id}/`,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: { mock: true },
      };
    }

    const igUserId = input.platformAccountId;
    const accessToken = input.accessToken;
    const caption = buildCaption({
      caption: input.caption,
      description: input.description,
      hashtags: input.hashtags,
    });
    const client = this.http.create(this.graphBase());

    try {
      let containerId: string;

      if (input.localFilePath) {
        const fileSize = await getLocalFileSize(input.localFilePath, input.fileSizeBytes);
        const create = await client.post<{ id: string; uri?: string }>(`/${igUserId}/media`, null, {
          params: {
            media_type: 'REELS',
            upload_type: 'resumable',
            caption: caption || undefined,
            access_token: accessToken,
            ...(input.platformSettings?.coverUrl
              ? { cover_url: String(input.platformSettings.coverUrl) }
              : {}),
            ...(input.platformSettings?.thumbOffset != null
              ? { thumb_offset: String(input.platformSettings.thumbOffset) }
              : {}),
          },
        });
        containerId = create.data.id;
        if (!containerId) {
          throw new Error('Instagram resumable container create did not return id');
        }

        const version = this.graphVersion();
        const uploadUrl =
          create.data.uri ?? `https://rupload.facebook.com/ig-api-upload/${version}/${containerId}`;

        const uploadClient = this.http.create();
        await uploadClient.post(uploadUrl, createReadStream(input.localFilePath), {
          headers: {
            Authorization: `OAuth ${accessToken}`,
            offset: '0',
            file_size: String(fileSize),
            'Content-Type': input.mimeType ?? 'application/octet-stream',
          },
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          timeout: 600_000,
        });
      } else if (input.mediaUrl) {
        const create = await client.post<{ id: string }>(`/${igUserId}/media`, null, {
          params: {
            media_type: 'REELS',
            video_url: input.mediaUrl,
            caption: caption || undefined,
            access_token: accessToken,
            ...(input.platformSettings?.coverUrl
              ? { cover_url: String(input.platformSettings.coverUrl) }
              : {}),
          },
        });
        containerId = create.data.id;
        if (!containerId) {
          throw new Error('Instagram media container create did not return id');
        }
      } else {
        throw new Error(
          'Instagram publish requires localFilePath (preferred, resumable) or mediaUrl (public HTTPS URL reachable by Meta).',
        );
      }

      this.logger.log(`Instagram media container created for user ${igUserId}`);

      return {
        phase: 'processing',
        providerUploadId: containerId,
        providerPublishId: containerId,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: { containerId, awaiting: 'FINISHED then media_publish' },
      };
    } catch (err) {
      const message = axiosErrorMessage(err, 'Instagram publish failed');
      this.logger.error(`Instagram publish failed for ${igUserId}: ${message}`);
      return {
        phase: 'failed',
        errorCode: 'INSTAGRAM_PUBLISH_FAILED',
        errorMessage: message,
        requiresStatusPoll: false,
      };
    }
  }

  private mapContainerStatus(statusCode?: IgContainerStatus): {
    phase: PublishStatusResult['phase'];
    requiresStatusPoll: boolean;
    errorMessage?: string;
  } {
    switch (statusCode) {
      case 'FINISHED':
        return { phase: 'uploaded', requiresStatusPoll: true };
      case 'PUBLISHED':
        return { phase: 'published', requiresStatusPoll: false };
      case 'IN_PROGRESS':
        return { phase: 'processing', requiresStatusPoll: true };
      case 'EXPIRED':
        return {
          phase: 'failed',
          requiresStatusPoll: false,
          errorMessage: 'Instagram media container expired before publish',
        };
      case 'ERROR':
        return {
          phase: 'failed',
          requiresStatusPoll: false,
          errorMessage: 'Instagram media container entered ERROR state',
        };
      default:
        return { phase: 'processing', requiresStatusPoll: true };
    }
  }

  async getPublishStatus(input: {
    accessToken: string;
    platformAccountId: string;
    providerUploadId?: string;
    providerPublishId?: string;
    providerPostId?: string;
  }): Promise<PublishStatusResult> {
    const containerOrPostId =
      input.providerUploadId ?? input.providerPublishId ?? input.providerPostId;

    if (this.shouldUseMock() || containerOrPostId?.startsWith('mock-ig-')) {
      const id = containerOrPostId ?? mockId('mock-ig-media', input.platformAccountId);
      return {
        phase: 'published',
        providerPostId: id,
        postUrl: `https://www.instagram.com/reel/${id}/`,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: { mock: true },
      };
    }

    if (!containerOrPostId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_CONTAINER_ID',
        errorMessage: 'providerUploadId is required for Instagram status',
        requiresStatusPoll: false,
      };
    }

    // If caller already has a published media id (not a container), treat as published.
    if (input.providerPostId && !input.providerUploadId) {
      return {
        phase: 'published',
        providerPostId: input.providerPostId,
        postUrl: `https://www.instagram.com/reel/${input.providerPostId}/`,
        requiresStatusPoll: false,
      };
    }

    try {
      const client = this.http.create(this.graphBase());
      const statusRes = await client.get<{
        id?: string;
        status_code?: IgContainerStatus;
        status?: string;
      }>(`/${containerOrPostId}`, {
        params: {
          access_token: input.accessToken,
          fields: 'id,status_code,status',
        },
      });

      const statusCode = statusRes.data.status_code;
      const mapped = this.mapContainerStatus(statusCode);

      if (mapped.phase === 'failed') {
        return {
          phase: 'failed',
          providerPostId: containerOrPostId,
          errorCode: 'INSTAGRAM_CONTAINER_ERROR',
          errorMessage: mapped.errorMessage,
          requiresStatusPoll: false,
          raw: statusRes.data as Record<string, unknown>,
        };
      }

      if (statusCode === 'FINISHED') {
        const publish = await client.post<{ id: string }>(
          `/${input.platformAccountId}/media_publish`,
          null,
          {
            params: {
              creation_id: containerOrPostId,
              access_token: input.accessToken,
            },
          },
        );
        const mediaId = publish.data.id;
        return {
          phase: 'published',
          providerPostId: mediaId,
          postUrl: `https://www.instagram.com/reel/${mediaId}/`,
          uploadProgress: 100,
          requiresStatusPoll: false,
          raw: { containerId: containerOrPostId, mediaId },
        };
      }

      if (statusCode === 'PUBLISHED') {
        return {
          phase: 'published',
          providerPostId: containerOrPostId,
          postUrl: `https://www.instagram.com/reel/${containerOrPostId}/`,
          uploadProgress: 100,
          requiresStatusPoll: false,
          raw: statusRes.data as Record<string, unknown>,
        };
      }

      return {
        phase: mapped.phase,
        providerPostId: containerOrPostId,
        requiresStatusPoll: mapped.requiresStatusPoll,
        pollAfterMs: 5_000,
        raw: statusRes.data as Record<string, unknown>,
      };
    } catch (err) {
      return {
        phase: 'failed',
        errorCode: 'INSTAGRAM_STATUS_FAILED',
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
    if (this.shouldUseMock() || input.providerPostId.startsWith('mock-ig-')) {
      return {
        providerPostId: input.providerPostId,
        postUrl: `https://www.instagram.com/reel/${input.providerPostId}/`,
        caption: 'Mock Instagram caption',
        raw: { mock: true },
      };
    }

    const client = this.http.create(this.graphBase());
    const res = await client.get<{
      id: string;
      caption?: string;
      permalink?: string;
      media_product_type?: string;
    }>(`/${input.providerPostId}`, {
      params: {
        access_token: input.accessToken,
        fields: 'id,caption,permalink,media_product_type',
      },
    });

    return {
      providerPostId: res.data.id,
      postUrl: res.data.permalink,
      caption: res.data.caption,
      raw: res.data as unknown as Record<string, unknown>,
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
      return mockPostAnalytics('INSTAGRAM', input.providerPostId, input.postUrl);
    }

    const client = this.http.create(this.graphBase());
    try {
      const mediaRes = await client.get<{
        id?: string;
        permalink?: string;
        media_product_type?: string;
        media_type?: string;
        timestamp?: string;
      }>(`/${input.providerPostId}`, {
        params: {
          access_token: input.accessToken,
          fields: 'id,permalink,media_product_type,media_type,timestamp',
        },
      });
      const isReel =
        mediaRes.data.media_product_type === 'REELS' || mediaRes.data.media_type === 'REELS';
      const metrics = [
        'views',
        'reach',
        'likes',
        'comments',
        'saved',
        'shares',
        ...(isReel ? ['total_watch_time', 'ig_reels_avg_watch_time'] : []),
      ];
      const insightsRes = await client.get<{
        data?: Array<{
          name?: string;
          values?: Array<{ value?: number | string }>;
          total_value?: { value?: number | string } | number | string;
        }>;
      }>(`/${input.providerPostId}/insights`, {
        params: {
          access_token: input.accessToken,
          metric: metrics.join(','),
        },
      });
      const insights = new Map(
        (insightsRes.data.data ?? []).map((entry) => [
          entry.name ?? '',
          instagramInsightValue(entry),
        ]),
      );
      const unavailable = (reason: string, nativeName?: string) =>
        unavailableMetric(reason, { nativeName });
      const metric = (nativeName: string) => {
        const value = insights.get(nativeName);
        return value == null
          ? unavailable(`Instagram did not return ${nativeName} for this media.`, nativeName)
          : availableMetric(value, { nativeName });
      };
      const totalWatchMs = insights.get('total_watch_time');
      const averageWatchMs = insights.get('ig_reels_avg_watch_time');

      return {
        platform: 'INSTAGRAM',
        providerPostId: input.providerPostId,
        postUrl: input.postUrl ?? mediaRes.data.permalink ?? null,
        publishedAt: mediaRes.data.timestamp ?? null,
        views: metric('views'),
        reach: metric('reach'),
        impressions: unavailable(
          'Instagram media impressions is deprecated; views is used instead.',
          'impressions',
        ),
        likes: metric('likes'),
        comments: metric('comments'),
        shares: metric('shares'),
        saves: metric('saved'),
        watchTimeSeconds: !isReel
          ? unavailable('Instagram watch time is only requested for Reels.')
          : totalWatchMs == null
            ? unavailable(
                'Instagram did not return total_watch_time for this Reel.',
                'total_watch_time',
              )
            : availableMetric(totalWatchMs / 1_000, {
                nativeName: 'total_watch_time',
                definition: 'Instagram total Reel watch time converted from milliseconds.',
              }),
        averageWatchSeconds: !isReel
          ? unavailable('Instagram average watch time is only requested for Reels.')
          : averageWatchMs == null
            ? unavailable(
                'Instagram did not return ig_reels_avg_watch_time for this Reel.',
                'ig_reels_avg_watch_time',
              )
            : availableMetric(averageWatchMs / 1_000, {
                nativeName: 'ig_reels_avg_watch_time',
                definition: 'Instagram average Reel watch time converted from milliseconds.',
              }),
        completionRate: unavailable(
          'Instagram media insights does not expose a native completion rate.',
        ),
        followersGained: unavailable(
          'Instagram media insights does not expose post-attributed followers gained.',
        ),
        metricSource: 'PROVIDER_API',
        platformNotes: {
          views: 'Instagram views replaces deprecated impressions and video_views metrics.',
          reach: 'Reach is the number of unique accounts that saw the media.',
          watch: isReel
            ? 'Reel watch-time values are converted from milliseconds to seconds.'
            : 'Watch-time metrics are unavailable for non-Reel media.',
        },
        raw: truncateRawProviderResponse({
          media: mediaRes.data,
          insights: insightsRes.data,
        }),
      };
    } catch (err) {
      return instagramUnavailableMetrics(
        input.providerPostId,
        input.postUrl,
        `Instagram insights unavailable: ${axiosErrorMessage(err)}`,
      );
    }
  }

  async disconnectAccount(_accessToken: string, platformAccountId: string): Promise<void> {
    this.logger.log(`Instagram disconnect best-effort for ${platformAccountId}`);
  }
}

function instagramInsightValue(entry: {
  values?: Array<{ value?: number | string }>;
  total_value?: { value?: number | string } | number | string;
}): number | undefined {
  const total =
    typeof entry.total_value === 'object' ? entry.total_value?.value : entry.total_value;
  const raw = total ?? entry.values?.[0]?.value;
  if (raw == null || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function instagramUnavailableMetrics(
  providerPostId: string,
  postUrl: string | null | undefined,
  reason: string,
): NormalizedPostMetrics {
  const unavailable = () => unavailableMetric(reason);
  return {
    platform: 'INSTAGRAM',
    providerPostId,
    postUrl,
    views: unavailable(),
    reach: unavailable(),
    impressions: unavailable(),
    likes: unavailable(),
    comments: unavailable(),
    shares: unavailable(),
    saves: unavailable(),
    watchTimeSeconds: unavailable(),
    averageWatchSeconds: unavailable(),
    completionRate: unavailable(),
    followersGained: unavailable(),
    metricSource: 'PROVIDER_API',
    platformNotes: {
      permission:
        'Instagram returns no media insights when the Professional account or token lacks insights permission.',
    },
    raw: truncateRawProviderResponse({ error: reason }),
  };
}
