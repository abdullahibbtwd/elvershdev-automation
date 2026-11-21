import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { seriesApi, type SeriesCharacter, type SeriesCharacterIdentityUpdate } from '@/lib/series-api';
import { statusTone } from '@/lib/status';

type IdentityFormState = {
  ageRange: string;
  genderPresentation: string;
  skinTone: string;
  facialStructure: string;
  eyeColor: string;
  eyeShape: string;
  hairstyle: string;
  hairFurColor: string;
  facialHair: string;
  bodyProportions: string;
  clothing: string;
  accessories: string;
  markings: string;
  voiceProfile: string;
  personality: string;
  physicalDescription: string;
  canonicalVisualDescription: string;
  visualConsistencyNotes: string;
};

function toForm(character: SeriesCharacter): IdentityFormState {
  return {
    ageRange: character.ageRange ?? '',
    genderPresentation: character.genderPresentation ?? '',
    skinTone: character.skinTone ?? '',
    facialStructure: character.facialStructure ?? '',
    eyeColor: character.eyeColor ?? '',
    eyeShape: character.eyeShape ?? '',
    hairstyle: character.hairstyle ?? '',
    hairFurColor: character.hairFurColor ?? '',
    facialHair: character.facialHair ?? '',
    bodyProportions: character.bodyProportions ?? '',
    clothing: character.clothing ?? '',
    accessories: character.accessories ?? '',
    markings: character.markings ?? '',
    voiceProfile: character.voiceProfile ?? '',
    personality: character.personality ?? '',
    physicalDescription: character.physicalDescription ?? '',
    canonicalVisualDescription: character.canonicalVisualDescription ?? '',
    visualConsistencyNotes: character.visualConsistencyNotes ?? '',
  };
}

function Field({
  label,
  value,
  onChange,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
}) {
  return (
    <label className="block space-y-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea
          className="min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

export function SeriesCharactersPage() {
  const { id: seriesId = '' } = useParams();
  const queryClient = useQueryClient();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IdentityFormState | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['series', 'characters', seriesId],
    enabled: Boolean(seriesId),
    queryFn: () => seriesApi.listCharacters(seriesId),
  });

  const invalidate = () =>
    void queryClient.invalidateQueries({ queryKey: ['series', 'characters', seriesId] });

  const generateAll = useMutation({
    mutationFn: () => seriesApi.generateCharacterRefs(seriesId),
    onSuccess: () => {
      toast.success('Character reference generation started');
      invalidate();
    },
    onError: () => toast.error('Failed to generate references'),
  });

  const generateOne = useMutation({
    mutationFn: (characterId: string) =>
      seriesApi.generateOneCharacterRef(seriesId, characterId),
    onSuccess: () => {
      toast.success('Reference queued');
      invalidate();
    },
    onError: () => toast.error('Failed to generate reference'),
  });

  const approveOne = useMutation({
    mutationFn: (characterId: string) =>
      seriesApi.approveCharacterIdentity(seriesId, characterId),
    onSuccess: () => {
      toast.success('Identity approved');
      invalidate();
    },
    onError: () => toast.error('Failed to approve identity'),
  });

  const approveAll = useMutation({
    mutationFn: () => seriesApi.approveAllCharacterIdentities(seriesId),
    onSuccess: () => {
      toast.success('All identities approved');
      invalidate();
    },
    onError: () => toast.error('Failed to approve identities'),
  });

  const saveIdentity = useMutation({
    mutationFn: ({
      characterId,
      body,
    }: {
      characterId: string;
      body: SeriesCharacterIdentityUpdate;
    }) => seriesApi.updateCharacterIdentity(seriesId, characterId, body),
    onSuccess: () => {
      toast.success('Identity saved (approval cleared — re-approve after review)');
      setEditingId(null);
      setForm(null);
      invalidate();
    },
    onError: () => toast.error('Failed to save identity'),
  });

  const approvedCount = useMemo(
    () => (data ?? []).filter((character) => Boolean(character.approvedAt)).length,
    [data],
  );

  if (isLoading) return <LoadingState />;
  if (error || !data) {
    return <ErrorState message="Failed to load characters" onRetry={() => void refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Character studio"
        description="Persistent identity profiles, canonical descriptions, and reference portraits for series continuity."
        actions={
          <>
            <Button variant="outline" onClick={() => void refetch()}>
              Refresh
            </Button>
            <Button
              variant="outline"
              disabled={approveAll.isPending || data.length === 0}
              onClick={() => approveAll.mutate()}
            >
              Approve all identities
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

      <p className="text-sm text-muted-foreground">
        {approvedCount}/{data.length} identities approved. Lite video generation reuses these
        canonical descriptions — it does not guarantee identical faces across clips.
      </p>

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
            const isEditing = editingId === character.id && form;
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
                      {character.ageRange ? ` · ${character.ageRange}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <Badge tone={statusTone(character.lifecycleStatus)}>
                      {character.lifecycleStatus}
                    </Badge>
                    <Badge tone={character.approvedAt ? 'success' : 'warning'}>
                      {character.approvedAt
                        ? `Identity v${character.identityVersion ?? 1} approved`
                        : `Identity v${character.identityVersion ?? 1} draft`}
                    </Badge>
                  </div>
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

                {isEditing ? (
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Field
                        label="Age range"
                        value={form.ageRange}
                        onChange={(value) => setForm({ ...form, ageRange: value })}
                      />
                      <Field
                        label="Gender presentation"
                        value={form.genderPresentation}
                        onChange={(value) => setForm({ ...form, genderPresentation: value })}
                      />
                      <Field
                        label="Skin tone"
                        value={form.skinTone}
                        onChange={(value) => setForm({ ...form, skinTone: value })}
                      />
                      <Field
                        label="Hairstyle"
                        value={form.hairstyle}
                        onChange={(value) => setForm({ ...form, hairstyle: value })}
                      />
                      <Field
                        label="Hair / fur color"
                        value={form.hairFurColor}
                        onChange={(value) => setForm({ ...form, hairFurColor: value })}
                      />
                      <Field
                        label="Facial hair"
                        value={form.facialHair}
                        onChange={(value) => setForm({ ...form, facialHair: value })}
                      />
                      <Field
                        label="Eye color"
                        value={form.eyeColor}
                        onChange={(value) => setForm({ ...form, eyeColor: value })}
                      />
                      <Field
                        label="Eye shape"
                        value={form.eyeShape}
                        onChange={(value) => setForm({ ...form, eyeShape: value })}
                      />
                    </div>
                    <Field
                      label="Facial structure"
                      value={form.facialStructure}
                      onChange={(value) => setForm({ ...form, facialStructure: value })}
                      multiline
                    />
                    <Field
                      label="Body"
                      value={form.bodyProportions}
                      onChange={(value) => setForm({ ...form, bodyProportions: value })}
                      multiline
                    />
                    <Field
                      label="Default clothing"
                      value={form.clothing}
                      onChange={(value) => setForm({ ...form, clothing: value })}
                      multiline
                    />
                    <Field
                      label="Accessories"
                      value={form.accessories}
                      onChange={(value) => setForm({ ...form, accessories: value })}
                    />
                    <Field
                      label="Markings"
                      value={form.markings}
                      onChange={(value) => setForm({ ...form, markings: value })}
                    />
                    <Field
                      label="Voice description"
                      value={form.voiceProfile}
                      onChange={(value) => setForm({ ...form, voiceProfile: value })}
                      multiline
                    />
                    <Field
                      label="Personality"
                      value={form.personality}
                      onChange={(value) => setForm({ ...form, personality: value })}
                      multiline
                    />
                    <Field
                      label="Physical description"
                      value={form.physicalDescription}
                      onChange={(value) => setForm({ ...form, physicalDescription: value })}
                      multiline
                    />
                    <Field
                      label="Canonical visual description"
                      value={form.canonicalVisualDescription}
                      onChange={(value) =>
                        setForm({ ...form, canonicalVisualDescription: value })
                      }
                      multiline
                    />
                    <Field
                      label="Consistency notes"
                      value={form.visualConsistencyNotes}
                      onChange={(value) => setForm({ ...form, visualConsistencyNotes: value })}
                      multiline
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        disabled={saveIdentity.isPending}
                        onClick={() =>
                          saveIdentity.mutate({
                            characterId: character.id,
                            body: {
                              ...form,
                              rebuildCanonicalDescription: !form.canonicalVisualDescription.trim(),
                            },
                          })
                        }
                      >
                        Save identity
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={saveIdentity.isPending}
                        onClick={() =>
                          saveIdentity.mutate({
                            characterId: character.id,
                            body: {
                              ...form,
                              rebuildCanonicalDescription: true,
                            },
                          })
                        }
                      >
                        Rebuild canonical + save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingId(null);
                          setForm(null);
                        }}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-sm whitespace-pre-wrap">
                      {character.canonicalVisualDescription || character.physicalDescription}
                    </p>
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                      {character.personality}
                    </p>
                    {(character.clothing || character.voiceProfile) && (
                      <div className="space-y-1 text-sm text-muted-foreground">
                        {character.clothing ? <p>Clothing: {character.clothing}</p> : null}
                        {character.voiceProfile ? <p>Voice: {character.voiceProfile}</p> : null}
                      </div>
                    )}
                  </>
                )}

                <div className="flex flex-wrap gap-2">
                  {!isEditing ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingId(character.id);
                        setForm(toForm(character));
                      }}
                    >
                      Edit identity
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={approveOne.isPending || Boolean(character.approvedAt)}
                    onClick={() => approveOne.mutate(character.id)}
                  >
                    {character.approvedAt ? 'Approved' : 'Approve identity'}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={generateOne.isPending}
                    onClick={() => generateOne.mutate(character.id)}
                  >
                    Generate reference
                  </Button>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
