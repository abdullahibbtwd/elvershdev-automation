import axios from 'axios';
import { open as openFile } from 'node:fs/promises';
import type {
  PublishStatusResult,
  PublishVideoInput,
  PublishVideoResult,
  SocialPlatformKey,
  TokenBundle,
} from '@ai-video/shared';

function truthy(value: unknown): boolean {
  return value === true || value === 'true' || value === '1';
}

export function shouldUseSocialMock(platform: SocialPlatformKey): boolean {
  if (truthy(process.env.SOCIAL_USE_MOCK) || truthy(process.env.USE_MOCK)) return true;
  const flags: Record<SocialPlatformKey, string | undefined> = {
    FACEBOOK: process.env.FACEBOOK_USE_MOCK,
    INSTAGRAM: process.env.INSTAGRAM_USE_MOCK,
    TIKTOK: process.env.TIKTOK_USE_MOCK,
    YOUTUBE: process.env.YOUTUBE_USE_MOCK,
  };
  if (truthy(flags[platform])) return true;

  const configured: Record<SocialPlatformKey, boolean> = {
    FACEBOOK: Boolean(process.env.FACEBOOK_APP_ID && process.env.FACEBOOK_APP_SECRET),
    INSTAGRAM: Boolean(
      (process.env.INSTAGRAM_APP_ID || process.env.FACEBOOK_APP_ID) &&
        (process.env.INSTAGRAM_APP_SECRET || process.env.FACEBOOK_APP_SECRET),
    ),
    TIKTOK: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
    YOUTUBE: Boolean(process.env.YOUTUBE_CLIENT_ID && process.env.YOUTUBE_CLIENT_SECRET),
  };
  return !configured[platform];
}

function mockPublish(platform: SocialPlatformKey, accountId: string): PublishVideoResult {
  const id = `mock-${platform.toLowerCase()}-${accountId.slice(0, 12) || 'acct'}`;
  const urls: Record<SocialPlatformKey, string> = {
    FACEBOOK: `https://www.facebook.com/reel/${id}`,
    INSTAGRAM: `https://www.instagram.com/reel/${id}/`,
    TIKTOK: `https://www.tiktok.com/@mock/video/${id}`,
    YOUTUBE: `https://www.youtube.com/watch?v=${id}`,
  };
  return {
    phase: 'processing',
    providerUploadId: id,
    providerPublishId: id,
    providerPostId: id,
    postUrl: urls[platform],
    uploadProgress: 100,
    requiresStatusPoll: true,
    pollAfterMs: 2_000,
    raw: { mock: true },
  };
}

function mockStatus(platform: SocialPlatformKey, postId: string): PublishStatusResult {
  const urls: Record<SocialPlatformKey, string> = {
    FACEBOOK: `https://www.facebook.com/reel/${postId}`,
    INSTAGRAM: `https://www.instagram.com/reel/${postId}/`,
    TIKTOK: `https://www.tiktok.com/@mock/video/${postId}`,
    YOUTUBE: `https://www.youtube.com/watch?v=${postId}`,
  };
  return {
    phase: 'published',
    providerPostId: postId,
    postUrl: urls[platform],
    uploadProgress: 100,
    requiresStatusPoll: false,
    raw: { mock: true },
  };
}

function buildCaption(input: PublishVideoInput): string {
  const base = (input.caption ?? input.description ?? input.title ?? '').trim();
  const lower = base.toLowerCase();
  const tags = (input.hashtags ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (t.startsWith('#') ? t : `#${t}`))
    .filter((t) => !lower.includes(t.toLowerCase()));
  if (!tags.length) return base;
  return base ? `${base}\n\n${tags.join(' ')}` : tags.join(' ');
}

function formatSocialAxiosError(error: unknown): Error {
  if (!axios.isAxiosError(error)) {
    return error instanceof Error ? error : new Error(String(error));
  }
  const data = error.response?.data as
    | {
        error?: { message?: string; code?: number | string; error_user_msg?: string; type?: string };
        message?: string;
        code?: string;
      }
    | undefined;
  const metaMessage =
    data?.error?.error_user_msg || data?.error?.message || data?.message || data?.error?.code;
  const tiktokMessage =
    typeof data === 'object' && data && 'error' in data
      ? (data as { error?: { message?: string; code?: string } }).error?.message ||
        (data as { error?: { code?: string } }).error?.code
      : undefined;
  const detail = metaMessage || tiktokMessage;
  const status = error.response?.status;
  const message = detail
    ? `Social API ${status ?? 'error'}: ${detail}`
    : error.message;
  return Object.assign(new Error(message), {
    code: error.code ?? data?.error?.code ?? data?.code ?? 'SOCIAL_API_ERROR',
    status,
    responseData: data,
  });
}

async function withSocialErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw formatSocialAxiosError(error);
  }
}

async function resolveFacebookPageAccessToken(
  pageId: string,
  accessToken: string,
): Promise<string> {
  const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
  const base = `https://graph.facebook.com/${version}`;
  // System-user / user tokens often need the Page's own access_token for /videos.
  const page = await axios.get(`${base}/${pageId}`, {
    params: { fields: 'id,access_token', access_token: accessToken },
    validateStatus: () => true,
  });
  if (typeof page.data?.access_token === 'string' && page.data.access_token) {
    return page.data.access_token;
  }
  return accessToken;
}

async function publishFacebookPageVideo(input: PublishVideoInput): Promise<PublishVideoResult> {
  const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
  const base = `https://graph.facebook.com/${version}`;
  const pageId = input.platformAccountId;
  const description = buildCaption(input);
  const pageToken = await resolveFacebookPageAccessToken(pageId, input.accessToken);
  const { readFile } = await import('node:fs/promises');
  const bytes = await readFile(input.localFilePath!);
  const form = new FormData();
  form.append('description', description);
  if (input.title) form.append('title', input.title);
  form.append('published', 'true');
  form.append(
    'source',
    new Blob([bytes], { type: input.mimeType ?? 'video/mp4' }),
    'video.mp4',
  );

  const uploaded = await axios.post(`${base}/${pageId}/videos`, form, {
    params: { access_token: pageToken },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 600_000,
  });

  const videoId = uploaded.data?.id as string | undefined;
  if (!videoId) {
    throw new Error('Facebook page video upload did not return an id');
  }

  return {
    phase: 'processing',
    providerUploadId: videoId,
    providerPublishId: videoId,
    providerPostId: videoId,
    postUrl: `https://www.facebook.com/${pageId}/videos/${videoId}`,
    uploadProgress: 100,
    requiresStatusPoll: true,
    pollAfterMs: 5_000,
    raw: { mode: 'page_videos' },
  };
}

async function publishFacebook(input: PublishVideoInput): Promise<PublishVideoResult> {
  return withSocialErrors(async () => {
    const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
    const base = `https://graph.facebook.com/${version}`;
    const pageId = input.platformAccountId;
    const description = buildCaption(input);

    if (!input.localFilePath) {
      throw new Error('Facebook publish requires localFilePath');
    }

    // Prefer Reels when the token allows it; otherwise fall back to classic Page videos
    // (pages_manage_posts) so publish still works without pages_show_list.
    try {
      const start = await axios.post(`${base}/${pageId}/video_reels`, null, {
        params: {
          upload_phase: 'start',
          access_token: input.accessToken,
        },
      });

      const videoId = start.data?.video_id as string | undefined;
      const uploadUrl = start.data?.upload_url as string | undefined;
      if (!videoId || !uploadUrl) {
        throw new Error('Facebook video_reels start did not return video_id/upload_url');
      }

      const { createReadStream } = await import('node:fs');
      await axios.post(uploadUrl, createReadStream(input.localFilePath), {
        headers: {
          Authorization: `OAuth ${input.accessToken}`,
          offset: '0',
          file_size: String(input.fileSizeBytes ?? 0),
          'Content-Type': input.mimeType ?? 'video/mp4',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600_000,
      });

      await axios.post(`${base}/${pageId}/video_reels`, null, {
        params: {
          upload_phase: 'finish',
          video_id: videoId,
          video_state: 'PUBLISHED',
          description,
          title: input.title,
          access_token: input.accessToken,
        },
      });

      return {
        phase: 'processing',
        providerUploadId: videoId,
        providerPublishId: videoId,
        providerPostId: videoId,
        postUrl: `https://www.facebook.com/reel/${videoId}`,
        uploadProgress: 100,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: { mode: 'video_reels' },
      };
    } catch (error) {
      const message = axios.isAxiosError(error)
        ? String(error.response?.data?.error?.message ?? error.message)
        : error instanceof Error
          ? error.message
          : String(error);
      const missingShowList =
        /pages_show_list/i.test(message) ||
        (axios.isAxiosError(error) && error.response?.status === 403);
      if (!missingShowList) throw error;
      return publishFacebookPageVideo(input);
    }
  });
}

async function publishInstagram(input: PublishVideoInput): Promise<PublishVideoResult> {
  return withSocialErrors(async () => {
    const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
    const base = `https://graph.facebook.com/${version}`;
    const igId = input.platformAccountId;
    const caption = buildCaption(input);

    if (input.localFilePath) {
      const init = await axios.post(`${base}/${igId}/media`, null, {
        params: {
          media_type: 'REELS',
          upload_type: 'resumable',
          caption,
          access_token: input.accessToken,
          ...(input.platformSettings?.isAiGenerated != null
            ? { is_ai_generated: Boolean(input.platformSettings.isAiGenerated) }
            : {}),
        },
      });
      const containerId = init.data?.id as string | undefined;
      if (!containerId) throw new Error('Instagram resumable init missing container id');

      // Meta returns a versioned rupload URI; prefer that over a hand-built path.
      const uploadUri =
        (typeof init.data?.uri === 'string' && init.data.uri) ||
        `https://rupload.facebook.com/ig-api-upload/${version}/${containerId}`;

      // rupload requires Content-Length + X-Entity-Length (streams omit Content-Length).
      const { readFile } = await import('node:fs/promises');
      const bytes = await readFile(input.localFilePath);
      const fileSize = String(input.fileSizeBytes ?? bytes.length);
      await axios.post(uploadUri, bytes, {
        headers: {
          Authorization: `OAuth ${input.accessToken}`,
          offset: '0',
          file_size: fileSize,
          'Content-Length': fileSize,
          'X-Entity-Length': fileSize,
          'X-Entity-Name': 'video.mp4',
          'X-Entity-Type': input.mimeType ?? 'video/mp4',
          'Content-Type': 'application/octet-stream',
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600_000,
      });

      return {
        phase: 'processing',
        providerUploadId: containerId,
        providerPublishId: containerId,
        uploadProgress: 80,
        requiresStatusPoll: true,
        pollAfterMs: 5_000,
        raw: { awaitingContainer: true, uploadUri },
      };
    }

    if (!input.mediaUrl) {
      throw new Error('Instagram publish requires localFilePath or a public mediaUrl');
    }

    const container = await axios.post(`${base}/${igId}/media`, null, {
      params: {
        media_type: 'REELS',
        video_url: input.mediaUrl,
        caption,
        access_token: input.accessToken,
      },
    });
    const containerId = container.data?.id as string | undefined;
    if (!containerId) throw new Error('Instagram container creation failed');

    return {
      phase: 'processing',
      providerUploadId: containerId,
      providerPublishId: containerId,
      uploadProgress: 50,
      requiresStatusPoll: true,
      pollAfterMs: 5_000,
      raw: { awaitingContainer: true },
    };
  });
}

async function finishInstagramPublish(
  accessToken: string,
  igId: string,
  containerId: string,
): Promise<PublishStatusResult> {
  const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
  const base = `https://graph.facebook.com/${version}`;

  const status = await axios.get(`${base}/${containerId}`, {
    params: { fields: 'status_code,status', access_token: accessToken },
  });
  const code = String(status.data?.status_code ?? '').toUpperCase();

  if (code === 'ERROR' || code === 'EXPIRED') {
    return {
      phase: 'failed',
      errorCode: 'INSTAGRAM_CONTAINER_FAILED',
      errorMessage: status.data?.status ?? `Container status ${code}`,
      requiresStatusPoll: false,
    };
  }

  if (code !== 'FINISHED' && code !== 'PUBLISHED') {
    return {
      phase: 'processing',
      providerPublishId: containerId,
      requiresStatusPoll: true,
      pollAfterMs: 5_000,
      raw: status.data,
    };
  }

  const published = await axios.post(
    `${base}/${igId}/media_publish`,
    null,
    { params: { creation_id: containerId, access_token: accessToken } },
  );
  const mediaId = published.data?.id as string | undefined;
  return {
    phase: 'published',
    providerPostId: mediaId ?? containerId,
    providerPublishId: containerId,
    postUrl: mediaId ? `https://www.instagram.com/reel/${mediaId}/` : undefined,
    uploadProgress: 100,
    requiresStatusPoll: false,
  };
}

async function publishTikTok(input: PublishVideoInput): Promise<PublishVideoResult> {
  return withSocialErrors(async () => {
  if (!input.localFilePath) {
    throw new Error(
      'TikTok Direct Post uses FILE_UPLOAD and requires localFilePath (PULL_FROM_URL needs a verified domain)',
    );
  }

  const audited = truthy(process.env.TIKTOK_AUDITED);
  const headers = {
    Authorization: `Bearer ${input.accessToken}`,
    'Content-Type': 'application/json; charset=UTF-8',
  };

  // TikTok requires creator_info/query before each Direct Post.
  const creator = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/creator_info/query/',
    {},
    { headers },
  );
  if (creator.data?.error?.code && creator.data.error.code !== 'ok') {
    throw new Error(creator.data.error.message || 'TikTok creator_info query failed');
  }
  const privacyOptions = Array.isArray(creator.data?.data?.privacy_level_options)
    ? (creator.data.data.privacy_level_options as string[])
    : [];

  const requestedPrivacy = String(
    input.platformSettings?.privacyStatus ?? (audited ? 'PUBLIC_TO_EVERYONE' : 'SELF_ONLY'),
  );
  let privacyLevel = audited ? requestedPrivacy : 'SELF_ONLY';
  if (privacyOptions.length > 0 && !privacyOptions.includes(privacyLevel)) {
    privacyLevel = privacyOptions.includes('SELF_ONLY')
      ? 'SELF_ONLY'
      : privacyOptions[0];
  }

  const fileSize = input.fileSizeBytes ?? 0;
  const chunkSize = fileSize < 5 * 1024 * 1024 ? fileSize : Math.min(10 * 1024 * 1024, fileSize);
  const totalChunkCount = Math.max(1, Math.ceil(fileSize / Math.max(chunkSize, 1)));

  const init = await axios.post(
    'https://open.tiktokapis.com/v2/post/publish/video/init/',
    {
      post_info: {
        title: (input.title ?? buildCaption(input)).slice(0, 2200),
        privacy_level: privacyLevel,
        disable_duet: Boolean(input.platformSettings?.disableDuet ?? false),
        disable_comment: Boolean(input.platformSettings?.disableComment ?? false),
        disable_stitch: Boolean(input.platformSettings?.disableStitch ?? false),
        brand_content_toggle: Boolean(input.platformSettings?.brandContentToggle ?? false),
        brand_organic_toggle: Boolean(input.platformSettings?.brandOrganicToggle ?? false),
        is_aigc: Boolean(input.platformSettings?.isAigc ?? true),
        ...(input.platformSettings?.thumbOffsetMs != null
          ? { video_cover_timestamp_ms: Number(input.platformSettings.thumbOffsetMs) }
          : {}),
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: fileSize,
        chunk_size: chunkSize,
        total_chunk_count: totalChunkCount,
      },
    },
    { headers },
  );

  if (init.data?.error?.code && init.data.error.code !== 'ok') {
    const code = String(init.data.error.code);
    const message = init.data.error.message || 'TikTok init failed';
    if (code === 'unaudited_client_can_only_post_to_private_accounts') {
      throw new Error(
        `${message} (privacy=${privacyLevel}; set TIKTOK_AUDITED=true after TikTok approves video.publish, or keep SELF_ONLY / private account)`,
      );
    }
    throw new Error(`${code}: ${message}`);
  }

  const publishId = init.data?.data?.publish_id as string | undefined;
  const uploadUrl = init.data?.data?.upload_url as string | undefined;
  if (!publishId || !uploadUrl) {
    throw new Error('TikTok init missing publish_id/upload_url');
  }

  const handle = await openFile(input.localFilePath, 'r');
  try {
    let offset = 0;
    while (offset < fileSize) {
      const length = Math.min(chunkSize, fileSize - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const payload = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
      const end = offset + payload.length - 1;
      await axios.put(uploadUrl, payload, {
        headers: {
          'Content-Type': input.mimeType ?? 'video/mp4',
          'Content-Length': String(payload.length),
          'Content-Range': `bytes ${offset}-${end}/${fileSize}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600_000,
      });
      offset += payload.length;
    }
  } finally {
    await handle.close();
  }

  return {
    phase: 'processing',
    providerUploadId: publishId,
    providerPublishId: publishId,
    uploadProgress: 100,
    requiresStatusPoll: true,
    pollAfterMs: 5_000,
    raw: { privacyLevel, audited },
  };
  });
}

async function publishYouTube(input: PublishVideoInput): Promise<PublishVideoResult> {
  if (!input.localFilePath) {
    throw new Error('YouTube uploads require localFilePath for resumable videos.insert');
  }

  const privacyStatus = String(input.platformSettings?.privacyStatus ?? 'private').toLowerCase();
  const privacy =
    privacyStatus === 'public' || privacyStatus === 'unlisted' || privacyStatus === 'private'
      ? privacyStatus
      : 'private';

  const title = (input.title ?? 'Untitled').slice(0, 100);
  const description = buildCaption(input).slice(0, 5000);
  const mimeType = input.mimeType ?? 'video/mp4';
  const fileSize = input.fileSizeBytes ?? 0;

  const init = await axios.post(
    'https://www.googleapis.com/upload/youtube/v3/videos',
    {
      snippet: {
        title,
        description,
        categoryId: String(input.platformSettings?.categoryId ?? '22'),
      },
      status: {
        privacyStatus: privacy,
        selfDeclaredMadeForKids: Boolean(input.platformSettings?.madeForKids ?? false),
      },
    },
    {
      params: { uploadType: 'resumable', part: 'snippet,status' },
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Type': mimeType,
        'X-Upload-Content-Length': String(fileSize),
      },
    },
  );

  const uploadUrl = init.headers.location as string | undefined;
  if (!uploadUrl) throw new Error('YouTube resumable init missing Location');

  const chunkSize = 8 * 1024 * 1024;
  const handle = await openFile(input.localFilePath, 'r');
  let videoId: string | undefined;
  try {
    let offset = 0;
    while (offset < fileSize) {
      const length = Math.min(chunkSize, fileSize - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const payload = bytesRead === length ? buffer : buffer.subarray(0, bytesRead);
      const start = offset;
      const end = offset + payload.length - 1;
      const res = await axios.put(uploadUrl, payload, {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': mimeType,
          'Content-Length': String(payload.length),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600_000,
        validateStatus: (s) => s === 200 || s === 201 || s === 308,
      });
      if (end >= fileSize - 1 && (res.status === 200 || res.status === 201)) {
        videoId = res.data?.id;
        break;
      }
      offset += payload.length;
    }
  } finally {
    await handle.close();
  }

  if (!videoId) throw new Error('YouTube upload completed without video id');

  return {
    phase: 'processing',
    providerUploadId: videoId,
    providerPublishId: videoId,
    providerPostId: videoId,
    postUrl: `https://www.youtube.com/watch?v=${videoId}`,
    uploadProgress: 100,
    requiresStatusPoll: true,
    pollAfterMs: 5_000,
  };
}

export async function publishVideoToPlatform(
  platform: SocialPlatformKey,
  input: PublishVideoInput,
  opts?: { useMock?: boolean },
): Promise<PublishVideoResult> {
  if (opts?.useMock || shouldUseSocialMock(platform)) {
    return mockPublish(platform, input.platformAccountId);
  }
  switch (platform) {
    case 'FACEBOOK':
      return publishFacebook(input);
    case 'INSTAGRAM':
      return publishInstagram(input);
    case 'TIKTOK':
      return publishTikTok(input);
    case 'YOUTUBE':
      return publishYouTube(input);
    default:
      throw new Error(`Unsupported platform ${platform}`);
  }
}

export async function getPlatformPublishStatus(
  platform: SocialPlatformKey,
  input: {
    accessToken: string;
    platformAccountId: string;
    providerUploadId?: string | null;
    providerPublishId?: string | null;
    providerPostId?: string | null;
  },
  opts?: { useMock?: boolean },
): Promise<PublishStatusResult> {
  const id = input.providerPostId ?? input.providerPublishId ?? input.providerUploadId ?? '';
  if (opts?.useMock || shouldUseSocialMock(platform) || id.startsWith('mock-')) {
    return mockStatus(platform, id || `mock-${platform.toLowerCase()}`);
  }

  if (platform === 'INSTAGRAM' && input.providerPublishId && !input.providerPostId) {
    return finishInstagramPublish(
      input.accessToken,
      input.platformAccountId,
      input.providerPublishId,
    );
  }

  if (platform === 'TIKTOK') {
    const publishId = input.providerPublishId ?? input.providerUploadId;
    if (!publishId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_PUBLISH_ID',
        errorMessage: 'TikTok publish_id required',
        requiresStatusPoll: false,
      };
    }
    const res = await axios.post(
      'https://open.tiktokapis.com/v2/post/publish/status/fetch/',
      { publish_id: publishId },
      {
        headers: {
          Authorization: `Bearer ${input.accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
        },
      },
    );
    const status = String(res.data?.data?.status ?? '').toUpperCase();
    if (status === 'FAILED') {
      return {
        phase: 'failed',
        errorCode: 'TIKTOK_PUBLISH_FAILED',
        errorMessage: res.data?.data?.fail_reason || 'TikTok publish failed',
        requiresStatusPoll: false,
        raw: res.data?.data,
      };
    }
    if (status === 'PUBLISH_COMPLETE') {
      return {
        phase: 'published',
        providerPostId: publishId,
        providerPublishId: publishId,
        uploadProgress: 100,
        requiresStatusPoll: false,
        raw: res.data?.data,
      };
    }
    return {
      phase: 'processing',
      providerPublishId: publishId,
      requiresStatusPoll: true,
      pollAfterMs: 5_000,
      raw: res.data?.data,
    };
  }

  if (platform === 'YOUTUBE') {
    const videoId = input.providerPostId ?? input.providerPublishId ?? input.providerUploadId;
    if (!videoId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_VIDEO_ID',
        errorMessage: 'YouTube video id required',
        requiresStatusPoll: false,
      };
    }
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { part: 'status,processingDetails', id: videoId },
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const item = res.data?.items?.[0];
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
    if (uploadStatus === 'rejected' || uploadStatus === 'failed' || processingStatus === 'failed') {
      return {
        phase: 'failed',
        providerPostId: videoId,
        errorCode: 'YOUTUBE_FAILED',
        errorMessage:
          item.status?.rejectionReason ||
          item.processingDetails?.processingFailureReason ||
          'YouTube processing failed',
        requiresStatusPoll: false,
      };
    }
    if (uploadStatus === 'processed' || processingStatus === 'succeeded') {
      return {
        phase: 'published',
        providerPostId: videoId,
        postUrl: `https://www.youtube.com/watch?v=${videoId}`,
        uploadProgress: 100,
        requiresStatusPoll: false,
      };
    }
    return {
      phase: 'processing',
      providerPostId: videoId,
      postUrl: `https://www.youtube.com/watch?v=${videoId}`,
      requiresStatusPoll: true,
      pollAfterMs: 5_000,
    };
  }

  if (platform === 'FACEBOOK') {
    const videoId = input.providerPostId ?? input.providerPublishId ?? input.providerUploadId;
    if (!videoId) {
      return {
        phase: 'failed',
        errorCode: 'MISSING_VIDEO_ID',
        errorMessage: 'Facebook video id required',
        requiresStatusPoll: false,
      };
    }
    const version = process.env.FACEBOOK_GRAPH_VERSION ?? 'v22.0';
    const res = await axios.get(`https://graph.facebook.com/${version}/${videoId}`, {
      params: {
        fields: 'id,permalink_url,status',
        access_token: input.accessToken,
      },
    });
    return {
      phase: 'published',
      providerPostId: videoId,
      postUrl: res.data?.permalink_url ?? `https://www.facebook.com/reel/${videoId}`,
      uploadProgress: 100,
      requiresStatusPoll: false,
      raw: res.data,
    };
  }

  return {
    phase: 'published',
    providerPostId: id,
    uploadProgress: 100,
    requiresStatusPoll: false,
  };
}

export async function refreshPlatformToken(
  platform: SocialPlatformKey,
  refreshToken: string,
): Promise<TokenBundle | null> {
  if (shouldUseSocialMock(platform)) {
    return {
      accessToken: `mock-${platform.toLowerCase()}-refreshed`,
      refreshToken,
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  if (platform === 'YOUTUBE') {
    const body = new URLSearchParams({
      client_id: process.env.YOUTUBE_CLIENT_ID ?? '',
      client_secret: process.env.YOUTUBE_CLIENT_SECRET ?? '',
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });
    const res = await axios.post('https://oauth2.googleapis.com/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token ?? refreshToken,
      expiresAt: res.data.expires_in
        ? new Date(Date.now() + res.data.expires_in * 1000)
        : null,
    };
  }

  if (platform === 'TIKTOK') {
    const body = new URLSearchParams({
      client_key: process.env.TIKTOK_CLIENT_KEY ?? '',
      client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '',
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    });
    const res = await axios.post('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token ?? refreshToken,
      expiresAt: res.data.expires_in
        ? new Date(Date.now() + res.data.expires_in * 1000)
        : null,
    };
  }

  // Meta long-lived page tokens typically do not refresh via refresh_token
  return null;
}
