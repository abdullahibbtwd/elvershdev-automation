import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  SocialConnectionStatus,
  SocialPlatform,
  type OAuthState,
  type SocialChannel,
} from '@prisma/client';
import {
  DEFAULT_CAPABILITIES,
  type ConnectedAccountInfo,
  type PublishingCapabilities,
  type SocialPlatformKey,
  type TokenBundle,
} from '@ai-video/shared';
import { createHash, randomBytes } from 'node:crypto';
import { getPagination, paginationMeta } from '../../common/utils/pagination';
import { EncryptionService } from '../../common/crypto/encryption.service';
import { SocialProviderRegistry } from '../../integrations/social/social-provider.registry';
import { PrismaService } from '../../prisma/prisma.service';
import { ConnectChannelDto } from './dto/connect-channel.dto';
import { CreateChannelDto } from './dto/create-channel.dto';
import { ListChannelsDto } from './dto/list-channels.dto';
import { UpdateChannelDto } from './dto/update-channel.dto';
import { SocialOAuthProviderParam } from './social-oauth.constants';

@Injectable()
export class ChannelsService {
  private readonly logger = new Logger(ChannelsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: EncryptionService,
    private readonly config: ConfigService,
    private readonly socialProviders: SocialProviderRegistry,
  ) {}

  async create(userId: string, dto: CreateChannelDto) {
    try {
      const channel = await this.prisma.socialChannel.create({
        data: {
          userId,
          platform: dto.platform,
          accountName: dto.accountName.trim(),
          platformAccountId: dto.platformAccountId.trim(),
          accessTokenEncrypted: this.encryption.encrypt(dto.accessToken ?? 'pending-oauth'),
          refreshTokenEncrypted: dto.refreshToken
            ? this.encryption.encrypt(dto.refreshToken)
            : null,
          isActive: dto.isActive ?? true,
          connectionStatus: SocialConnectionStatus.CONNECTED,
        },
      });
      return this.toPublic(channel);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException('Channel already connected for this account');
      }
      throw error;
    }
  }

  async list(userId: string, query: ListChannelsDto) {
    const { page, limit, skip } = getPagination(query);
    const where: Prisma.SocialChannelWhereInput = {
      userId,
      ...(query.platform ? { platform: query.platform } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.socialChannel.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.socialChannel.count({ where }),
    ]);

    return {
      items: items.map((item) => this.toPublic(item)),
      meta: paginationMeta(page, limit, total),
    };
  }

  async getById(userId: string, id: string) {
    const channel = await this.requireChannel(userId, id);
    return this.toPublic(channel);
  }

  async update(userId: string, id: string, dto: UpdateChannelDto) {
    await this.requireChannel(userId, id);
    const channel = await this.prisma.socialChannel.update({
      where: { id },
      data: {
        ...(dto.accountName !== undefined ? { accountName: dto.accountName.trim() } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        ...(dto.accessToken !== undefined
          ? { accessTokenEncrypted: this.encryption.encrypt(dto.accessToken) }
          : {}),
        ...(dto.refreshToken !== undefined
          ? {
              refreshTokenEncrypted: dto.refreshToken
                ? this.encryption.encrypt(dto.refreshToken)
                : null,
            }
          : {}),
      },
    });
    return this.toPublic(channel);
  }

  async remove(userId: string, id: string) {
    const channel = await this.requireChannel(userId, id);

    try {
      const provider = this.socialProviders.get(channel.platform);
      if (provider.disconnectAccount) {
        const accessToken = this.encryption.decrypt(channel.accessTokenEncrypted);
        await provider.disconnectAccount(accessToken, channel.platformAccountId);
      }
    } catch (error) {
      this.logger.warn(
        `Best-effort disconnect for channel ${id} failed: ${(error as Error).message}`,
      );
    }

    await this.prisma.socialChannel.delete({ where: { id } });
    return { deleted: true };
  }

  async countByUser(userId: string) {
    return this.prisma.socialChannel.count({ where: { userId } });
  }

  getCapabilities() {
    const platforms: SocialPlatformKey[] = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE'];
    return platforms.map((platform) => {
      let isConfigured = false;
      let useMock = true;
      try {
        const provider = this.socialProviders.get(platform);
        isConfigured = provider.isConfigured();
        useMock = provider.shouldUseMock();
      } catch {
        isConfigured = false;
        useMock = true;
      }
      return {
        platform,
        isConfigured,
        useMock,
        capabilities: DEFAULT_CAPABILITIES[platform],
      };
    });
  }

  async startConnect(userId: string, providerParam: SocialOAuthProviderParam, dto: ConnectChannelDto) {
    const platform = this.toPlatform(providerParam);
    const provider = this.socialProviders.get(platform);
    const redirectUri = this.redirectUriFor(platform);

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;
    if (platform === SocialPlatform.TIKTOK) {
      codeVerifier = randomBytes(32).toString('base64url');
      codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
    }

    const stateRecord = await this.createState(userId, platform, dto.redirectPath, codeVerifier);
    const authorizationUrl = provider.getAuthorizationUrl({
      state: stateRecord.state,
      redirectUri,
      codeChallenge,
    });

    return {
      authorizationUrl,
      state: stateRecord.state,
      provider: providerParam,
      platform,
    };
  }

  async handleOAuthCallback(
    providerParam: SocialOAuthProviderParam,
    query: { code?: string; state?: string; error?: string; error_description?: string },
  ): Promise<string> {
    const frontendBase = this.config.get<string>(
      'integrations.socialFrontendRedirectUrl',
      'http://localhost:5173',
    );
    const connectedPath = `${frontendBase.replace(/\/$/, '')}/channels`;

    if (query.error) {
      const message = encodeURIComponent(query.error_description || query.error);
      return `${connectedPath}?error=${encodeURIComponent(providerParam)}&message=${message}`;
    }

    if (!query.code || !query.state) {
      return `${connectedPath}?error=${encodeURIComponent(providerParam)}&message=${encodeURIComponent('missing_code_or_state')}`;
    }

    try {
      const platform = this.toPlatform(providerParam);
      const oauthState = await this.consumeState(query.state);
      if (oauthState.provider !== platform) {
        throw new BadRequestException('OAuth state provider mismatch');
      }

      const provider = this.socialProviders.get(platform);
      const redirectUri = this.redirectUriFor(platform);
      const exchange = await provider.exchangeAuthorizationCode({
        code: query.code,
        redirectUri,
        codeVerifier: oauthState.codeVerifier ?? undefined,
      });

      const channels = [];
      for (const account of exchange.accounts) {
        let capabilities: PublishingCapabilities;
        try {
          const accessToken = this.accountAccessToken(exchange.tokens, account);
          capabilities = await provider.getPublishingCapabilities(accessToken, account);
        } catch (error) {
          this.logger.warn(
            `Capabilities fetch failed for ${platform}/${account.platformAccountId}: ${(error as Error).message}`,
          );
          capabilities = {
            ...DEFAULT_CAPABILITIES[platform as SocialPlatformKey],
            canPublishVideo: false,
            unsupportedReasons: [
              ...DEFAULT_CAPABILITIES[platform as SocialPlatformKey].unsupportedReasons,
              (error as Error).message,
            ],
          };
        }

        const channel = await this.upsertFromOAuth({
          userId: oauthState.userId,
          platform,
          tokens: exchange.tokens,
          account,
          capabilities,
        });
        channels.push(channel);
      }

      const redirectPath =
        this.sanitizeRedirectPath(oauthState.redirectPath ?? undefined) ?? '/channels';
      const base = `${frontendBase.replace(/\/$/, '')}${redirectPath}`;
      const separator = base.includes('?') ? '&' : '?';
      return `${base}${separator}connected=${encodeURIComponent(providerParam)}&accounts=${channels.length}`;
    } catch (error) {
      this.logger.warn(`OAuth callback failed for ${providerParam}: ${(error as Error).message}`);
      return `${connectedPath}?error=${encodeURIComponent(providerParam)}&message=${encodeURIComponent((error as Error).message || 'oauth_failed')}`;
    }
  }

  async refresh(userId: string, id: string) {
    const channel = await this.requireChannel(userId, id);
    const provider = this.socialProviders.get(channel.platform);
    const tokens = await this.getDecryptedTokens(channel.id, userId);

    let accessToken = tokens.accessToken;
    let refreshToken = tokens.refreshToken;
    let tokenExpiresAt = tokens.tokenExpiresAt;

    if (provider.refreshAccessToken && refreshToken) {
      const refreshed = await provider.refreshAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken ?? refreshToken;
      tokenExpiresAt = refreshed.expiresAt ?? tokenExpiresAt;
    }

    const account = await provider.getConnectedAccount(accessToken, channel.platformAccountId);
    const capabilities = await provider.getPublishingCapabilities(accessToken, account);
    const connectionStatus = this.connectionStatusFromCapabilities(capabilities);

    const updated = await this.prisma.socialChannel.update({
      where: { id: channel.id },
      data: {
        accountName: account.displayName || channel.accountName,
        username: account.username ?? channel.username,
        profileImageUrl: account.profileImageUrl ?? channel.profileImageUrl,
        accountType: account.accountType ?? channel.accountType,
        grantedScopes: account.grantedScopes?.length
          ? account.grantedScopes
          : channel.grantedScopes,
        publishingCapabilities: capabilities as unknown as Prisma.InputJsonValue,
        connectionStatus,
        accessTokenEncrypted: this.encryption.encrypt(accessToken),
        refreshTokenEncrypted: refreshToken ? this.encryption.encrypt(refreshToken) : null,
        tokenExpiresAt,
        lastConnectionCheckAt: new Date(),
        lastError: null,
        metadata: (account.metadata ?? {}) as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    return this.toPublic(updated);
  }

  async createState(
    userId: string,
    provider: SocialPlatform,
    redirectPath?: string,
    codeVerifier?: string,
  ): Promise<OAuthState> {
    const ttlSeconds = this.config.get<number>('integrations.socialOauthStateTtlSeconds', 600);
    const state = randomBytes(32).toString('base64url');
    return this.prisma.oAuthState.create({
      data: {
        state,
        userId,
        provider,
        codeVerifier: codeVerifier ?? null,
        redirectPath: this.sanitizeRedirectPath(redirectPath),
        expiresAt: new Date(Date.now() + ttlSeconds * 1000),
      },
    });
  }

  /** Only allow same-origin relative paths (blocks //evil.com open redirects). */
  private sanitizeRedirectPath(redirectPath?: string): string | null {
    if (!redirectPath) return null;
    if (!redirectPath.startsWith('/')) return null;
    if (redirectPath.startsWith('//')) return null;
    if (redirectPath.includes('\\') || redirectPath.includes('://')) return null;
    return redirectPath;
  }

  async consumeState(state: string): Promise<OAuthState> {
    const record = await this.prisma.oAuthState.findUnique({ where: { state } });
    if (!record) {
      throw new BadRequestException('Invalid OAuth state');
    }
    await this.prisma.oAuthState.delete({ where: { id: record.id } }).catch(() => undefined);
    if (record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('OAuth state expired');
    }
    return record;
  }

  async upsertFromOAuth(input: {
    userId: string;
    platform: SocialPlatform;
    tokens: TokenBundle;
    account: ConnectedAccountInfo;
    capabilities: PublishingCapabilities;
  }): Promise<SocialChannel> {
    const { userId, platform, tokens, account, capabilities } = input;
    const accessToken = this.accountAccessToken(tokens, account);
    const connectionStatus = this.connectionStatusFromCapabilities(capabilities);
    const scopes =
      account.grantedScopes?.length > 0
        ? account.grantedScopes
        : tokens.scopes && tokens.scopes.length > 0
          ? tokens.scopes
          : [];

    return this.prisma.socialChannel.upsert({
      where: {
        userId_platform_platformAccountId: {
          userId,
          platform,
          platformAccountId: account.platformAccountId,
        },
      },
      create: {
        userId,
        platform,
        accountName: account.displayName || account.username || account.platformAccountId,
        username: account.username ?? null,
        platformAccountId: account.platformAccountId,
        profileImageUrl: account.profileImageUrl ?? null,
        accountType: account.accountType ?? null,
        connectionStatus,
        grantedScopes: scopes,
        publishingCapabilities: capabilities as unknown as Prisma.InputJsonValue,
        accessTokenEncrypted: this.encryption.encrypt(accessToken),
        refreshTokenEncrypted: tokens.refreshToken
          ? this.encryption.encrypt(tokens.refreshToken)
          : null,
        tokenExpiresAt: tokens.expiresAt ?? null,
        lastConnectionCheckAt: new Date(),
        lastError: null,
        metadata: (account.metadata ?? {}) as Prisma.InputJsonValue,
        isActive: true,
      },
      update: {
        accountName: account.displayName || account.username || account.platformAccountId,
        username: account.username ?? null,
        profileImageUrl: account.profileImageUrl ?? null,
        accountType: account.accountType ?? null,
        connectionStatus,
        grantedScopes: scopes,
        publishingCapabilities: capabilities as unknown as Prisma.InputJsonValue,
        accessTokenEncrypted: this.encryption.encrypt(accessToken),
        refreshTokenEncrypted: tokens.refreshToken
          ? this.encryption.encrypt(tokens.refreshToken)
          : null,
        tokenExpiresAt: tokens.expiresAt ?? null,
        lastConnectionCheckAt: new Date(),
        lastError: null,
        metadata: (account.metadata ?? {}) as Prisma.InputJsonValue,
        isActive: true,
      },
    });
  }

  async getDecryptedTokens(channelId: string, userId: string) {
    const channel = await this.requireChannel(userId, channelId);
    return {
      accessToken: this.encryption.decrypt(channel.accessTokenEncrypted),
      refreshToken: channel.refreshTokenEncrypted
        ? this.encryption.decrypt(channel.refreshTokenEncrypted)
        : null,
      tokenExpiresAt: channel.tokenExpiresAt,
      platform: channel.platform,
      platformAccountId: channel.platformAccountId,
    };
  }

  connectionStatusFromCapabilities(capabilities: PublishingCapabilities): SocialConnectionStatus {
    if (!capabilities.canPublishVideo) {
      if (capabilities.unsupportedReasons?.length) {
        return SocialConnectionStatus.NOT_ELIGIBLE;
      }
      return SocialConnectionStatus.MISSING_PERMISSIONS;
    }
    if (capabilities.testOrPrivateOnly || !capabilities.canPublishPublic) {
      return SocialConnectionStatus.TEST_ONLY;
    }
    return SocialConnectionStatus.PUBLIC_READY;
  }

  toPublic(channel: SocialChannel) {
    const capabilities = this.parseCapabilities(channel);
    return {
      id: channel.id,
      userId: channel.userId,
      platform: channel.platform,
      accountName: channel.accountName,
      username: channel.username,
      platformAccountId: channel.platformAccountId,
      profileImageUrl: channel.profileImageUrl,
      accountType: channel.accountType,
      connectionStatus: channel.connectionStatus,
      grantedScopes: channel.grantedScopes,
      publishingCapabilities: capabilities,
      warnings: capabilities.warnings ?? [],
      unsupportedReasons: capabilities.unsupportedReasons ?? [],
      tokenExpiresAt: channel.tokenExpiresAt,
      lastConnectionCheckAt: channel.lastConnectionCheckAt,
      lastError: channel.lastError,
      metadata: channel.metadata,
      isActive: channel.isActive,
      hasAccessToken: Boolean(channel.accessTokenEncrypted),
      hasRefreshToken: Boolean(channel.refreshTokenEncrypted),
      createdAt: channel.createdAt,
      updatedAt: channel.updatedAt,
    };
  }

  private async requireChannel(userId: string, id: string): Promise<SocialChannel> {
    const channel = await this.prisma.socialChannel.findFirst({ where: { id, userId } });
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }
    return channel;
  }

  private toPlatform(provider: SocialOAuthProviderParam | string): SocialPlatform {
    const key = String(provider).toUpperCase();
    if (!Object.values(SocialPlatform).includes(key as SocialPlatform)) {
      throw new BadRequestException(`Unsupported social provider: ${provider}`);
    }
    return key as SocialPlatform;
  }

  private redirectUriFor(platform: SocialPlatform): string {
    const map: Record<SocialPlatform, string> = {
      FACEBOOK: this.config.get<string>(
        'integrations.facebookRedirectUri',
        'http://localhost:3000/api/channels/facebook/callback',
      )!,
      INSTAGRAM: this.config.get<string>(
        'integrations.instagramRedirectUri',
        'http://localhost:3000/api/channels/instagram/callback',
      )!,
      TIKTOK: this.config.get<string>(
        'integrations.tiktokRedirectUri',
        'http://localhost:3000/api/channels/tiktok/callback',
      )!,
      YOUTUBE: this.config.get<string>(
        'integrations.youtubeRedirectUri',
        'http://localhost:3000/api/channels/youtube/callback',
      )!,
    };
    return map[platform];
  }

  private accountAccessToken(tokens: TokenBundle, account: ConnectedAccountInfo): string {
    const meta = account.metadata ?? {};
    if (typeof meta.accessToken === 'string' && meta.accessToken.length > 0) {
      return meta.accessToken;
    }
    if (typeof meta.pageAccessToken === 'string' && meta.pageAccessToken.length > 0) {
      return meta.pageAccessToken;
    }
    return tokens.accessToken;
  }

  private parseCapabilities(channel: SocialChannel): PublishingCapabilities {
    const stored = channel.publishingCapabilities;
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
      const caps = stored as Partial<PublishingCapabilities>;
      if (typeof caps.canPublishVideo === 'boolean') {
        return {
          ...DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey],
          ...caps,
          flags: caps.flags ?? DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey].flags,
          warnings:
            caps.warnings ?? DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey].warnings,
          unsupportedReasons:
            caps.unsupportedReasons ??
            DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey].unsupportedReasons,
          supportedMimeTypes:
            caps.supportedMimeTypes ??
            DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey].supportedMimeTypes,
        };
      }
    }
    return DEFAULT_CAPABILITIES[channel.platform as SocialPlatformKey];
  }
}
