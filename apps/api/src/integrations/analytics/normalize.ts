import { RAW_PROVIDER_RESPONSE_MAX_BYTES } from '@ai-video/shared';

export { RAW_PROVIDER_RESPONSE_MAX_BYTES };

/**
 * Keeps provider payloads safe to persist while retaining the complete object
 * whenever it already fits within the analytics raw-response limit.
 */
export function truncateRawProviderResponse(
  raw: unknown,
  maxBytes = RAW_PROVIDER_RESPONSE_MAX_BYTES,
): Record<string, unknown> {
  const normalized =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : { value: raw ?? null };
  const serialized = safeStringify(normalized);
  const originalBytes = Buffer.byteLength(serialized, 'utf8');

  if (originalBytes <= maxBytes) return normalized;

  const envelopeOverhead = Buffer.byteLength(
    JSON.stringify({ truncated: true, originalBytes, rawPreview: '' }),
    'utf8',
  );
  const previewBytes = Math.max(0, maxBytes - envelopeOverhead - 8);
  const rawPreview = Buffer.from(serialized, 'utf8')
    .subarray(0, previewBytes)
    .toString('utf8')
    .replace(/\uFFFD$/u, '');

  return {
    truncated: true,
    originalBytes,
    rawPreview,
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ serializationError: 'Provider response was not JSON serializable' });
  }
}
