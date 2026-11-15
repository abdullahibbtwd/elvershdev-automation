import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
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
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label htmlFor="date-range-preset">Date range</Label>
        <Select
          id="date-range-preset"
          className="w-[180px]"
          value={value.preset}
          onChange={(event) =>
            onChange({ ...value, preset: event.target.value as DatePreset })
          }
          options={presets}
        />
      </div>
      {value.preset === 'custom' && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="date-range-from">From</Label>
            <Input
              id="date-range-from"
              type="date"
              value={value.from ?? ''}
              onChange={(event) => onChange({ ...value, from: event.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="date-range-to">To</Label>
            <Input
              id="date-range-to"
              type="date"
              value={value.to ?? ''}
              onChange={(event) => onChange({ ...value, to: event.target.value })}
            />
          </div>
        </>
      )}
    </div>
  );
}
