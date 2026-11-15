/**
 * Server-to-server connectivity check for Meta / TikTok / YouTube.
 * Never prints secret values — only status, IDs, and safe provider messages.
 *
 * Usage:
 *   pnpm --filter @ai-video/api exec ts-node -r tsconfig-paths/register scripts/verify-social-connectivity.ts
 */
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import axios, { type AxiosError } from 'axios';

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env'), override: true });

type CheckStatus = 'ok' | 'skip' | 'fail' | 'warn';

interface CheckResult {
  platform: string;
  check: string;
  status: CheckStatus;
  detail: string;
}

const results: CheckResult[] = [];

function present(value: string | undefined): boolean {
  return Boolean(value && value.trim().length > 0);
}

function push(platform: string, check: string, status: CheckStatus, detail: string) {
  results.push({ platform, check, status, detail });
  const icon = status === 'ok' ? '✓' : status === 'fail' ? '✗' : status === 'warn' ? '!' : '·';
  console.log(`[${icon}] ${platform} / ${check}: ${detail}`);
}

function axiosDetail(err: unknown): string {
  const ax = err as AxiosError<{ error?: { message?: string; code?: number }; error_description?: string }>;
  const data = ax.response?.data;
  if (data && typeof data === 'object') {
    if (typeof data.error?.message === 'string') {
      return `HTTP ${ax.response?.status ?? '?'}: ${data.error.message}${
        data.error.code != null ? ` (code ${data.error.code})` : ''
      }`;
    }
    if (typeof data.error_description === 'string') {
      return `HTTP ${ax.response?.status ?? '?'}: ${data.error_description}`;
    }
  }
  return ax.message || (err instanceof Error ? err.message : 'unknown error');
}

async function verifyMeta() {
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v22.0';
  const base = `https://graph.facebook.com/${graphVersion}`;
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
  const igId = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();

  push(
    'META',
    'env',
    present(pageToken) && present(pageId)
      ? 'ok'
      : present(appId) && present(appSecret)
        ? 'warn'
        : 'fail',
    present(pageToken) && present(pageId)
      ? `Page token + page ID set (token len=${pageToken!.length}, pageId=${pageId})`
      : present(appId) && present(appSecret)
        ? 'OAuth app credentials set, but FACEBOOK_PAGE_ACCESS_TOKEN / FACEBOOK_PAGE_ID missing for S2S'
        : 'Missing Meta credentials',
  );

  if (!present(pageToken) || !present(pageId)) {
    push('META', 'facebook_page', 'skip', 'Skipped — need FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID');
    push('META', 'instagram', 'skip', 'Skipped — need page token + INSTAGRAM_ACCOUNT_ID');
    return;
  }

  try {
    const page = await axios.get<{ id?: string; name?: string; access_token?: string }>(
      `${base}/${pageId}`,
      {
        params: {
          fields: 'id,name',
          access_token: pageToken,
        },
        timeout: 20_000,
      },
    );
    push(
      'META',
      'facebook_page',
      page.data.id === pageId ? 'ok' : 'warn',
      `Graph page reachable: id=${page.data.id ?? '?'} name=${page.data.name ?? '?'}`,
    );
  } catch (err) {
    push('META', 'facebook_page', 'fail', axiosDetail(err));
  }

  if (!present(igId)) {
    push('META', 'instagram', 'skip', 'INSTAGRAM_ACCOUNT_ID not set');
    return;
  }

  try {
    const ig = await axios.get<{
      id?: string;
      username?: string;
      name?: string;
    }>(`${base}/${igId}`, {
      params: {
        fields: 'id,username,name',
        access_token: pageToken,
      },
      timeout: 20_000,
    });
    push(
      'META',
      'instagram',
      ig.data.id === igId ? 'ok' : 'warn',
      `IG account reachable: id=${ig.data.id ?? '?'} @${ig.data.username ?? '?'} name=${ig.data.name ?? '?'}`,
    );
  } catch (err) {
    push('META', 'instagram', 'fail', axiosDetail(err));
  }

  // Soft check: Page → linked Instagram Business account
  try {
    const edge = await axios.get<{
      instagram_business_account?: { id?: string; username?: string };
    }>(`${base}/${pageId}`, {
      params: {
        fields: 'instagram_business_account{id,username}',
        access_token: pageToken,
      },
      timeout: 20_000,
    });
    const linkedId = edge.data.instagram_business_account?.id;
    const linkedUser = edge.data.instagram_business_account?.username;
    push(
      'META',
      'page_ig_link',
      linkedId === igId ? 'ok' : linkedId ? 'warn' : 'fail',
      linkedId === igId
        ? `Page linked to INSTAGRAM_ACCOUNT_ID (@${linkedUser ?? '?'})`
        : linkedId
          ? `Page linked to IG ${linkedId} (@${linkedUser ?? '?'}), env expects ${igId}`
          : 'Page has no instagram_business_account (or token lacks pages_read_engagement / pages_show_list)',
    );
  } catch (err) {
    push('META', 'page_ig_link', 'warn', axiosDetail(err));
  }
}

async function verifyTikTok() {
  const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();

  if (!present(clientKey) || !present(clientSecret)) {
    push(
      'TIKTOK',
      'env',
      'fail',
      'TIKTOK_CLIENT_KEY / TIKTOK_CLIENT_SECRET are empty — fill them in .env (and apps/api/.env)',
    );
    push('TIKTOK', 'client_token', 'skip', 'Skipped — client credentials missing');
    push(
      'TIKTOK',
      'publish_ready',
      'skip',
      'Publishing still needs a user OAuth once (video.publish). Client credentials alone cannot post.',
    );
    return;
  }

  push('TIKTOK', 'env', 'ok', `Client key/secret set (key len=${clientKey!.length})`);

  try {
    const body = new URLSearchParams({
      client_key: clientKey!,
      client_secret: clientSecret!,
      grant_type: 'client_credentials',
    });
    const res = await axios.post<{
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    }>('https://open.tiktokapis.com/v2/oauth/token/', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20_000,
    });

    if (res.data.access_token) {
      push(
        'TIKTOK',
        'client_token',
        'ok',
        `Client credentials grant OK (expires_in=${res.data.expires_in ?? '?'})`,
      );
    } else {
      push(
        'TIKTOK',
        'client_token',
        'fail',
        res.data.error_description || res.data.error || 'No access_token in response',
      );
    }
  } catch (err) {
    push('TIKTOK', 'client_token', 'fail', axiosDetail(err));
  }

  push(
    'TIKTOK',
    'publish_ready',
    'warn',
    process.env.TIKTOK_AUDITED === 'true'
      ? 'App marked audited; still need a connected user channel with video.publish scope'
      : 'TIKTOK_AUDITED!=true → public posting forced SELF_ONLY until TikTok audits the app',
  );
}

async function verifyYouTube() {
  const clientId = process.env.YOUTUBE_CLIENT_ID?.trim();
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET?.trim();
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN?.trim();
  const redirectUri = process.env.YOUTUBE_REDIRECT_URI?.trim();

  if (!present(clientId) || !present(clientSecret)) {
    push(
      'YOUTUBE',
      'env',
      'fail',
      'YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET are empty — fill them in .env (and apps/api/.env)',
    );
    push('YOUTUBE', 'token_refresh', 'skip', 'Skipped — OAuth client missing');
    return;
  }

  push(
    'YOUTUBE',
    'env',
    'ok',
    `OAuth client set; redirect=${redirectUri || '(default localhost callback)'}`,
  );

  if (!present(refreshToken)) {
    push(
      'YOUTUBE',
      'token_refresh',
      'warn',
      'No YOUTUBE_REFRESH_TOKEN — complete one offline OAuth connect, then store refresh token for S2S uploads',
    );
    return;
  }

  try {
    const body = new URLSearchParams({
      client_id: clientId!,
      client_secret: clientSecret!,
      refresh_token: refreshToken!,
      grant_type: 'refresh_token',
    });
    const res = await axios.post<{
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    }>('https://oauth2.googleapis.com/token', body.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 20_000,
    });

    if (!res.data.access_token) {
      push(
        'YOUTUBE',
        'token_refresh',
        'fail',
        res.data.error_description || res.data.error || 'No access_token',
      );
      return;
    }

    push(
      'YOUTUBE',
      'token_refresh',
      'ok',
      `Refresh grant OK (expires_in=${res.data.expires_in ?? '?'})`,
    );

    const channels = await axios.get<{
      items?: Array<{ id?: string; snippet?: { title?: string } }>;
    }>('https://www.googleapis.com/youtube/v3/channels', {
      params: { part: 'snippet', mine: 'true' },
      headers: { Authorization: `Bearer ${res.data.access_token}` },
      timeout: 20_000,
    });
    const ch = channels.data.items?.[0];
    push(
      'YOUTUBE',
      'channel',
      ch?.id ? 'ok' : 'warn',
      ch?.id
        ? `Channel reachable: id=${ch.id} title=${ch.snippet?.title ?? '?'}`
        : 'Token valid but no channel returned for this account',
    );
  } catch (err) {
    push('YOUTUBE', 'token_refresh', 'fail', axiosDetail(err));
  }
}

async function main() {
  console.log('Social connectivity verification (secrets never printed)\n');
  await verifyMeta();
  console.log('');
  await verifyTikTok();
  console.log('');
  await verifyYouTube();

  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  console.log(`\nSummary: ${results.length} checks — ${fails} fail, ${warns} warn`);
  if (fails > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
