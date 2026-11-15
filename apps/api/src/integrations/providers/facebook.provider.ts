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
  META_PAGE_SCOPES,
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

@Injectable()
export class FacebookProvider extends BaseProvider implements SocialPublishingProvider {
  readonly platform = 'FACEBOOK' as const;
  private readonly logger = new Logger(FacebookProvider.name);

  constructor(
    private readonly config: ConfigService,
    private readonly http: HttpClientService,
  ) {
    super();
  }

  isConfigured(): boolean {
    const oauthConfigured = Boolean(
      this.config.get<string>('integrations.facebookAppId') &&
        this.config.get<string>('integrations.facebookAppSecret'),
    );
    const pageTokenConfigured = Boolean(
      this.config.get<string>('integrations.facebookPageAccessToken') &&
        this.config.get<string>('integrations.facebookPageId'),
    );
    return oauthConfigured || pageTokenConfigured;
  }

  shouldUseMock(): boolean {
    return resolveSocialShouldUseMock({
      config: this.config,
      platformUseMockKey: 'integrations.facebookUseMock',
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
      this.config.get<string>('integrations.facebookAppId'),
      'FACEBOOK_APP_ID',
    );
  }

  private appSecret(): string {
    return this.assertConfigured(
      this.config.get<string>('integrations.facebookAppSecret'),
      'FACEBOOK_APP_SECRET',
    );
  }

  private defaultRedirectUri(): string {
    return (
      this.config.get<string>('integrations.facebookRedirectUri') ??
      'http://localhost:3000/api/channels/facebook/callback'
    );
  }

  getAuthorizationUrl(params: AuthorizationUrlParams): string {
    const version = this.graphVersion();
    const clientId = this.shouldUseMock()
      ? (this.config.get<string>('integrations.facebookAppId') ?? 'mock-facebook-app')
      : this.appId();
    const redirectUri = params.redirectUri || this.defaultRedirectUri();
    const scopes = (params.scopes?.length ? params.scopes : [...META_PAGE_SCOPES]).join(',');
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
        accessToken: 'mock-facebook-user-token',
        refreshToken: null,
        expiresAt: new Date(Date.now() + 60 * 24 * 3600 * 1000),
        scopes: [...META_PAGE_SCOPES],
      };
      return {
        tokens,
        accounts: [
          {
            platformAccountId: 'mock-fb-page-1',
            displayName: 'Mock Facebook Page',
            username: 'mock_fb_page',
            profileImageUrl: null,
            accountType: 'page',
            grantedScopes: [...META_PAGE_SCOPES],
            metadata: { pageAccessToken: 'mock-facebook-page-token' },
          },
        ],
      };
    }

    const client = this.http.create(this.graphBase());
    const redirectUri = params.redirectUri || this.defaultRedirectUri();

    const shortLived = await client.get<{
      access_token: string;
      token_type?: string;
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
      token_type?: string;
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
    const accountsRes = await client.get<{
      data?: Array<{
        id: string;
        name?: string;
        access_token?: string;
        picture?: { data?: { url?: string } };
        tasks?: string[];
      }>;
    }>('/me/accounts', {
      params: {
        access_token: userToken,
        fields: 'id,name,access_token,picture{url},tasks',
      },
    });

    const pages = accountsRes.data.data ?? [];
    if (!pages.length) {
      this.logger.warn('Facebook OAuth succeeded but no Pages were returned for this user');
    }

    const accounts: ConnectedAccountInfo[] = pages.map((page) => ({
      platformAccountId: page.id,
      displayName: page.name ?? page.id,
      username: null,
      profileImageUrl: page.picture?.data?.url ?? null,
      accountType: 'page',
      grantedScopes: [...META_PAGE_SCOPES],
      metadata: {
        pageAccessToken: page.access_token,
        tasks: page.tasks,
      },
    }));

    return {
      tokens: {
        accessToken: userToken,
        refreshToken: null,
        expiresAt: expiresAtFromSeconds(longLived.data.expires_in),
        scopes: [...META_PAGE_SCOPES],
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
        platformAccountId: platformAccountId || 'mock-fb-page-1',
        displayName: 'Mock Facebook Page',
        username: 'mock_fb_page',
        profileImageUrl: null,
        accountType: 'page',
        grantedScopes: [...META_PAGE_SCOPES],
        metadata: { pageAccessToken: accessToken || 'mock-facebook-page-token' },
      };
    }

    const client = this.http.create(this.graphBase());
    const res = await client.get<{
      id: string;
      name?: string;
      picture?: { data?: { url?: string } };
      category?: string;
    }>(`/${platformAccountId}`, {
      params: {
        access_token: accessToken,
        fields: 'id,name,picture{url},category',
      },
    });

    return {
      platformAccountId: res.data.id,
      displayName: res.data.name ?? res.data.id,
      username: null,
      profileImageUrl: res.data.picture?.data?.url ?? null,
      accountType: 'page',
      grantedScopes: [...META_PAGE_SCOPES],
      metadata: { category: res.data.category },
    };
  }

  async getPublishingCapabilities(
    _accessToken: string,
    account: ConnectedAccountInfo,
  ): Promise<PublishingCapabilities> {
    const caps = structuredClone(DEFAULT_CAPABILITIES.FACEBOOK);
    if (account.accountType && account.accountType !== 'page') {
      caps.canPublishVideo = false;
      caps.canPublishPublic = false;
      caps.unsupportedReasons = [
        ...caps.unsupportedReasons,
        'Only Facebook Pages are supported for Reels publishing; personal profiles are not supported.',
      ];
    }
    return caps;
  }

  async publishVideo(input: PublishVideoInput): Promise<PublishVideoResult> {
    if (this.shouldUseMock()) {
      const id = mockId('mock-fb-reel', input.platformAccountId);
      return {
        phase: 'published',
        providerUploadId: id,
        providerPublishId: id,
        providerPostId: id,
        postUrl: `https://www.facebook.com/reel/${id}`,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: { mock: true },
      };
    }

    if (!input.localFilePath) {
      throw new Error(
        'Facebook Reels publishing requires localFilePath for the start/upload/finish video_reels flow.',
      );
    }

    const pageId = input.platformAccountId;
    const accessToken = input.accessToken;
    const client = this.http.create(this.graphBase());
    const fileSize = await getLocalFileSize(input.localFilePath, input.fileSizeBytes);
    const description = buildCaption({
      caption: input.caption,
      description: input.description,
      hashtags: input.hashtags,
    });
    const title = input.title?.trim() || undefined;

    try {
      const start = await client.post<{ video_id: string; upload_url: string }>(
        `/${pageId}/video_reels`,
        {
          upload_phase: 'start',
          access_token: accessToken,
        },
      );

      const videoId = start.data.video_id;
      const uploadUrl = start.data.upload_url;
      if (!videoId || !uploadUrl) {
        throw new Error('Facebook video_reels start did not return video_id/upload_url');
      }

      this.logger.log(`Facebook reel upload started for page ${pageId}`);

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

      const finishParams: Record<string, string> = {
        access_token: accessToken,
        video_id: videoId,
        upload_phase: 'finish',
        video_state: 'PUBLISHED',
      };
      if (description) finishParams.description = description;
      if (title) finishParams.title = title;

      const finish = await client.post<{ success?: boolean; post_id?: string; message?: string }>(
        `/${pageId}/video_reels`,
        null,
        { params: finishParams },
      );

      const postId = finish.data.post_id ?? videoId;
      return {
        phase: 'processing',
        providerUploadId: videoId,
        providerPublishId: postId,
        providerPostId: postId,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: { success: finish.data.success, message: finish.data.message },
      };
    } catch (err) {
      const message = axiosErrorMessage(err, 'Facebook publish failed');
      this.logger.error(`Facebook publish failed for page ${pageId}: ${message}`);
      return {
        phase: 'failed',
        errorCode: 'FACEBOOK_PUBLISH_FAILED',
        errorMessage: message,
        requiresStatusPoll: false,
      };
    }
  }

  async getPublishStatus(input: {
    accessToken: string;
    platformAccountId: string;
    providerUploadId?: string;
    providerPublishId?: string;
    providerPostId?: string;
  }): Promise<PublishStatusResult> {
    const videoId = input.providerUploadId ?? input.providerPostId ?? input.providerPublishId;
    if (this.shouldUseMock() || videoId?.startsWith('mock-fb-')) {
      const id = videoId ?? mockId('mock-fb-reel', input.platformAccountId);
      return {
        phase: 'published',
        providerPostId: id,
        postUrl: `https://www.facebook.com/reel/${id}`,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: { mock: true },
      };
    }

    if (!videoId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_VIDEO_ID',
        errorMessage: 'providerUploadId or providerPostId is required for Facebook status',
        requiresStatusPoll: false,
      };
    }

    try {
      const client = this.http.create(this.graphBase());
      const res = await client.get<{
        id?: string;
        status?: {
          video_status?: string;
          uploading_phase?: { status?: string };
          processing_phase?: { status?: string };
          publishing_phase?: { status?: string; publish_status?: string; post_id?: string };
        };
      }>(`/${videoId}`, {
        params: {
          access_token: input.accessToken,
          fields: 'id,status',
        },
      });

      const status = res.data.status;
      const publishing = status?.publishing_phase;
      const processing = status?.processing_phase;
      const uploading = status?.uploading_phase;
      const postId = publishing?.post_id ?? videoId;

      if (publishing?.publish_status === 'published' || publishing?.status === 'complete') {
        return {
          phase: 'published',
          providerPostId: postId,
          postUrl: `https://www.facebook.com/${postId}`,
          uploadProgress: 100,
          requiresStatusPoll: false,
          raw: status as Record<string, unknown>,
        };
      }

      if (
        status?.video_status === 'error' ||
        processing?.status === 'error' ||
        uploading?.status === 'error' ||
        publishing?.status === 'error'
      ) {
        return {
          phase: 'failed',
          providerPostId: postId,
          errorCode: 'FACEBOOK_VIDEO_ERROR',
          errorMessage: 'Facebook reported an error while processing the reel',
          requiresStatusPoll: false,
          raw: status as Record<string, unknown>,
        };
      }

      const phase =
        uploading?.status === 'in_progress'
          ? 'uploading'
          : processing?.status === 'in_progress'
            ? 'processing'
            : publishing?.status === 'in_progress'
              ? 'publishing'
              : 'processing';

      return {
        phase,
        providerPostId: postId,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: status as Record<string, unknown>,
      };
    } catch (err) {
      return {
        phase: 'failed',
        errorCode: 'FACEBOOK_STATUS_FAILED',
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
    if (this.shouldUseMock() || input.providerPostId.startsWith('mock-fb-')) {
      return {
        providerPostId: input.providerPostId,
        postUrl: `https://www.facebook.com/${input.providerPostId}`,
        title: 'Mock Facebook Reel',
        caption: 'Mock caption',
        raw: { mock: true },
      };
    }

    const client = this.http.create(this.graphBase());
    const res = await client.get<{
      id: string;
      description?: string;
      title?: string;
      permalink_url?: string;
    }>(`/${input.providerPostId}`, {
      params: {
        access_token: input.accessToken,
        fields: 'id,description,title,permalink_url',
      },
    });

    return {
      providerPostId: res.data.id,
      postUrl: res.data.permalink_url,
      title: res.data.title,
      caption: res.data.description,
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
      return mockPostAnalytics('FACEBOOK', input.providerPostId, input.postUrl);
    }

    const client = this.http.create(this.graphBase());
    const [insightsRes, engagementRes] = await Promise.all([
      client.get<{
        data?: Array<{ name?: string; values?: Array<{ value?: number | string }> }>;
      }>(`/${input.providerPostId}/video_insights`, {
        params: {
          access_token: input.accessToken,
          metric: 'total_video_views,total_video_views_unique,total_video_avg_time_watched',
        },
      }),
      client.get<{
        id?: string;
        permalink_url?: string;
        likes?: { summary?: { total_count?: number } };
        comments?: { summary?: { total_count?: number } };
        shares?: { count?: number };
      }>(`/${input.providerPostId}`, {
        params: {
          access_token: input.accessToken,
          fields:
            'id,permalink_url,likes.limit(0).summary(true),comments.limit(0).summary(true),shares',
        },
      }),
    ]);

    const insights = new Map(
      (insightsRes.data.data ?? []).map((entry) => [
        entry.name ?? '',
        numericMetric(entry.values?.[0]?.value),
      ]),
    );
    const views = insights.get('total_video_views');
    const uniqueViews = insights.get('total_video_views_unique');
    const averageWatchMs = insights.get('total_video_avg_time_watched');
    const unavailable = (reason: string, nativeName?: string) =>
      unavailableMetric(reason, { nativeName });
    const countMetric = (value: number | undefined, nativeName: string) =>
      value == null
        ? unavailable(`Facebook did not return ${nativeName} for this video.`, nativeName)
        : availableMetric(value, { nativeName });

    return {
      platform: 'FACEBOOK',
      providerPostId: input.providerPostId,
      postUrl: input.postUrl ?? engagementRes.data.permalink_url ?? null,
      views: countMetric(views, 'total_video_views'),
      reach: countMetric(uniqueViews, 'total_video_views_unique'),
      impressions: unavailable(
        'Facebook video_insights does not return a comparable post impressions metric in this query.',
      ),
      likes: countMetric(
        engagementRes.data.likes?.summary?.total_count,
        'likes.summary.total_count',
      ),
      comments: countMetric(
        engagementRes.data.comments?.summary?.total_count,
        'comments.summary.total_count',
      ),
      shares: countMetric(engagementRes.data.shares?.count, 'shares.count'),
      saves: unavailable('Facebook does not expose Reel saves through these Page video endpoints.'),
      watchTimeSeconds: unavailable(
        'Facebook total watch time was not requested because this endpoint only supplies the required average watch metric.',
      ),
      averageWatchSeconds:
        averageWatchMs == null
          ? unavailable(
              'Facebook did not return total_video_avg_time_watched.',
              'total_video_avg_time_watched',
            )
          : availableMetric(averageWatchMs / 1_000, {
              nativeName: 'total_video_avg_time_watched',
              definition: 'Facebook average time watched converted from milliseconds to seconds.',
            }),
      completionRate: unavailable(
        'Facebook does not return a native completion rate in the requested video_insights metrics.',
      ),
      followersGained: unavailable(
        'Facebook does not expose post-attributed follower gains from these endpoints.',
      ),
      metricSource: 'PROVIDER_API',
      platformNotes: {
        views: 'total_video_views is Facebook video plays under Facebook’s native view definition.',
        reach: 'total_video_views_unique is used as unique video viewers, not account reach.',
        watch:
          'total_video_avg_time_watched is returned in milliseconds and normalized to seconds.',
      },
      raw: truncateRawProviderResponse({
        insights: insightsRes.data,
        engagement: engagementRes.data,
      }),
    };
  }

  async disconnectAccount(_accessToken: string, platformAccountId: string): Promise<void> {
    this.logger.log(`Facebook disconnect best-effort for page ${platformAccountId}`);
  }
}

function numericMetric(value: number | string | undefined): number | undefined {
  if (value == null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
