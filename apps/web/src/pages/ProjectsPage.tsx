import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export function ProjectsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [duration, setDuration] = useState('30');

  const queryKey = useMemo(
    () => ['projects', { search, status }],
    [search, status],
  );

  const { data, isLoading, error, refetch } = useQuery({
    queryKey,
    queryFn: async () => {
      const res = await api.get('/projects', {
        params: {
          search: search || undefined,
          status: status || undefined,
          limit: 50,
        },
      });
      return res.data;
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/projects', {
        title,
        description: description || undefined,
        aspectRatio,
        duration: Number(duration) || undefined,
        targetPlatforms: ['YOUTUBE', 'TIKTOK'],
      });
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Project created');
      setTitle('');
      setDescription('');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard-overview'] });
    },
    onError: (err: unknown) => {
      toast.error(
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message ?? 'Failed to create project',
      );
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Video Projects</h1>
          <p className="mt-1 text-sm text-muted-foreground">Create and manage story-to-video projects.</p>
        </div>
      </div>

      <form
        className="grid gap-3 rounded-xl border border-border bg-card p-4 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) {
            toast.error('Title is required');
            return;
          }
          createMutation.mutate();
        }}
      >
        <Input
          placeholder="Project title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Input
          placeholder="Aspect ratio"
          value={aspectRatio}
          onChange={(e) => setAspectRatio(e.target.value)}
        />
        <Input
          placeholder="Duration (seconds)"
          value={duration}
          onChange={(e) => setDuration(e.target.value)}
        />
        <Textarea
          className="md:col-span-2"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="md:col-span-2">
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Creating…' : 'Create project'}
          </Button>
        </div>
      </form>

      <div className="flex flex-wrap gap-3">
        <Input
          className="max-w-xs"
          placeholder="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <Select
          className="w-[180px]"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          options={[
            { value: '', label: 'All statuses' },
            ...['DRAFT', 'PROCESSING', 'RENDERING', 'READY', 'FAILED', 'PUBLISHED'].map((s) => ({
              value: s,
              label: s,
            })),
          ]}
        />
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load projects" onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first video project to start assembling stories, media and jobs."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Title</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Aspect</th>
                <th className="px-4 py-3 font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map(
                (project: {
                  id: string;
                  title: string;
                  status: string;
                  aspectRatio?: string;
                  updatedAt: string;
                }) => (
                  <tr key={project.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <Link className="font-medium text-primary hover:underline" to={`/projects/${project.id}`}>
                        {project.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={statusTone(project.status)}>{project.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{project.aspectRatio || '—'}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(project.updatedAt).toLocaleString()}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
