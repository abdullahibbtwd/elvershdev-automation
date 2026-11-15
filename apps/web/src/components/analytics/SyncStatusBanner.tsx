import { AlertTriangle, CheckCircle2, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { dateTime } from '@/lib/analytics';

export type SyncJob = {
  id: string;
  status: string;
  postsTargeted?: number;
  postsSucceeded?: number;
  postsFailed?: number;
  lastError?: string | null;
  createdAt: string;
  completedAt?: string | null;
};

export function SyncStatusBanner({ job }: { job?: SyncJob }) {
  if (!job) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
          <Clock className="h-4 w-4" /> Analytics have not been synced yet.
        </CardContent>
      </Card>
    );
  }
  const failed = job.status === 'FAILED' || job.status === 'PARTIAL';
  const stale =
    Date.now() - new Date(job.completedAt ?? job.createdAt).getTime() > 24 * 60 * 60 * 1000;
  return (
    <Card className={failed ? 'border-amber-500/40 bg-amber-500/10' : undefined}>
      <CardContent className="p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          {failed ? (
            <AlertTriangle className="h-4 w-4 text-amber-300" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-emerald-400" />
          )}
          <span>Last sync: {dateTime(job.completedAt ?? job.createdAt)}</span>
          <Badge tone={failed ? 'warning' : 'success'}>{job.status}</Badge>
          {stale && <Badge tone="warning">Stale data</Badge>}
        </div>
        {job.postsFailed ? (
          <p className="mt-1 text-xs text-amber-200">
            Partial failure: {job.postsFailed} failed, {job.postsSucceeded ?? 0} succeeded.
          </p>
        ) : null}
        {job.lastError && <p className="mt-1 text-xs text-red-400">{job.lastError}</p>}
      </CardContent>
    </Card>
  );
}
