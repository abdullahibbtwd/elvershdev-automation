import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard,
  Copy,
  Library,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { seriesApi, type SeriesLane } from '@/lib/series-api';
import { statusTone } from '@/lib/status';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function formatWhen(value?: string | Date | null) {
  if (!value) return null;
  return new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function laneStatusLabel(lane: SeriesLane, displayState?: string) {
  if (!lane.enabled || lane.status === 'DISABLED') return { label: 'Off', tone: 'default' as const };
  if (lane.status === 'PAUSED') return { label: 'Paused', tone: 'warning' as const };
  if (displayState && displayState !== 'Idle' && displayState !== '…') {
    return { label: displayState, tone: statusTone(displayState) };
  }
  return { label: 'Ready', tone: 'success' as const };
}

function LaneCard({
  lane,
  onChanged,
}: {
  lane: SeriesLane;
  onChanged: () => void;
}) {
  const [confirmRun, setConfirmRun] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [useMockAi, setUseMockAi] = useState(false);

  const execView = useQuery({
    queryKey: ['series', 'lane-exec', lane.id],
    queryFn: () => seriesApi.laneExecutionView(lane.id),
    refetchInterval: 10_000,
  });

  const pause = useMutation({
    mutationFn: () => seriesApi.pauseLane(lane.id),
    onSuccess: () => {
      toast.success(`${lane.name} paused`);
      onChanged();
    },
    onError: () => toast.error('Failed to pause lane'),
  });
  const resume = useMutation({
    mutationFn: () => seriesApi.resumeLane(lane.id),
    onSuccess: () => {
      toast.success(`${lane.name} resumed`);
      onChanged();
    },
    onError: () => toast.error('Failed to resume lane'),
  });
  const duplicate = useMutation({
    mutationFn: () => seriesApi.duplicateLane(lane.id),
    onSuccess: () => {
      toast.success('Lane duplicated');
      onChanged();
    },
    onError: () => toast.error('Failed to duplicate lane'),
  });
  const remove = useMutation({
    mutationFn: () => seriesApi.deleteLane(lane.id),
    onSuccess: () => {
      setConfirmDelete(false);
      toast.success('Lane deleted');
      onChanged();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to delete lane';
      toast.error(String(message));
    },
  });
  const reset = useMutation({
    mutationFn: () => seriesApi.resetLane(lane.id),
    onSuccess: (data) => {
      setConfirmReset(false);
      toast.success(`${lane.name} reset`, {
        description: `Deleted ${data.deleted.seriesCount} movie(s), ${data.deleted.scheduleCount} schedule(s). Lane is paused.`,
      });
      onChanged();
      void execView.refetch();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to reset lane';
      toast.error(String(message));
    },
  });
  const runNow = useMutation({
    mutationFn: () => seriesApi.runLaneNow(lane.id, { useMockAi }),
    onSuccess: (data) => {
      const reason = String(data.reason ?? 'Queued');
      if (data.awaitingApproval) toast.message('Approval required', { description: reason });
      else if (data.skipped) toast.message('Skipped', { description: reason });
      else toast.success('Run Now queued', { description: reason });
      setConfirmRun(false);
      onChanged();
      void execView.refetch();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Run Now failed';
      toast.error(String(message));
    },
  });
  const produceNext = useMutation({
    mutationFn: () => seriesApi.produceNextEpisode(lane.id, { useMockAi }),
    onSuccess: () => {
      toast.success('Produce Next Episode queued');
      onChanged();
      void execView.refetch();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Produce Next failed';
      toast.error(String(message));
    },
  });
  const planMovie = useMutation({
    mutationFn: () =>
      seriesApi.planMovies({
        lanes: [{ laneId: lane.id, ideaMode: 'generate' }],
        startMediaProduction: false,
        useMockAi,
        async: true,
      }),
    onSuccess: () => {
      toast.success('Movie plan queued (media not started)');
      onChanged();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Plan Movie failed';
      toast.error(String(message));
    },
  });

  const busy =
    pause.isPending ||
    resume.isPending ||
    duplicate.isPending ||
    remove.isPending ||
    reset.isPending ||
    runNow.isPending ||
    produceNext.isPending ||
    planMovie.isPending;

  const view = execView.data;
  const hasMovie = Boolean(lane.activeSeries);
  const isPaused = lane.status === 'PAUSED' || lane.status === 'DISABLED' || !lane.enabled;
  const status = laneStatusLabel(lane, view?.displayState);
  const nextPublish = formatWhen(view?.nextPublishAt ?? lane.nextPublishAt);
  const nextAction =
    view?.nextActionReason ??
    (hasMovie ? 'Working on the next step…' : 'No movie yet — plan one to get started');

  const headline = useMemo(() => {
    if (!hasMovie) return 'No movie yet';
    const series = lane.activeSeries!;
    return `${series.title} · Ep ${series.currentEpisodeNumber}/${series.plannedEpisodeCount}`;
  }, [hasMovie, lane.activeSeries]);

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{lane.name}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Publishes daily at {lane.publishTime} ({lane.timezone})
          </p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <div className="space-y-1">
        {hasMovie ? (
          <Link
            to={`/series/${lane.activeSeries!.id}`}
            className="block text-base font-medium text-foreground hover:text-primary"
          >
            {headline}
          </Link>
        ) : (
          <p className="text-base font-medium text-foreground">{headline}</p>
        )}
        <p className="text-sm text-muted-foreground">{nextAction}</p>
        {nextPublish ? (
          <p className="text-sm text-muted-foreground">Next publish · {nextPublish}</p>
        ) : null}
        {view?.blocker ? (
          <p className="text-sm text-amber-600 dark:text-amber-400">{view.blocker}</p>
        ) : null}
        {view?.lastExecution?.errorMessage ? (
          <p className="text-sm text-destructive">{view.lastExecution.errorMessage}</p>
        ) : null}
      </div>

      <div className="mt-auto flex flex-wrap items-center gap-2">
        {!hasMovie ? (
          <Button disabled={busy} onClick={() => planMovie.mutate()}>
            <Clapperboard className="mr-1.5 h-4 w-4" />
            Plan Movie
          </Button>
        ) : (
          <>
            <Link
              to={`/series/${lane.activeSeries!.id}`}
              className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open movie
            </Link>
            <Button variant="outline" disabled={busy} onClick={() => setConfirmRun(true)}>
              <Play className="mr-1.5 h-4 w-4" />
              Run next step
            </Button>
          </>
        )}

        {isPaused ? (
          <Button variant="outline" disabled={busy} onClick={() => resume.mutate()}>
            <Play className="mr-1.5 h-4 w-4" />
            Resume
          </Button>
        ) : (
          <Button variant="outline" disabled={busy} onClick={() => pause.mutate()}>
            <Pause className="mr-1.5 h-4 w-4" />
            Pause
          </Button>
        )}

        <Button
          size="icon"
          variant="ghost"
          className="ml-auto"
          aria-label={showMore ? 'Hide more actions' : 'More actions'}
          onClick={() => setShowMore((v) => !v)}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {showMore ? (
        <div className="flex flex-wrap gap-2 border-t border-border pt-3">
          {hasMovie ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => planMovie.mutate()}>
              <Clapperboard className="mr-1 h-3 w-3" />
              Plan new movie
            </Button>
          ) : null}
          {hasMovie ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => produceNext.mutate()}>
              Produce next episode
            </Button>
          ) : null}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => duplicate.mutate()}>
            <Copy className="mr-1 h-3 w-3" />
            Duplicate
          </Button>
          <Link
            to="/series/settings"
            className="inline-flex h-9 items-center gap-1 rounded-md border border-input px-3 text-sm"
          >
            <Settings className="h-3 w-3" />
            Settings
          </Link>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => setConfirmReset(true)}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Reset
          </Button>
          {lane.laneType === 'CUSTOM' ? (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDelete(true)}>
              Delete lane
            </Button>
          ) : null}
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        title={`Run next step on ${lane.name}?`}
        description={
          <div className="space-y-3">
            <p>
              Queues the next eligible step for this lane. Approvals and emergency stop are never
              bypassed.
            </p>
            <label className="flex items-center gap-2 text-foreground">
              <input
                type="checkbox"
                checked={useMockAi}
                onChange={(e) => setUseMockAi(e.target.checked)}
              />
              Use mock AI
            </label>
          </div>
        }
        confirmLabel="Run now"
        pending={runNow.isPending}
        onConfirm={() => runNow.mutate()}
      />
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={`Reset ${lane.name}?`}
        description={`This permanently deletes all movies, episodes, characters, schedules, and execution history on this lane.

The lane itself stays (Morning/Evening). It will be paused so you can Plan Movie fresh.

This cannot be undone.`}
        confirmPhrase="RESET"
        confirmLabel="Reset lane"
        variant="destructive"
        pending={reset.isPending}
        onConfirm={() => reset.mutate()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${lane.name}?`}
        description="Story data is retained but the lane will be removed from the dashboard."
        confirmLabel="Delete lane"
        variant="destructive"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </section>
  );
}

export function SeriesOverviewPage() {
  const queryClient = useQueryClient();
  const [useMockAi, setUseMockAi] = useState(false);
  const [newLaneName, setNewLaneName] = useState('');

  const configQuery = useQuery({
    queryKey: ['series', 'config'],
    queryFn: () => seriesApi.getConfig(),
  });
  const lanesQuery = useQuery({
    queryKey: ['series', 'lanes'],
    queryFn: () => seriesApi.listLanes(),
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['series'] });

  const control = useMutation({
    mutationFn: async (key: 'enable' | 'pause' | 'resume' | 'emergencyStop') => {
      if (key === 'enable') return seriesApi.enable();
      if (key === 'pause') return seriesApi.pause();
      if (key === 'resume') return seriesApi.resume();
      return seriesApi.emergencyStop();
    },
    onSuccess: (_, key) => {
      toast.success(`Series Studio ${key} completed`);
      invalidate();
    },
    onError: () => toast.error('Control action failed'),
  });

  const createLane = useMutation({
    mutationFn: async () => {
      const name = newLaneName.trim();
      if (!name) throw new Error('Name required');
      return seriesApi.createLane({ name });
    },
    onSuccess: () => {
      toast.success('Lane created');
      setNewLaneName('');
      invalidate();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to create lane';
      toast.error(String(message));
    },
  });

  const runAll = useMutation({
    mutationFn: () => seriesApi.runAllNow({ useMockAi }),
    onSuccess: (data) => {
      toast.success('Run All evaluated', { description: data.message });
      invalidate();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Run All failed';
      toast.error(String(message));
    },
  });

  const planAllMovies = useMutation({
    mutationFn: () =>
      seriesApi.planMovies({
        startMediaProduction: false,
        useMockAi,
        async: true,
      }),
    onSuccess: (data) => {
      toast.success('Plan Movies for All Lanes queued', {
        description: String(data.note ?? ''),
      });
      invalidate();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Plan Movies failed';
      toast.error(String(message));
    },
  });

  const prepareNext = useMutation({
    mutationFn: () =>
      seriesApi.prepareNextEpisodes({
        useMockAi,
        ignoreScheduleWindow: false,
      }),
    onSuccess: () => {
      toast.success('Prepare Next Episodes evaluated');
      invalidate();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Prepare Next failed';
      toast.error(String(message));
    },
  });

  if (configQuery.isLoading || lanesQuery.isLoading) return <LoadingState />;
  if (configQuery.error || !configQuery.data) {
    return <ErrorState message="Failed to load Series Studio" onRetry={() => void configQuery.refetch()} />;
  }

  const config = configQuery.data;
  const lanes = lanesQuery.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Series Studio"
        description="Independent series lanes with creative direction, continuity, and instant Run Now."
        actions={
          <>
            <Button variant="outline" onClick={() => invalidate()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
            <Link
              to="/series/library"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-card px-4 text-sm"
            >
              <Library className="h-4 w-4" />
              Library
            </Link>
            <Link
              to="/series/settings"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-input bg-card px-4 text-sm"
            >
              <Settings className="h-4 w-4" />
              Settings
            </Link>
          </>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Studio"
          value={
            <Badge tone={config.seriesStudioEnabled ? 'success' : 'warning'}>
              {config.seriesStudioEnabled ? 'Enabled' : 'Disabled'}
            </Badge>
          }
        />
        <Stat label="Run mode" value={<Badge tone={statusTone(config.runMode)}>{config.runMode}</Badge>} />
        <Stat
          label="Autonomy"
          value={
            <Badge tone={config.autonomyMode === 'FULLY_AUTONOMOUS' ? 'success' : 'default'}>
              {(config.autonomyMode ?? 'MANUAL') === 'FULLY_AUTONOMOUS'
                ? 'Fully autonomous'
                : 'Manual'}
            </Badge>
          }
        />
        <Stat
          label="Publishing"
          value={config.automaticPublishing ? 'Automatic' : 'Manual / off'}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button disabled={control.isPending} onClick={() => control.mutate('enable')}>
          Enable
        </Button>
        <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate('pause')}>
          Pause
        </Button>
        <Button variant="outline" disabled={control.isPending} onClick={() => control.mutate('resume')}>
          Resume
        </Button>
        <Button
          variant="secondary"
          disabled={planAllMovies.isPending || lanes.length === 0}
          onClick={() => {
            if (
              window.confirm(
                'Plan movies for all enabled lanes? This creates complete plans only — media production will not start unless you enable that option in settings.',
              )
            ) {
              planAllMovies.mutate();
            }
          }}
        >
          <Clapperboard className="mr-2 h-4 w-4" />
          Plan Movies for All Lanes
        </Button>
        <Button
          variant="outline"
          disabled={prepareNext.isPending || lanes.length === 0}
          onClick={() => prepareNext.mutate()}
        >
          Prepare Next Episodes
        </Button>
        <Button
          variant="secondary"
          disabled={runAll.isPending || lanes.length === 0}
          onClick={() => {
            if (window.confirm('Run all enabled lanes now? Each lane is evaluated independently.')) {
              runAll.mutate();
            }
          }}
        >
          <Play className="mr-2 h-4 w-4" />
          Run All Enabled Lanes Now
        </Button>
        <Button
          variant="destructive"
          disabled={control.isPending}
          onClick={() => control.mutate('emergencyStop')}
        >
          Emergency stop
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={useMockAi}
            onChange={(e) => setUseMockAi(e.target.checked)}
          />
          Use mock AI for studio actions
        </label>
      </div>

      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-border bg-card p-4">
        <div className="min-w-[200px] flex-1 space-y-1">
          <label className="text-sm font-medium">Create lane</label>
          <Input
            value={newLaneName}
            onChange={(e) => setNewLaneName(e.target.value)}
            placeholder="e.g. Series C (Weekend)"
          />
        </div>
        <Button disabled={createLane.isPending || !newLaneName.trim()} onClick={() => createLane.mutate()}>
          <Plus className="mr-2 h-4 w-4" />
          Add lane
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {lanes.length === 0 ? (
          <EmptyState title="No lanes yet" description="Enable Series Studio to create default lanes." />
        ) : (
          lanes.map((lane) => (
            <LaneCard key={lane.id} lane={lane} onChanged={invalidate} />
          ))
        )}
      </div>
    </div>
  );
}
