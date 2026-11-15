import { Badge } from '@/components/ui/badge';
import { compact, money } from '@/lib/analytics';

type MetricState = 'number' | 'unavailable' | 'not-synced' | 'sync-failed' | 'estimated';

export function MetricValue({
  value,
  state = value == null ? 'unavailable' : 'number',
  format = 'number',
}: {
  value?: number | string | null;
  state?: MetricState;
  format?: 'number' | 'money' | 'percent' | 'text';
}) {
  if (state === 'sync-failed') return <Badge tone="danger">Sync failed</Badge>;
  if (state === 'not-synced') return <Badge tone="warning">Not synced</Badge>;
  if (value == null || state === 'unavailable')
    return <span className="text-sm text-muted-foreground">Unavailable</span>;

  const displayed =
    format === 'money'
      ? money(value)
      : format === 'percent'
        ? `${Number(value).toFixed(1)}%`
        : format === 'text'
          ? String(value)
          : compact(value);

  return (
    <span className="inline-flex items-center gap-2">
      <span>{displayed}</span>
      {state === 'estimated' && <Badge tone="info">Estimated</Badge>}
    </span>
  );
}
