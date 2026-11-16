import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { seriesApi } from '@/lib/series-api';
import { statusTone } from '@/lib/status';

export function SeriesCharactersPage() {
  const { id: seriesId = '' } = useParams();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['series', 'characters', seriesId],
    enabled: Boolean(seriesId),
    queryFn: () => seriesApi.listCharacters(seriesId),
  });

  const generateAll = useMutation({
    mutationFn: () => seriesApi.generateCharacterRefs(seriesId),
    onSuccess: () => {
      toast.success('Character reference generation started');
      void queryClient.invalidateQueries({ queryKey: ['series', 'characters', seriesId] });
    },
    onError: () => toast.error('Failed to generate references'),
  });

  const generateOne = useMutation({
    mutationFn: (characterId: string) =>
      seriesApi.generateOneCharacterRef(seriesId, characterId),
    onSuccess: () => {
      toast.success('Reference queued');
      void queryClient.invalidateQueries({ queryKey: ['series', 'characters', seriesId] });
    },
    onError: () => toast.error('Failed to generate reference'),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message="Failed to load characters" onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Character studio"
        description="Series-locked character bible and reference portraits."
        actions={
          <>
            <Button variant="outline" onClick={() => void refetch()}>
              Refresh
            </Button>
            <Button disabled={generateAll.isPending} onClick={() => generateAll.mutate()}>
              Generate missing refs
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

      {data.length === 0 ? (
        <EmptyState
          title="No characters"
          description="Approve or generate a series plan to create the character roster."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {data.map((character) => {
            const primary = character.referenceAssets?.find((asset) => asset.isPrimary);
            const imageUrl = primary?.mediaAsset?.publicUrl;
            return (
              <section
                key={character.id}
                className="space-y-3 rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h2 className="text-lg font-semibold">{character.name}</h2>
                    <p className="text-sm text-muted-foreground">
                      {character.role} · {character.species}
                    </p>
                  </div>
                  <Badge tone={statusTone(character.lifecycleStatus)}>
                    {character.lifecycleStatus}
                  </Badge>
                </div>
                {imageUrl ? (
                  <img
                    src={imageUrl}
                    alt={character.name}
                    className="h-40 w-full rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                    No reference portrait
                  </div>
                )}
                <p className="text-sm whitespace-pre-wrap">
                  {character.canonicalVisualDescription || character.physicalDescription}
                </p>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {character.personality}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={generateOne.isPending}
                  onClick={() => generateOne.mutate(character.id)}
                >
                  Generate reference
                </Button>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
