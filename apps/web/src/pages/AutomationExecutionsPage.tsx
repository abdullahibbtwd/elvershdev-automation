import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Cog, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

type Execution = {
  id: string;
  contentScheduleId?: string | null;
  stage: string;
  status: string;
  attemptNumber: number;
  lastError?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt: string;
};

export function AutomationExecutionsPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automation', 'executions'],
    refetchInterval: 10000,
    queryFn: async () =>
      (await api.get('/automation/executions', { params: { limit: 50 } })).data
        .data as Execution[],
  });

  const retry = useMutation({
    mutationFn: async (id: string) => api.post(`/automation/executions/${id}/retry`),
    onSuccess: () => {
      toast.success('Retry queued');
      void queryClient.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: () => toast.error('Retry failed'),
  });

  const items = data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automation Executions</h1>
          <p className="mt-1 text-sm text-muted-foreground">Pipeline stage runs and their outcomes.</p>
        </div>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load executions" onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Cog}
          title="No executions yet"
          description="Executions appear once automation starts processing scheduled content."
        />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {item.stage}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      attempt {item.attemptNumber}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {new Date(item.createdAt).toLocaleString()}
                    {item.contentScheduleId && ` · schedule ${item.contentScheduleId.slice(0, 8)}`}
                  </div>
                  {item.lastError && <p className="mt-2 text-sm text-destructive">{item.lastError}</p>}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                  {['FAILED', 'STALLED', 'BUDGET_BLOCKED'].includes(item.status) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={retry.isPending}
                      onClick={() => retry.mutate(item.id)}
                    >
                      Retry
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
