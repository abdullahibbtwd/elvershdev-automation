import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { Check, CheckCircle2, Mic, RefreshCw, RotateCcw, Save, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export type NarrationJobSummary = {
  id: string;
  status: string;
  progress: number;
  jobType: string;
  errorMessage?: string | null;
  updatedAt?: string;
};

export type NarrationAudioItem = {
  id: string;
  sceneId: string | null;
  sceneNarrationId: string | null;
  status: string;
  progress: number;
  sourceText?: string;
  speakingStyle?: string | null;
  providerVoiceId?: string | null;
  voiceProfileId?: string | null;
  durationSeconds?: number | null;
  format?: string | null;
  mimeType?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  currency?: string | null;
  isSelected: boolean;
  attemptNumber: number;
  retryCount: number;
  errorCode?: string | null;
  errorMessage?: string | null;
  downloadUrl?: string | null;
  createdAt?: string;
};

export type SceneNarrationItem = {
  id: string;
  sceneId: string;
  sceneNumber?: number | null;
  sequence: number;
  text: string;
  emotionalTone?: string;
  speakingStyle: string;
  deliveryInstructions?: string | null;
  estimatedDurationSeconds: number;
  status: string;
  audio: NarrationAudioItem[];
};

export type NarrationScript = {
  id: string;
  storyId: string;
  version: number;
  status: string;
  fullText?: string | null;
  errorMessage?: string | null;
  approvedAt?: string | null;
  scenes: SceneNarrationItem[];
};

export type StoryNarrationResponse = {
  storyId: string;
  narrationScript: NarrationScript | null;
  jobs: NarrationJobSummary[];
};

export type StoryNarrationProgress = {
  storyId: string;
  narrationScript: { id: string; version: number; status: string; errorMessage?: string | null } | null;
  totalScenes: number;
  completedScenes: number;
  failedScenes: number;
  percentComplete: number;
  countsByStatus: Record<string, number>;
  activeJobs: NarrationJobSummary[];
};

type ProviderVoice = { id: string; name: string; description?: string; provider?: string };

type VoiceProfile = {
  id: string;
  name: string;
  providerVoiceId: string;
  isDefault: boolean;
  configuration?: { speakingStyle?: string } | null;
};

type SceneDraft = { text?: string; speakingStyle?: string };

const BUSY_AUDIO_STATUSES = new Set(['PENDING', 'GENERATING', 'VALIDATING', 'STORING']);
const POLL_INTERVAL_MS = 1500;

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const message = (err.response?.data as { message?: string | string[] } | undefined)?.message;
    if (Array.isArray(message) && message.length > 0) return message.join(', ');
    if (typeof message === 'string' && message.trim().length > 0) return message;
  }
  return fallback;
}

function isNarrationProgressActive(progress?: StoryNarrationProgress): boolean {
  if (!progress) return false;
  if (progress.narrationScript?.status === 'PLANNING') return true;
  if ((progress.activeJobs?.length ?? 0) > 0) return true;
  return Object.entries(progress.countsByStatus || {}).some(
    ([status, count]) => BUSY_AUDIO_STATUSES.has(status) && count > 0,
  );
}

function formatCost(value?: number | null, currency?: string | null) {
  if (value == null) return null;
  return `$${Number(value).toFixed(4)} ${currency || 'USD'}`;
}

function formatDuration(seconds?: number | null) {
  if (seconds == null) return null;
  return `${Number(seconds).toFixed(1)}s`;
}

function pickAudio(audio: NarrationAudioItem[]): NarrationAudioItem | null {
  return (
    audio.find((item) => item.isSelected) ||
    audio.find((item) => item.status === 'COMPLETED') ||
    audio[0] ||
    null
  );
}

export function StoryNarrationSection({
  storyId,
  hasScenes,
  isStoryGenerating,
}: {
  storyId: string;
  hasScenes: boolean;
  isStoryGenerating: boolean;
}) {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, SceneDraft>>({});
  const [voiceChoice, setVoiceChoice] = useState<string>(''); // '', 'profile:<id>', 'voice:<id>'
  const [speakingStyle, setSpeakingStyle] = useState('');
  const [forceRegenerate, setForceRegenerate] = useState(false);
  const [newProfileName, setNewProfileName] = useState('');
  const [pendingSceneId, setPendingSceneId] = useState<string | null>(null);
  const wasActiveRef = useRef(false);

  const progressQuery = useQuery({
    queryKey: ['story-narration-progress', storyId],
    enabled: Boolean(storyId) && hasScenes,
    refetchInterval: (query) =>
      isNarrationProgressActive(query.state.data as StoryNarrationProgress | undefined)
        ? POLL_INTERVAL_MS
        : false,
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/narration/progress`);
      return res.data.data as StoryNarrationProgress;
    },
  });

  const isActive = isNarrationProgressActive(progressQuery.data);

  const narrationQuery = useQuery({
    queryKey: ['story-narration', storyId],
    enabled: Boolean(storyId) && hasScenes,
    refetchInterval: () => (isActive ? POLL_INTERVAL_MS : false),
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/narration`);
      return res.data.data as StoryNarrationResponse;
    },
  });

  const voicesQuery = useQuery({
    queryKey: ['voices'],
    enabled: hasScenes,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await api.get('/voices');
      return (res.data.data?.voices ?? []) as ProviderVoice[];
    },
  });

  const profilesQuery = useQuery({
    queryKey: ['voice-profiles'],
    enabled: hasScenes,
    queryFn: async () => {
      const res = await api.get('/voice-profiles');
      return (res.data.data ?? []) as VoiceProfile[];
    },
  });

  const voices = voicesQuery.data ?? [];
  const profiles = profilesQuery.data ?? [];

  useEffect(() => {
    if (wasActiveRef.current && !isActive) {
      void queryClient.invalidateQueries({ queryKey: ['story-narration', storyId] });
      toast.success('Narration processing finished');
    }
    wasActiveRef.current = isActive;
  }, [isActive, queryClient, storyId]);

  const invalidateNarration = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['story-narration', storyId] }),
      queryClient.invalidateQueries({ queryKey: ['story-narration-progress', storyId] }),
    ]);
  };

  const voicePayload = () => {
    const payload: { voiceProfileId?: string; providerVoiceId?: string; speakingStyle?: string } =
      {};
    if (voiceChoice.startsWith('profile:')) payload.voiceProfileId = voiceChoice.slice(8);
    else if (voiceChoice.startsWith('voice:')) payload.providerVoiceId = voiceChoice.slice(6);
    if (speakingStyle.trim()) payload.speakingStyle = speakingStyle.trim();
    return payload;
  };

  const planMutation = useMutation({
    mutationFn: async (regenerate: boolean) => {
      const res = await api.post(`/stories/${storyId}/narration/plan`, { regenerate });
      return res.data.data;
    },
    onSuccess: async (_data, regenerate) => {
      setDrafts({});
      toast.success(regenerate ? 'Narration regeneration queued' : 'Narration planning queued');
      await invalidateNarration();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to plan narration')),
  });

  const saveMutation = useMutation({
    mutationFn: async ({
      scriptId,
      scenes,
    }: {
      scriptId: string;
      scenes: Array<{ id: string; text?: string; speakingStyle?: string }>;
    }) => {
      const res = await api.patch(`/narration/${scriptId}`, { scenes });
      return res.data.data;
    },
    onSuccess: async () => {
      setDrafts({});
      toast.success('Narration saved');
      await invalidateNarration();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to save narration')),
  });

  const approveMutation = useMutation({
    mutationFn: async (scriptId: string) => {
      const res = await api.post(`/narration/${scriptId}/approve`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success('Narration script approved');
      await invalidateNarration();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to approve narration')),
  });

  const createProfileMutation = useMutation({
    mutationFn: async () => {
      const providerVoiceId = voiceChoice.startsWith('voice:')
        ? voiceChoice.slice(6)
        : voiceChoice.startsWith('profile:')
          ? profiles.find((p) => p.id === voiceChoice.slice(8))?.providerVoiceId
          : voices[0]?.id;
      if (!providerVoiceId) throw new Error('Select a provider voice first');
      const res = await api.post('/voice-profiles', {
        name: newProfileName.trim() || 'Default narrator',
        providerVoiceId,
        isDefault: profiles.length === 0,
        configuration: speakingStyle.trim() ? { speakingStyle: speakingStyle.trim() } : {},
      });
      return res.data.data as VoiceProfile;
    },
    onSuccess: async (profile) => {
      toast.success('Voice profile created');
      setNewProfileName('');
      setVoiceChoice(`profile:${profile.id}`);
      await queryClient.invalidateQueries({ queryKey: ['voice-profiles'] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error && !axios.isAxiosError(err)
          ? err.message
          : getApiErrorMessage(err, 'Failed to create voice profile'),
      ),
  });

  const generateStoryMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/stories/${storyId}/narration/generate`, {
        ...voicePayload(),
        ...(forceRegenerate ? { forceRegenerate: true } : {}),
      });
      return res.data.data as {
        job: unknown;
        skippedSceneIds?: string[];
        estimatedCostUsd?: number;
        audioGenerations?: unknown[];
      };
    },
    onSuccess: async (data) => {
      const queued = data.audioGenerations?.length ?? 0;
      if (queued === 0) {
        toast.info('Nothing to generate — all scenes already have audio');
      } else {
        toast.success(
          `Audio generation queued for ${queued} scene(s)${
            data.estimatedCostUsd != null ? ` · est. $${data.estimatedCostUsd.toFixed(4)}` : ''
          }`,
        );
      }
      await invalidateNarration();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to queue audio generation')),
  });

  const generateSceneMutation = useMutation({
    mutationFn: async ({ sceneId, force }: { sceneId: string; force: boolean }) => {
      const res = await api.post(`/scenes/${sceneId}/narration/generate`, {
        ...voicePayload(),
        ...(force ? { forceRegenerate: true } : {}),
      });
      return res.data.data;
    },
    onMutate: ({ sceneId }) => setPendingSceneId(sceneId),
    onSettled: async () => {
      setPendingSceneId(null);
      await invalidateNarration();
    },
    onSuccess: () => toast.success('Scene audio queued'),
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to queue scene audio')),
  });

  const retryMutation = useMutation({
    mutationFn: async (audioId: string) => {
      const res = await api.post(`/audio/${audioId}/retry`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success('Audio retry queued');
      await invalidateNarration();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to retry audio')),
  });

  const selectMutation = useMutation({
    mutationFn: async (audioId: string) => {
      const res = await api.post(`/audio/${audioId}/select`);
      return res.data.data;
    },
    onSuccess: async () => {
      toast.success('Preferred version selected');
      await invalidateNarration();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to select audio')),
  });

  const script = narrationQuery.data?.narrationScript ?? null;
  const scenes = useMemo(() => script?.scenes ?? [], [script]);

  const dirtyEdits = useMemo(() => {
    const edits: Array<{ id: string; text?: string; speakingStyle?: string }> = [];
    for (const scene of scenes) {
      const draft = drafts[scene.id];
      if (!draft) continue;
      const edit: { id: string; text?: string; speakingStyle?: string } = { id: scene.id };
      if (draft.text !== undefined && draft.text !== scene.text) edit.text = draft.text;
      if (draft.speakingStyle !== undefined && draft.speakingStyle !== scene.speakingStyle) {
        edit.speakingStyle = draft.speakingStyle;
      }
      if (edit.text !== undefined || edit.speakingStyle !== undefined) edits.push(edit);
    }
    return edits;
  }, [drafts, scenes]);

  const totalEstimatedCost = useMemo(
    () =>
      scenes.reduce((sum, scene) => {
        const audio = pickAudio(scene.audio);
        return sum + (audio?.estimatedCost ?? 0);
      }, 0),
    [scenes],
  );

  const sectionHeader = (
    <h2 className="flex items-center gap-2 font-semibold">
      <Mic className="h-4 w-4" />
      Narration / Voice
    </h2>
  );

  if (!hasScenes) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        {sectionHeader}
        <EmptyState
          icon={Mic}
          title="No scenes yet"
          description="Plan scenes before generating a narration script and voiceover."
        />
      </div>
    );
  }

  if (narrationQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        {sectionHeader}
        <LoadingState label="Loading narration…" />
      </div>
    );
  }

  if (narrationQuery.error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        {sectionHeader}
        <ErrorState
          message={getApiErrorMessage(narrationQuery.error, 'Could not load narration data')}
          onRetry={() => void narrationQuery.refetch()}
        />
      </div>
    );
  }

  const progress = progressQuery.data;
  const scriptStatus = script?.status;
  const isPlanning = scriptStatus === 'PLANNING';
  const canEdit = Boolean(script) && (scriptStatus === 'READY' || scriptStatus === 'APPROVED');
  const canGenerateAudio = canEdit && dirtyEdits.length === 0;
  const planBusy = planMutation.isPending || isPlanning;
  const globalBusy = isStoryGenerating || isActive;

  const voiceSelector = (
    <div className="space-y-3 rounded-md border border-border bg-secondary/40 p-3">
      <div className="text-xs font-medium uppercase text-muted-foreground">Voice</div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="narration-voice">
            Provider voice or saved profile
          </label>
          <Select
            id="narration-voice"
            value={voiceChoice}
            onChange={(e) => setVoiceChoice(e.target.value)}
            disabled={voicesQuery.isLoading || profilesQuery.isLoading}
            options={[{ value: '', label: 'Default voice' }]}
            groups={[
              ...(profiles.length
                ? [
                    {
                      label: 'Voice profiles',
                      options: profiles.map((profile) => ({
                        value: `profile:${profile.id}`,
                        label: `${profile.name} (${profile.providerVoiceId})${profile.isDefault ? ' · default' : ''}`,
                      })),
                    },
                  ]
                : []),
              ...(voices.length
                ? [
                    {
                      label: 'Provider voices',
                      options: voices.map((voice) => ({
                        value: `voice:${voice.id}`,
                        label: `${voice.name}${voice.description ? ` — ${voice.description}` : ''}`,
                      })),
                    },
                  ]
                : []),
            ]}
          />
          {(voicesQuery.error || profilesQuery.error) && (
            <p className="text-xs text-rose-700">
              Could not load voices.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => {
                  void voicesQuery.refetch();
                  void profilesQuery.refetch();
                }}
              >
                Retry
              </button>
            </p>
          )}
        </div>
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="narration-style">
            Speaking style (optional)
          </label>
          <input
            id="narration-style"
            className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground"
            placeholder="e.g. warm, calm storyteller"
            maxLength={200}
            value={speakingStyle}
            onChange={(e) => setSpeakingStyle(e.target.value)}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground" htmlFor="narration-profile-name">
            Save current voice as profile
          </label>
          <input
            id="narration-profile-name"
            className="h-9 w-56 rounded-md border border-input bg-card px-3 text-sm text-foreground"
            placeholder="Profile name"
            maxLength={100}
            value={newProfileName}
            onChange={(e) => setNewProfileName(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={createProfileMutation.isPending || voices.length === 0}
          onClick={() => createProfileMutation.mutate()}
        >
          {createProfileMutation.isPending
            ? 'Creating…'
            : profiles.length === 0
              ? 'Create default profile'
              : 'Create profile'}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold">
            <Mic className="h-4 w-4" />
            Narration / Voice
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Plan a scene-by-scene narration script, approve it, then generate voiceover audio.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={globalBusy && !isActive}
            onClick={() => {
              void progressQuery.refetch();
              void narrationQuery.refetch();
            }}
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Refresh
          </Button>
          {script ? (
            <Button
              variant="outline"
              disabled={isStoryGenerating || planBusy}
              onClick={() => {
                const ok = window.confirm(
                  'Regenerate the narration script? This creates a new script version and discards unsaved edits.',
                );
                if (!ok) return;
                planMutation.mutate(true);
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {planBusy ? 'Planning…' : 'Regenerate script'}
            </Button>
          ) : (
            <Button
              disabled={isStoryGenerating || planBusy}
              onClick={() => planMutation.mutate(false)}
            >
              <Mic className="mr-2 h-4 w-4" />
              {planBusy ? 'Planning…' : 'Generate narration script'}
            </Button>
          )}
        </div>
      </div>

      {progress && script && (
        <div className="rounded-md border border-border bg-secondary/40 px-3 py-2 text-sm text-foreground">
          Audio progress: {progress.completedScenes}/{progress.totalScenes} scenes complete (
          {progress.percentComplete}%)
          {progress.failedScenes > 0 ? ` · ${progress.failedScenes} failed` : ''}
          {isActive ? ' · in progress' : ''}
        </div>
      )}

      {isPlanning && (
        <LoadingState label="Planning narration script…" />
      )}

      {!script && !planBusy && (
        <EmptyState
          icon={Mic}
          title="No narration script yet"
          description="Generate a narration script from your planned scenes."
        />
      )}

      {scriptStatus === 'FAILED' && (
        <ErrorState
          message={script?.errorMessage || 'Narration planning failed'}
          onRetry={() => planMutation.mutate(true)}
        />
      )}

      {script && !isPlanning && scriptStatus !== 'FAILED' && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={statusTone(script.status === 'APPROVED' ? 'COMPLETED' : script.status)}>
              {script.status}
            </Badge>
            <span className="text-muted-foreground">Script v{script.version}</span>
            {totalEstimatedCost > 0 && (
              <span className="text-muted-foreground">· est. audio cost ${totalEstimatedCost.toFixed(4)}</span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={dirtyEdits.length === 0 || saveMutation.isPending}
              onClick={() => saveMutation.mutate({ scriptId: script.id, scenes: dirtyEdits })}
            >
              <Save className="mr-1 h-3.5 w-3.5" />
              {saveMutation.isPending
                ? 'Saving…'
                : dirtyEdits.length > 0
                  ? `Save edits (${dirtyEdits.length})`
                  : 'Save edits'}
            </Button>
            <Button
              size="sm"
              disabled={
                scriptStatus !== 'READY' || dirtyEdits.length > 0 || approveMutation.isPending
              }
              onClick={() => approveMutation.mutate(script.id)}
            >
              <CheckCircle2 className="mr-1 h-3.5 w-3.5" />
              {scriptStatus === 'APPROVED'
                ? 'Approved'
                : approveMutation.isPending
                  ? 'Approving…'
                  : 'Approve script'}
            </Button>
            {scriptStatus === 'APPROVED' && dirtyEdits.length === 0 && (
              <span className="self-center text-xs text-muted-foreground">
                Editing an approved script requires re-approval.
              </span>
            )}
          </div>

          {voiceSelector}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={
                !canGenerateAudio ||
                globalBusy ||
                generateStoryMutation.isPending ||
                scenes.length === 0
              }
              onClick={() => {
                const ok = window.confirm(
                  `Generate narration audio for ${scenes.length} scene(s)? This uses Gemini TTS credits (or mock mode).`,
                );
                if (!ok) return;
                generateStoryMutation.mutate();
              }}
            >
              <Volume2 className="mr-2 h-4 w-4" />
              {isActive
                ? 'Generating audio…'
                : generateStoryMutation.isPending
                  ? 'Queuing…'
                  : 'Generate all audio'}
            </Button>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input
                type="checkbox"
                checked={forceRegenerate}
                onChange={(e) => setForceRegenerate(e.target.checked)}
              />
              Regenerate scenes that already have audio
            </label>
            {!canGenerateAudio && dirtyEdits.length > 0 && (
              <span className="text-xs text-amber-300">Save your edits before generating audio.</span>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {scenes.map((scene) => {
              const draft = drafts[scene.id] ?? {};
              const textValue = draft.text ?? scene.text;
              const styleValue = draft.speakingStyle ?? scene.speakingStyle;
              const selected = pickAudio(scene.audio);
              const busyAudio = scene.audio.find((item) => BUSY_AUDIO_STATUSES.has(item.status));
              const sceneBusy = pendingSceneId === scene.sceneId || Boolean(busyAudio);
              const hasCompleted = scene.audio.some((item) => item.status === 'COMPLETED');
              const latest = scene.audio[0];
              const failedLatest = latest && latest.status === 'FAILED' ? latest : null;
              const isRetrying = Boolean(busyAudio && busyAudio.retryCount > 0);
              const sceneDirty = dirtyEdits.some((edit) => edit.id === scene.id);

              return (
                <div key={scene.id} className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-medium">
                        Scene {scene.sceneNumber ?? scene.sequence}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        ~{Number(scene.estimatedDurationSeconds).toFixed(1)}s ·{' '}
                        {textValue.length} chars
                      </div>
                    </div>
                    <div className="flex flex-wrap justify-end gap-1">
                      <Badge tone={statusTone(scene.status === 'APPROVED' ? 'COMPLETED' : scene.status)}>
                        {scene.status}
                      </Badge>
                      {busyAudio ? (
                        <Badge tone="info">
                          {isRetrying ? 'RETRYING' : busyAudio.status} {busyAudio.progress}%
                        </Badge>
                      ) : selected ? (
                        <Badge tone={statusTone(selected.status)}>audio {selected.status}</Badge>
                      ) : (
                        <Badge>NO AUDIO</Badge>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Narration</div>
                    <Textarea
                      value={textValue}
                      disabled={!canEdit || sceneBusy}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [scene.id]: { ...prev[scene.id], text: e.target.value },
                        }))
                      }
                      className="min-h-[110px]"
                      maxLength={4000}
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="text-xs font-medium uppercase text-muted-foreground">
                      Speaking style
                    </div>
                    <input
                      className="h-9 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground"
                      value={styleValue}
                      disabled={!canEdit || sceneBusy}
                      maxLength={200}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [scene.id]: { ...prev[scene.id], speakingStyle: e.target.value },
                        }))
                      }
                    />
                  </div>

                  {selected?.downloadUrl && selected.status === 'COMPLETED' ? (
                    <div className="space-y-1">
                      <audio
                        key={selected.downloadUrl}
                        src={selected.downloadUrl}
                        controls
                        preload="none"
                        className="w-full"
                      />
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        {formatDuration(selected.durationSeconds) && (
                          <span>{formatDuration(selected.durationSeconds)}</span>
                        )}
                        {selected.providerVoiceId && <span>{selected.providerVoiceId}</span>}
                        {formatCost(selected.estimatedCost, selected.currency) && (
                          <span>est. {formatCost(selected.estimatedCost, selected.currency)}</span>
                        )}
                        <span>attempt #{selected.attemptNumber}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-md border border-dashed bg-secondary/40 px-3 py-4 text-center text-xs text-muted-foreground">
                      {busyAudio
                        ? `${isRetrying ? 'Retrying' : 'Generating'} audio… ${busyAudio.progress}%`
                        : 'No audio yet'}
                    </div>
                  )}

                  {failedLatest?.errorMessage && (
                    <div className="rounded-md border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-xs text-red-300">
                      {failedLatest.errorCode ? `${failedLatest.errorCode}: ` : ''}
                      {failedLatest.errorMessage}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !canEdit || sceneDirty || sceneBusy || globalBusy || isStoryGenerating
                      }
                      onClick={() => {
                        const ok = window.confirm(
                          `Generate narration audio for scene ${scene.sceneNumber ?? scene.sequence}? This may incur Gemini TTS costs.`,
                        );
                        if (!ok) return;
                        generateSceneMutation.mutate({
                          sceneId: scene.sceneId,
                          force: hasCompleted,
                        });
                      }}
                    >
                      <Volume2 className="mr-1 h-3.5 w-3.5" />
                      {hasCompleted ? 'Regenerate audio' : 'Generate audio'}
                    </Button>

                    {failedLatest && !sceneBusy && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={retryMutation.isPending}
                        onClick={() => retryMutation.mutate(failedLatest.id)}
                      >
                        <RotateCcw className="mr-1 h-3.5 w-3.5" />
                        Retry
                      </Button>
                    )}
                  </div>

                  {scene.audio.length > 0 && (
                    <div className="space-y-1 border-t pt-2">
                      <div className="text-xs font-medium uppercase text-muted-foreground">History</div>
                      <ul className="space-y-1">
                        {scene.audio.map((item) => (
                          <li
                            key={item.id}
                            className={`flex flex-wrap items-center gap-2 rounded border px-2 py-1 text-xs ${
                              item.isSelected
                                ? 'border-primary bg-primary text-primary-foreground'
                                : 'border-border bg-card text-foreground'
                            }`}
                          >
                            <span>#{item.attemptNumber}</span>
                            <span>{item.status}</span>
                            {formatDuration(item.durationSeconds) && (
                              <span>{formatDuration(item.durationSeconds)}</span>
                            )}
                            {formatCost(item.estimatedCost, item.currency) && (
                              <span>{formatCost(item.estimatedCost, item.currency)}</span>
                            )}
                            {item.isSelected && <span>selected</span>}
                            <span className="ml-auto flex gap-1">
                              {item.status === 'COMPLETED' && !item.isSelected && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-foreground hover:bg-secondary/40 disabled:opacity-50"
                                  disabled={selectMutation.isPending}
                                  onClick={() => selectMutation.mutate(item.id)}
                                >
                                  <Check className="h-3 w-3" />
                                  Select
                                </button>
                              )}
                              {item.status === 'FAILED' && (
                                <button
                                  type="button"
                                  className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-foreground hover:bg-secondary/40 disabled:opacity-50"
                                  disabled={retryMutation.isPending || sceneBusy}
                                  onClick={() => retryMutation.mutate(item.id)}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Retry
                                </button>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
