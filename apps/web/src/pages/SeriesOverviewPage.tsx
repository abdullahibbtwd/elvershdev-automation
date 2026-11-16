import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clapperboard,
  Copy,
  Library,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  SERIES_GENRE_OPTIONS,
  SERIES_THEME_OPTIONS,
  seriesApi,
  type SeriesLane,
} from '@/lib/series-api';
import { statusTone } from '@/lib/status';

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-xl font-semibold">{value}</div>
    </div>
  );
}

function LaneCard({
  lane,
  onChanged,
}: {
  lane: SeriesLane;
  onChanged: () => void;
}) {
  const [confirmRun, setConfirmRun] = useState(false);
  const [useMockAi, setUseMockAi] = useState(true);

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
    runNow.isPending ||
    produceNext.isPending ||
    planMovie.isPending;

  const displayState = execView.data?.displayState ?? '…';
  const view = execView.data;
  const progressLabel = lane.activeSeries
    ? `Ep ${lane.activeSeries.currentEpisodeNumber}/${lane.activeSeries.plannedEpisodeCount}`
    : `Ep ${lane.lastPublishedEpisodeNumber}/${lane.plannedEpisodeCount}`;
  const fmt = (value?: string | Date | null) =>
    value ? new Date(value).toLocaleString() : '—';

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{lane.name}</h2>
          <p className="text-sm text-muted-foreground">
            {lane.laneType} · Publishes at {lane.publishTime} ({lane.timezone}) · Lead{' '}
            {lane.productionLeadTimeMinutes ?? 240}m · Mode{' '}
            {lane.productionStartMode ?? 'NEXT_WINDOW'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge tone={statusTone(displayState)}>{displayState}</Badge>
          <Badge tone={statusTone(lane.status)}>{lane.status}</Badge>
          <Badge tone={lane.enabled ? 'success' : 'default'}>
            {lane.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        </div>
      </div>

      <div className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <span className="text-muted-foreground">Active movie: </span>
          {lane.activeSeries ? (
            <Link className="text-primary hover:underline" to={`/series/${lane.activeSeries.id}`}>
              {lane.activeSeries.title}
            </Link>
          ) : (
            <span>None</span>
          )}
        </div>
        <div>
          <span className="text-muted-foreground">Progress: </span>
          {progressLabel}
        </div>
        <div>
          <span className="text-muted-foreground">Current episode: </span>
          {view?.currentEpisode
            ? `#${view.currentEpisode.episodeNumber} (${view.currentEpisode.status})`
            : '—'}
        </div>
        <div>
          <span className="text-muted-foreground">Next episode: </span>
          {view?.nextEpisode
            ? `#${view.nextEpisode.episodeNumber} (${view.nextEpisode.status})`
            : '—'}
        </div>
        <div>
          <span className="text-muted-foreground">Production status: </span>
          {view?.productionStage ?? displayState}
        </div>
        <div>
          <span className="text-muted-foreground">Approval: </span>
          {view?.approvalStatus ?? lane.activeSeries?.approvalStatus ?? '—'}
        </div>
        <div>
          <span className="text-muted-foreground">Next production: </span>
          {fmt(view?.nextProductionAt ?? lane.nextProductionAt)}
        </div>
        <div>
          <span className="text-muted-foreground">Next publish: </span>
          {fmt(view?.nextPublishAt ?? lane.nextPublishAt)}
        </div>
        <div>
          <span className="text-muted-foreground">Last published: </span>
          {view?.lastPublishedEpisode
            ? `#${view.lastPublishedEpisode.episodeNumber}`
            : lane.lastPublishedEpisodeNumber
              ? `#${lane.lastPublishedEpisodeNumber}`
              : '—'}
        </div>
        <div className="sm:col-span-2">
          <span className="text-muted-foreground">Next action: </span>
          {view?.nextActionReason ?? '…'}
        </div>
        {view?.blocker ? (
          <div className="sm:col-span-2 text-amber-600 dark:text-amber-400">
            Blocker: {view.blocker}
          </div>
        ) : null}
        {view?.lastExecution?.errorMessage ? (
          <div className="sm:col-span-2 text-destructive">
            Last error: {view.lastExecution.errorMessage}
          </div>
        ) : null}
      </div>

      {confirmRun ? (
        <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
          <p>
            Run Now will enqueue the next eligible step for <strong>{lane.name}</strong>. Approvals
            and emergency stop are never bypassed. Jobs may still be running after this returns.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useMockAi}
              onChange={(e) => setUseMockAi(e.target.checked)}
            />
            Use mock AI
          </label>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => runNow.mutate()}>
              Confirm Run Now
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirmRun(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => planMovie.mutate()}>
          <Clapperboard className="mr-1 h-3 w-3" />
          Plan Movie
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setConfirmRun(true)}>
          <Play className="mr-1 h-3 w-3" />
          Run Now
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => produceNext.mutate()}>
          Produce Next Episode
        </Button>
        {lane.status === 'PAUSED' || lane.status === 'DISABLED' ? (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => resume.mutate()}>
            <Play className="mr-1 h-3 w-3" />
            Resume
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => pause.mutate()}>
            <Pause className="mr-1 h-3 w-3" />
            Pause
          </Button>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => duplicate.mutate()}>
          <Copy className="mr-1 h-3 w-3" />
          Duplicate
        </Button>
        {lane.activeSeries ? (
          <Link
            to={`/series/${lane.activeSeries.id}`}
            className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm"
          >
            View Movie / Episodes
          </Link>
        ) : null}
        <Link
          to="/series/settings"
          className="inline-flex h-8 items-center rounded-md border border-input px-3 text-sm"
        >
          Edit Settings
        </Link>
        {lane.laneType === 'CUSTOM' ? (
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  `Delete ${lane.name}? Story data is retained but the lane will be removed from the dashboard.`,
                )
              ) {
                remove.mutate();
              }
            }}
          >
            <Trash2 className="mr-1 h-3 w-3" />
            Delete
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export function SeriesOverviewPage() {
  const queryClient = useQueryClient();
  const [laneId, setLaneId] = useState('');
  const [ideaMode, setIdeaMode] = useState<'generate' | 'custom'>('generate');
  const [customPremise, setCustomPremise] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>(['Cinematic drama']);
  const [selectedThemes, setSelectedThemes] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const [useMockAi, setUseMockAi] = useState(true);
  const [newLaneName, setNewLaneName] = useState('');

  const configQuery = useQuery({
    queryKey: ['series', 'config'],
    queryFn: () => seriesApi.getConfig(),
  });
  const lanesQuery = useQuery({
    queryKey: ['series', 'lanes'],
    queryFn: () => seriesApi.listLanes(),
  });
  const statusQuery = useQuery({
    queryKey: ['series', 'scheduler'],
    queryFn: () => seriesApi.schedulerStatus(),
    refetchInterval: 15000,
  });
  const executionsQuery = useQuery({
    queryKey: ['series', 'executions'],
    queryFn: () => seriesApi.listExecutions({ take: 10 }),
    refetchInterval: 12000,
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
    mutationFn: () => seriesApi.runAllNow({ useMockAi: true }),
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

  const generate = useMutation({
    mutationFn: async () => {
      const targetLaneId = laneId || lanesQuery.data?.[0]?.id;
      if (!targetLaneId) throw new Error('No lane');
      if (ideaMode === 'custom' && !customPremise.trim()) {
        throw new Error('Enter your movie idea');
      }
      return seriesApi.generate({
        laneId: targetLaneId,
        genre: selectedGenres[0],
        theme: selectedThemes.join('; ') || undefined,
        additionalInstructions: instructions || undefined,
        customPremise: ideaMode === 'custom' ? customPremise : undefined,
        ideaMode,
        useMockAi,
        async: true,
      });
    },
    onSuccess: () => {
      toast.success('Movie planning queued');
      invalidate();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        'Failed to generate series';
      toast.error(String(message));
    },
  });

  const genreToggles = useMemo(() => SERIES_GENRE_OPTIONS, []);

  if (configQuery.isLoading || lanesQuery.isLoading) return <LoadingState />;
  if (configQuery.error || !configQuery.data) {
    return <ErrorState message="Failed to load Series Studio" onRetry={() => void configQuery.refetch()} />;
  }

  const config = configQuery.data;
  const lanes = lanesQuery.data ?? [];

  const toggleGenre = (genre: string) => {
    setSelectedGenres((prev) =>
      prev.includes(genre) ? prev.filter((g) => g !== genre) : [...prev, genre],
    );
  };
  const toggleTheme = (theme: string) => {
    setSelectedThemes((prev) =>
      prev.includes(theme) ? prev.filter((t) => t !== theme) : [...prev, theme],
    );
  };

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
        <Stat
          label="Scheduler"
          value={
            statusQuery.data?.phase != null
              ? `Phase ${String(statusQuery.data.phase)}`
              : statusQuery.isLoading
                ? '…'
                : 'Idle'
          }
        />
      </div>
      <p className="text-sm text-muted-foreground">
        Monitoring centre — configure creative direction and autonomy in Settings. Routine approvals
        are not required in Fully Autonomous Mode. Exceptional controls: pause lane, retry, emergency
        stop.
      </p>

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

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Execution history</h2>
        <p className="text-sm text-muted-foreground">
          Persists across refreshes. Distinguish MANUAL vs SCHEDULED triggers, approvals, queue
          state, and failures.
        </p>
        {(executionsQuery.data?.items?.length ?? 0) === 0 ? (
          <p className="text-sm text-muted-foreground">No executions yet. Use Run Now on a lane.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {executionsQuery.data!.items.map((ex) => (
              <li
                key={ex.id}
                className="grid gap-1 border-b border-border py-2 sm:grid-cols-[1fr_auto]"
              >
                <div>
                  <div className="font-medium">
                    {ex.lane?.name ?? ex.laneId} · {ex.resolvedAction ?? ex.requestedAction}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Trigger {ex.triggerSource} · started{' '}
                    {ex.startedAt ? new Date(ex.startedAt).toLocaleString() : '—'}
                    {ex.completedAt
                      ? ` · completed ${new Date(ex.completedAt).toLocaleString()}`
                      : ''}
                    {ex.seriesId ? ` · movie ${ex.seriesId.slice(0, 8)}` : ''}
                    {ex.episodeId ? ` · ep ${ex.episodeId.slice(0, 8)}` : ''}
                  </div>
                  {ex.errorMessage ? (
                    <div className="text-xs text-destructive">{ex.errorMessage}</div>
                  ) : null}
                </div>
                <Badge tone={statusTone(ex.status)}>{ex.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Generate movie plan</h2>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium">Lane</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={laneId || lanes[0]?.id || ''}
              onChange={(e) => setLaneId(e.target.value)}
            >
              {lanes.map((lane) => (
                <option key={lane.id} value={lane.id}>
                  {lane.name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Idea mode</label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={ideaMode}
              onChange={(e) => setIdeaMode(e.target.value as 'generate' | 'custom')}
            >
              <option value="generate">Option A — Generate an original idea</option>
              <option value="custom">Option B — Use my own idea</option>
            </select>
          </div>
        </div>

        {ideaMode === 'custom' ? (
          <div className="space-y-1">
            <label className="text-sm font-medium">Your movie idea / premise</label>
            <Textarea
              value={customPremise}
              onChange={(e) => setCustomPremise(e.target.value)}
              rows={4}
              placeholder="Describe the premise, conflict, characters, and ending direction…"
            />
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-sm font-medium">Genres</label>
          <div className="flex flex-wrap gap-2">
            {genreToggles.map((genre) => (
              <button
                key={genre}
                type="button"
                className={`rounded-md border px-2 py-1 text-xs ${
                  selectedGenres.includes(genre)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input'
                }`}
                onClick={() => toggleGenre(genre)}
              >
                {genre}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Themes</label>
          <div className="flex flex-wrap gap-2">
            {SERIES_THEME_OPTIONS.map((theme) => (
              <button
                key={theme}
                type="button"
                className={`rounded-md border px-2 py-1 text-xs ${
                  selectedThemes.includes(theme)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input'
                }`}
                onClick={() => toggleTheme(theme)}
              >
                {theme}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-sm font-medium">Additional creative preferences</label>
          <Textarea
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={3}
            placeholder="Optional — cannot override safety or continuity rules"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={useMockAi}
            onChange={(e) => setUseMockAi(e.target.checked)}
          />
          Use mock AI (no Gemini spend)
        </label>
        <Button disabled={generate.isPending || lanes.length === 0} onClick={() => generate.mutate()}>
          <Clapperboard className="mr-2 h-4 w-4" />
          Plan series
        </Button>
      </section>
    </div>
  );
}
