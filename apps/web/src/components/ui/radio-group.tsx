import { cn } from '@/lib/utils';

export type RadioOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

export type RadioGroupProps = {
  name: string;
  value?: string;
  defaultValue?: string;
  options: RadioOption[];
  onChange?: (value: string) => void;
  className?: string;
  orientation?: 'vertical' | 'horizontal';
};

export function RadioGroup({
  name,
  value,
  defaultValue,
  options,
  onChange,
  className,
  orientation = 'vertical',
}: RadioGroupProps) {
  return (
    <div
      role="radiogroup"
      className={cn(
        'grid gap-2',
        orientation === 'horizontal' && 'sm:grid-cols-2 lg:grid-cols-3',
        className,
      )}
    >
      {options.map((option) => {
        const checked = value != null ? value === option.value : undefined;
        return (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-card px-3 py-3 transition-all duration-200',
              'hover:border-primary/40 hover:bg-accent/40',
              'has-[:checked]:border-primary has-[:checked]:bg-primary/10 has-[:checked]:shadow-[0_0_12px_rgba(0,194,214,0.15)]',
              'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={checked}
              defaultChecked={defaultValue === option.value}
              disabled={option.disabled}
              onChange={() => onChange?.(option.value)}
              className="mt-1 h-4 w-4 border-input accent-primary"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}
