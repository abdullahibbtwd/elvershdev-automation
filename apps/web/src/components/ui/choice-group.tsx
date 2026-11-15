import { cn } from '@/lib/utils';

export type ChoiceOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
};

type SingleProps = {
  multiple?: false;
  value?: string;
  onChange?: (value: string) => void;
};

type MultiProps = {
  multiple: true;
  value?: string[];
  onChange?: (value: string[]) => void;
};

export type ChoiceGroupProps = {
  options: ChoiceOption[];
  className?: string;
  size?: 'sm' | 'md';
  variant?: 'segmented' | 'cards';
} & (SingleProps | MultiProps);

export function ChoiceGroup(props: ChoiceGroupProps) {
  const { options, className, size = 'md', variant = 'segmented' } = props;
  const selected = new Set(
    props.multiple ? (props.value ?? []) : props.value ? [props.value] : [],
  );

  const toggle = (next: string) => {
    if (props.multiple) {
      const current = new Set(props.value ?? []);
      if (current.has(next)) current.delete(next);
      else current.add(next);
      props.onChange?.([...current]);
      return;
    }
    props.onChange?.(next);
  };

  if (variant === 'cards') {
    return (
      <div className={cn('grid gap-2 sm:grid-cols-2', className)}>
        {options.map((option) => {
          const active = selected.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              disabled={option.disabled}
              aria-pressed={active}
              onClick={() => toggle(option.value)}
              className={cn(
                'rounded-lg border px-4 py-3 text-left transition-all duration-200',
                'border-border bg-card hover:border-primary/40 hover:bg-accent/40',
                'disabled:cursor-not-allowed disabled:opacity-50',
                active &&
                  'border-primary bg-primary/10 text-primary shadow-[0_0_12px_rgba(0,194,214,0.15)]',
              )}
            >
              <div className={cn('font-medium', size === 'sm' ? 'text-xs' : 'text-sm')}>
                {option.label}
              </div>
              {option.description ? (
                <div className="mt-1 text-xs text-muted-foreground">{option.description}</div>
              ) : null}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'inline-flex flex-wrap gap-1 rounded-lg border border-border bg-secondary/40 p-1',
        className,
      )}
    >
      {options.map((option) => {
        const active = selected.has(option.value);
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            aria-pressed={active}
            onClick={() => toggle(option.value)}
            className={cn(
              'rounded-md px-3 font-medium transition-all duration-200',
              size === 'sm' ? 'h-8 text-xs' : 'h-9 text-sm',
              'text-muted-foreground hover:bg-accent hover:text-foreground',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active &&
                'bg-primary text-primary-foreground shadow-[0_0_12px_rgba(0,194,214,0.2)] hover:bg-primary hover:text-primary-foreground',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
