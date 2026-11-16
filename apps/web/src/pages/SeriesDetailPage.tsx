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

export function SeriesDetailPage() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['series', 'detail', id],
    enabled: Boolean(id),
    queryFn: () => seriesApi.getSeries(id),
  });

  const approve = useMutation({
    mutationFn: () => seriesApi.approveSeries(id),
    onSuccess: () => {
      toast.success('Series approved');
      void queryClient.invalidateQueries({ queryKey: ['series'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Approve failed';
      toast.error(String(message));
    },
  });

  const reject = useMutation({
    mutationFn: () => seriesApi.rejectSeries(id),
    onSuccess: () => {
      toast.success('Series rejected');
      void queryClient.invalidateQueries({ queryKey: ['series'] });
    },
    onError: () => toast.error('Reject failed'),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message="Failed to load series" onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={data.title}
        description={data.logline ?? data.synopsis ?? 'Series detail'}
        actions={
          <>
            <Button variant="outline" onClick={() => void refetch()}>
              Refresh
            </Button>
            <Link
              to={`/series/${id}/characters`}
              className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm"
            >
              Characters
            </Link>
            <Link
              to="/series/library"
              className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm"
            >
              Library
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        <Badge tone={statusTone(data.approvalStatus)}>{data.approvalStatus}</Badge>
        <Badge tone="info">{data.lane.laneType}</Badge>
        <Badge tone="default">
          {data.episodes.length}/{data.plannedEpisodeCount} episodes
        </Badge>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={approve.isPending || data.approvalStatus === 'APPROVED'}
          onClick={() => approve.mutate()}
        >
          Approve series
        </Button>
        <Button
          variant="outline"
          disabled={reject.isPending || data.approvalStatus === 'REJECTED'}
          onClick={() => reject.mutate()}
        >
          Reject
        </Button>
      </div>

      {data.bible ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Bible</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ['Premise', data.bible.premise],
              ['Setting', data.bible.setting],
              ['Beginning', data.bible.beginning],
              ['Middle', data.bible.middle],
              ['Ending', data.bible.ending],
              ['World rules', data.bible.worldRules],
            ].map(([label, value]) => (
              <div key={label} className="space-y-1">
                <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
                <p className="text-sm whitespace-pre-wrap">{value}</p>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Episodes</h2>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-medium">#</th>
                <th className="px-2 py-2 font-medium">Title</th>
                <th className="px-2 py-2 font-medium">Status</th>
                <th className="px-2 py-2 font-medium">Approval</th>
                <th className="px-2 py-2 font-medium">Production</th>
              </tr>
            </thead>
            <tbody>
              {data.episodes.map((ep) => (
                <tr key={ep.id} className="border-t border-border">
                  <td className="px-2 py-2">{ep.episodeNumber}</td>
                  <td className="px-2 py-2">
                    <Link
                      className="text-primary hover:underline"
                      to={`/series/${id}/episodes/${ep.id}`}
                    >
                      {ep.title}
                    </Link>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={statusTone(ep.status)}>{ep.status}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={statusTone(ep.approvalStatus)}>{ep.approvalStatus}</Badge>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={statusTone(ep.productionState)}>{ep.productionState}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
