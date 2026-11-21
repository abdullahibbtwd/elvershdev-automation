import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { api } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';

export function SystemOpsPage() {
  const user = useAuthStore((s) => s.user);
  const queryClient = useQueryClient();
  const [confirmBackup, setConfirmBackup] = useState(false);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['ops-overview'],
    queryFn: async () => {
      const res = await api.get('/ops/overview');
      return res.data.data ?? res.data;
    },
    refetchInterval: 15_000,
    enabled: user?.role === 'ADMIN',
  });

  const { data: alerts } = useQuery({
    queryKey: ['ops-alerts'],
    queryFn: async () => {
      const res = await api.get('/ops/alerts');
      return res.data.data ?? res.data;
    },
    enabled: user?.role === 'ADMIN',
  });

  const { data: failedJobs } = useQuery({
    queryKey: ['ops-failed-jobs'],
    queryFn: async () => {
      const res = await api.get('/ops/jobs/failed', { params: { limit: 20 } });
      return res.data.data ?? res.data;
    },
    enabled: user?.role === 'ADMIN',
  });

  const diagnostics = useMutation({
    mutationFn: async () => api.post('/ops/diagnostics'),
    onSuccess: (res) => {
      toast.success(res.data?.data?.ok || res.data?.ok ? 'Diagnostics OK' : 'Diagnostics found issues');
      void queryClient.invalidateQueries({ queryKey: ['ops-overview'] });
    },
    onError: () => toast.error('Diagnostics failed'),
  });

  const backup = useMutation({
    mutationFn: async () => api.post('/ops/backup', { confirm: 'BACKUP' }),
    onSuccess: () => {
      toast.success('Backup triggered');
      setConfirmBackup(false);
      void queryClient.invalidateQueries({ queryKey: ['ops-overview'] });
    },
    onError: () => toast.error('Backup failed'),
  });

  const setStage = useMutation({
    mutationFn: async (stage: string) => api.post('/ops/rollout', { stage }),
    onSuccess: () => {
      toast.success('Rollout stage updated');
      void queryClient.invalidateQueries({ queryKey: ['ops-overview'] });
    },
    onError: () => toast.error('Failed to update rollout stage'),
  });

  const globalPause = useMutation({
    mutationFn: async (paused: boolean) => api.post('/ops/automation/global-pause', { paused }),
    onSuccess: (_, paused) => {
      toast.success(paused ? 'Global automation paused' : 'Global automation resumed');
    },
    onError: () => toast.error('Failed to update automation pause'),
  });

  const retryJob = useMutation({
    mutationFn: async (id: string) => api.post(`/ops/jobs/${id}/retry`),
    onSuccess: () => {
      toast.success('Job requeued');
      void queryClient.invalidateQueries({ queryKey: ['ops-failed-jobs'] });
    },
    onError: () => toast.error('Retry failed'),
  });

  if (user?.role !== 'ADMIN') {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-6 text-sm text-amber-200">
        System operations require the ADMIN role. Ask an administrator to promote your account via
        <code className="mx-1">POST /api/ops/promote-admin</code>.
      </div>
    );
  }

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load system health" onRetry={() => void refetch()} />;

  const components = data?.components ?? {};
  const queues = Array.isArray(data?.queues) ? data.queues : [];
  const providers = data?.providers ?? {};
  const alertList = Array.isArray(alerts) ? alerts : [];
  const failed = Array.isArray(failedJobs) ? failedJobs : [];

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">System operations</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Environment {data?.environment} · version {data?.version} · rollout {data?.rolloutStage}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => diagnostics.mutate()} disabled={diagnostics.isPending}>
            Run diagnostics
          </Button>
          <Button variant="outline" onClick={() => globalPause.mutate(true)}>
            Pause automation
          </Button>
          <Button variant="outline" onClick={() => globalPause.mutate(false)}>
            Resume automation
          </Button>
          <Button onClick={() => setConfirmBackup(true)}>Trigger backup…</Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmBackup}
        onOpenChange={setConfirmBackup}
        title="Trigger backup?"
        description="This starts a system backup job. Type BACKUP to confirm."
        confirmPhrase="BACKUP"
        confirmLabel="Trigger backup"
        variant="destructive"
        pending={backup.isPending}
        onConfirm={() => backup.mutate()}
      />

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {Object.entries(components).map(([name, info]) => {
          const status = (info as { status?: string })?.status ?? 'unknown';
          return (
            <div key={name} className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{name}</div>
              <div
                className={`mt-1 text-lg font-semibold ${
                  status === 'up' ? 'text-emerald-700' : 'text-rose-700'
                }`}
              >
                {status}
              </div>
            </div>
          );
        })}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Rollout stage</h2>
        <div className="flex flex-wrap gap-2">
          {(['A', 'B', 'C', 'D', 'E'] as const).map((stage) => (
            <Button
              key={stage}
              variant={data?.rolloutStage === stage ? 'default' : 'outline'}
              size="sm"
              onClick={() => setStage.mutate(stage)}
            >
              Stage {stage}
            </Button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          A infrastructure · B mock testing · C controlled live · D limited automation · E full
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Resources</h2>
        <div className="rounded-xl border border-border bg-card p-4 text-sm text-foreground">
          <div>Memory used: {data?.resources?.memory?.usedPercent ?? '—'}%</div>
          <div>Process RSS: {Math.round((data?.resources?.memory?.processRssBytes ?? 0) / 1024 / 1024)} MB</div>
          <div>CPU cores: {data?.resources?.cpuCount ?? '—'}</div>
          <div>
            Last backup:{' '}
            {data?.lastSuccessfulBackup?.completedAt
              ? new Date(data.lastSuccessfulBackup.completedAt).toLocaleString()
              : 'none recorded'}
          </div>
          <div>
            Last analytics sync:{' '}
            {data?.lastSuccessfulAnalyticsSync?.completedAt
              ? new Date(data.lastSuccessfulAnalyticsSync.completedAt).toLocaleString()
              : 'none'}
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Queues</h2>
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-secondary/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Queue</th>
                <th className="px-3 py-2">Waiting</th>
                <th className="px-3 py-2">Active</th>
                <th className="px-3 py-2">Delayed</th>
                <th className="px-3 py-2">Failed</th>
                <th className="px-3 py-2">Paused</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q: Record<string, unknown>) => (
                <tr key={String(q.name)} className="border-b last:border-0">
                  <td className="px-3 py-2 font-medium">{String(q.name)}</td>
                  <td className="px-3 py-2">{String(q.waiting ?? '—')}</td>
                  <td className="px-3 py-2">{String(q.active ?? '—')}</td>
                  <td className="px-3 py-2">{String(q.delayed ?? '—')}</td>
                  <td className="px-3 py-2">{String(q.failed ?? '—')}</td>
                  <td className="px-3 py-2">{q.paused ? 'yes' : 'no'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Providers</h2>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Object.entries(providers).map(([name, info]) => (
            <div key={name} className="rounded-xl border border-border bg-card p-3 text-sm">
              <div className="font-medium capitalize">{name}</div>
              <div className="text-muted-foreground">{(info as { status?: string }).status}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Open alerts</h2>
        {alertList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No alerts.</p>
        ) : (
          <ul className="space-y-2">
            {alertList.slice(0, 20).map((a: Record<string, unknown>) => (
              <li key={String(a.id)} className="rounded-xl border border-border bg-card p-3 text-sm">
                <div className="font-medium">
                  [{String(a.severity)}] {String(a.title)}
                </div>
                <div className="text-muted-foreground">{String(a.body)}</div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">Failed jobs</h2>
        {failed.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failed jobs.</p>
        ) : (
          <ul className="space-y-2">
            {failed.map((job: Record<string, unknown>) => (
              <li
                key={String(job.id)}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card p-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {String(job.jobType)} · {String(job.id).slice(0, 8)}
                  </div>
                  <div className="text-muted-foreground">{String(job.errorMessage ?? '—')}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => retryJob.mutate(String(job.id))}>
                  Retry
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
