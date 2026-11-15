import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import {
  StoryVisualsSection,
  type StoryVisualsProgress,
  type StoryVisualsResponse,
} from '@/components/story/StoryVisualsSection';
import { StoryMotionSection } from '@/components/story/StoryMotionSection';
import { StoryNarrationSection } from '@/components/story/StoryNarrationSection';
import { StoryRenderSection } from '@/components/story/StoryRenderSection';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

type StoryScene = {
  id: string;
  sceneNumber: number;
  durationSeconds: number;
  narration: string;
  visualDescription: string;
  imagePrompt: string;
  videoPrompt: string;
  cameraMovement: string;
  lighting: string;
  environment: string;
  characterConsistencyInstructions: string;
};

type CharacterProfile = {
  id: string;
  name: string;
  appearance: string;
  clothing: string;
  ageRange: string;
  hair: string;
  distinctiveFeatures: string;
  consistencyNotes: string;
};

type GenerationJob = {
  id: string;
  status: string;
  progress: number;
  jobType: string;
  errorMessage?: string | null;
};

function isVisualProgressActive(progress?: StoryVisualsProgress): boolean {
  if (!progress) return false;
  if ((progress.activeJobs?.length ?? 0) > 0) return true;
  if ((progress.countsByStatus?.ANALYZING ?? 0) > 0) return true;
  if ((progress.countsByStatus?.GENERATING ?? 0) > 0) return true;
  return false;
}

export function StoryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [openingHook, setOpeningHook] = useState('');
  const [narrationScript, setNarrationScript] = useState('');
  const [closingMessage, setClosingMessage] = useState('');
  const [description, setDescription] = useState('');
  const [hashtags, setHashtags] = useState('');
  const [projectTitle, setProjectTitle] = useState('');
  const [selectedVisualStyleId, setSelectedVisualStyleId] = useState('');

  const visualsProgressQuery = useQuery({
    queryKey: ['story-visuals-progress', id],
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const progress = query.state.data as StoryVisualsProgress | undefined;
      return isVisualProgressActive(progress) ? 1500 : false;
    },
    queryFn: async () => {
      const res = await api.get(`/stories/${id}/visuals/progress`);
      return res.data.data as StoryVisualsProgress;
    },
  });

  const isVisualActive = isVisualProgressActive(visualsProgressQuery.data);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['story', id],
    enabled: Boolean(id),
    refetchInterval: (query) => {
      const story = query.state.data as { status?: string } | undefined;
      return story?.status === 'GENERATING' || isVisualActive ? 1500 : false;
    },
    queryFn: async () => {
      const res = await api.get(`/stories/${id}`);
      return res.data.data as {
        id: string;
        title: string;
        content: string;
        status: string;
        openingHook?: string | null;
        narrationScript?: string | null;
        closingMessage?: string | null;
        description?: string | null;
        hashtags?: string[];
        niche?: string | null;
        tone?: string | null;
        category?: string | null;
        language?: string;
        targetDurationSeconds?: number | null;
        scenes: StoryScene[];
        characters: CharacterProfile[];
        generationJobs: GenerationJob[];
        providerUsages: Array<{
          id: string;
          model: string;
          requestType: string;
          inputTokens: number;
          outputTokens: number;
          estimatedCost: number;
        }>;
      };
    },
  });

  useEffect(() => {
    if (data) {
      setTitle(data.title);
      setContent(data.content);
      setOpeningHook(data.openingHook ?? '');
      setNarrationScript(data.narrationScript ?? '');
      setClosingMessage(data.closingMessage ?? '');
      setDescription(data.description ?? '');
      setHashtags((data.hashtags ?? []).join(', '));
      setProjectTitle(`Video — ${data.title}`);
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.patch(`/stories/${id}`, {
        title,
        content,
        openingHook,
        narrationScript,
        closingMessage,
        description,
        hashtags: hashtags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
      }),
    onSuccess: () => {
      toast.success('Story draft saved');
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
      void queryClient.invalidateQueries({ queryKey: ['story', id] });
    },
    onError: () => toast.error('Failed to save story'),
  });

  const regenerateMutation = useMutation({
    mutationFn: async () => api.post(`/stories/${id}/regenerate`, {}),
    onSuccess: () => {
      toast.success('Regeneration queued');
      void queryClient.invalidateQueries({ queryKey: ['story', id] });
    },
    onError: () => toast.error('Failed to regenerate'),
  });

  const planScenesMutation = useMutation({
    mutationFn: async () => api.post(`/stories/${id}/plan-scenes`),
    onSuccess: () => {
      toast.success('Scene planning queued');
      void queryClient.invalidateQueries({ queryKey: ['story', id] });
    },
    onError: () => toast.error('Failed to plan scenes'),
  });

  const generateVisualsMutation = useMutation({
    mutationFn: async () =>
      api.post(`/stories/${id}/visuals/generate`, {
        visualStyleId: selectedVisualStyleId || undefined,
      }),
    onSuccess: () => {
      toast.success('Visual generation queued');
      void queryClient.invalidateQueries({ queryKey: ['story-visuals-progress', id] });
      void queryClient.invalidateQueries({ queryKey: ['story-visuals', id] });
      void queryClient.invalidateQueries({ queryKey: ['story', id] });
    },
    onError: (err) => {
      const message = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message
        : undefined;
      toast.error(message || 'Failed to queue visual generation');
    },
  });

  const handleGenerateVisuals = () => {
    const cachedVisuals = queryClient.getQueryData<StoryVisualsResponse>(['story-visuals', id]);
    const hasCompleted = Boolean(
      cachedVisuals?.scenes.some((scene) =>
        scene.visuals.some((v) => v.generationStatus === 'COMPLETED' && Boolean(v.downloadUrl)),
      ),
    );
    if (hasCompleted) {
      const confirmed = window.confirm(
        'Some scenes already have generated visuals. Generate visuals for the story anyway?',
      );
      if (!confirmed) return;
    }
    generateVisualsMutation.mutate();
  };

  const attachMutation = useMutation({
    mutationFn: async () =>
      api.post(`/stories/${id}/attach-project`, {
        projectTitle: projectTitle || undefined,
      }),
    onSuccess: (res) => {
      toast.success('Attached to video project');
      navigate(`/projects/${res.data.data.id}`);
    },
    onError: () => toast.error('Failed to attach project'),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => api.delete(`/stories/${id}`),
    onSuccess: () => {
      toast.success('Story deleted');
      navigate('/stories');
    },
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load story" onRetry={() => void refetch()} />;
  if (!data) return null;

  const latestJob = data.generationJobs?.[0];
  const isGenerating = data.status === 'GENERATING';

  return (
    <div className="space-y-6">
      <div>
        <Link to="/stories" className="text-sm text-muted-foreground hover:underline">
          ← Back to stories
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">Story workspace</h1>
          <Badge tone={statusTone(data.status)}>{data.status}</Badge>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {[data.niche, data.tone, data.category, data.language]
            .filter(Boolean)
            .join(' · ')}
          {data.targetDurationSeconds ? ` · ${data.targetDurationSeconds}s` : ''}
        </p>
      </div>

      {isGenerating && (
        <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          Generation in progress
          {latestJob ? ` — ${latestJob.jobType} ${latestJob.progress}%` : ''}. This page refreshes
          automatically.
        </div>
      )}

      {data.status === 'FAILED' && latestJob?.errorMessage && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          Generation failed: {latestJob.errorMessage}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={isGenerating || regenerateMutation.isPending}
          onClick={() => regenerateMutation.mutate()}
        >
          Regenerate story
        </Button>
        <Button
          variant="outline"
          disabled={isGenerating || !data.content || planScenesMutation.isPending}
          onClick={() => planScenesMutation.mutate()}
        >
          Replan scenes
        </Button>
        {data.scenes.length > 0 && (
          <Button
            disabled={isGenerating || isVisualActive || generateVisualsMutation.isPending}
            onClick={handleGenerateVisuals}
          >
            {isVisualActive
              ? 'Generating visuals…'
              : generateVisualsMutation.isPending
                ? 'Queuing visuals…'
                : 'Generate visuals'}
          </Button>
        )}
        <Button variant="outline" onClick={() => saveMutation.mutate()}>
          Save draft
        </Button>
        <Button variant="destructive" onClick={() => deleteMutation.mutate()}>
          Delete
        </Button>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Story preview</h2>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">Opening hook</div>
            <Textarea value={openingHook} onChange={(e) => setOpeningHook(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">Story</div>
            <Textarea
              className="min-h-[140px]"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">Narration</div>
            <Textarea
              className="min-h-[140px]"
              value={narrationScript}
              onChange={(e) => setNarrationScript(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">Closing</div>
            <Textarea value={closingMessage} onChange={(e) => setClosingMessage(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">Description</div>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase text-muted-foreground">Hashtags</div>
            <Input value={hashtags} onChange={(e) => setHashtags(e.target.value)} />
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Characters</h2>
            {data.characters.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No character profiles yet.</p>
            ) : (
              <div className="mt-3 space-y-3">
                {data.characters.map((character) => (
                  <div key={character.id} className="border-t pt-3 first:border-0 first:pt-0">
                    <div className="font-medium">{character.name}</div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {character.ageRange} · {character.hair}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{character.appearance}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{character.clothing}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{character.consistencyNotes}</p>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-semibold">Attach to project</h2>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <Input
                value={projectTitle}
                onChange={(e) => setProjectTitle(e.target.value)}
                placeholder="New project title"
              />
              <Button
                disabled={attachMutation.isPending || isGenerating}
                onClick={() => attachMutation.mutate()}
              >
                Create project
              </Button>
            </div>
          </div>

          {data.providerUsages?.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-4">
              <h2 className="font-semibold">Usage</h2>
              <div className="mt-3 space-y-2 text-sm">
                {data.providerUsages.slice(0, 5).map((usage) => (
                  <div key={usage.id} className="flex justify-between gap-3 text-muted-foreground">
                    <span>
                      {usage.requestType} · {usage.model}
                    </span>
                    <span>
                      {usage.inputTokens}/{usage.outputTokens} tok · $
                      {Number(usage.estimatedCost).toFixed(6)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Scene plan</h2>
        {data.scenes.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Scenes appear after planning completes.
          </p>
        ) : (
          <div className="mt-4 space-y-4">
            {data.scenes.map((scene) => (
              <div key={scene.id} className="border-t pt-4 first:border-0 first:pt-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-medium">Scene {scene.sceneNumber}</h3>
                  <Badge>{scene.durationSeconds}s</Badge>
                </div>
                <p className="mt-2 text-sm text-foreground">{scene.narration}</p>
                <p className="mt-2 text-sm text-muted-foreground">{scene.visualDescription}</p>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                  <div>
                    <span className="font-medium text-foreground">Camera:</span> {scene.cameraMovement}
                  </div>
                  <div>
                    <span className="font-medium text-foreground">Lighting:</span> {scene.lighting}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-foreground">Environment:</span>{' '}
                    {scene.environment}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-foreground">Consistency:</span>{' '}
                    {scene.characterConsistencyInstructions}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-foreground">Image prompt:</span>{' '}
                    {scene.imagePrompt}
                  </div>
                  <div className="sm:col-span-2">
                    <span className="font-medium text-foreground">Video prompt:</span>{' '}
                    {scene.videoPrompt}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <StoryVisualsSection
        storyId={data.id}
        hasScenes={data.scenes.length > 0}
        isStoryGenerating={isGenerating}
        selectedStyleId={selectedVisualStyleId}
        onSelectStyleId={setSelectedVisualStyleId}
      />

      <StoryMotionSection
        storyId={data.id}
        hasScenes={data.scenes.length > 0}
        isStoryGenerating={isGenerating}
      />

      <StoryNarrationSection
        storyId={data.id}
        hasScenes={data.scenes.length > 0}
        isStoryGenerating={isGenerating}
      />

      <StoryRenderSection
        storyId={data.id}
        hasScenes={data.scenes.length > 0}
        isStoryGenerating={isGenerating}
        storyTitle={data.title}
        storyDescription={data.description ?? undefined}
      />
    </div>
  );
}
