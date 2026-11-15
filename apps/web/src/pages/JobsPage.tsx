import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Workflow } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

const JOB_TYPES = [
  'STORY',
  'IMAGE',
  'VIDEO',
  'NARRATION_PLANNING',
  'VOICE',
  'RENDER',
  'PUBLISH',
  'ANALYTICS',
] as const;

export function JobsPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [jobType, setJobType] = useState<(typeof JOB_TYPES)[number]>('STORY');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['jobs', status],
    refetchInterval: 3000,
    queryFn: async () => {
      const res = await api.get('/jobs', {
        params: { status: status || undefined, limit: 50 },
      });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      api.post('/jobs', {
        jobType,
        provider: 'placeholder',
        estimatedCost: 0,
        payload: { source: 'dashboard' },
      }),
    onSuccess: () => {
      toast.success('Job queued');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => toast.error('Failed to create job'),
  });

  const cancelMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/jobs/${id}/cancel`),
    onSuccess: () => {
      toast.success('Job cancelled');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  const retryMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/jobs/${id}/retry`),
    onSuccess: () => {
      toast.success('Job retried');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Generation Jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Queue placeholder processors to verify BullMQ status sync.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <Select
          className="w-[200px]"
          value={jobType}
          onChange={(e) => setJobType(e.target.value as (typeof JOB_TYPES)[number])}
          options={JOB_TYPES.map((type) => ({ value: type, label: type }))}
        />
        <Button onClick={() => createMutation.mutate()} disabled={createMutation.isPending}>
          Queue job
        </Button>
        <Select
          className="ml-auto w-[180px]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            ...['PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED'].map((s) => ({
              value: s,
              label: s,
            })),
          ]}
        />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load jobs" onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title="No generation jobs"
          description="Queue a placeholder job to exercise the worker pipeline."
          actionLabel="Queue story job"
          onAction={() => createMutation.mutate()}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Progress</th>
                <th className="px-4 py-3 font-medium">Provider</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map(
                (job: {
                  id: string;
                  jobType: string;
                  status: string;
                  progress: number;
                  provider?: string;
                  errorMessage?: string;
                }) => (
                  <tr key={job.id} className="border-b last:border-0">
                    <td className="px-4 py-3 font-medium">{job.jobType}</td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                      {job.errorMessage ? (
                        <div className="mt-1 max-w-xs truncate text-xs text-destructive">
                          {job.errorMessage}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">{job.progress}%</td>
                    <td className="px-4 py-3 text-muted-foreground">{job.provider || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        {['PENDING', 'QUEUED'].includes(job.status) ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => cancelMutation.mutate(job.id)}
                          >
                            Cancel
                          </Button>
                        ) : null}
                        {['FAILED', 'CANCELLED'].includes(job.status) ? (
                          <Button size="sm" onClick={() => retryMutation.mutate(job.id)}>
                            Retry
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
