import { cn } from '@/lib/utils';

const tones: Record<string, string> = {
  default: 'bg-secondary text-secondary-foreground',
  success: 'bg-emerald-500/15 text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-300',
  danger: 'bg-red-500/15 text-red-400',
  info: 'bg-sky-500/15 text-sky-300',
};

export function Badge({
  children,
  tone = 'default',
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium transition-all duration-200',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
