import type { ReactNode } from 'react';
import { chartTheme } from './chart-theme';

type PayloadItem = {
  name?: string;
  value?: number | string;
  color?: string;
  dataKey?: string | number;
};

type ChartTooltipProps = {
  active?: boolean;
  payload?: PayloadItem[];
  label?: string | number;
  formatter?: (value: number | string, name: string) => ReactNode;
};

export function ChartTooltip({ active, payload, label, formatter }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded-lg border border-border bg-card p-3 text-xs font-mono text-foreground shadow-xl"
      style={{
        background: chartTheme.tooltipBg,
        borderColor: chartTheme.tooltipBorder,
        color: chartTheme.tooltipText,
      }}
    >
      {label != null && label !== '' && (
        <div className="mb-2 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      )}
      <div className="space-y-1">
        {payload.map((item, index) => {
          const name = String(item.name ?? item.dataKey ?? 'value');
          const raw = item.value ?? '—';
          const display = formatter ? formatter(raw as number | string, name) : raw;
          return (
            <div key={`${name}-${index}`} className="flex items-center justify-between gap-4">
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: item.color ?? chartTheme.primary }}
                />
                {name}
              </span>
              <span className="font-medium text-foreground">{display}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
