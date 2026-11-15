import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, CalendarDays, Play, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { EmptyState } from '@/components/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

type Schedule = {
  id: string;
  status: string;
  currentStage?: string;
  progress?: number;
  lastError?: string | null;
  scheduledGenerationAt?: string | null;
  contentPlan?: { ideaTitle?: string | null } | null;
};

type Dashboard = {
  operationalStatus: string;
  blockers: string[];
  today: { date: string; generationTarget: number; planned: number; progress: number };
  generating: Schedule[];
  completedRendersToday: number;
  scheduledPublications: number;
  successfulPublications: number;
  failedPublications: number;
  monthlyGenerationCount: number;
  monthlyGenerationTarget: number;
  spend?: { dailyUsd?: number; monthlyUsd?: number };
  estimatedMonthlyProviderCostUsd: number | null;
  estimatedMonthlyProviderCostNote?: string;
  failedTasks: Schedule[];
  upcomingPublications: {
    id: string;
    platform: string;
    status: string;
    scheduledAt: string;
  }[];
};

const ACTIONS = [
  { key: 'enable', label: 'Enable', variant: 'default' },
  { key: 'pause', label: 'Pause', variant: 'outline' },
  { key: 'resume', label: 'Resume', variant: 'outline' },
  { key: 'emergency-stop', label: 'Emergency Stop', variant: 'destructive' },
  { key: 'run-now', label: 'Run Now', variant: 'secondary' },
] as const;

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function AutomationDashboardPage() {
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automation', 'dashboard'],
    refetchInterval: 10000,
    queryFn: async () => (await api.get('/automation/dashboard')).data.data as Dashboard,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['automation'] });

  const actionMutation = useMutation({
    mutationFn: async (key: string) => api.post(`/automation/${key}`),
    onSuccess: (_, key) => {
      toast.success(`Action "${key}" completed`);
      void invalidate();
    },
    onError: (_, key) => toast.error(`Action "${key}" failed`),
  });

  const retryMutation = useMutation({
    mutationFn: async (scheduleId: string) => {
      const res = await api.get('/automation/executions', {
        params: { contentScheduleId: scheduleId, limit: 1 },
      });
      const execution = (res.data.data as { id: string }[])[0];
      if (!execution) throw new Error('No execution found');
      return api.post(`/automation/executions/${execution.id}/retry`);
    },
    onSuccess: () => {
      toast.success('Retry queued');
      void invalidate();
    },
    onError: () => toast.error('Retry failed — no retryable execution for this schedule'),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data)
    return <ErrorState message="Failed to load automation" onRetry={() => void refetch()} />;

  const busy = actionMutation.isPending;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automation</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Daily planning, generation and publishing at a glance.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Link
            to="/automation/calendar"
            className="inline-flex h-10 items-center gap-2 rounded-md border px-4 text-sm"
          >
            <CalendarDays className="h-4 w-4" />
            Calendar
          </Link>
          <Link
            to="/automation/executions"
            className="inline-flex h-10 items-center rounded-md border px-4 text-sm"
          >
            Executions
          </Link>
          <Link
            to="/automation/settings"
            className="inline-flex h-10 items-center rounded-md border px-4 text-sm"
          >
            Settings
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Bot className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Operational status</span>
            <Badge tone={statusTone(data.operationalStatus)}>{data.operationalStatus}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((action) => (
              <Button
                key={action.key}
                size="sm"
                variant={action.variant}
                disabled={busy}
                onClick={() => {
                  if (
                    action.key === 'emergency-stop' &&
                    !window.confirm('Emergency stop will halt all automation. Continue?')
                  )
                    return;
                  actionMutation.mutate(action.key);
                }}
              >
                {action.key === 'run-now' && <Play className="mr-1 h-3 w-3" />}
                {action.label}
              </Button>
            ))}
          </div>
        </div>
        {data.blockers.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm text-amber-300">
            {data.blockers.map((blocker) => (
              <li key={blocker}>• {blocker}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label={`Today (${data.today.date})`}
          value={`${data.today.planned} / ${data.today.generationTarget}`}
          hint={`${data.today.progress}% of daily target planned`}
        />
        <Stat label="Completed renders today" value={data.completedRendersToday} />
        <Stat label="Scheduled publications" value={data.scheduledPublications} />
        <Stat
          label="Published / Failed"
          value={`${data.successfulPublications} / ${data.failedPublications}`}
        />
        <Stat
          label="Monthly generation"
          value={`${data.monthlyGenerationCount} / ${data.monthlyGenerationTarget}`}
        />
        <Stat
          label="Spend today / month"
          value={`$${(data.spend?.dailyUsd ?? 0).toFixed(2)} / $${(data.spend?.monthlyUsd ?? 0).toFixed(2)}`}
        />
        <div className="rounded-xl border border-border bg-card p-4 sm:col-span-2">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Estimated monthly cost
          </div>
          <div className="mt-1 text-2xl font-semibold">
            {data.estimatedMonthlyProviderCostUsd != null
              ? `~$${data.estimatedMonthlyProviderCostUsd.toFixed(2)}`
              : 'Not enough data'}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Estimate only, not a billing invoice.{' '}
            {data.estimatedMonthlyProviderCostNote}
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Generating now</h2>
        {data.generating.length === 0 ? (
          <EmptyState
            icon={Bot}
            title="Nothing generating"
            description="Videos currently being generated or rendered will appear here."
          />
        ) : (
          data.generating.map((item) => (
            <div key={item.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-medium">
                  {item.contentPlan?.ideaTitle ?? `Schedule ${item.id.slice(0, 8)}`}
                </div>
                <div className="flex gap-2">
                  {item.currentStage && <Badge>{item.currentStage}</Badge>}
                  <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                </div>
              </div>
              <div className="mt-2 h-1.5 w-48 overflow-hidden rounded bg-slate-200">
                <div
                  className="h-full bg-slate-800"
                  style={{ width: `${Math.min(100, item.progress ?? 0)}%` }}
                />
              </div>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Upcoming publications</h2>
        {data.upcomingPublications.length === 0 ? (
          <p className="text-sm text-muted-foreground">No upcoming publications.</p>
        ) : (
          data.upcomingPublications.map((pub) => (
            <div
              key={pub.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm"
            >
              <div>
                <span className="font-medium">{pub.platform}</span> ·{' '}
                {new Date(pub.scheduledAt).toLocaleString()}
              </div>
              <Badge tone={statusTone(pub.status)}>{pub.status}</Badge>
            </div>
          ))
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Failed tasks</h2>
        {data.failedTasks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failed tasks.</p>
        ) : (
          data.failedTasks.map((task) => (
            <div key={task.id} className="rounded-xl border border-border bg-card px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    {task.contentPlan?.ideaTitle ?? 'Untitled'}{' '}
                    <span className="text-xs font-normal text-muted-foreground">
                      schedule {task.id}
                    </span>
                  </div>
                  {task.lastError && <p className="mt-1 text-sm text-destructive">{task.lastError}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={statusTone(task.status)}>{task.status}</Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={retryMutation.isPending}
                    onClick={() => retryMutation.mutate(task.id)}
                  >
                    Retry
                  </Button>
                </div>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
