import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Check, Image as ImageIcon, Maximize2, RefreshCw, RotateCcw, Sparkles, User } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { ImageLightbox, type LightboxImage } from '@/components/story/ImageLightbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export type VisualStyleItem = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  isSystem: boolean;
};

export type VisualJobSummary = {
  id: string;
  status: string;
  progress: number;
  jobType: string;
  errorMessage?: string | null;
  updatedAt?: string;
};

export type SceneVisualItem = {
  id: string;
  sceneId: string;
  visualStyleId?: string | null;
  visualPrompt: string;
  negativePrompt?: string | null;
  generationStatus: string;
  isSelected: boolean;
  attemptNumber: number;
  provider?: string | null;
  providerModel?: string | null;
  errorMessage?: string | null;
  downloadUrl?: string | null;
  createdAt?: string;
  visualStyle?: VisualStyleItem | null;
  generationJob?: VisualJobSummary | null;
};

export type StoryVisualScene = {
  id: string;
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  cameraMovement: string;
  lighting: string;
  environment: string;
  visuals: SceneVisualItem[];
};

export type CharacterVisualReferenceItem = {
  id: string;
  characterProfileId: string;
  prompt: string;
  isPrimary: boolean;
  downloadUrl?: string | null;
  createdAt?: string;
  generationJob?: VisualJobSummary | null;
};

export type StoryVisualCharacter = {
  id: string;
  name: string;
  appearance: string;
  clothing: string;
  ageRange: string;
  hair: string;
  distinctiveFeatures: string;
  consistencyNotes: string;
  canonicalVisualDescription?: string | null;
  visualReferences: CharacterVisualReferenceItem[];
};

export type StoryVisualsResponse = {
  storyId: string;
  visualStyle: VisualStyleItem | null;
  scenes: StoryVisualScene[];
  characters: StoryVisualCharacter[];
  jobs: VisualJobSummary[];
};

export type StoryVisualsProgress = {
  storyId: string;
  totalScenes: number;
  completedScenes: number;
  failedScenes: number;
  percentComplete: number;
  countsByStatus: {
    PENDING: number;
    ANALYZING: number;
    PROMPT_READY: number;
    GENERATING: number;
    COMPLETED: number;
    FAILED: number;
  };
  activeJobs: VisualJobSummary[];
  charactersTotal: number;
  charactersWithReferences: number;
};

type PromptDraft = {
  baseKey: string;
  visualPrompt: string;
  negativePrompt: string;
  dirty: boolean;
};

const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'QUEUED', 'PROCESSING']);
const BUSY_VISUAL_STATUSES = new Set(['ANALYZING', 'GENERATING']);

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message) && message.length > 0) {
      return message.join(', ');
    }
    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }
  }
  return fallback;
}

function isVisualProgressActive(progress?: StoryVisualsProgress): boolean {
  if (!progress) return false;
  if ((progress.activeJobs?.length ?? 0) > 0) return true;
  if ((progress.countsByStatus?.ANALYZING ?? 0) > 0) return true;
  if ((progress.countsByStatus?.GENERATING ?? 0) > 0) return true;
  return false;
}

export function StoryVisualsSection({
  storyId,
  hasScenes,
  isStoryGenerating,
  selectedStyleId: controlledStyleId,
  onSelectStyleId,
}: {
  storyId: string;
  hasScenes: boolean;
  isStoryGenerating: boolean;
  selectedStyleId?: string;
  onSelectStyleId?: (styleId: string) => void;
}) {
  const queryClient = useQueryClient();
  const [internalStyleId, setInternalStyleId] = useState('');
  const [promptDrafts, setPromptDrafts] = useState<Record<string, PromptDraft>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const [pendingCharacterId, setPendingCharacterId] = useState<string | null>(null);
  const wasActiveRef = useRef(false);

  const selectedStyleId = controlledStyleId !== undefined ? controlledStyleId : internalStyleId;
  const setSelectedStyleId = useCallback(
    (nextId: string) => {
      if (onSelectStyleId) {
        onSelectStyleId(nextId);
      } else {
        setInternalStyleId(nextId);
      }
    },
    [onSelectStyleId],
  );

  const stylesQuery = useQuery({
    queryKey: ['visual-styles'],
    queryFn: async () => {
      const res = await api.get('/visual-styles');
      return res.data.data as VisualStyleItem[];
    },
  });

  const progressQuery = useQuery({
    queryKey: ['story-visuals-progress', storyId],
    enabled: Boolean(storyId) && hasScenes,
    refetchInterval: (query) => {
      const progress = query.state.data as StoryVisualsProgress | undefined;
      return isVisualProgressActive(progress) ? 1500 : false;
    },
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/visuals/progress`);
      return res.data.data as StoryVisualsProgress;
    },
  });

  const progressActive = isVisualProgressActive(progressQuery.data);

  const visualsQuery = useQuery({
    queryKey: ['story-visuals', storyId],
    enabled: Boolean(storyId),
    refetchInterval: (query) => {
      const visuals = query.state.data as StoryVisualsResponse | undefined;
      const hasActiveInList =
        (visuals?.jobs ?? []).some((job) => ACTIVE_JOB_STATUSES.has(job.status)) ||
        (visuals?.scenes ?? []).some((scene) =>
          scene.visuals.some(
            (v) =>
              BUSY_VISUAL_STATUSES.has(v.generationStatus) ||
              (v.generationJob && ACTIVE_JOB_STATUSES.has(v.generationJob.status)),
          ),
        );
      return progressActive || hasActiveInList ? 1500 : false;
    },
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/visuals`);
      return res.data.data as StoryVisualsResponse;
    },
  });

  const isVisualActive = useMemo(() => {
    if (progressActive) return true;
    const visuals = visualsQuery.data;
    if (!visuals) return false;
    return (
      visuals.jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status)) ||
      visuals.scenes.some((scene) =>
        scene.visuals.some(
          (v) =>
            BUSY_VISUAL_STATUSES.has(v.generationStatus) ||
            (v.generationJob && ACTIVE_JOB_STATUSES.has(v.generationJob.status)),
        ),
      )
    );
  }, [progressActive, visualsQuery.data]);

  useEffect(() => {
    if (wasActiveRef.current && !isVisualActive) {
      void queryClient.invalidateQueries({ queryKey: ['story-visuals', storyId] });
      void queryClient.invalidateQueries({ queryKey: ['story', storyId] });
    }
    wasActiveRef.current = isVisualActive;
  }, [isVisualActive, queryClient, storyId]);

  useEffect(() => {
    if (selectedStyleId) return;
    const styles = stylesQuery.data ?? [];
    const storyStyleId = visualsQuery.data?.visualStyle?.id;
    const defaultStyle = styles.find((s) => s.isDefault) ?? styles[0];
    const initial = storyStyleId ?? defaultStyle?.id ?? '';
    if (initial) {
      setSelectedStyleId(initial);
    }
  }, [selectedStyleId, setSelectedStyleId, stylesQuery.data, visualsQuery.data?.visualStyle?.id]);

  const invalidateVisualQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ['story-visuals-progress', storyId] });
    void queryClient.invalidateQueries({ queryKey: ['story-visuals', storyId] });
    void queryClient.invalidateQueries({ queryKey: ['story', storyId] });
  };

  const generateStoryMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/stories/${storyId}/visuals/generate`, {
        visualStyleId: selectedStyleId || undefined,
      });
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Story visual generation queued');
      invalidateVisualQueries();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to queue visual generation'));
    },
  });

  const savePromptMutation = useMutation({
    mutationFn: async (vars: {
      sceneId: string;
      visualId: string;
      visualPrompt: string;
      negativePrompt?: string;
    }) => {
      const res = await api.patch(`/scenes/${vars.sceneId}/visuals/${vars.visualId}`, {
        visualPrompt: vars.visualPrompt,
        negativePrompt: vars.negativePrompt,
      });
      return res.data.data as SceneVisualItem;
    },
    onSuccess: (_data, vars) => {
      toast.success('Visual prompt saved');
      setPromptDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.sceneId];
        return next;
      });
      invalidateVisualQueries();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to save visual prompt'));
    },
  });

  const selectVisualMutation = useMutation({
    mutationFn: async (vars: { sceneId: string; visualId: string }) => {
      const res = await api.patch(`/scenes/${vars.sceneId}/visuals/${vars.visualId}`, {
        isSelected: true,
      });
      return res.data.data as SceneVisualItem;
    },
    onSuccess: () => {
      toast.success('Preferred visual selected');
      invalidateVisualQueries();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to select visual'));
    },
  });

  const sceneGenerateMutation = useMutation({
    mutationFn: async (vars: {
      sceneId: string;
      regenerate: boolean;
      visualPrompt?: string;
      negativePrompt?: string;
    }) => {
      setPendingSceneId(vars.sceneId);
      const endpoint = vars.regenerate
        ? `/scenes/${vars.sceneId}/visuals/regenerate`
        : `/scenes/${vars.sceneId}/visuals/generate`;
      const res = await api.post(endpoint, {
        visualStyleId: selectedStyleId || undefined,
        ...(vars.visualPrompt?.trim() ? { visualPrompt: vars.visualPrompt.trim() } : {}),
        ...(vars.negativePrompt !== undefined
          ? { negativePrompt: vars.negativePrompt.trim() }
          : {}),
      });
      return res.data.data;
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.regenerate ? 'Scene regeneration queued' : 'Scene visual queued');
      setPromptDrafts((prev) => {
        const next = { ...prev };
        delete next[vars.sceneId];
        return next;
      });
      invalidateVisualQueries();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to queue scene visual'));
    },
    onSettled: () => {
      setPendingSceneId(null);
    },
  });

  const generateCharacterRefMutation = useMutation({
    mutationFn: async (vars: { characterId: string; force: boolean }) => {
      setPendingCharacterId(vars.characterId);
      const res = await api.post(`/characters/${vars.characterId}/visual-reference/generate`, {
        force: vars.force,
      });
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Character reference queued');
      invalidateVisualQueries();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to generate character reference'));
    },
    onSettled: () => {
      setPendingCharacterId(null);
    },
  });

  const retryJobMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const res = await api.post(`/visual-generation/jobs/${jobId}/retry`);
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Visual job retried');
      invalidateVisualQueries();
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, 'Failed to retry job'));
    },
  });

  const visualsData = visualsQuery.data;
  const styles = stylesQuery.data ?? [];
  const selectedStyle = styles.find((s) => s.id === selectedStyleId) ?? visualsData?.visualStyle ?? null;
  const progress = progressQuery.data;

  const { lightboxImages, imageIndexByKey } = useMemo(() => {
    const items: LightboxImage[] = [];
    const indexMap = new Map<string, number>();

    for (const character of visualsData?.characters ?? []) {
      for (const ref of character.visualReferences) {
        if (ref.downloadUrl) {
          indexMap.set(`char:${ref.id}`, items.length);
          items.push({
            url: ref.downloadUrl,
            title: `${character.name} · Character reference`,
            subtitle: ref.prompt,
          });
        }
      }
    }

    for (const scene of visualsData?.scenes ?? []) {
      for (const visual of scene.visuals) {
        if (visual.downloadUrl) {
          indexMap.set(`visual:${visual.id}`, items.length);
          items.push({
            url: visual.downloadUrl,
            title: `Scene ${scene.sceneNumber} · Attempt #${visual.attemptNumber}${visual.isSelected ? ' (Selected)' : ''}`,
            subtitle: visual.visualPrompt,
          });
        }
      }
    }

    return { lightboxImages: items, imageIndexByKey: indexMap };
  }, [visualsData]);

  const openLightbox = (key: string) => {
    const idx = imageIndexByKey.get(key);
    if (idx !== undefined) {
      setLightboxIndex(idx);
    }
  };

  const hasCompletedVisuals = Boolean(
    visualsData?.scenes.some((scene) =>
      scene.visuals.some((v) => v.generationStatus === 'COMPLETED' && Boolean(v.downloadUrl)),
    ),
  );

  const hasActiveAnalysisJob = Boolean(
    progress?.activeJobs?.some((job) => job.jobType === 'VISUAL_ANALYSIS') ||
      visualsData?.jobs.some(
        (job) => job.jobType === 'VISUAL_ANALYSIS' && ACTIVE_JOB_STATUSES.has(job.status),
      ),
  );

  const latestAnalysisJob = visualsData?.jobs.find((job) => job.jobType === 'VISUAL_ANALYSIS');
  const showFailedAnalysisBanner =
    !hasActiveAnalysisJob && latestAnalysisJob?.status === 'FAILED';

  const handleGenerateAll = () => {
    if (hasCompletedVisuals) {
      const confirmed = window.confirm(
        'Some scenes already have generated visuals. Generate visuals for the story anyway?',
      );
      if (!confirmed) return;
    }
    generateStoryMutation.mutate();
  };

  const getSceneDraft = (scene: StoryVisualScene, targetVisual: SceneVisualItem | null) => {
    const serverPrompt = targetVisual ? targetVisual.visualPrompt : scene.imagePrompt;
    const serverNegative = targetVisual?.negativePrompt ?? '';
    const baseKey = targetVisual
      ? `${targetVisual.id}:${serverPrompt}:${serverNegative}`
      : `scene:${scene.imagePrompt}`;
    const existing = promptDrafts[scene.id];
    if (existing && (existing.dirty || existing.baseKey === baseKey)) {
      return {
        visualPrompt: existing.visualPrompt,
        negativePrompt: existing.negativePrompt,
        dirty: existing.dirty,
        baseKey,
      };
    }
    return {
      visualPrompt: serverPrompt,
      negativePrompt: serverNegative,
      dirty: false,
      baseKey,
    };
  };

  const updateSceneDraft = (
    sceneId: string,
    baseKey: string,
    patch: Partial<{ visualPrompt: string; negativePrompt: string }>,
    current: { visualPrompt: string; negativePrompt: string },
  ) => {
    setPromptDrafts((prev) => ({
      ...prev,
      [sceneId]: {
        baseKey,
        visualPrompt: patch.visualPrompt ?? current.visualPrompt,
        negativePrompt: patch.negativePrompt ?? current.negativePrompt,
        dirty: true,
      },
    }));
  };

  return (
    <section id="story-visuals" className="space-y-5 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-semibold">Visuals</h2>
            {progress && progress.totalScenes > 0 && (
              <Badge tone={progress.completedScenes === progress.totalScenes ? 'success' : 'default'}>
                {progress.completedScenes}/{progress.totalScenes} scenes ready
              </Badge>
            )}
            {isVisualActive && <Badge tone="info">Generating</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Select a visual style, refine scene prompts, and generate or compare scene artwork.
          </p>
        </div>

        {hasScenes && (
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Visual style"
              className="h-10 rounded-md border border-input bg-card px-3 text-sm"
              value={selectedStyleId}
              disabled={isStoryGenerating || isVisualActive || stylesQuery.isLoading}
              onChange={(e) => setSelectedStyleId(e.target.value)}
            >
              {styles.length === 0 && <option value="">Default style</option>}
              {styles.map((style) => (
                <option key={style.id} value={style.id}>
                  {style.name}
                  {style.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
            <Button
              disabled={isStoryGenerating || isVisualActive || generateStoryMutation.isPending}
              onClick={handleGenerateAll}
            >
              <Sparkles className="h-4 w-4" />
              {isVisualActive
                ? 'Generating…'
                : generateStoryMutation.isPending
                  ? 'Queuing…'
                  : hasCompletedVisuals
                    ? 'Generate story visuals'
                    : 'Generate all visuals'}
            </Button>
          </div>
        )}
      </div>

      {selectedStyle && (
        <div className="rounded-md border bg-secondary/40 px-3 py-2 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{selectedStyle.name}:</span>{' '}
          {selectedStyle.description}
        </div>
      )}

      {!hasScenes ? (
        <EmptyState
          icon={ImageIcon}
          title="No scenes to visualize"
          description="Plan story scenes first so prompts and visuals can be generated for each scene."
        />
      ) : visualsQuery.isLoading ? (
        <LoadingState label="Loading visuals…" />
      ) : visualsQuery.error ? (
        <ErrorState
          message="Failed to load story visuals"
          onRetry={() => void visualsQuery.refetch()}
        />
      ) : !visualsData ? null : (
        <div className="space-y-6">
          {progress && (isVisualActive || progress.completedScenes > 0 || progress.failedScenes > 0) && (
            <div className="space-y-2 rounded-lg border bg-secondary/50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <div className="font-medium text-foreground">
                  {isVisualActive ? 'Visual generation in progress' : 'Visual generation summary'}
                </div>
                <div className="text-xs text-muted-foreground">
                  {progress.completedScenes}/{progress.totalScenes} scenes ({progress.percentComplete}%)
                  {progress.charactersTotal > 0 &&
                    ` · ${progress.charactersWithReferences}/${progress.charactersTotal} character refs`}
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-slate-900 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(0, progress.percentComplete))}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {progress.countsByStatus.ANALYZING > 0 && (
                  <Badge tone="info">Analyzing: {progress.countsByStatus.ANALYZING}</Badge>
                )}
                {progress.countsByStatus.PROMPT_READY > 0 && (
                  <Badge tone="default">Prompt ready: {progress.countsByStatus.PROMPT_READY}</Badge>
                )}
                {progress.countsByStatus.GENERATING > 0 && (
                  <Badge tone="info">Generating: {progress.countsByStatus.GENERATING}</Badge>
                )}
                {progress.countsByStatus.COMPLETED > 0 && (
                  <Badge tone="success">Completed: {progress.countsByStatus.COMPLETED}</Badge>
                )}
                {progress.failedScenes > 0 && (
                  <Badge tone="danger">Failed: {progress.failedScenes}</Badge>
                )}
                {progress.activeJobs.map((job) => (
                  <span key={job.id} className="inline-flex items-center gap-1 text-muted-foreground">
                    <span className="h-2 w-2 animate-pulse rounded-full bg-blue-500" />
                    {job.jobType} ({job.status}
                    {job.progress > 0 ? ` ${job.progress}%` : ''})
                  </span>
                ))}
              </div>
            </div>
          )}

          {showFailedAnalysisBanner && latestAnalysisJob && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              <div>
                <span className="font-medium">Visual analysis failed:</span>{' '}
                {latestAnalysisJob.errorMessage || 'Unknown error'}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={retryJobMutation.isPending}
                onClick={() => retryJobMutation.mutate(latestAnalysisJob.id)}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Retry analysis
              </Button>
            </div>
          )}

          {visualsData.characters.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Character references</h3>
                <span className="text-xs text-muted-foreground">
                  {visualsData.characters.length} character
                  {visualsData.characters.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {visualsData.characters.map((character) => {
                  const primaryRef =
                    character.visualReferences.find((r) => r.isPrimary) ??
                    character.visualReferences[0];
                  const hasRef = character.visualReferences.length > 0;
                  const isCharJobActive = character.visualReferences.some(
                    (ref) => ref.generationJob && ACTIVE_JOB_STATUSES.has(ref.generationJob.status),
                  );

                  return (
                    <div
                      key={character.id}
                      className="flex flex-col justify-between rounded-xl border border-border bg-card p-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-foreground">{character.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {[character.ageRange, character.hair].filter(Boolean).join(' · ')}
                            </div>
                          </div>
                          {hasRef && <Badge tone="success">Reference ready</Badge>}
                        </div>

                        {primaryRef?.downloadUrl ? (
                          <button
                            type="button"
                            className="group relative block w-full overflow-hidden rounded-md border bg-muted"
                            onClick={() => openLightbox(`char:${primaryRef.id}`)}
                          >
                            <img
                              src={primaryRef.downloadUrl}
                              alt={`${character.name} reference`}
                              className="h-44 w-full object-contain transition-transform group-hover:scale-[1.02]"
                            />
                            <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-slate-900/75 px-2 py-0.5 text-[11px] text-white">
                              <Maximize2 className="h-3 w-3" />
                              Preview
                            </span>
                          </button>
                        ) : (
                          <div className="flex h-36 flex-col items-center justify-center rounded-md border border-dashed bg-secondary/40 text-xs text-muted-foreground">
                            <User className="mb-1.5 h-6 w-6" />
                            No reference portrait yet
                          </div>
                        )}

                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {character.canonicalVisualDescription || character.appearance}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t pt-2.5">
                        <span className="text-xs text-muted-foreground">
                          {character.visualReferences.length} ref
                          {character.visualReferences.length === 1 ? '' : 's'}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={
                            isStoryGenerating ||
                            hasActiveAnalysisJob ||
                            isCharJobActive ||
                            pendingCharacterId === character.id
                          }
                          onClick={() => {
                            if (hasRef) {
                              const confirmed = window.confirm(
                                `Regenerate character reference portrait for ${character.name}?`,
                              );
                              if (!confirmed) return;
                            }
                            generateCharacterRefMutation.mutate({
                              characterId: character.id,
                              force: hasRef,
                            });
                          }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          {pendingCharacterId === character.id
                            ? 'Queuing…'
                            : hasRef
                              ? 'Regenerate'
                              : 'Generate ref'}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Scene visuals</h3>
            {visualsData.scenes.map((scene) => {
              const selectedVisual = scene.visuals.find((v) => v.isSelected) ?? null;
              const latestVisual = scene.visuals[0] ?? null;
              const displayVisual =
                selectedVisual ??
                scene.visuals.find((v) => v.generationStatus === 'COMPLETED' && v.downloadUrl) ??
                latestVisual;
              const promptTargetVisual = selectedVisual ?? latestVisual;

              const draft = getSceneDraft(scene, promptTargetVisual);
              const representativeStatus =
                displayVisual?.generationStatus ?? 'PENDING';
              const isSceneBusy =
                hasActiveAnalysisJob ||
                pendingSceneId === scene.id ||
                scene.visuals.some(
                  (v) =>
                    BUSY_VISUAL_STATUSES.has(v.generationStatus) ||
                    (v.generationJob && ACTIVE_JOB_STATUSES.has(v.generationJob.status)),
                );
              const isPromptLocked = Boolean(
                promptTargetVisual && BUSY_VISUAL_STATUSES.has(promptTargetVisual.generationStatus),
              );
              const hasCompletedForScene = scene.visuals.some(
                (v) => v.generationStatus === 'COMPLETED' && Boolean(v.downloadUrl),
              );
              const sceneErrorMessage =
                displayVisual?.generationStatus === 'FAILED'
                  ? displayVisual.errorMessage || displayVisual.generationJob?.errorMessage
                  : null;

              return (
                <div key={scene.id} className="rounded-xl border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">
                        Scene {scene.sceneNumber}
                      </span>
                      <Badge>{scene.durationSeconds}s</Badge>
                      <Badge tone={statusTone(representativeStatus)}>
                        {representativeStatus}
                      </Badge>
                      {displayVisual && (
                        <span className="text-xs text-muted-foreground">
                          Attempt #{displayVisual.attemptNumber}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      {representativeStatus === 'FAILED' && !hasCompletedForScene ? (
                        <Button
                          size="sm"
                          disabled={isStoryGenerating || isSceneBusy}
                          onClick={() =>
                            sceneGenerateMutation.mutate({
                              sceneId: scene.id,
                              regenerate: false,
                              visualPrompt: draft.visualPrompt,
                              negativePrompt: draft.negativePrompt,
                            })
                          }
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          Retry scene
                        </Button>
                      ) : hasCompletedForScene ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isStoryGenerating || isSceneBusy}
                          onClick={() => {
                            const confirmed = window.confirm(
                              `Regenerate visual for Scene ${scene.sceneNumber}? This creates a new image generation attempt.`,
                            );
                            if (!confirmed) return;
                            sceneGenerateMutation.mutate({
                              sceneId: scene.id,
                              regenerate: true,
                              visualPrompt: draft.dirty ? draft.visualPrompt : undefined,
                              negativePrompt: draft.dirty ? draft.negativePrompt : undefined,
                            });
                          }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Regenerate
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={isStoryGenerating || isSceneBusy}
                          onClick={() =>
                            sceneGenerateMutation.mutate({
                              sceneId: scene.id,
                              regenerate: false,
                              visualPrompt:
                                draft.dirty || !promptTargetVisual ? draft.visualPrompt : undefined,
                              negativePrompt:
                                draft.dirty || !promptTargetVisual
                                  ? draft.negativePrompt
                                  : undefined,
                            })
                          }
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          {isSceneBusy ? 'Generating…' : 'Generate image'}
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-4 lg:grid-cols-12">
                    <div className="space-y-3 lg:col-span-5">
                      {displayVisual?.downloadUrl ? (
                        <button
                          type="button"
                          className="group relative block w-full overflow-hidden rounded-md border bg-muted text-left"
                          onClick={() => openLightbox(`visual:${displayVisual.id}`)}
                        >
                          <img
                            src={displayVisual.downloadUrl}
                            alt={`Scene ${scene.sceneNumber} visual`}
                            className="h-56 w-full object-contain transition-transform group-hover:scale-[1.01]"
                          />
                          <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
                            {displayVisual.isSelected && (
                              <span className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-0.5 text-[11px] font-medium text-white">
                                <Check className="h-3 w-3" />
                                Selected
                              </span>
                            )}
                          </div>
                          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded bg-slate-900/75 px-2 py-0.5 text-[11px] text-white">
                            <Maximize2 className="h-3 w-3" />
                            Expand
                          </span>
                        </button>
                      ) : isSceneBusy ? (
                        <div className="flex h-56 flex-col items-center justify-center rounded-md border border-dashed bg-secondary/40 text-sm text-muted-foreground">
                          <span className="mb-2 h-5 w-5 animate-spin rounded-full border-2 border-border border-t-slate-700" />
                          {representativeStatus === 'ANALYZING'
                            ? 'Analyzing scene prompt…'
                            : 'Generating image…'}
                        </div>
                      ) : representativeStatus === 'FAILED' ? (
                        <div className="flex h-56 flex-col items-center justify-center rounded-md border border-red-500/40 bg-red-500/10 p-4 text-center text-sm text-red-300">
                          <p className="font-medium">Image generation failed</p>
                          <p className="mt-1 line-clamp-3 text-xs text-destructive">
                            {sceneErrorMessage || 'Unknown error occurred during generation.'}
                          </p>
                        </div>
                      ) : (
                        <div className="flex h-56 flex-col items-center justify-center rounded-md border border-dashed bg-secondary/40 px-4 text-center text-xs text-muted-foreground">
                          <ImageIcon className="mb-2 h-6 w-6" />
                          No image generated yet
                        </div>
                      )}

                      {scene.visuals.length > 1 && (
                        <div className="space-y-1.5">
                          <div className="text-xs font-medium uppercase text-muted-foreground">
                            Attempts ({scene.visuals.length})
                          </div>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {scene.visuals.map((attempt) => (
                              <div
                                key={attempt.id}
                                className={`rounded-md border p-1.5 text-xs ${
                                  attempt.isSelected
                                    ? 'border-emerald-600 bg-emerald-50/40 ring-1 ring-emerald-600'
                                    : 'bg-secondary/40'
                                }`}
                              >
                                {attempt.downloadUrl ? (
                                  <button
                                    type="button"
                                    className="block w-full overflow-hidden rounded bg-muted"
                                    onClick={() => openLightbox(`visual:${attempt.id}`)}
                                  >
                                    <img
                                      src={attempt.downloadUrl}
                                      alt={`Scene ${scene.sceneNumber} attempt ${attempt.attemptNumber}`}
                                      className="h-20 w-full object-cover"
                                    />
                                  </button>
                                ) : (
                                  <div className="flex h-20 items-center justify-center rounded bg-muted text-[11px] text-muted-foreground">
                                    {attempt.generationStatus}
                                  </div>
                                )}

                                <div className="mt-1.5 flex items-center justify-between gap-1">
                                  <span className="font-medium text-foreground">
                                    #{attempt.attemptNumber}
                                  </span>
                                  {attempt.isSelected ? (
                                    <span className="font-medium text-emerald-700">Selected</span>
                                  ) : attempt.generationStatus === 'COMPLETED' &&
                                    attempt.downloadUrl ? (
                                    <button
                                      type="button"
                                      disabled={selectVisualMutation.isPending}
                                      className="font-medium text-foreground underline hover:text-foreground disabled:opacity-50"
                                      onClick={() =>
                                        selectVisualMutation.mutate({
                                          sceneId: scene.id,
                                          visualId: attempt.id,
                                        })
                                      }
                                    >
                                      Select
                                    </button>
                                  ) : (
                                    <Badge tone={statusTone(attempt.generationStatus)}>
                                      {attempt.generationStatus}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="space-y-3 lg:col-span-7">
                      <p className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">Narration:</span>{' '}
                        {scene.narration}
                      </p>

                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-medium uppercase text-muted-foreground">
                            Visual prompt
                          </label>
                          {draft.dirty && (
                            <span className="text-[11px] text-amber-300">Unsaved changes</span>
                          )}
                        </div>
                        <Textarea
                          className="min-h-[110px]"
                          value={draft.visualPrompt}
                          disabled={isPromptLocked || savePromptMutation.isPending}
                          onChange={(e) =>
                            updateSceneDraft(
                              scene.id,
                              draft.baseKey,
                              { visualPrompt: e.target.value },
                              draft,
                            )
                          }
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-medium uppercase text-muted-foreground">
                          Negative prompt (optional)
                        </label>
                        <Input
                          value={draft.negativePrompt}
                          disabled={isPromptLocked || savePromptMutation.isPending}
                          placeholder="blurry, low quality, distorted anatomy..."
                          onChange={(e) =>
                            updateSceneDraft(
                              scene.id,
                              draft.baseKey,
                              { negativePrompt: e.target.value },
                              draft,
                            )
                          }
                        />
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-muted-foreground">
                          {promptTargetVisual
                            ? `Editing prompt for attempt #${promptTargetVisual.attemptNumber}`
                            : 'Pre-filled from scene plan — edit before generating'}
                        </span>

                        {promptTargetVisual && (
                          <div className="flex gap-2">
                            {draft.dirty && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  setPromptDrafts((prev) => {
                                    const next = { ...prev };
                                    delete next[scene.id];
                                    return next;
                                  })
                                }
                              >
                                Reset
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !draft.dirty ||
                                !draft.visualPrompt.trim() ||
                                isPromptLocked ||
                                savePromptMutation.isPending
                              }
                              onClick={() =>
                                savePromptMutation.mutate({
                                  sceneId: scene.id,
                                  visualId: promptTargetVisual.id,
                                  visualPrompt: draft.visualPrompt.trim(),
                                  negativePrompt: draft.negativePrompt.trim(),
                                })
                              }
                            >
                              {savePromptMutation.isPending ? 'Saving…' : 'Save prompt'}
                            </Button>
                          </div>
                        )}
                      </div>

                      {sceneErrorMessage && (
                        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                          <span className="font-medium">Error:</span> {sceneErrorMessage}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <ImageLightbox
        images={lightboxImages}
        activeIndex={lightboxIndex}
        onClose={() => setLightboxIndex(null)}
        onChangeIndex={setLightboxIndex}
      />
    </section>
  );
}
