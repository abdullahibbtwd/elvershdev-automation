import { Card, CardContent } from '@/components/ui/card';
import { MetricValue } from './MetricValue';

export function MetricCard({
  label,
  value,
  hint,
  format,
  estimated,
}: {
  label: string;
  value?: number | string | null;
  hint?: string;
  format?: 'number' | 'money' | 'percent' | 'text';
  estimated?: boolean;
}) {
  return (
    <Card interactive className="hover:border-primary/40">
      <CardContent className="p-5">
        <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">
          <MetricValue value={value} format={format} state={estimated ? 'estimated' : undefined} />
        </div>
        {hint ? <div className="mt-1.5 text-xs text-muted-foreground">{hint}</div> : null}
      </CardContent>
    </Card>
  );
}
