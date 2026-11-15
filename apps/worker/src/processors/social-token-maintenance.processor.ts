import type { Job, Processor } from 'bullmq';
import { SocialConnectionStatus, type SocialPlatform } from '@prisma/client';
import type { SocialPlatformKey, SocialTokenMaintenanceQueuePayload } from '@ai-video/shared';
import { decryptCredential, encryptCredential } from '../lib/crypto';
import type { Logger } from '../lib/logger';
import { getPrisma } from '../lib/prisma';
import { refreshPlatformToken } from '../lib/social/publish-client';

export function createSocialTokenMaintenanceProcessor(logger: Logger): Processor {
  return async (job: Job<SocialTokenMaintenanceQueuePayload>) => {
    const prisma = getPrisma();
    const data = job.data;

    logger.info({ bullJobId: job.id, mode: data.mode }, 'Social token maintenance started');

    const now = new Date();
    const soon = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const channels =
      data.mode === 'refresh_one' && data.channelId
        ? await prisma.socialChannel.findMany({
            where: {
              id: data.channelId,
              ...(data.userId ? { userId: data.userId } : {}),
            },
          })
        : await prisma.socialChannel.findMany({
            where: {
              isActive: true,
              refreshTokenEncrypted: { not: null },
              OR: [
                { tokenExpiresAt: null },
                { tokenExpiresAt: { lte: soon } },
                {
                  connectionStatus: {
                    in: [SocialConnectionStatus.EXPIRED, SocialConnectionStatus.ERROR],
                  },
                },
              ],
              ...(data.platform ? { platform: data.platform as SocialPlatform } : {}),
              ...(data.userId ? { userId: data.userId } : {}),
            },
            take: 100,
          });

    let refreshed = 0;
    let skipped = 0;
    let failed = 0;

    for (const channel of channels) {
      if (!channel.refreshTokenEncrypted) {
        skipped += 1;
        continue;
      }
      if (channel.tokenExpiresAt && channel.tokenExpiresAt > soon && data.mode === 'scan_expiring') {
        skipped += 1;
        continue;
      }

      try {
        const refreshToken = decryptCredential(channel.refreshTokenEncrypted);
        const bundle = await refreshPlatformToken(
          channel.platform as SocialPlatformKey,
          refreshToken,
        );
        if (!bundle) {
          skipped += 1;
          continue;
        }

        await prisma.socialChannel.update({
          where: { id: channel.id },
          data: {
            accessTokenEncrypted: encryptCredential(bundle.accessToken),
            refreshTokenEncrypted: bundle.refreshToken
              ? encryptCredential(bundle.refreshToken)
              : channel.refreshTokenEncrypted,
            tokenExpiresAt: bundle.expiresAt ?? channel.tokenExpiresAt,
            connectionStatus:
              channel.connectionStatus === SocialConnectionStatus.EXPIRED ||
              channel.connectionStatus === SocialConnectionStatus.ERROR
                ? SocialConnectionStatus.CONNECTED
                : channel.connectionStatus,
            lastConnectionCheckAt: now,
            lastError: null,
          },
        });
        refreshed += 1;
      } catch (error) {
        failed += 1;
        await prisma.socialChannel.update({
          where: { id: channel.id },
          data: {
            connectionStatus: SocialConnectionStatus.EXPIRED,
            lastError: (error as Error).message,
            lastConnectionCheckAt: now,
          },
        });
        logger.warn(
          { channelId: channel.id, err: (error as Error).message },
          'Token refresh failed',
        );
      }
    }

    return { refreshed, skipped, failed, scanned: channels.length };
  };
}
