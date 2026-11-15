import {
  isMetricAvailable,
  metricValueOrNull,
  type OptionalMetric,
} from './metrics';

export interface EngagementParts {
  likes: OptionalMetric<number>;
  comments: OptionalMetric<number>;
  shares: OptionalMetric<number>;
  saves?: OptionalMetric<number>;
  views: OptionalMetric<number>;
  includeSaves?: boolean;
}

export interface CalculationResult {
  value: number | null;
  available: boolean;
  reason?: string;
  definition: string;
  inputsUsed: string[];
}

function sumAvailable(
  parts: Array<{ key: string; metric?: OptionalMetric<number> }>,
): { sum: number; used: string[]; missing: string[] } {
  const used: string[] = [];
  const missing: string[] = [];
  let sum = 0;
  for (const part of parts) {
    if (!part.metric) {
      missing.push(part.key);
      continue;
    }
    if (isMetricAvailable(part.metric)) {
      sum += part.metric.value;
      used.push(part.key);
    } else {
      missing.push(part.key);
    }
  }
  return { sum, used, missing };
}

/**
 * Engagement rate = engagement actions / views.
 * Returns unavailable (not zero) when views missing, views === 0, or required engagement parts missing.
 */
export function calculateEngagementRate(input: EngagementParts): CalculationResult {
  const definition =
    'Engagement rate = (likes + comments + shares' +
    (input.includeSaves ? ' + saves' : '') +
    ') / views. Requires AVAILABLE views > 0 and all included engagement metrics.';

  const views = metricValueOrNull(input.views);
  if (views == null) {
    return {
      value: null,
      available: false,
      reason: 'Views metric unavailable',
      definition,
      inputsUsed: [],
    };
  }
  if (views <= 0) {
    return {
      value: null,
      available: false,
      reason: 'Cannot compute engagement rate when views are zero',
      definition,
      inputsUsed: ['views'],
    };
  }

  const parts: Array<{ key: string; metric?: OptionalMetric<number> }> = [
    { key: 'likes', metric: input.likes },
    { key: 'comments', metric: input.comments },
    { key: 'shares', metric: input.shares },
  ];
  if (input.includeSaves) {
    parts.push({ key: 'saves', metric: input.saves });
  }

  const { sum, used, missing } = sumAvailable(parts);
  if (missing.length > 0) {
    return {
      value: null,
      available: false,
      reason: `Missing engagement parts: ${missing.join(', ')}`,
      definition,
      inputsUsed: used,
    };
  }

  return {
    value: sum / views,
    available: true,
    definition,
    inputsUsed: [...used, 'views'],
  };
}

export function calculateEngagementPerThousandViews(
  input: EngagementParts,
): CalculationResult {
  const rate = calculateEngagementRate(input);
  if (!rate.available || rate.value == null) {
    return {
      ...rate,
      definition:
        'Engagement per 1,000 views = engagement rate × 1000. Same availability rules as engagement rate.',
    };
  }
  return {
    value: rate.value * 1000,
    available: true,
    definition:
      'Engagement per 1,000 views = ((likes + comments + shares [+ saves]) / views) × 1000',
    inputsUsed: rate.inputsUsed,
  };
}

export function calculateCostPerThousandViews(input: {
  costUsd: number | null | undefined;
  views: OptionalMetric<number> | number | null | undefined;
}): CalculationResult {
  const definition =
    'Cost per 1,000 views = production cost USD / (views / 1000). Requires cost and views > 0.';
  const cost = input.costUsd;
  const views =
    typeof input.views === 'number'
      ? input.views
      : metricValueOrNull(input.views as OptionalMetric<number> | null | undefined);

  if (cost == null || !Number.isFinite(cost)) {
    return { value: null, available: false, reason: 'Cost unavailable', definition, inputsUsed: [] };
  }
  if (views == null) {
    return { value: null, available: false, reason: 'Views unavailable', definition, inputsUsed: [] };
  }
  if (views <= 0) {
    return {
      value: null,
      available: false,
      reason: 'Cannot divide by zero views',
      definition,
      inputsUsed: ['cost', 'views'],
    };
  }
  return {
    value: cost / (views / 1000),
    available: true,
    definition,
    inputsUsed: ['cost', 'views'],
  };
}

export function calculateCostPerEngagement(input: {
  costUsd: number | null | undefined;
  engagement: number | null | undefined;
}): CalculationResult {
  const definition =
    'Cost per engagement = production cost USD / total engagement actions. Requires engagement > 0.';
  if (input.costUsd == null || !Number.isFinite(input.costUsd)) {
    return { value: null, available: false, reason: 'Cost unavailable', definition, inputsUsed: [] };
  }
  if (input.engagement == null) {
    return {
      value: null,
      available: false,
      reason: 'Engagement unavailable',
      definition,
      inputsUsed: [],
    };
  }
  if (input.engagement <= 0) {
    return {
      value: null,
      available: false,
      reason: 'Cannot divide by zero engagement',
      definition,
      inputsUsed: ['cost', 'engagement'],
    };
  }
  return {
    value: input.costUsd / input.engagement,
    available: true,
    definition,
    inputsUsed: ['cost', 'engagement'],
  };
}

export function averageOfAvailable(values: Array<number | null | undefined>): CalculationResult {
  const definition =
    'Average of available numeric values only. Null/unavailable entries are excluded from the denominator.';
  const nums = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (nums.length === 0) {
    return {
      value: null,
      available: false,
      reason: 'No available values to average',
      definition,
      inputsUsed: [],
    };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    value: sum / nums.length,
    available: true,
    definition,
    inputsUsed: [`n=${nums.length}`],
  };
}

export function safeDivide(
  numerator: number | null | undefined,
  denominator: number | null | undefined,
  definition: string,
): CalculationResult {
  if (numerator == null || denominator == null) {
    return {
      value: null,
      available: false,
      reason: 'Numerator or denominator unavailable',
      definition,
      inputsUsed: [],
    };
  }
  if (denominator === 0) {
    return {
      value: null,
      available: false,
      reason: 'Cannot divide by zero',
      definition,
      inputsUsed: ['numerator', 'denominator'],
    };
  }
  return {
    value: numerator / denominator,
    available: true,
    definition,
    inputsUsed: ['numerator', 'denominator'],
  };
}

export function toAvailabilityMap(
  metrics: Record<string, OptionalMetric<number>>,
): Record<string, { status: string; reason?: string; definition?: string; nativeName?: string }> {
  const out: Record<
    string,
    { status: string; reason?: string; definition?: string; nativeName?: string }
  > = {};
  for (const [key, metric] of Object.entries(metrics)) {
    out[key] = {
      status: metric.status,
      reason: 'reason' in metric ? metric.reason : undefined,
      definition: metric.definition,
      nativeName: metric.nativeName,
    };
  }
  return out;
}

export function optionalToDbBigInt(metric: OptionalMetric<number>): bigint | null {
  const v = metricValueOrNull(metric);
  if (v == null) return null;
  return BigInt(Math.round(v));
}

export function optionalToDbFloat(metric: OptionalMetric<number>): number | null {
  return metricValueOrNull(metric);
}
