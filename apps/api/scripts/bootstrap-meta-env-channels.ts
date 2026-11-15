/**
 * Seed Facebook + Instagram SocialChannel rows from env page-token credentials
 * so publishing can run server-to-server without a browser OAuth prompt.
 *
 * Requires:
 *   FACEBOOK_PAGE_ACCESS_TOKEN, FACEBOOK_PAGE_ID, INSTAGRAM_ACCOUNT_ID (optional),
 *   CREDENTIALS_ENCRYPTION_KEY, DATABASE_URL
 *   BOOTSTRAP_USER_EMAIL (default: admin@localhost) — user that owns the channels
 *
 * Usage:
 *   pnpm --filter @ai-video/api exec ts-node -r tsconfig-paths/register scripts/bootstrap-meta-env-channels.ts
 */
import { config as loadEnv } from 'dotenv';
import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import axios from 'axios';
import { Prisma, SocialPlatform } from '@prisma/client';
import { DEFAULT_CAPABILITIES } from '@ai-video/shared';
import { INSTAGRAM_SCOPES, META_PAGE_SCOPES } from '../src/integrations/social/social-publishing.types';
import { createPrismaClient } from '../src/prisma/create-prisma-client';

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

loadEnv({ path: resolve(__dirname, '../../../.env') });
loadEnv({ path: resolve(__dirname, '../.env'), override: true });

const prisma = createPrismaClient();

function encrypt(plaintext: string, rawKey: string): string {
  const key = createHash('sha256').update(rawKey).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString('base64url');
}

async function main() {
  const pageToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN?.trim();
  const pageId = process.env.FACEBOOK_PAGE_ID?.trim();
  const igId = process.env.INSTAGRAM_ACCOUNT_ID?.trim();
  const encKey = process.env.CREDENTIALS_ENCRYPTION_KEY?.trim();
  const email = process.env.BOOTSTRAP_USER_EMAIL?.trim() || 'admin@localhost';
  const graphVersion = process.env.FACEBOOK_GRAPH_VERSION || 'v22.0';
  const base = `https://graph.facebook.com/${graphVersion}`;

  if (!pageToken || !pageId) {
    throw new Error('FACEBOOK_PAGE_ACCESS_TOKEN and FACEBOOK_PAGE_ID are required');
  }
  if (!encKey || encKey.length < 32) {
    throw new Error('CREDENTIALS_ENCRYPTION_KEY must be set (≥32 chars)');
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email,
        name: 'Meta Bootstrap',
        passwordHash: 'bootstrap-not-for-login',
      },
    });
    console.log(`Created user ${email}`);
  } else {
    console.log(`Using existing user ${email}`);
  }

  const pageRes = await axios.get<{ id: string; name?: string }>(`${base}/${pageId}`, {
    params: { fields: 'id,name', access_token: pageToken },
    timeout: 20_000,
  });
  const pageName = pageRes.data.name || `Facebook Page ${pageId}`;

  const fb = await prisma.socialChannel.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: user.id,
        platform: SocialPlatform.FACEBOOK,
        platformAccountId: pageId,
      },
    },
    create: {
      userId: user.id,
      platform: SocialPlatform.FACEBOOK,
      accountName: pageName,
      platformAccountId: pageId,
      accountType: 'page',
      connectionStatus: 'CONNECTED',
      grantedScopes: [...META_PAGE_SCOPES],
      publishingCapabilities: asJson(DEFAULT_CAPABILITIES.FACEBOOK),
      accessTokenEncrypted: encrypt(pageToken, encKey),
      tokenExpiresAt: null,
      metadata: asJson({ pageAccessToken: true, source: 'env-bootstrap' }),
      isActive: true,
      lastConnectionCheckAt: new Date(),
    },
    update: {
      accountName: pageName,
      accountType: 'page',
      connectionStatus: 'CONNECTED',
      grantedScopes: [...META_PAGE_SCOPES],
      publishingCapabilities: asJson(DEFAULT_CAPABILITIES.FACEBOOK),
      accessTokenEncrypted: encrypt(pageToken, encKey),
      tokenExpiresAt: null,
      metadata: asJson({ pageAccessToken: true, source: 'env-bootstrap' }),
      isActive: true,
      lastConnectionCheckAt: new Date(),
      lastError: null,
    },
  });
  console.log(`Facebook channel upserted: ${fb.id} (page ${pageId})`);

  if (!igId) {
    console.log('INSTAGRAM_ACCOUNT_ID not set — skipping Instagram channel');
    return;
  }

  const igRes = await axios.get<{ id: string; username?: string; name?: string }>(
    `${base}/${igId}`,
    {
      params: { fields: 'id,username,name', access_token: pageToken },
      timeout: 20_000,
    },
  );
  const igName = igRes.data.username ? `@${igRes.data.username}` : `Instagram ${igId}`;

  const ig = await prisma.socialChannel.upsert({
    where: {
      userId_platform_platformAccountId: {
        userId: user.id,
        platform: SocialPlatform.INSTAGRAM,
        platformAccountId: igId,
      },
    },
    create: {
      userId: user.id,
      platform: SocialPlatform.INSTAGRAM,
      accountName: igName,
      username: igRes.data.username ?? null,
      platformAccountId: igId,
      accountType: 'BUSINESS',
      connectionStatus: 'CONNECTED',
      grantedScopes: [...INSTAGRAM_SCOPES],
      publishingCapabilities: asJson(DEFAULT_CAPABILITIES.INSTAGRAM),
      accessTokenEncrypted: encrypt(pageToken, encKey),
      tokenExpiresAt: null,
      metadata: asJson({
        pageAccessToken: true,
        source: 'env-bootstrap',
        facebookPageId: pageId,
      }),
      isActive: true,
      lastConnectionCheckAt: new Date(),
    },
    update: {
      accountName: igName,
      username: igRes.data.username ?? null,
      accountType: 'BUSINESS',
      connectionStatus: 'CONNECTED',
      grantedScopes: [...INSTAGRAM_SCOPES],
      publishingCapabilities: asJson(DEFAULT_CAPABILITIES.INSTAGRAM),
      accessTokenEncrypted: encrypt(pageToken, encKey),
      tokenExpiresAt: null,
      metadata: asJson({
        pageAccessToken: true,
        source: 'env-bootstrap',
        facebookPageId: pageId,
      }),
      isActive: true,
      lastConnectionCheckAt: new Date(),
      lastError: null,
    },
  });
  console.log(`Instagram channel upserted: ${ig.id} (ig ${igId})`);
}

main()
  .catch((err) => {
    console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
