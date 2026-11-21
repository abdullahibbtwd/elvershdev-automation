import {
  normalizeVideoProviderId,
  type VideoGenerationProvider,
  type VideoProviderId,
} from '@ai-video/shared';
import { hailuoVideoProvider, shouldUseHailuoMock } from './hailuo';
import { klingVideoProvider, shouldUseKlingMock } from './kling';
import { shouldUseXaiVideoMock, xaiVideoProvider } from './xai-video';

export function resolveVideoProvider(
  providerName?: string | null,
): VideoGenerationProvider {
  const id = normalizeVideoProviderId(providerName ?? undefined);
  if (id === 'kling') return klingVideoProvider;
  if (id === 'xai') return xaiVideoProvider;
  return hailuoVideoProvider;
}

export function resolveVideoProviderId(
  providerName?: string | null,
): VideoProviderId {
  return normalizeVideoProviderId(providerName ?? undefined);
}

export function shouldUseVideoProviderMock(
  providerName?: string | null,
  forceMock?: boolean,
): boolean {
  const id = resolveVideoProviderId(providerName);
  if (id === 'kling') return shouldUseKlingMock(forceMock);
  if (id === 'xai') return shouldUseXaiVideoMock(forceMock);
  return shouldUseHailuoMock(forceMock);
}

export function getVideoPollIntervalSeconds(providerName?: string | null): number {
  const id = resolveVideoProviderId(providerName);
  if (id === 'kling') {
    const parsed = Number.parseInt(process.env.KLING_POLL_INTERVAL_SECONDS ?? '8', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 8;
  }
  if (id === 'xai') {
    const parsed = Number.parseInt(process.env.XAI_VIDEO_POLL_INTERVAL_SECONDS ?? '5', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
  }
  const parsed = Number.parseInt(process.env.HAILUO_POLL_INTERVAL_SECONDS ?? '15', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

export function getVideoMaxPollAttempts(providerName?: string | null): number {
  const id = resolveVideoProviderId(providerName);
  if (id === 'kling') {
    const parsed = Number.parseInt(process.env.KLING_MAX_POLL_ATTEMPTS ?? '90', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 90;
  }
  if (id === 'xai') {
    const parsed = Number.parseInt(process.env.XAI_VIDEO_MAX_POLL_ATTEMPTS ?? '120', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 120;
  }
  const parsed = Number.parseInt(process.env.HAILUO_MAX_POLL_ATTEMPTS ?? '80', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 80;
}

export function getVideoProviderModel(providerName?: string | null): string {
  const provider = resolveVideoProvider(providerName);
  return provider.getModel();
}
