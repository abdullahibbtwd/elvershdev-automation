/** Make values safe for Express `res.json` / `JSON.stringify` (Prisma BigInt/Decimal). */
export function jsonSafe<T>(value: T): T {
  return sanitize(value) as T;
}

function sanitize(value: unknown): unknown {
  if (typeof value === 'bigint') {
    const asNumber = Number(value);
    return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
  }
  if (value == null || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  // Prisma Decimal
  if (typeof (value as { toNumber?: unknown }).toNumber === 'function') {
    try {
      return (value as { toNumber: () => number }).toNumber();
    } catch {
      return String(value);
    }
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitize(item));
  }
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = sanitize(nested);
  }
  return out;
}

/** Install once so any accidental BigInt in API responses still serializes. */
export function installBigIntJson(): void {
  const proto = BigInt.prototype as unknown as { toJSON?: () => number | string };
  if (proto.toJSON) return;
  proto.toJSON = function toJSON(this: bigint) {
    const asNumber = Number(this);
    return Number.isSafeInteger(asNumber) ? asNumber : this.toString();
  };
}
