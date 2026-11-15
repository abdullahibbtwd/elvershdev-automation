import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Check, Clapperboard, Film, RefreshCw, RotateCcw, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export type MotionJobSummary = {
  id: string;
  status: string;
  progress: number;
  jobType: string;
  errorMessage?: string | null;
  updatedAt?: string;
};

export type MotionItem = {
  id: string;
  sceneId: string;
  storyId: string;
  status: string;
  progress: number;
  motionPrompt: string;
  negativePrompt?: string | null;
  durationSeconds: number;
  resolution: string;
  isSelected: boolean;
  attemptNumber: number;
  provider?: string | null;
  providerModel?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  currency?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  downloadUrl?: string | null;
  sourceImageUrl?: string | null;
  outputMetadata?: Record<string, unknown> | null;
  generationJob?: MotionJobSummary | null;
};

export type StoryMotionScene = {
  id: string;
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  visualDescription: string;
  videoPrompt: string;
  cameraMovement: string;
  hasSourceImage: boolean;
  sourceImageUrl?: string | null;
  motions: MotionItem[];
};

export type StoryMotionResponse = {
  storyId: string;
  scenes: StoryMotionScene[];
  jobs: MotionJobSummary[];
};

export type StoryMotionProgress = {
  storyId: string;
  totalScenes: number;
  completedScenes: number;
  failedScenes: number;
  percentComplete: number;
  countsByStatus: Record<string, number>;
  activeJobs: MotionJobSummary[];
  motions: Array<{
    id: string;
    sceneId: string;
    status: string;
    progress: number;
    isSelected: boolean;
    attemptNumber: number;
    errorMessage?: string | null;
  }>;
};

const ACTIVE_JOB_STATUSES = new Set(['PENDING', 'QUEUED', 'PROCESSING']);
const BUSY_MOTION_STATUSES = new Set([
  'PENDING',
  'ANALYZING',
  'SUBMITTING',
  'PROCESSING',
  'DOWNLOADING',
  'VALIDATING',
]);

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message) && message.length > 0) return message.join(', ');
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
}

function isMotionProgressActive(progress?: StoryMotionProgress): boolean {
  if (!progress) return false;
  if ((progress.activeJobs?.length ?? 0) > 0) return true;
  return Object.entries(progress.countsByStatus || {}).some(
    ([status, count]) => BUSY_MOTION_STATUSES.has(status) && count > 0,
  );
}

export function StoryMotionSection({
  storyId,
  hasScenes,
  isStoryGenerating,
}: {
  storyId: string;
  hasScenes: boolean;
  isStoryGenerating: boolean;
}) {
  const queryClient = useQueryClient();
  const [promptDrafts, setPromptDrafts] = useState<Record<string, string>>({});
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const wasActiveRef = useRef(false);

  const progressQuery = useQuery({
    queryKey: ['story-motion-progress', storyId],
    enabled: Boolean(storyId) && hasScenes,
    refetchInterval: (query) =>
      isMotionProgressActive(query.state.data as StoryMotionProgress | undefined) ? 2000 : false,
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/motion/progress`);
      return res.data.data as StoryMotionProgress;
    },
  });

  const motionQuery = useQuery({
    queryKey: ['story-motion', storyId],
    enabled: Boolean(storyId) && hasScenes,
    refetchInterval: () => (isMotionProgressActive(progressQuery.data) ? 2500 : false),
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/motion`);
      return res.data.data as StoryMotionResponse;
    },
  });

  const isActive = isMotionProgressActive(progressQuery.data);

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      void queryClient.invalidateQueries({ queryKey: ['story-motion', storyId] });
      toast.success('Motion generation finished');
    }
    wasActiveRef.current = isActive;
  }, [isActive, queryClient, storyId]);

  useEffect(() => {
    if (!motionQuery.data) return;
    setPromptDrafts((prev) => {
      const next = { ...prev };
      for (const scene of motionQuery.data.scenes) {
        const selected =
          scene.motions.find((motion) => motion.isSelected) || scene.motions[0] || null;
        const key = selected?.id || `scene-${scene.id}`;
        if (!(key in next)) {
          next[key] = selected?.motionPrompt || scene.videoPrompt || '';
        }
      }
      return next;
    });
  }, [motionQuery.data]);

  const invalidateMotion = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['story-motion', storyId] }),
      queryClient.invalidateQueries({ queryKey: ['story-motion-progress', storyId] }),
    ]);
  };

  const generateStoryMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/stories/${storyId}/motion/generate`, {
        durationSeconds: 5,
        resolution: '720p',
      });
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success('Motion generation queued');
      await invalidateMotion();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to queue motion generation')),
  });

  const generateSceneMutation = useMutation({
    mutationFn: async ({
      sceneId,
      motionPrompt,
      regenerate,
    }: {
      sceneId: string;
      motionPrompt?: string;
      regenerate?: boolean;
    }) => {
      const path = regenerate
        ? `/scenes/${sceneId}/motion/regenerate`
        : `/scenes/${sceneId}/motion/generate`;
      const res = await api.post(path, {
        durationSeconds: 5,
        resolution: '720p',
        ...(motionPrompt ? { motionPrompt, skipAnalysis: true } : {}),
      });
      return res.data.data;
    },
    onMutate: ({ sceneId }) => setPendingSceneId(sceneId),
    onSettled: async () => {
      setPendingSceneId(null);
      await invalidateMotion();
    },
    onSuccess: () => toast.success('Scene motion queued'),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to queue scene motion')),
  });

  const updateMotionMutation = useMutation({
    mutationFn: async ({
      motionId,
      motionPrompt,
      isSelected,
    }: {
      motionId: string;
      motionPrompt?: string;
      isSelected?: boolean;
    }) => {
      const res = await api.patch(`/motion/${motionId}`, {
        ...(motionPrompt !== undefined ? { motionPrompt } : {}),
        ...(isSelected !== undefined ? { isSelected } : {}),
      });
      return res.data.data;
    },
    onSuccess: async () => {
      await invalidateMotion();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to update motion')),
  });

  const retryMutation = useMutation({
    mutationFn: async (motionId: string) => {
      const res = await api.post(`/motion/${motionId}/retry`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success('Motion retry queued');
      await invalidateMotion();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to retry motion')),
  });

  const cancelMutation = useMutation({
    mutationFn: async (motionId: string) => {
      const res = await api.post(`/motion/${motionId}/cancel`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success('Motion cancelled');
      await invalidateMotion();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to cancel motion')),
  });

  const scenesWithImages = useMemo(
    () => motionQuery.data?.scenes.filter((scene) => scene.hasSourceImage).length ?? 0,
    [motionQuery.data],
  );

  if (!hasScenes) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Motion / Clips</h2>
        <EmptyState
          icon={Film}
          title="No scenes yet"
          description="Plan scenes and generate visuals before creating motion clips."
        />
      </div>
    );
  }

  if (motionQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Motion / Clips</h2>
        <LoadingState label="Loading motion clips…" />
      </div>
    );
  }

  if (motionQuery.error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Motion / Clips</h2>
        <ErrorState
          message={getApiErrorMessage(motionQuery.error, 'Could not load motion data')}
          onRetry={() => void motionQuery.refetch()}
        />
      </div>
    );
  }

  const data = motionQuery.data!;
  const progress = progressQuery.data;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Clapperboard className="h-4 w-4" />
            Motion / Clips
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Convert generated scene images into short cinematic video clips.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={isStoryGenerating || isActive}
            onClick={() => void progressQuery.refetch()}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          <Button
            disabled={
              isStoryGenerating ||
              isActive ||
              generateStoryMutation.isPending ||
              scenesWithImages === 0
            }
            onClick={() => {
              const ok = window.confirm(
                `Generate motion clips for ${scenesWithImages} scene(s) with source images? This uses Kling video credits (or mock mode).`,
              );
              if (!ok) return;
              generateStoryMutation.mutate();
            }}
          >
            <Film className="mr-2 h-4 w-4" />
            {isActive
              ? 'Generating motion…'
              : generateStoryMutation.isPending
                ? 'Queuing…'
                : 'Generate motion'}
          </Button>
        </div>
      </div>

      {progress && (
        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground">
          Progress: {progress.completedScenes}/{progress.totalScenes} scenes complete (
          {progress.percentComplete}%)
          {progress.failedScenes > 0 ? ` · ${progress.failedScenes} failed` : ''}
          {isActive ? ' · in progress' : ''}
        </div>
      )}

      {scenesWithImages === 0 && (
        <EmptyState
          icon={Clapperboard}
          title="No source images yet"
          description="Generate scene visuals first. Motion generation requires a completed scene image."
        />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {data.scenes.map((scene) => {
          const selected =
            scene.motions.find((motion) => motion.isSelected) || scene.motions[0] || null;
          const draftKey = selected?.id || `scene-${scene.id}`;
          const draftPrompt = promptDrafts[draftKey] ?? selected?.motionPrompt ?? scene.videoPrompt;
          const busy = Boolean(
            pendingSceneId === scene.id ||
              scene.motions.some((motion) => BUSY_MOTION_STATUSES.has(motion.status)) ||
              (selected?.generationJob &&
                ACTIVE_JOB_STATUSES.has(selected.generationJob.status)),
          );

          return (
            <div key={scene.id} className="space-y-3 rounded-lg border border-border p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium">Scene {scene.sceneNumber}</div>
                  <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                    {scene.visualDescription}
                  </p>
                </div>
                <Badge className={statusTone(selected?.status || (scene.hasSourceImage ? 'READY' : 'MISSING'))}>
                  {selected?.status || (scene.hasSourceImage ? 'IMAGE READY' : 'NO IMAGE')}
                </Badge>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="overflow-hidden rounded-md border bg-muted">
                  {scene.sourceImageUrl ? (
                    <img
                      src={scene.sourceImageUrl}
                      alt={`Scene ${scene.sceneNumber} source`}
                      className="aspect-[9/16] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center text-xs text-muted-foreground">
                      No source image
                    </div>
                  )}
                </div>
                <div className="overflow-hidden rounded-md border bg-background">
                  {selected?.downloadUrl ? (
                    <video
                      key={selected.downloadUrl}
                      src={selected.downloadUrl}
                      controls
                      playsInline
                      className="aspect-[9/16] w-full object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[9/16] items-center justify-center text-xs text-muted-foreground">
                      {busy ? `Generating… ${selected?.progress ?? 0}%` : 'No clip yet'}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-1">
                <div className="text-xs font-medium uppercase text-muted-foreground">Motion prompt</div>
                <Textarea
                  value={draftPrompt}
                  disabled={!scene.hasSourceImage || busy}
                  onChange={(e) =>
                    setPromptDrafts((prev) => ({ ...prev, [draftKey]: e.target.value }))
                  }
                  className="min-h-[90px]"
                />
              </div>

              {selected?.errorMessage && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                  {selected.errorCode ? `${selected.errorCode}: ` : ''}
                  {selected.errorMessage}
                </div>
              )}

              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {selected && (
                  <>
                    <span>
                      {selected.durationSeconds}s · {selected.resolution}
                    </span>
                    {selected.estimatedCost != null && (
                      <span>
                        est. ${Number(selected.estimatedCost).toFixed(4)} {selected.currency || 'USD'}
                      </span>
                    )}
                    <span>attempt #{selected.attemptNumber}</span>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!scene.hasSourceImage || busy || isStoryGenerating}
                  onClick={() => {
                    if (!scene.hasSourceImage) {
                      toast.error('Generate a scene image first');
                      return;
                    }
                    const ok = window.confirm(
                      `Generate motion for scene ${scene.sceneNumber}? This may incur Kling costs.`,
                    );
                    if (!ok) return;
                    generateSceneMutation.mutate({
                      sceneId: scene.id,
                      motionPrompt: draftPrompt,
                      regenerate: Boolean(selected),
                    });
                  }}
                >
                  {selected ? 'Regenerate' : 'Generate clip'}
                </Button>

                {selected && draftPrompt !== selected.motionPrompt && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      updateMotionMutation.mutate({
                        motionId: selected.id,
                        motionPrompt: draftPrompt,
                      })
                    }
                  >
                    Save prompt
                  </Button>
                )}

                {selected && !selected.isSelected && selected.status === 'COMPLETED' && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      updateMotionMutation.mutate({ motionId: selected.id, isSelected: true })
                    }
                  >
                    <Check className="mr-1 h-3.5 w-3.5" />
                    Select
                  </Button>
                )}

                {selected &&
                  (selected.status === 'FAILED' || selected.status === 'CANCELLED') && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => retryMutation.mutate(selected.id)}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      Retry
                    </Button>
                  )}

                {selected && BUSY_MOTION_STATUSES.has(selected.status) && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => cancelMutation.mutate(selected.id)}
                  >
                    <X className="mr-1 h-3.5 w-3.5" />
                    Cancel
                  </Button>
                )}
              </div>

              {scene.motions.length > 1 && (
                <div className="space-y-1 border-t pt-2">
                  <div className="text-xs font-medium uppercase text-muted-foreground">History</div>
                  <div className="flex flex-wrap gap-1">
                    {scene.motions.map((motion) => (
                      <button
                        key={motion.id}
                        type="button"
                        className={`rounded border px-2 py-1 text-xs ${
                          motion.isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-card text-foreground'
                        }`}
                        onClick={() => {
                          setPromptDrafts((prev) => ({
                            ...prev,
                            [motion.id]: motion.motionPrompt,
                          }));
                          if (motion.status === 'COMPLETED' && !motion.isSelected) {
                            updateMotionMutation.mutate({
                              motionId: motion.id,
                              isSelected: true,
                            });
                          }
                        }}
                      >
                        #{motion.attemptNumber} · {motion.status}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
