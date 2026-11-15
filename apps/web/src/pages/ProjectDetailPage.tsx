import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export function ProjectDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['project', id],
    enabled: Boolean(id),
    queryFn: async () => {
      const res = await api.get(`/projects/${id}`);
      return res.data.data;
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => api.delete(`/projects/${id}`),
    onSuccess: () => {
      toast.success('Project deleted');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      navigate('/projects');
    },
  });

  const enqueueMutation = useMutation({
    mutationFn: async () =>
      api.post('/jobs', {
        jobType: 'VIDEO',
        videoProjectId: id,
        provider: 'placeholder',
        estimatedCost: 0,
      }),
    onSuccess: () => {
      toast.success('Generation job queued');
      void queryClient.invalidateQueries({ queryKey: ['project', id] });
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
    },
    onError: () => toast.error('Failed to queue job'),
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load project" onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link to="/projects" className="text-sm text-muted-foreground hover:underline">
            ← Back to projects
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{data.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.description || 'No description'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => enqueueMutation.mutate()}>
            Queue video job
          </Button>
          <Button variant="destructive" onClick={() => deleteMutation.mutate()}>
            Delete
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Status</div>
          <div className="mt-2">
            <Badge tone={statusTone(data.status)}>{data.status}</Badge>
          </div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Duration</div>
          <div className="mt-2 font-medium">{data.duration ?? '—'}s</div>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm text-muted-foreground">Aspect ratio</div>
          <div className="mt-2 font-medium">{data.aspectRatio || '—'}</div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-semibold">Target platforms</h2>
        <div className="mt-3 flex flex-wrap gap-2">
          {(data.targetPlatforms || []).length === 0 ? (
            <span className="text-sm text-muted-foreground">None selected</span>
          ) : (
            data.targetPlatforms.map((platform: string) => (
              <Badge key={platform}>{platform}</Badge>
            ))
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Linked story</h2>
          <p className="mt-3 text-sm text-muted-foreground">
            {data.story ? data.story.title : 'No story linked yet'}
          </p>
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h2 className="font-semibold">Recent jobs</h2>
          <div className="mt-3 space-y-2">
            {(data.generationJobs || []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs for this project.</p>
            ) : (
              data.generationJobs.map((job: { id: string; jobType: string; status: string }) => (
                <div key={job.id} className="flex items-center justify-between text-sm">
                  <span>{job.jobType}</span>
                  <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
