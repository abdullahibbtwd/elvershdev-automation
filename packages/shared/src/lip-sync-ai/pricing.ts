import { getLipSyncCapabilities } from './capabilities';
import type { LipSyncProviderId } from './types';

export function estimateLipSyncCostUsd(
  providerId: LipSyncProviderId,
  durationSeconds: number,
  env: Record<string, string | undefined> = {},
): number {
  const caps = getLipSyncCapabilities(providerId);
  const override = env.LIP_SYNC_PRICE_PER_SECOND_USD;
  const price =
    override && Number.isFinite(Number.parseFloat(override))
      ? Number.parseFloat(override)
      : caps.pricePerSecondUsd;
  return Number((Math.max(0, durationSeconds) * price).toFixed(6));
}
