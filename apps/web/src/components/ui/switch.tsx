import * as React from 'react';
import { cn } from '@/lib/utils';

export type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  label?: React.ReactNode;
  description?: React.ReactNode;
};

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked = false, onCheckedChange, label, description, className, disabled, id, ...props }, ref) => {
    const autoId = React.useId();
    const switchId = id ?? autoId;

    const control = (
      <button
        ref={ref}
        id={switchId}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onCheckedChange?.(!checked)}
        className={cn(
          'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-all duration-200',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'border-primary bg-primary' : 'border-input bg-secondary',
          !label && className,
        )}
        {...props}
      >
        <span
          className={cn(
            'pointer-events-none block h-5 w-5 rounded-full bg-background shadow transition-transform duration-200',
            checked ? 'translate-x-[1.35rem]' : 'translate-x-0.5',
          )}
        />
      </button>
    );

    if (!label && !description) return control;

    return (
      <div
        className={cn(
          'flex items-start justify-between gap-4 rounded-lg border border-border bg-card px-4 py-3',
          className,
        )}
      >
        <label htmlFor={switchId} className="min-w-0 cursor-pointer space-y-0.5">
          <div className="text-sm font-medium text-foreground">{label}</div>
          {description ? (
            <div className="text-xs text-muted-foreground">{description}</div>
          ) : null}
        </label>
        {control}
      </div>
    );
  },
);
Switch.displayName = 'Switch';
