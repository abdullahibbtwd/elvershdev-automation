import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Film, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export function StoriesPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['stories', search],
    queryFn: async () => {
      const res = await api.get('/stories', {
        params: { search: search || undefined, limit: 50 },
      });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () =>
      api.post('/stories', {
        title,
        content,
        status: 'DRAFT',
      }),
    onSuccess: () => {
      toast.success('Story draft saved');
      setTitle('');
      setContent('');
      void queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
    onError: () => toast.error('Failed to save story'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Stories</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Draft manually or generate with Gemini, then plan scenes for video production.
          </p>
        </div>
        <Button asChild>
          <Link to="/stories/new">
            <Sparkles className="h-4 w-4" />
            AI story
          </Link>
        </Button>
      </div>

      <form
        className="space-y-3 rounded-xl border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim() || !content.trim()) {
            toast.error('Title and content are required');
            return;
          }
          createMutation.mutate();
        }}
      >
        <div className="text-sm font-medium">Quick draft</div>
        <Input placeholder="Story title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <Textarea
          placeholder="Story content / narration"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <Button type="submit" disabled={createMutation.isPending}>
          Save draft
        </Button>
      </form>

      <Input
        className="max-w-sm"
        placeholder="Search stories"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load stories" onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={Film}
          title="No stories yet"
          description="Create an AI story or save a manual draft to get started."
        />
      ) : (
        <div className="space-y-3">
          {data.data.map(
            (story: {
              id: string;
              title: string;
              status: string;
              updatedAt: string;
              _count?: { scenes: number; characters: number };
            }) => (
              <Link
                key={story.id}
                to={`/stories/${story.id}`}
                className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3 hover:border-border"
              >
                <div>
                  <div className="font-medium">{story.title}</div>
                  <div className="text-xs text-muted-foreground">
                    Updated {new Date(story.updatedAt).toLocaleString()}
                    {story._count
                      ? ` · ${story._count.scenes} scenes · ${story._count.characters} characters`
                      : ''}
                  </div>
                </div>
                <Badge tone={statusTone(story.status)}>{story.status}</Badge>
              </Link>
            ),
          )}
        </div>
      )}
    </div>
  );
}
