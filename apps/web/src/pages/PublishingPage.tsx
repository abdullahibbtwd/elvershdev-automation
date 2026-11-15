import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, History, RefreshCw } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';
import { toast } from 'sonner';

type Publication = {
  id: string;
  platform: string;
  status: string;
  title?: string | null;
  caption?: string | null;
  postUrl?: string | null;
  uploadProgress?: number;
  errorMessage?: string | null;
  errorCode?: string | null;
  retryCount?: number;
  publishedAt?: string | null;
  createdAt: string;
  channel?: { accountName?: string; platform?: string } | null;
  videoRender?: { id?: string; storyId?: string } | null;
  videoProject?: { title?: string } | null;
};

const ACTIVE = new Set([
  'QUEUED',
  'VALIDATING',
  'UPLOADING',
  'PROCESSING',
  'PUBLISHING',
  'ACTION_REQUIRED',
]);

export function PublishingPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['publishing'],
    refetchInterval: (query) => {
      const items = (query.state.data as { data: Publication[] } | undefined)?.data;
      return items?.some((item) => ACTIVE.has(item.status)) ? 3000 : false;
    },
    queryFn: async () => {
      const res = await api.get('/publishing', { params: { limit: 50 } });
      return res.data as { data: Publication[] };
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/publishing/${id}/retry`),
    onSuccess: () => {
      toast.success('Retry queued');
      void queryClient.invalidateQueries({ queryKey: ['publishing'] });
    },
    onError: () => toast.error('Retry failed'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/publishing/${id}/cancel`),
    onSuccess: () => {
      toast.success('Publication cancelled');
      void queryClient.invalidateQueries({ queryKey: ['publishing'] });
    },
    onError: () => toast.error('Cancel failed'),
  });

  const items = data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Publishing History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track on-demand publishes to connected channels. Retries check provider status before
            re-uploading to avoid duplicate posts.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load publishing history" onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={History}
          title="No publishing history"
          description="Publish a completed render from a story page to see progress and post links here."
        />
      ) : (
        <div className="space-y-3">
          {items.map((record) => (
            <div key={record.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {record.channel?.accountName ||
                      record.videoProject?.title ||
                      'Untitled'}{' '}
                    · {record.platform}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {record.title || record.caption || 'No caption'} ·{' '}
                    {new Date(record.createdAt).toLocaleString()}
                  </div>
                  {typeof record.uploadProgress === 'number' && ACTIVE.has(record.status) && (
                    <div className="mt-2 h-1.5 w-48 overflow-hidden rounded bg-slate-200">
                      <div
                        className="h-full bg-slate-800"
                        style={{ width: `${Math.min(100, record.uploadProgress)}%` }}
                      />
                    </div>
                  )}
                  {record.errorMessage && (
                    <p className="mt-2 text-sm text-destructive">
                      {record.errorCode ? `${record.errorCode}: ` : ''}
                      {record.errorMessage}
                    </p>
                  )}
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge tone={statusTone(record.status)}>{record.status}</Badge>
                  <div className="flex flex-wrap justify-end gap-2">
                    {record.postUrl && (
                      <a
                        href={record.postUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs"
                      >
                        <ExternalLink className="h-3 w-3" />
                        View post
                      </a>
                    )}
                    {(record.status === 'FAILED' || record.status === 'ACTION_REQUIRED') && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => retryMutation.mutate(record.id)}
                        disabled={retryMutation.isPending}
                      >
                        Retry
                      </Button>
                    )}
                    {['DRAFT', 'QUEUED', 'VALIDATING'].includes(record.status) && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => cancelMutation.mutate(record.id)}
                        disabled={cancelMutation.isPending}
                      >
                        Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
