import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  RefreshCw,
  Share2,
  Subtitles,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PublishRenderDialog } from '@/components/story/PublishRenderDialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

type OutputProfile = {
  id: string;
  label: string;
  aspectRatio: string;
  width: number;
  height: number;
  frameRate: number;
};

type SceneReadiness = {
  sceneId: string;
  sceneNumber: number;
  ready: boolean;
  missing: string[];
  hasVisual: boolean;
  hasMotion: boolean;
  hasNarrationAudio: boolean;
  narrationApproved: boolean;
  estimatedDurationSeconds: number | null;
};

type ReadinessResponse = {
  storyId: string;
  totalScenes: number;
  readyScenes: number;
  visualsAvailable: number;
  motionClipsAvailable: number;
  narrationTracksApproved: number;
  narrationScriptApproved: boolean;
  canRender: boolean;
  missing: string[];
  scenes: SceneReadiness[];
  outputProfiles: OutputProfile[];
};

type RenderItem = {
  id: string;
  status: string;
  progress: number;
  aspectRatio: string;
  width: number;
  height: number;
  frameRate: number;
  subtitleEnabled: boolean;
  subtitleBurnedIn: boolean;
  currentSceneSequence?: number | null;
  completedSceneCount: number;
  totalSceneCount: number;
  duration?: number | null;
  fileSize?: number | null;
  errorMessage?: string | null;
  previewUrl?: string | null;
  subtitleUrl?: string | null;
  createdAt?: string;
  completedAt?: string | null;
  processingTimeMs?: number | null;
};

type RenderProgress = {
  renderId: string;
  status: string;
  progress: number;
  currentSceneSequence?: number | null;
  completedSceneCount: number;
  totalSceneCount: number;
  errorMessage?: string | null;
};

const ACTIVE_RENDER_STATUSES = new Set([
  'PENDING',
  'PLANNING',
  'PREPARING_ASSETS',
  'RENDERING_SCENES',
  'MIXING_AUDIO',
  'GENERATING_SUBTITLES',
  'COMBINING',
  'VALIDATING',
  'UPLOADING',
]);

const POLL_INTERVAL_MS = 2000;

function getApiErrorMessage(err: unknown, fallback: string): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as
      | { message?: string | string[]; missing?: string[] }
      | undefined;
    if (Array.isArray(data?.message) && data.message.length > 0) return data.message.join(', ');
    if (typeof data?.message === 'string' && data.message.trim()) {
      if (Array.isArray(data.missing) && data.missing.length) {
        return `${data.message} ${data.missing.slice(0, 3).join('; ')}`;
      }
      return data.message;
    }
  }
  return fallback;
}

function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function isRenderActive(status?: string): boolean {
  return Boolean(status && ACTIVE_RENDER_STATUSES.has(status));
}

type Props = {
  storyId: string;
  hasScenes: boolean;
  isStoryGenerating: boolean;
  storyTitle?: string;
  storyDescription?: string;
};

export function StoryRenderSection({
  storyId,
  hasScenes,
  isStoryGenerating,
  storyTitle,
  storyDescription,
}: Props) {
  const queryClient = useQueryClient();
  const [profileId, setProfileId] = useState('vertical-9x16-1080p30');
  const [subtitleEnabled, setSubtitleEnabled] = useState(true);
  const [subtitleBurnedIn, setSubtitleBurnedIn] = useState(true);
  const [selectedRenderId, setSelectedRenderId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);

  const readinessQuery = useQuery({
    queryKey: ['story-render-readiness', storyId],
    enabled: Boolean(storyId) && hasScenes,
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/renders/readiness`);
      return res.data.data as ReadinessResponse;
    },
  });

  const rendersQuery = useQuery({
    queryKey: ['story-renders', storyId],
    enabled: Boolean(storyId) && hasScenes,
    refetchInterval: (query) => {
      const items = query.state.data as RenderItem[] | undefined;
      return items?.some((item) => isRenderActive(item.status)) ? POLL_INTERVAL_MS : false;
    },
    queryFn: async () => {
      const res = await api.get(`/stories/${storyId}/renders`);
      return res.data.data as RenderItem[];
    },
  });

  const activeRender = useMemo(() => {
    const items = rendersQuery.data ?? [];
    const active = items.find((item) => isRenderActive(item.status));
    if (active) return active;
    if (selectedRenderId) {
      return items.find((item) => item.id === selectedRenderId) ?? items[0] ?? null;
    }
    return items[0] ?? null;
  }, [rendersQuery.data, selectedRenderId]);

  const progressQuery = useQuery({
    queryKey: ['render-progress', activeRender?.id],
    enabled: Boolean(activeRender?.id) && isRenderActive(activeRender?.status),
    refetchInterval: POLL_INTERVAL_MS,
    queryFn: async () => {
      const res = await api.get(`/renders/${activeRender!.id}/progress`);
      return res.data.data as RenderProgress;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post(`/stories/${storyId}/renders`, {
        profileId,
        subtitleEnabled,
        subtitleBurnedIn,
      });
      return res.data.data as RenderItem;
    },
    onSuccess: (data) => {
      setSelectedRenderId(data.id);
      toast.success('Render queued');
      void queryClient.invalidateQueries({ queryKey: ['story-renders', storyId] });
      void queryClient.invalidateQueries({ queryKey: ['story-render-readiness', storyId] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to start render')),
  });

  const cancelMutation = useMutation({
    mutationFn: async (renderId: string) => {
      const res = await api.post(`/renders/${renderId}/cancel`);
      return res.data.data as RenderItem;
    },
    onSuccess: () => {
      toast.success('Render cancelled');
      void queryClient.invalidateQueries({ queryKey: ['story-renders', storyId] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to cancel render')),
  });

  const retryMutation = useMutation({
    mutationFn: async (renderId: string) => {
      const res = await api.post(`/renders/${renderId}/retry`);
      return res.data.data as RenderItem;
    },
    onSuccess: (data) => {
      setSelectedRenderId(data.id);
      toast.success('Render retry queued');
      void queryClient.invalidateQueries({ queryKey: ['story-renders', storyId] });
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Failed to retry render')),
  });

  const downloadMutation = useMutation({
    mutationFn: async (renderId: string) => {
      const res = await api.get(`/renders/${renderId}/download`);
      return res.data.data as { downloadUrl: string; fileName: string };
    },
    onSuccess: (data) => {
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Download unavailable')),
  });

  const subtitleMutation = useMutation({
    mutationFn: async (renderId: string) => {
      const res = await api.get(`/renders/${renderId}/subtitles`);
      return res.data.data as { downloadUrl: string };
    },
    onSuccess: (data) => {
      window.open(data.downloadUrl, '_blank', 'noopener,noreferrer');
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Subtitles unavailable')),
  });

  if (!hasScenes) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Video Assembly / Final Render</h2>
        <EmptyState
          icon={Film}
          title="Scenes required"
          description="Plan story scenes before assembling the final video."
        />
      </div>
    );
  }

  if (readinessQuery.isLoading || rendersQuery.isLoading) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Video Assembly / Final Render</h2>
        <LoadingState />
      </div>
    );
  }

  if (readinessQuery.error) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Video Assembly / Final Render</h2>
        <ErrorState
          message={getApiErrorMessage(readinessQuery.error, 'Could not load render readiness')}
          onRetry={() => void readinessQuery.refetch()}
        />
      </div>
    );
  }

  const readiness = readinessQuery.data!;
  const renders = rendersQuery.data ?? [];
  const progress = progressQuery.data;
  const rendering = Boolean(activeRender && isRenderActive(activeRender.status));
  const completed = activeRender?.status === 'COMPLETED' ? activeRender : null;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Video Assembly / Final Render</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Assemble selected visuals, motion clips, and narration into a social-ready MP4.
          </p>
        </div>
        <Badge tone={readiness.canRender ? 'success' : 'warning'}>
          {readiness.canRender ? 'Ready to render' : 'Assets incomplete'}
        </Badge>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <ChecklistItem
          ok={readiness.readyScenes === readiness.totalScenes && readiness.totalScenes > 0}
          label={`${readiness.readyScenes}/${readiness.totalScenes} scenes ready`}
        />
        <ChecklistItem
          ok={readiness.visualsAvailable === readiness.totalScenes}
          label={`${readiness.visualsAvailable} visuals available`}
        />
        <ChecklistItem
          ok={readiness.motionClipsAvailable === readiness.totalScenes}
          label={`${readiness.motionClipsAvailable} motion clips available`}
        />
        <ChecklistItem
          ok={readiness.narrationTracksApproved === readiness.totalScenes}
          label={`${readiness.narrationTracksApproved} narration tracks approved`}
        />
        <ChecklistItem ok={subtitleEnabled} label={subtitleEnabled ? 'Subtitles enabled' : 'Subtitles off'} />
        <ChecklistItem ok={false} label="Background music optional" muted />
      </div>

      {readiness.missing.length > 0 && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            Missing before render
          </div>
          <ul className="list-disc space-y-1 pl-5">
            {readiness.missing.slice(0, 8).map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b text-xs uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pr-3">Scene</th>
              <th className="py-2 pr-3">Visual</th>
              <th className="py-2 pr-3">Motion</th>
              <th className="py-2 pr-3">Narration</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {readiness.scenes.map((scene) => (
              <tr key={scene.sceneId} className="border-b last:border-0">
                <td className="py-2 pr-3 font-medium">#{scene.sceneNumber}</td>
                <td className="py-2 pr-3">{scene.hasVisual ? 'Selected' : 'Missing'}</td>
                <td className="py-2 pr-3">{scene.hasMotion ? 'Selected' : 'Image fallback'}</td>
                <td className="py-2 pr-3">
                  {scene.hasNarrationAudio ? 'Selected audio' : 'Missing audio'}
                </td>
                <td className="py-2">
                  <Badge tone={scene.ready ? 'success' : 'danger'}>
                    {scene.ready ? 'Ready' : 'Blocked'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-foreground">Output profile</span>
          <select
            className="w-full rounded-md border border-border bg-card px-3 py-2"
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            disabled={rendering}
          >
            {(readiness.outputProfiles ?? []).map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3 self-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={subtitleEnabled}
              onChange={(e) => setSubtitleEnabled(e.target.checked)}
              disabled={rendering}
            />
            Enable subtitles
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={subtitleBurnedIn}
              onChange={(e) => setSubtitleBurnedIn(e.target.checked)}
              disabled={rendering || !subtitleEnabled}
            />
            Burn-in captions
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          onClick={() => createMutation.mutate()}
          disabled={
            isStoryGenerating ||
            rendering ||
            !readiness.canRender ||
            createMutation.isPending
          }
        >
          <Film className="mr-2 h-4 w-4" />
          {createMutation.isPending ? 'Queueing…' : 'Render Video'}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            void readinessQuery.refetch();
            void rendersQuery.refetch();
          }}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
        {activeRender && isRenderActive(activeRender.status) && (
          <Button
            variant="outline"
            onClick={() => cancelMutation.mutate(activeRender.id)}
            disabled={cancelMutation.isPending}
          >
            <XCircle className="mr-2 h-4 w-4" />
            Cancel
          </Button>
        )}
        {activeRender &&
          (activeRender.status === 'FAILED' || activeRender.status === 'CANCELLED') && (
            <Button
              variant="outline"
              onClick={() => retryMutation.mutate(activeRender.id)}
              disabled={retryMutation.isPending}
            >
              <Clapperboard className="mr-2 h-4 w-4" />
              Retry failed render
            </Button>
          )}
      </div>

      {(rendering || progress) && activeRender && (
        <div className="mt-4 rounded-md border bg-secondary/40 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium">
              Stage:{' '}
              <Badge tone={statusTone(progress?.status ?? activeRender.status)}>
                {progress?.status ?? activeRender.status}
              </Badge>
            </div>
            <div className="text-sm text-muted-foreground">
              {progress?.progress ?? activeRender.progress}% · scenes{' '}
              {progress?.completedSceneCount ?? activeRender.completedSceneCount}/
              {progress?.totalSceneCount ?? activeRender.totalSceneCount}
              {progress?.currentSceneSequence
                ? ` · current #${progress.currentSceneSequence}`
                : ''}
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-slate-200">
            <div
              className="h-full bg-slate-800 transition-all"
              style={{ width: `${Math.min(100, progress?.progress ?? activeRender.progress)}%` }}
            />
          </div>
          {(progress?.errorMessage || activeRender.errorMessage) && (
            <p className="mt-2 text-sm text-destructive">
              {progress?.errorMessage || activeRender.errorMessage}
            </p>
          )}
        </div>
      )}

      {completed?.previewUrl && (
        <div className="mt-4 space-y-3">
          <h3 className="font-medium">Final video</h3>
          <video
            key={completed.previewUrl}
            className="max-h-[480px] w-full rounded-md bg-black"
            src={completed.previewUrl}
            controls
            playsInline
          />
          <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
            <span>
              {completed.width}×{completed.height} · {completed.frameRate}fps ·{' '}
              {completed.duration?.toFixed(2) ?? '—'}s · {formatBytes(completed.fileSize)}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => downloadMutation.mutate(completed.id)}>
              <Download className="mr-2 h-4 w-4" />
              Download MP4
            </Button>
            {completed.subtitleUrl && (
              <Button variant="outline" onClick={() => subtitleMutation.mutate(completed.id)}>
                <Subtitles className="mr-2 h-4 w-4" />
                Download subtitles
              </Button>
            )}
            <Button variant="outline" onClick={() => setPublishOpen(true)}>
              <Share2 className="mr-2 h-4 w-4" />
              Publish to social
            </Button>
          </div>
        </div>
      )}

      {completed && (
        <PublishRenderDialog
          renderId={completed.id}
          storyTitle={storyTitle}
          storyDescription={storyDescription}
          open={publishOpen}
          onClose={() => setPublishOpen(false)}
        />
      )}

      <div className="mt-6">
        <h3 className="font-medium">Render history</h3>
        {renders.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No renders yet.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {renders.map((render) => (
              <button
                key={render.id}
                type="button"
                className="flex w-full items-center justify-between rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-secondary/40"
                onClick={() => setSelectedRenderId(render.id)}
              >
                <span className="truncate">
                  {new Date(render.createdAt ?? Date.now()).toLocaleString()} ·{' '}
                  {render.width}×{render.height}
                </span>
                <Badge tone={statusTone(render.status)}>{render.status}</Badge>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ChecklistItem({
  ok,
  label,
  muted,
}: {
  ok: boolean;
  label: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
      {muted ? (
        <span className="text-muted-foreground">○</span>
      ) : ok ? (
        <CheckCircle2 className="h-4 w-4 text-emerald-600" />
      ) : (
        <AlertTriangle className="h-4 w-4 text-amber-600" />
      )}
      <span>{label}</span>
    </div>
  );
}
