import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { seriesApi } from '@/lib/series-api';
import { statusTone } from '@/lib/status';

function errMessage(err: unknown, fallback: string) {
  const message = (err as { response?: { data?: { message?: string | string[] } } })?.response
    ?.data?.message;
  if (Array.isArray(message)) return message.join(', ');
  return message ? String(message) : fallback;
}

/** Opt-in mock only via UI toggle or VITE_SERIES_USE_MOCK_AI=true — never hard-code true. */
function defaultUseMockAi(): boolean {
  return import.meta.env.VITE_SERIES_USE_MOCK_AI === 'true';
}

type PipelineStep = {
  id: string;
  label: string;
  state: 'done' | 'active' | 'pending' | 'blocked';
};

export function SeriesEpisodePage() {
  const { id: seriesId = '', episodeId = '' } = useParams();
  const queryClient = useQueryClient();
  const [useMockAi, setUseMockAi] = useState(defaultUseMockAi);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['series', 'episode', seriesId, episodeId],
    enabled: Boolean(seriesId && episodeId),
    queryFn: () => seriesApi.getEpisode(seriesId, episodeId),
    refetchInterval: (query) => {
      const episode = query.state.data;
      if (!episode) return false;
      if (episode.productionState === 'RUNNING' || episode.productionState === 'QUEUED') {
        return 5000;
      }
      const clipsBusy = (episode.videoClips ?? []).some((clip) =>
        ['QUEUED', 'SUBMITTED', 'GENERATING', 'DOWNLOADING', 'RETRYING'].includes(clip.status),
      );
      return clipsBusy ? 4000 : false;
    },
  });

  const productionQuery = useQuery({
    queryKey: ['series', 'production', seriesId, episodeId],
    enabled: Boolean(seriesId && episodeId),
    queryFn: () => seriesApi.getProduction(seriesId, episodeId),
    refetchInterval: 5000,
  });

  const assemblyQuery = useQuery({
    queryKey: ['series', 'assembly', seriesId, episodeId],
    enabled: Boolean(seriesId && episodeId),
    queryFn: () => seriesApi.getAssembly(seriesId, episodeId),
    refetchInterval: (query) => {
      const status = query.state.data;
      if (!status) return false;
      if (status.readyToAssemble && !status.videoRenderId) return 4000;
      return false;
    },
  });

  const outputMediaAssetId = assemblyQuery.data?.render?.outputMediaAssetId ?? null;
  const playbackQuery = useQuery({
    queryKey: ['series', 'episode-playback', outputMediaAssetId],
    enabled: Boolean(outputMediaAssetId),
    queryFn: () => seriesApi.getMediaDownloadUrl(outputMediaAssetId!),
    staleTime: 60_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['series', 'episode', seriesId, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['series', 'production', seriesId, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['series', 'assembly', seriesId, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['series', 'detail', seriesId] });
  };

  const mockOpts = { useMockAi: useMockAi || undefined };

  const generate = useMutation({
    mutationFn: () =>
      seriesApi.generateEpisode(seriesId, episodeId, { async: true, ...mockOpts }),
    onSuccess: () => {
      toast.success('Episode script generation queued');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Generate failed')),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      seriesApi.regenerateEpisode(seriesId, episodeId, { async: true, ...mockOpts }),
    onSuccess: () => {
      toast.success('Episode regeneration queued');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Regenerate failed')),
  });

  const approve = useMutation({
    mutationFn: () => seriesApi.approveEpisode(seriesId, episodeId),
    onSuccess: () => {
      toast.success('Episode approved · clip plan will be built when available');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Approve failed')),
  });

  const validate = useMutation({
    mutationFn: () => seriesApi.validateContinuity(seriesId, episodeId),
    onSuccess: () => {
      toast.success('Continuity validation completed');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Validation failed')),
  });

  const planClips = useMutation({
    mutationFn: () => seriesApi.planClips(seriesId, episodeId, { force: true }),
    onSuccess: (result) => {
      toast.success(
        `Clip plan ready · ${result.clipCount} clips · ~$${result.estimatedCostUsd.toFixed(2)}`,
      );
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Clip plan failed')),
  });

  const generateClips = useMutation({
    mutationFn: () =>
      seriesApi.generateClips(seriesId, episodeId, {
        async: true,
        mode: 'auto',
        ...mockOpts,
      }),
    onSuccess: (result) => {
      toast.success(
        result.queued
          ? `Queued ${result.clipCount ?? 0} Grok Lite clip(s)`
          : result.message ?? 'Clip generation started',
      );
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Clip generation failed')),
  });

  const cancelClips = useMutation({
    mutationFn: () => seriesApi.cancelClips(seriesId, episodeId),
    onSuccess: (result) => {
      toast.success(`Cancelled ${result.cancelledCount} clip job(s)`);
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Cancel clips failed')),
  });

  const retryClip = useMutation({
    mutationFn: (clipId: string) =>
      seriesApi.retryClip(seriesId, episodeId, clipId, { ...mockOpts }),
    onSuccess: () => {
      toast.success('Clip retry queued');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Retry failed')),
  });

  const assemble = useMutation({
    mutationFn: () =>
      seriesApi.assembleEpisode(seriesId, episodeId, {
        async: true,
        // Manual Assemble always rebuilds from the current COMPLETED clips (old 2-clip
        // renders must not block the new 6-clip dialogue packs).
        force: true,
      }),
    onSuccess: (result) => {
      if (result.skipped) toast.success('Episode already assembled');
      else if (result.queued) toast.success('Assembly queued — rebuilding from current clips');
      else toast.success('Assembly started');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Assemble failed')),
  });

  const produce = useMutation({
    mutationFn: () =>
      seriesApi.produceEpisode(seriesId, episodeId, {
        async: true,
        ...mockOpts,
        // Manual Produce always force-cancels stuck fal/VISUAL_INTELLIGENCE runs and starts Grok path.
        force: true,
      }),
    onSuccess: () => {
      toast.success('Production started (dialogue → clips → assembly)');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Produce failed')),
  });

  const cancel = useMutation({
    mutationFn: () => seriesApi.cancelProduction(seriesId, episodeId),
    onSuccess: () => {
      toast.success('Production cancelled');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Cancel failed')),
  });

  const pipeline = useMemo((): PipelineStep[] => {
    if (!data) return [];
    const clips = data.videoClips ?? [];
    const hasScript = Boolean(data.script?.trim());
    const approved = data.approvalStatus === 'APPROVED';
    const hasPlan = clips.length > 0;
    const clipsDone =
      hasPlan &&
      clips.every((c) => c.status === 'COMPLETED' && Boolean(c.videoMediaAssetId));
    const assembled = Boolean(data.videoRenderId || assemblyQuery.data?.videoRenderId);

    const step = (
      id: string,
      label: string,
      done: boolean,
      active: boolean,
      blocked = false,
    ): PipelineStep => ({
      id,
      label,
      state: done ? 'done' : blocked ? 'blocked' : active ? 'active' : 'pending',
    });

    return [
      step('script', 'Script', hasScript, !hasScript),
      step('approve', 'Approve', approved, hasScript && !approved, !hasScript),
      step('plan', 'Clip plan', hasPlan, approved && !hasPlan, !approved),
      step('clips', 'Grok clips', clipsDone, hasPlan && !clipsDone, !hasPlan),
      step('assemble', 'Assemble', assembled, clipsDone && !assembled, !clipsDone),
    ];
  }, [data, assemblyQuery.data?.videoRenderId]);

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message="Failed to load episode" onRetry={() => void refetch()} />;
  }

  const busy =
    generate.isPending ||
    regenerate.isPending ||
    approve.isPending ||
    validate.isPending ||
    planClips.isPending ||
    generateClips.isPending ||
    cancelClips.isPending ||
    retryClip.isPending ||
    assemble.isPending ||
    produce.isPending ||
    cancel.isPending;

  const videoClips = data.videoClips ?? [];
  const shots = data.shots ?? [];
  const clipCost = videoClips.reduce(
    (sum, clip) => sum + Number(clip.estimatedCostUsd ?? 0),
    0,
  );
  const clipsInFlight = videoClips.some((clip) =>
    ['QUEUED', 'SUBMITTED', 'GENERATING', 'DOWNLOADING', 'RETRYING'].includes(clip.status),
  );
  const clipsReadyToAssemble =
    videoClips.length > 0 &&
    videoClips.every(
      (clip) => clip.status === 'COMPLETED' && Boolean(clip.videoMediaAssetId),
    );
  const completedClips = videoClips.filter((c) => c.status === 'COMPLETED').length;
  const failedClips = videoClips.filter((c) => c.status === 'FAILED').length;

  const production = productionQuery.data as
    | {
        runs?: Array<{
          id: string;
          stage: string | null;
          status: string;
          errorMessage?: string | null;
        }>;
      }
    | undefined;

  const activeRun = production?.runs?.find(
    (run) => run.status === 'RUNNING' || run.status === 'PENDING' || run.status === 'RETRYING',
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Episode ${data.episodeNumber}: ${data.title}`}
        description={data.synopsis ?? 'Cinematic episode: screenplay → Grok Lite clips → assemble'}
        actions={
          <>
            <Button variant="outline" onClick={() => void refetch()}>
              Refresh
            </Button>
            <Link
              to={`/series/${seriesId}`}
              className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm"
            >
              Series
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        <Badge tone={statusTone(data.approvalStatus)}>{data.approvalStatus}</Badge>
        <Badge tone={statusTone(data.productionState)}>{data.productionState}</Badge>
        {data.spokenWordCount != null ? (
          <Badge tone="default">{data.spokenWordCount} words</Badge>
        ) : null}
        <Badge tone="default">{data.targetDurationSeconds}s target</Badge>
        {useMockAi ? <Badge tone="warning">Mock AI</Badge> : null}
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Cinematic pipeline</h2>
            <p className="text-sm text-muted-foreground">
              Dialogue screenplay → ≤15s Grok Lite clips → FFmpeg assembly (no narration gate).
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={useMockAi}
              onChange={(e) => setUseMockAi(e.target.checked)}
            />
            Use mock AI
          </label>
        </div>
        <ol className="mt-4 grid gap-2 sm:grid-cols-5">
          {pipeline.map((step, index) => (
            <li
              key={step.id}
              className={[
                'rounded-lg border px-3 py-2 text-sm',
                step.state === 'done'
                  ? 'border-emerald-500/40 bg-emerald-500/10'
                  : step.state === 'active'
                    ? 'border-primary/50 bg-primary/10'
                    : step.state === 'blocked'
                      ? 'border-border/60 bg-muted/20 text-muted-foreground'
                      : 'border-border bg-muted/10 text-muted-foreground',
              ].join(' ')}
            >
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                {index + 1}
              </div>
              <div className="font-medium">{step.label}</div>
              <div className="text-xs capitalize text-muted-foreground">{step.state}</div>
            </li>
          ))}
        </ol>
        {activeRun ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Production run: <Badge tone={statusTone(activeRun.status)}>{activeRun.status}</Badge>{' '}
            stage <span className="font-medium text-foreground">{activeRun.stage ?? '—'}</span>
            {activeRun.errorMessage ? (
              <span className="text-red-300"> — {activeRun.errorMessage}</span>
            ) : null}
          </p>
        ) : null}
      </section>

      {data.lastError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {data.lastError}
        </div>
      ) : null}

      <div className="space-y-3">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Screenplay
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => generate.mutate()}>
              Generate script
            </Button>
            <Button variant="outline" disabled={busy} onClick={() => regenerate.mutate()}>
              Regenerate
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => validate.mutate()}>
              Validate continuity
            </Button>
            <Button
              disabled={busy || data.approvalStatus === 'APPROVED'}
              onClick={() => approve.mutate()}
            >
              Approve
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Grok Lite clips
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !data.script}
              onClick={() => planClips.mutate()}
            >
              Build clip plan
            </Button>
            <Button
              disabled={busy || videoClips.length === 0}
              onClick={() => generateClips.mutate()}
            >
              Generate clips
            </Button>
            <Button
              variant="outline"
              disabled={busy || !clipsInFlight}
              onClick={() => cancelClips.mutate()}
            >
              Cancel clips
            </Button>
            <Button
              disabled={busy || !clipsReadyToAssemble}
              onClick={() => assemble.mutate()}
            >
              Assemble episode
            </Button>
          </div>
        </div>

        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Full production
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={busy || data.approvalStatus !== 'APPROVED'}
              onClick={() => produce.mutate()}
            >
              Produce
            </Button>
            <Button
              variant="outline"
              disabled={
                busy ||
                (data.productionState !== 'RUNNING' && data.productionState !== 'QUEUED')
              }
              onClick={() => cancel.mutate()}
            >
              Cancel production
            </Button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Produce runs the dialogue pipeline through clip generation and assembly. Mock AI is
            off by default — enable the toggle only for dry runs.
          </p>
        </div>
      </div>

      {data.hook || data.ending || data.cliffhanger ? (
        <section className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-3">
          {data.hook ? (
            <div>
              <div className="text-xs uppercase text-muted-foreground">Hook</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{data.hook}</p>
            </div>
          ) : null}
          {data.ending ? (
            <div>
              <div className="text-xs uppercase text-muted-foreground">Ending</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{data.ending}</p>
            </div>
          ) : null}
          {data.cliffhanger ? (
            <div>
              <div className="text-xs uppercase text-muted-foreground">Cliffhanger</div>
              <p className="mt-1 text-sm whitespace-pre-wrap">{data.cliffhanger}</p>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="space-y-2 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Script</h2>
        <pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-3 text-sm">
          {data.script?.trim() || 'No script yet.'}
        </pre>
      </section>

      {data.scenes && data.scenes.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Scenes ({data.scenes.length})</h2>
          <div className="space-y-3">
            {data.scenes.map((scene) => (
              <div key={scene.id} className="rounded-lg border border-border p-3">
                <div className="text-sm font-medium">
                  Scene {scene.sceneOrder} — {scene.location}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{scene.action}</p>
                <p className="mt-1 text-sm">{scene.visualDescription}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {shots.length > 0 ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Screenplay shots ({shots.length})</h2>
          <div className="space-y-2">
            {shots.map((shot) => (
              <div key={shot.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    S{shot.sceneOrder} · Shot {shot.shotOrder}
                  </span>
                  <Badge tone="default">{shot.shotType}</Badge>
                  <Badge tone={statusTone(shot.status)}>{shot.status}</Badge>
                  <span className="text-muted-foreground">{shot.durationSeconds}s</span>
                </div>
                {shot.speakerName ? (
                  <p className="mt-1 text-muted-foreground">Speaker: {shot.speakerName}</p>
                ) : null}
                {shot.dialogueLine?.text ? (
                  <p className="mt-1 whitespace-pre-wrap">“{shot.dialogueLine.text}”</p>
                ) : null}
                {shot.cameraDirection ? (
                  <p className="mt-1 text-muted-foreground">{shot.cameraDirection}</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Grok Lite clips</h2>
            <p className="text-sm text-muted-foreground">
              ≤15s packs for Imagine Video 1.5 Lite · episode target {data.targetDurationSeconds}s
            </p>
          </div>
          {videoClips.length > 0 ? (
            <div className="text-sm text-muted-foreground">
              {completedClips}/{videoClips.length} done
              {failedClips > 0 ? ` · ${failedClips} failed` : ''} ·{' '}
              {videoClips.reduce((sum, c) => sum + c.durationSeconds, 0).toFixed(1)}s · ~$
              {clipCost.toFixed(2)}
            </div>
          ) : null}
        </div>
        {videoClips.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No clip plan yet. Approve the screenplay or click Build clip plan.
          </p>
        ) : (
          <div className="space-y-2">
            {videoClips.map((clip) => {
              const shotOrders = Array.isArray(clip.shotOrders)
                ? (clip.shotOrders as number[]).join(', ')
                : '—';
              const characters = Array.isArray(clip.characters)
                ? (clip.characters as string[]).join(', ')
                : '';
              return (
                <details
                  key={clip.id}
                  className="rounded-lg border border-border p-3 text-sm open:bg-muted/20"
                >
                  <summary className="cursor-pointer list-none">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">Clip {clip.clipIndex + 1}</span>
                      <Badge tone={statusTone(clip.status)}>{clip.status}</Badge>
                      <span className="text-muted-foreground">
                        {clip.durationSeconds}s · scene {clip.sceneOrder} · shots {shotOrders}
                      </span>
                    </div>
                    {clip.dialogue ? (
                      <p className="mt-1 line-clamp-2 text-muted-foreground">{clip.dialogue}</p>
                    ) : (
                      <p className="mt-1 line-clamp-2 text-muted-foreground">
                        {clip.action ?? 'Visual beat'}
                      </p>
                    )}
                  </summary>
                  <div className="mt-3 space-y-2 border-t border-border pt-3">
                    {characters ? <p>Characters: {characters}</p> : null}
                    {clip.location ? <p>Location: {clip.location}</p> : null}
                    {clip.camera ? <p>Camera: {clip.camera}</p> : null}
                    {clip.errorMessage ? (
                      <p className="text-red-300">{clip.errorMessage}</p>
                    ) : null}
                    {clip.videoMediaAssetId ? (
                      <p className="text-muted-foreground">
                        Media asset: {clip.videoMediaAssetId}
                      </p>
                    ) : null}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => retryClip.mutate(clip.id)}
                      >
                        {clip.status === 'FAILED' ? 'Retry' : 'Regenerate'}
                      </Button>
                    </div>
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-muted/30 p-2 text-xs">
                      {clip.prompt}
                    </pre>
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-border bg-card p-4 text-sm">
        <h2 className="text-lg font-semibold">Assembly</h2>
        {assemblyQuery.data ? (
          <div className="mt-2 space-y-1 text-muted-foreground">
            <p>
              Clips ready: {assemblyQuery.data.completedClipCount}/
              {assemblyQuery.data.clipCount}
              {assemblyQuery.data.readyToAssemble ? ' · ready to assemble' : ''}
            </p>
            {assemblyQuery.data.videoRenderId || data.videoRenderId ? (
              <>
                <p>
                  Render:{' '}
                  <span className="font-mono text-xs text-foreground">
                    {assemblyQuery.data.videoRenderId ?? data.videoRenderId}
                  </span>
                </p>
                {assemblyQuery.data.render?.status ? (
                  <p>
                    Status:{' '}
                    <Badge tone={statusTone(assemblyQuery.data.render.status)}>
                      {assemblyQuery.data.render.status}
                    </Badge>
                  </p>
                ) : null}
                {(assemblyQuery.data.actualDurationSeconds ?? data.actualDurationSeconds) !=
                null ? (
                  <p>
                    Duration:{' '}
                    {Number(
                      assemblyQuery.data.actualDurationSeconds ?? data.actualDurationSeconds,
                    ).toFixed(1)}
                    s
                  </p>
                ) : null}
                {outputMediaAssetId ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        disabled={!playbackQuery.data?.url}
                        onClick={() => {
                          const url = playbackQuery.data?.url;
                          if (url) window.open(url, '_blank', 'noopener,noreferrer');
                        }}
                      >
                        Open video
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={playbackQuery.isFetching}
                        onClick={() => void playbackQuery.refetch()}
                      >
                        Refresh link
                      </Button>
                      <Link
                        className="inline-flex items-center text-sm text-primary hover:underline"
                        to="/media"
                      >
                        Media Library
                      </Link>
                    </div>
                    {playbackQuery.isError ? (
                      <p className="text-red-300">Could not load playback URL.</p>
                    ) : null}
                    {playbackQuery.data?.url ? (
                      <video
                        key={playbackQuery.data.url}
                        className="mt-1 max-h-[480px] w-full rounded-lg border border-border bg-black"
                        controls
                        playsInline
                        preload="metadata"
                        src={playbackQuery.data.url}
                      />
                    ) : playbackQuery.isLoading ? (
                      <p>Loading player…</p>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p>No assembled render yet. Finish Grok clips, then Assemble episode.</p>
            )}
          </div>
        ) : (
          <p className="mt-2 text-muted-foreground">Loading assembly status…</p>
        )}
      </section>

      {production?.runs && production.runs.length > 0 ? (
        <section className="space-y-2 rounded-xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Production runs</h2>
          <ul className="space-y-2 text-sm">
            {production.runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(run.status)}>{run.status}</Badge>
                <span>{run.stage ?? '—'}</span>
                {run.errorMessage ? (
                  <span className="text-red-300">{run.errorMessage}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.storyId ? (
        <p className="text-sm text-muted-foreground">
          Linked story:{' '}
          <Link className="text-primary hover:underline" to={`/stories/${data.storyId}`}>
            {data.storyId}
          </Link>
        </p>
      ) : null}
    </div>
  );
}
