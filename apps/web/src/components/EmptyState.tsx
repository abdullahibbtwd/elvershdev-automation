import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actionLabel,
  onAction,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const resolvedAction =
    action ??
    (actionLabel && onAction ? (
      <Button size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    ) : null);

  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center justify-center px-6 py-12 text-center">
        {Icon ? (
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
        ) : null}
        {resolvedAction ? <div className="mt-4">{resolvedAction}</div> : null}
      </CardContent>
    </Card>
  );
}
