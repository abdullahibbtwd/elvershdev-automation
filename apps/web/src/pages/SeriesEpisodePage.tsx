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

export function SeriesEpisodePage() {
  const { id: seriesId = '', episodeId = '' } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['series', 'episode', seriesId, episodeId],
    enabled: Boolean(seriesId && episodeId),
    queryFn: () => seriesApi.getEpisode(seriesId, episodeId),
    refetchInterval: (query) =>
      query.state.data?.productionState === 'RUNNING' ||
      query.state.data?.productionState === 'QUEUED'
        ? 5000
        : false,
  });

  const productionQuery = useQuery({
    queryKey: ['series', 'production', seriesId, episodeId],
    enabled: Boolean(seriesId && episodeId),
    queryFn: () => seriesApi.getProduction(seriesId, episodeId),
    refetchInterval: 5000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['series', 'episode', seriesId, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['series', 'production', seriesId, episodeId] });
    void queryClient.invalidateQueries({ queryKey: ['series', 'detail', seriesId] });
  };

  const generate = useMutation({
    mutationFn: () => seriesApi.generateEpisode(seriesId, episodeId, { async: true, useMockAi: true }),
    onSuccess: () => {
      toast.success('Episode script generation queued');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Generate failed')),
  });

  const regenerate = useMutation({
    mutationFn: () =>
      seriesApi.regenerateEpisode(seriesId, episodeId, { async: true, useMockAi: true }),
    onSuccess: () => {
      toast.success('Episode regeneration queued');
      invalidate();
    },
    onError: (err) => toast.error(errMessage(err, 'Regenerate failed')),
  });

  const approve = useMutation({
    mutationFn: () => seriesApi.approveEpisode(seriesId, episodeId),
    onSuccess: () => {
      toast.success('Episode approved');
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

  const produce = useMutation({
    mutationFn: () => seriesApi.produceEpisode(seriesId, episodeId, { async: true, useMockAi: true }),
    onSuccess: () => {
      toast.success('Production started');
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

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message="Failed to load episode" onRetry={() => void refetch()} />;
  }

  const busy =
    generate.isPending ||
    regenerate.isPending ||
    approve.isPending ||
    validate.isPending ||
    produce.isPending ||
    cancel.isPending;

  const production = productionQuery.data as
    | { runs?: Array<{ id: string; stage: string | null; status: string; errorMessage?: string | null }> }
    | undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Episode ${data.episodeNumber}: ${data.title}`}
        description={data.synopsis ?? 'Episode script and production'}
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

      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        <Badge tone={statusTone(data.approvalStatus)}>{data.approvalStatus}</Badge>
        <Badge tone={statusTone(data.productionState)}>{data.productionState}</Badge>
        {data.spokenWordCount != null ? (
          <Badge tone="default">{data.spokenWordCount} words</Badge>
        ) : null}
      </div>

      {data.lastError ? (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
          {data.lastError}
        </div>
      ) : null}

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
        <Button
          disabled={busy || data.approvalStatus !== 'APPROVED'}
          onClick={() => produce.mutate()}
        >
          Produce
        </Button>
        <Button
          variant="outline"
          disabled={busy || (data.productionState !== 'RUNNING' && data.productionState !== 'QUEUED')}
          onClick={() => cancel.mutate()}
        >
          Cancel production
        </Button>
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
