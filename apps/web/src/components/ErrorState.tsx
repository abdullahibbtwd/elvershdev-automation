import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Card className="border-destructive/40 bg-destructive/5">
      <CardContent className="px-4 py-8 text-center">
        <p className="text-sm text-destructive">{message}</p>
        {onRetry ? (
          <Button variant="outline" size="sm" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
