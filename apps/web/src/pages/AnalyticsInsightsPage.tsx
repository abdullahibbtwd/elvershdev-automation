import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Lightbulb, Sparkles } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

type Insight = {
  id: string;
  recommendation: string;
  supportingMetrics: Record<string, unknown>;
  sampleSize: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  platform?: string | null;
  suggestedExperiment: string;
  dateFrom: string;
  dateTo: string;
  category?: string | null;
  evidenceType: string;
  createdAt: string;
};
type Settings = {
  performanceOptimizationEnabled: boolean;
  minSampleSizeForOptimization: number;
  preferStrongCategories: boolean;
  avoidWeakFormats: boolean;
  suggestDurationAdjustments: boolean;
  suggestCaptionExperiments: boolean;
  diversityFloorPercent: number;
  insightLookbackDays: number;
  syncRecentHours: number;
  syncOlderHours: number;
  recentPostMaxAgeDays: number;
};
const defaults: Settings = {
  performanceOptimizationEnabled: false,
  minSampleSizeForOptimization: 10,
  preferStrongCategories: true,
  avoidWeakFormats: false,
  suggestDurationAdjustments: true,
  suggestCaptionExperiments: true,
  diversityFloorPercent: 30,
  insightLookbackDays: 90,
  syncRecentHours: 6,
  syncOlderHours: 48,
  recentPostMaxAgeDays: 7,
};

export function AnalyticsInsightsPage() {
  const client = useQueryClient();
  const [settings, setSettings] = useState(defaults);
  const insights = useQuery({
    queryKey: ['analytics', 'insights'],
    queryFn: async () => (await api.get('/analytics/insights')).data.data as Insight[],
  });
  const generate = useMutation({
    mutationFn: () => api.post('/analytics/insights/generate'),
    onSuccess: () => {
      toast.success('New insight generated');
      void client.invalidateQueries({ queryKey: ['analytics', 'insights'] });
    },
    onError: (error: { response?: { data?: { message?: string } } }) =>
      toast.error(error.response?.data?.message ?? 'Unable to generate insight'),
  });
  const save = useMutation({
    mutationFn: async () =>
      (await api.patch('/analytics/insights/settings', settings)).data.data as Settings,
    onSuccess: (data) => {
      setSettings(data);
      toast.success('Optimization settings saved');
    },
    onError: () => toast.error('Unable to save optimization settings'),
  });

  if (insights.isLoading) return <LoadingState />;
  if (insights.error)
    return <ErrorState message="Failed to load analytics insights" onRetry={() => void insights.refetch()} />;

  const setBoolean = (key: keyof Settings) => (event: { target: { checked: boolean } }) =>
    setSettings((current) => ({ ...current, [key]: event.target.checked }));
  const setNumber = (key: keyof Settings) => (event: { target: { value: string } }) =>
    setSettings((current) => ({ ...current, [key]: Number(event.target.value) }));

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link className="mb-3 inline-flex items-center text-sm text-muted-foreground" to="/analytics"><ArrowLeft className="mr-1 h-4 w-4" /> Analytics</Link>
          <h1 className="text-2xl font-semibold">Analytics insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">Conservative, evidence-based recommendations from observed performance.</p>
        </div>
        <Button disabled={generate.isPending} onClick={() => generate.mutate()}>
          <Sparkles className="mr-2 h-4 w-4" /> {generate.isPending ? 'Generating…' : 'Generate insight'}
        </Button>
      </header>

      {!insights.data?.length ? (
        <EmptyState icon={Lightbulb} title="No insights yet" description="Insights require enough content performance samples." actionLabel="Generate insight" onAction={() => generate.mutate()} />
      ) : (
        <section className="space-y-3">
          {insights.data.map((insight) => (
            <article key={insight.id} className="rounded-xl border border-border bg-card p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={insight.confidence === 'HIGH' ? 'success' : insight.confidence === 'MEDIUM' ? 'info' : 'warning'}>{insight.confidence} confidence</Badge>
                <Badge>{insight.evidenceType.replaceAll('_', ' ')}</Badge>
                {insight.platform && <Badge>{insight.platform}</Badge>}
                {insight.category && <Badge>{insight.category}</Badge>}
              </div>
              <h2 className="mt-3 text-lg font-semibold">{insight.recommendation}</h2>
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">Supporting metrics</h3>
                  <dl className="mt-2 space-y-1 text-sm">
                    {Object.entries(insight.supportingMetrics).map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt>{key}</dt><dd className="font-medium">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</dd></div>)}
                    <div className="flex justify-between gap-4"><dt>Sample size</dt><dd className="font-medium">{insight.sampleSize}</dd></div>
                  </dl>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase text-muted-foreground">Suggested experiment</h3>
                  <p className="mt-2 text-sm">{insight.suggestedExperiment}</p>
                </div>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">{new Date(insight.dateFrom).toLocaleDateString()}–{new Date(insight.dateTo).toLocaleDateString()}</p>
            </article>
          ))}
        </section>
      )}

      <form className="rounded-xl border border-border bg-card p-5" onSubmit={(event) => { event.preventDefault(); save.mutate(); }}>
        <h2 className="font-semibold">Optimization settings</h2>
        <p className="mt-1 text-xs text-muted-foreground">The API has no settings read endpoint; defaults are shown until this form is saved, then the server response is used.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['performanceOptimizationEnabled', 'Enable performance optimization'],
            ['preferStrongCategories', 'Prefer strong categories'],
            ['avoidWeakFormats', 'Avoid weak formats'],
            ['suggestDurationAdjustments', 'Suggest duration adjustments'],
            ['suggestCaptionExperiments', 'Suggest caption experiments'],
          ] as Array<[keyof Settings, string]>).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(settings[key])} onChange={setBoolean(key)} /> {label}</label>
          ))}
          {([
            ['minSampleSizeForOptimization', 'Minimum sample size', 3, undefined],
            ['diversityFloorPercent', 'Diversity floor (%)', 0, 100],
            ['insightLookbackDays', 'Insight lookback (days)', 7, 365],
            ['syncRecentHours', 'Recent sync interval (hours)', 1, undefined],
            ['syncOlderHours', 'Older sync interval (hours)', 1, undefined],
            ['recentPostMaxAgeDays', 'Recent post age (days)', 1, undefined],
          ] as Array<[keyof Settings, string, number, number | undefined]>).map(([key, label, min, max]) => (
            <label key={key} className="text-xs font-medium text-muted-foreground">{label}<Input className="mt-1" type="number" min={min} max={max} value={Number(settings[key])} onChange={setNumber(key)} /></label>
          ))}
        </div>
        <Button className="mt-5" type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</Button>
      </form>
    </div>
  );
}
