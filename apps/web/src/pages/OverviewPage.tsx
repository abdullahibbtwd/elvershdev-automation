import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

export function OverviewPage() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['dashboard-overview'],
    queryFn: async () => {
      const res = await api.get('/dashboard/overview');
      return res.data.data;
    },
  });

  if (isLoading) return <LoadingState label="Loading overview…" />;
  if (error) {
    return (
      <ErrorState
        message={(error as Error).message || 'Failed to load overview'}
        onRetry={() => void refetch()}
      />
    );
  }

  const counts = data.counts as Record<string, number>;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Overview"
        description="Project, job and media activity for your workspace."
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Projects', counts.projects, '/projects'],
          ['Stories', counts.stories, '/stories'],
          ['Media', counts.media, '/media'],
          ['Jobs', counts.jobs, '/jobs'],
          ['Channels', counts.channels, '/channels'],
          ['Publishing', counts.publishing, '/publishing'],
          ['Processing', counts.processingJobs, '/jobs'],
          ['Failed jobs', counts.failedJobs, '/jobs'],
        ].map(([label, value, href]) => (
          <Link key={label as string} to={href as string} className="block">
            <Card interactive className="h-full hover:border-primary/50">
              <CardContent className="p-5">
                <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                  {label as string}
                </div>
                <div className="mt-2 text-3xl font-semibold tracking-tight text-foreground">
                  {value as number}
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Recent projects</CardTitle>
            <CardDescription>Latest workspaces in production.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentProjects.length === 0 ? (
              <p className="text-sm text-muted-foreground">No projects yet.</p>
            ) : (
              data.recentProjects.map(
                (project: { id: string; title: string; status: string; aspectRatio?: string }) => (
                  <Link
                    key={project.id}
                    to={`/projects/${project.id}`}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 transition-all duration-200 hover:border-primary/40 hover:bg-accent/50"
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{project.title}</div>
                      <div className="text-xs text-muted-foreground">{project.aspectRatio || '—'}</div>
                    </div>
                    <Badge tone={statusTone(project.status)}>{project.status}</Badge>
                  </Link>
                ),
              )
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent jobs</CardTitle>
            <CardDescription>Generation pipeline activity.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.recentJobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              data.recentJobs.map(
                (job: {
                  id: string;
                  jobType: string;
                  status: string;
                  progress: number;
                }) => (
                  <div
                    key={job.id}
                    className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5"
                  >
                    <div>
                      <div className="text-sm font-medium text-foreground">{job.jobType}</div>
                      <div className="text-xs text-muted-foreground">{job.progress}% complete</div>
                    </div>
                    <Badge tone={statusTone(job.status)}>{job.status}</Badge>
                  </div>
                ),
              )
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
