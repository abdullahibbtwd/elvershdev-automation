import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

const PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE'] as const;
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Config = Record<string, any>;

const list = (value: string) =>
  value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

const num = (value: string) => (value.trim() === '' ? undefined : Number(value));
const nullableNum = (value: string) => (value.trim() === '' ? null : Number(value));

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-border bg-card p-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function AutomationSettingsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({});
  const [days, setDays] = useState<number[]>([]);
  const [weekends, setWeekends] = useState(true);
  const [channels, setChannels] = useState<Record<string, boolean>>({});

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automation', 'config'],
    queryFn: async () => (await api.get('/automation/config')).data.data as Config,
  });

  useEffect(() => {
    if (!data) return;
    const s = (v: unknown) => (v == null ? '' : String(v));
    const l = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '');
    setForm({
      dailyGenerationTarget: s(data.dailyGenerationTarget),
      monthlyGenerationTarget: s(data.monthlyGenerationTarget),
      timezone: s(data.timezone),
      publishingWindowStart: s(data.publishingWindowStart),
      publishingWindowEnd: s(data.publishingWindowEnd),
      minIntervalMinutes: s(data.minIntervalMinutes),
      maxDailyPublishingAttempts: s(data.maxDailyPublishingAttempts),
      contentCategories: l(data.contentCategories),
      storyGenres: l(data.storyGenres),
      themes: l(data.themes),
      targetAudience: s(data.targetAudience),
      language: s(data.language),
      tone: s(data.tone),
      targetDurationSeconds: s(data.targetDurationSeconds),
      dailyBudgetUsd: s(data.dailyBudgetUsd),
      monthlyBudgetUsd: s(data.monthlyBudgetUsd),
      maxCostPerVideoUsd: s(data.maxCostPerVideoUsd),
      maxConcurrentGeneration: s(data.maxConcurrentGeneration),
      maxConcurrentPublishing: s(data.maxConcurrentPublishing),
      maxRetries: s(data.maxRetries),
      maxGenerationAttempts: s(data.maxGenerationAttempts),
      maxImageGenerationsPerScene: s(data.maxImageGenerationsPerScene),
      maxMotionAttemptsPerScene: s(data.maxMotionAttemptsPerScene),
      contentExclusions: l(data.contentExclusions),
      brandIdentity: s(data.brandIdentity),
    });
    setDays(data.preferredPublishingDays ?? []);
    setWeekends(Boolean(data.includeWeekends));
    setChannels(
      Object.fromEntries(
        PLATFORMS.map((p) => [p, data.channelPublishingEnabled?.[p] !== false]),
      ),
    );
  }, [data]);

  const set = (key: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const input = (key: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Input value={form[key] ?? ''} onChange={set(key)} {...props} />
  );

  const saveMutation = useMutation({
    mutationFn: async () => {
      const f = form;
      return api.patch('/automation/config', {
        dailyGenerationTarget: num(f.dailyGenerationTarget),
        monthlyGenerationTarget: num(f.monthlyGenerationTarget),
        timezone: f.timezone || undefined,
        preferredPublishingDays: days,
        includeWeekends: weekends,
        publishingWindowStart: f.publishingWindowStart || undefined,
        publishingWindowEnd: f.publishingWindowEnd || undefined,
        minIntervalMinutes: num(f.minIntervalMinutes),
        maxDailyPublishingAttempts: num(f.maxDailyPublishingAttempts),
        channelPublishingEnabled: channels,
        contentCategories: list(f.contentCategories),
        storyGenres: list(f.storyGenres),
        themes: list(f.themes),
        targetAudience: f.targetAudience,
        language: f.language || undefined,
        tone: f.tone,
        targetDurationSeconds: num(f.targetDurationSeconds),
        contentExclusions: list(f.contentExclusions),
        brandIdentity: f.brandIdentity || null,
        maxConcurrentGeneration: num(f.maxConcurrentGeneration),
        maxConcurrentPublishing: num(f.maxConcurrentPublishing),
        maxRetries: num(f.maxRetries),
        dailyBudgetUsd: nullableNum(f.dailyBudgetUsd),
        monthlyBudgetUsd: nullableNum(f.monthlyBudgetUsd),
        maxCostPerVideoUsd: nullableNum(f.maxCostPerVideoUsd),
        maxGenerationAttempts: num(f.maxGenerationAttempts),
        maxImageGenerationsPerScene: num(f.maxImageGenerationsPerScene),
        maxMotionAttemptsPerScene: num(f.maxMotionAttemptsPerScene),
      });
    },
    onSuccess: () => {
      toast.success('Automation settings saved');
      void queryClient.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: () => toast.error('Failed to save automation settings'),
  });

  const controlMutation = useMutation({
    mutationFn: async (key: 'enable' | 'pause' | 'resume' | 'emergency-stop') =>
      api.post(`/automation/${key}`),
    onSuccess: (_, key) => {
      toast.success(`Action "${key}" completed`);
      void queryClient.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: () => toast.error('Action failed'),
  });

  if (isLoading) return <LoadingState />;
  if (error || !data)
    return (
      <ErrorState message="Failed to load automation settings" onRetry={() => void refetch()} />
    );

  const status = data.enabled ? data.runMode : 'DISABLED';
  const busy = controlMutation.isPending;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Automation Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Targets, schedule, content preferences, budgets and limits.
        </p>
      </div>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 text-sm">
          Status: <Badge tone={statusTone(status)}>{status}</Badge>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || data.enabled}
            onClick={() => controlMutation.mutate('enable')}
          >
            Enable
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => controlMutation.mutate('pause')}
          >
            Pause
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => controlMutation.mutate('resume')}
          >
            Resume
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Emergency stop will halt all automation. Continue?'))
                controlMutation.mutate('emergency-stop');
            }}
          >
            Emergency Stop
          </Button>
        </div>
      </section>

      <Section title="Targets">
        <Field label="Daily generation target (1-20)">
          {input('dailyGenerationTarget', { type: 'number', min: 1, max: 20 })}
        </Field>
        <Field label="Monthly generation target (1-1000)">
          {input('monthlyGenerationTarget', { type: 'number', min: 1, max: 1000 })}
        </Field>
      </Section>

      <Section title="Publishing schedule">
        <Field label="Timezone">{input('timezone', { placeholder: 'America/New_York' })}</Field>
        <Field label="Min interval (minutes)">
          {input('minIntervalMinutes', { type: 'number', min: 5 })}
        </Field>
        <Field label="Window start (HH:mm)">
          {input('publishingWindowStart', { placeholder: '09:00' })}
        </Field>
        <Field label="Window end (HH:mm)">
          {input('publishingWindowEnd', { placeholder: '21:00' })}
        </Field>
        <Field label="Max daily publishing attempts">
          {input('maxDailyPublishingAttempts', { type: 'number', min: 1, max: 200 })}
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={weekends}
            onChange={(e) => setWeekends(e.target.checked)}
          />
          Include weekends
        </label>
        <Field label="Preferred days">
          <div className="flex flex-wrap gap-3 text-sm">
            {DAYS.map((label, index) => (
              <label key={label} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={days.includes(index)}
                  onChange={(e) =>
                    setDays((prev) =>
                      e.target.checked ? [...prev, index].sort() : prev.filter((d) => d !== index),
                    )
                  }
                />
                {label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Channel publishing enabled">
          <div className="flex flex-wrap gap-3 text-sm">
            {PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={channels[platform] ?? false}
                  onChange={(e) =>
                    setChannels((prev) => ({ ...prev, [platform]: e.target.checked }))
                  }
                />
                {platform}
              </label>
            ))}
          </div>
        </Field>
      </Section>

      <Section title="Content">
        <Field label="Categories (comma-separated)">{input('contentCategories')}</Field>
        <Field label="Story genres (comma-separated)">{input('storyGenres')}</Field>
        <Field label="Themes (comma-separated)">{input('themes')}</Field>
        <Field label="Exclusions (comma-separated)">{input('contentExclusions')}</Field>
        <Field label="Target audience">{input('targetAudience', { maxLength: 200 })}</Field>
        <Field label="Language">{input('language', { maxLength: 10 })}</Field>
        <Field label="Tone">{input('tone', { maxLength: 100 })}</Field>
        <Field label="Target duration (seconds, 15-600)">
          {input('targetDurationSeconds', { type: 'number', min: 15, max: 600 })}
        </Field>
        <div className="space-y-1 sm:col-span-2">
          <label className="text-sm font-medium">Brand identity</label>
          <Textarea
            rows={4}
            maxLength={4000}
            value={form.brandIdentity ?? ''}
            onChange={set('brandIdentity')}
          />
        </div>
      </Section>

      <Section title="Budgets (USD, leave empty for no limit)">
        <Field label="Daily budget">
          {input('dailyBudgetUsd', { type: 'number', min: 0, step: '0.01' })}
        </Field>
        <Field label="Monthly budget">
          {input('monthlyBudgetUsd', { type: 'number', min: 0, step: '0.01' })}
        </Field>
        <Field label="Max cost per video">
          {input('maxCostPerVideoUsd', { type: 'number', min: 0, step: '0.01' })}
        </Field>
      </Section>

      <Section title="Concurrency & retries">
        <Field label="Max concurrent generation (1-10)">
          {input('maxConcurrentGeneration', { type: 'number', min: 1, max: 10 })}
        </Field>
        <Field label="Max concurrent publishing (1-20)">
          {input('maxConcurrentPublishing', { type: 'number', min: 1, max: 20 })}
        </Field>
        <Field label="Max retries (0-10)">
          {input('maxRetries', { type: 'number', min: 0, max: 10 })}
        </Field>
        <Field label="Max generation attempts (1-20)">
          {input('maxGenerationAttempts', { type: 'number', min: 1, max: 20 })}
        </Field>
        <Field label="Max image generations per scene (1-20)">
          {input('maxImageGenerationsPerScene', { type: 'number', min: 1, max: 20 })}
        </Field>
        <Field label="Max motion attempts per scene (1-20)">
          {input('maxMotionAttemptsPerScene', { type: 'number', min: 1, max: 20 })}
        </Field>
      </Section>

      <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
        Save settings
      </Button>
    </div>
  );
}
