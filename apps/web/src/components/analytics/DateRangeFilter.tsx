import { Input } from '@/components/ui/input';
import type { DatePreset, RangeParams } from '@/lib/analytics';

const presets: Array<{ value: DatePreset; label: string }> = [
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'last_90_days', label: 'Last 90 days' },
  { value: 'this_month', label: 'This month' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'custom', label: 'Custom' },
];

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: RangeParams;
  onChange: (value: RangeParams) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="text-xs font-medium text-muted-foreground">
        Date range
        <select
          className="mt-1 block h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground transition-all duration-200 hover:border-primary/40"
          value={value.preset}
          onChange={(event) =>
            onChange({ ...value, preset: event.target.value as DatePreset })
          }
        >
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </label>
      {value.preset === 'custom' && (
        <>
          <label className="text-xs font-medium text-muted-foreground">
            From
            <Input
              className="mt-1"
              type="date"
              value={value.from ?? ''}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            To
            <Input
              className="mt-1"
              type="date"
              value={value.to ?? ''}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
          </label>
        </>
      )}
    </div>
  );
}
