import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { seriesApi } from '@/lib/series-api';
import { statusTone } from '@/lib/status';

export function SeriesLibraryPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['series', 'library'],
    queryFn: () => seriesApi.listSeries({ take: 50 }),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message="Failed to load series library" onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Series library"
        description="Planned, active, and replacement-candidate movies."
        actions={
          <>
            <Button variant="outline" onClick={() => void refetch()}>
              Refresh
            </Button>
            <Link
              to="/series"
              className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm"
            >
              Overview
            </Link>
          </>
        }
      />

      {data.items.length === 0 ? (
        <EmptyState
          title="No series yet"
          description="Generate a movie plan from the Series Studio overview."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="min-w-full text-sm">
            <thead className="bg-muted/40 text-left text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Lane</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Approval</th>
                <th className="px-4 py-3 font-medium">Episodes</th>
                <th className="px-4 py-3 font-medium">Characters</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((item) => (
                <tr key={item.id} className="border-t border-border">
                  <td className="px-4 py-3">
                    <Link className="font-medium text-primary hover:underline" to={`/series/${item.id}`}>
                      {item.title}
                    </Link>
                    {item.logline ? (
                      <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {item.logline}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">{item.lane.laneType}</td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                    {item.isReplacementCandidate ? (
                      <Badge className="ml-1" tone="warning">
                        Replacement
                      </Badge>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge tone={statusTone(item.approvalStatus)}>{item.approvalStatus}</Badge>
                  </td>
                  <td className="px-4 py-3">
                    {item._count.episodes}/{item.plannedEpisodeCount}
                  </td>
                  <td className="px-4 py-3">{item._count.characters}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
