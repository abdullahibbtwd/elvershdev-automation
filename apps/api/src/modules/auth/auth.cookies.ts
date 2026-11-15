import type { CookieOptions, Response } from 'express';
import type { ConfigService } from '@nestjs/config';

export const REFRESH_COOKIE_NAME = 'refresh_token';

export function getRefreshCookieOptions(config: ConfigService): CookieOptions {
  const isProd = config.get<string>('nodeEnv') === 'production';
  const maxAgeMs = parseDurationToMs(
    config.get<string>('jwt.refreshExpiresIn', '7d'),
  );

  return {
    httpOnly: true,
    secure: config.get<boolean>('cookie.secure', isProd),
    sameSite: config.get<'lax' | 'strict' | 'none'>('cookie.sameSite', isProd ? 'strict' : 'lax'),
    path: config.get<string>('cookie.path', '/api/auth'),
    maxAge: maxAgeMs,
    ...(config.get<string>('cookie.domain')
      ? { domain: config.get<string>('cookie.domain') }
      : {}),
  };
}

export function setRefreshCookie(
  res: Response,
  refreshToken: string,
  config: ConfigService,
): void {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, getRefreshCookieOptions(config));
}

export function clearRefreshCookie(res: Response, config: ConfigService): void {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    ...getRefreshCookieOptions(config),
    maxAge: 0,
  });
}

function parseDurationToMs(value: string): number {
  const match = /^(\d+)([smhd])$/i.exec(value.trim());
  if (!match) {
    return 7 * 24 * 60 * 60 * 1000;
  }
  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
  const multipliers: Record<string, number> = {
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };
  return amount * (multipliers[unit] ?? 86_400_000);
}
