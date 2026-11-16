import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  SERIES_GENRE_OPTIONS,
  SERIES_THEME_OPTIONS,
  seriesApi,
  type SeriesConfig,
  type SeriesCreativeSettings,
  type SeriesLane,
} from '@/lib/series-api';
import { statusTone } from '@/lib/status';

const PLATFORMS = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE'] as const;

const CORE_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  { key: 'seriesStudioEnabled', label: 'Series Studio enabled' },
  { key: 'morningLaneEnabled', label: 'Morning lane enabled' },
  { key: 'eveningLaneEnabled', label: 'Evening lane enabled' },
];

const MASTER_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  {
    key: 'automaticEpisodeProduction',
    label: 'Automatic Episode Production',
    hint: 'Master switch for scripts + media. Individual advanced stages must also be on.',
  },
  {
    key: 'automaticMoviePlanning',
    label: 'Automatic Movie Planning',
    hint: 'Plans new movies when a lane needs one. Manual Plan Movie always available.',
  },
  {
    key: 'automaticPublishing',
    label: 'Automatic Publishing',
    hint: 'Hands completed episodes to the publish pipeline at the configured publish time.',
  },
  {
    key: 'automaticReplacementPlanning',
    label: 'Automatic Replacement Planning',
    hint: 'Prepares the next movie before the current one ends.',
  },
];

const APPROVAL_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  {
    key: 'movieApprovalRequired',
    label: 'Movie approval required',
    hint: 'Production never bypasses this gate.',
  },
  {
    key: 'episodeApprovalRequired',
    label: 'Episode approval required',
    hint: 'Scripts wait for approval before media production.',
  },
  {
    key: 'automaticReplacementApproval',
    label: 'Automatic replacement approval',
    hint: 'Default OFF — keep a human gate for replacement movies.',
  },
];

const ADVANCED_STAGE_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  { key: 'automaticCharacterGeneration', label: 'Automatic character generation' },
  { key: 'automaticEpisodeScriptGeneration', label: 'Automatic episode scripts' },
  {
    key: 'automaticVisualGeneration',
    label: 'Automatic visuals',
    hint: 'If off while production master is on, production stops before visuals.',
  },
  {
    key: 'automaticMotionGeneration',
    label: 'Automatic motion',
    hint: 'If off, automatic production stops before motion (does not skip silently).',
  },
  { key: 'automaticNarration', label: 'Automatic narration' },
  { key: 'automaticRendering', label: 'Automatic rendering' },
  {
    key: 'startMediaAfterMoviePlanning',
    label: 'Start media after movie planning',
    hint: 'Default OFF — Plan Movies in Advance keeps planning separate from credits spend.',
  },
];

const ALL_TOGGLE_KEYS = [
  ...CORE_TOGGLES,
  ...MASTER_TOGGLES,
  ...APPROVAL_TOGGLES,
  ...ADVANCED_STAGE_TOGGLES,
].map((t) => t.key);

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">{label}</label>
      {children}
    </div>
  );
}

export function SeriesSettingsPage() {
  const queryClient = useQueryClient();
  const [toggles, setToggles] = useState<Partial<Record<keyof SeriesConfig, boolean>>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [laneDrafts, setLaneDrafts] = useState<
    Record<
      string,
      {
        name: string;
        publishTime: string;
        timezone: string;
        productionLeadTimeMinutes: string;
        preferredProductionTime: string;
        productionStartMode: string;
      }
    >
  >({});
  const [creative, setCreative] = useState<SeriesCreativeSettings>({});
  const [laneCreativeId, setLaneCreativeId] = useState('');
  const [laneCreative, setLaneCreative] = useState<SeriesCreativeSettings>({});
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autonomyMode, setAutonomyMode] = useState<'MANUAL' | 'FULLY_AUTONOMOUS'>('MANUAL');

  const configQuery = useQuery({
    queryKey: ['series', 'config'],
    queryFn: () => seriesApi.getConfig(),
  });
  const lanesQuery = useQuery({
    queryKey: ['series', 'lanes'],
    queryFn: () => seriesApi.listLanes(),
  });

  useEffect(() => {
    const data = configQuery.data;
    if (!data) return;
    setToggles(
      Object.fromEntries(ALL_TOGGLE_KEYS.map((key) => [key, Boolean(data[key])])) as Partial<
        Record<keyof SeriesConfig, boolean>
      >,
    );
    setAutonomyMode(data.autonomyMode === 'FULLY_AUTONOMOUS' ? 'FULLY_AUTONOMOUS' : 'MANUAL');
    setForm({
      defaultPlannedEpisodeCount: String(data.defaultPlannedEpisodeCount ?? 10),
      defaultEpisodeDurationSeconds: String(data.defaultEpisodeDurationSeconds ?? 60),
      defaultReplacementTriggerEpisode: String(data.defaultReplacementTriggerEpisode ?? 8),
      maxConcurrentEpisodeProduction: String(data.maxConcurrentEpisodeProduction ?? 1),
      maxRetries: String(data.maxRetries ?? 3),
      qualityAcceptanceThreshold: String(data.qualityAcceptanceThreshold ?? 0.7),
      defaultProductionLeadTimeMinutes: String(data.defaultProductionLeadTimeMinutes ?? 240),
      defaultProductionStartMode: data.defaultProductionStartMode ?? 'NEXT_WINDOW',
      language: data.language ?? 'en',
      tone: data.tone ?? '',
      visualDirection: data.visualDirection ?? '',
      dailyBudgetUsd: data.dailyBudgetUsd == null ? '' : String(data.dailyBudgetUsd),
      monthlyBudgetUsd: data.monthlyBudgetUsd == null ? '' : String(data.monthlyBudgetUsd),
      maxCostPerEpisodeUsd:
        data.maxCostPerEpisodeUsd == null ? '' : String(data.maxCostPerEpisodeUsd),
    });
    setChannels(
      Object.fromEntries(
        PLATFORMS.map((platform) => [
          platform,
          data.channelPublishingEnabled?.[platform] !== false,
        ]),
      ),
    );
    setCreative(data.creativeSettings ?? {});
  }, [configQuery.data]);

  useEffect(() => {
    const lanes = lanesQuery.data;
    if (!lanes) return;
    setLaneDrafts(
      Object.fromEntries(
        lanes.map((lane) => [
          lane.id,
          {
            name: lane.name,
            publishTime: lane.publishTime,
            timezone: lane.timezone,
            productionLeadTimeMinutes: String(lane.productionLeadTimeMinutes ?? 240),
            preferredProductionTime: lane.preferredProductionTime ?? '',
            productionStartMode: lane.productionStartMode ?? 'NEXT_WINDOW',
          },
        ]),
      ),
    );
    if (!laneCreativeId && lanes[0]) {
      setLaneCreativeId(lanes[0].id);
      setLaneCreative(lanes[0].creativeSettings ?? {});
    }
  }, [lanesQuery.data, laneCreativeId]);

  const saveConfig = useMutation({
    mutationFn: async () => {
      const num = (key: string) => {
        const raw = form[key]?.trim();
        if (!raw) return undefined;
        return Number(raw);
      };
      const nullableNum = (key: string) => {
        const raw = form[key]?.trim();
        if (!raw) return null;
        return Number(raw);
      };
      return seriesApi.updateConfig({
        ...toggles,
        autonomyMode,
        defaultPlannedEpisodeCount: num('defaultPlannedEpisodeCount'),
        defaultEpisodeDurationSeconds: num('defaultEpisodeDurationSeconds'),
        defaultReplacementTriggerEpisode: num('defaultReplacementTriggerEpisode'),
        maxConcurrentEpisodeProduction: num('maxConcurrentEpisodeProduction'),
        maxRetries: num('maxRetries'),
        qualityAcceptanceThreshold: num('qualityAcceptanceThreshold'),
        defaultProductionLeadTimeMinutes: num('defaultProductionLeadTimeMinutes'),
        defaultProductionStartMode: (form.defaultProductionStartMode ||
          'NEXT_WINDOW') as SeriesConfig['defaultProductionStartMode'],
        language: form.language || undefined,
        tone: form.tone || undefined,
        visualDirection: form.visualDirection || undefined,
        dailyBudgetUsd: nullableNum('dailyBudgetUsd') as number | null,
        monthlyBudgetUsd: nullableNum('monthlyBudgetUsd') as number | null,
        maxCostPerEpisodeUsd: nullableNum('maxCostPerEpisodeUsd') as number | null,
        channelPublishingEnabled: channels,
        creativeSettings: creative,
      } as Partial<SeriesConfig>);
    },
    onSuccess: () => {
      toast.success('Series settings saved');
      void queryClient.invalidateQueries({ queryKey: ['series'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Failed to save settings';
      toast.error(String(message));
    },
  });

  const saveLane = useMutation({
    mutationFn: async (lane: SeriesLane) => {
      const draft = laneDrafts[lane.id];
      return seriesApi.updateLane(lane.id, {
        name: draft?.name,
        publishTime: draft?.publishTime,
        timezone: draft?.timezone,
        productionLeadTimeMinutes: draft?.productionLeadTimeMinutes
          ? Number(draft.productionLeadTimeMinutes)
          : undefined,
        preferredProductionTime: draft?.preferredProductionTime?.trim() || null,
        productionStartMode: draft?.productionStartMode || undefined,
        ...(lane.id === laneCreativeId ? { creativeSettings: laneCreative } : {}),
      });
    },
    onSuccess: (_, lane) => {
      toast.success(`${lane.name} saved`);
      void queryClient.invalidateQueries({ queryKey: ['series', 'lanes'] });
    },
    onError: () => toast.error('Failed to save lane'),
  });

  const toggleList = (
    list: string[] | undefined,
    value: string,
    setter: (next: string[]) => void,
  ) => {
    const current = list ?? [];
    setter(
      current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    );
  };

  if (configQuery.isLoading || lanesQuery.isLoading) return <LoadingState />;
  if (configQuery.error || !configQuery.data) {
    return (
      <ErrorState
        message="Failed to load Series settings"
        onRetry={() => void configQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Series settings"
        description="Feature switches, budgets, and lane publish times. Every toggle persists through the Series API."
        actions={
          <Link
            to="/series"
            className="inline-flex h-10 items-center rounded-md border border-input bg-card px-4 text-sm"
          >
            Overview
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={statusTone(configQuery.data.runMode)}>{configQuery.data.runMode}</Badge>
        <Badge tone={configQuery.data.seriesStudioEnabled ? 'success' : 'warning'}>
          {configQuery.data.seriesStudioEnabled ? 'Studio on' : 'Studio off'}
        </Badge>
        <Badge tone={autonomyMode === 'FULLY_AUTONOMOUS' ? 'success' : 'default'}>
          {autonomyMode === 'FULLY_AUTONOMOUS' ? 'Fully autonomous' : 'Manual mode'}
        </Badge>
      </div>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">1. Series Studio</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {CORE_TOGGLES.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-2 text-sm" title={hint}>
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(toggles[key])}
                onChange={(e) =>
                  setToggles((prev) => ({
                    ...prev,
                    [key]: e.target.checked,
                  }))
                }
              />
              <span>
                <span className="font-medium">{label}</span>
                {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
              </span>
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">2. Autonomous Mode</h2>
        <p className="text-sm text-muted-foreground">
          Fully Autonomous Mode plans, produces, validates, and publishes without routine human
          approval. This is separate from mock AI mode.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              name="autonomyMode"
              checked={autonomyMode === 'MANUAL'}
              onChange={() => setAutonomyMode('MANUAL')}
            />
            <span>
              <span className="font-medium">Manual Mode</span>
              <span className="block text-xs text-muted-foreground">
                Keep movie/episode/replacement approval gates as configured below.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 rounded-lg border border-border p-3 text-sm">
            <input
              type="radio"
              className="mt-1"
              name="autonomyMode"
              checked={autonomyMode === 'FULLY_AUTONOMOUS'}
              onChange={() => setAutonomyMode('FULLY_AUTONOMOUS')}
            />
            <span>
              <span className="font-medium">Fully Autonomous Mode</span>
              <span className="block text-xs text-muted-foreground">
                Overrides routine approval gates. Emergency stop, budgets, and quality checks still
                apply.
              </span>
            </span>
          </label>
        </div>
        {autonomyMode === 'FULLY_AUTONOMOUS' ? (
          <p className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
            Autonomy overrides movie approval, episode approval, and replacement approval. Stored
            legacy toggles are preserved if you switch back to Manual Mode.
          </p>
        ) : null}
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">3. Automation</h2>
        <p className="text-sm text-muted-foreground">
          Production automates scripting and media. Publishing stays independent so completed
          episodes can wait as READY_TO_PUBLISH when publishing is off.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {MASTER_TOGGLES.map(({ key, label, hint }) => (
            <label key={key} className="flex items-start gap-2 text-sm" title={hint}>
              <input
                type="checkbox"
                className="mt-1"
                checked={Boolean(toggles[key])}
                onChange={(e) =>
                  setToggles((prev) => ({
                    ...prev,
                    [key]: e.target.checked,
                  }))
                }
              />
              <span>
                <span className="font-medium">{label}</span>
                {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
              </span>
            </label>
          ))}
        </div>
        {toggles.automaticEpisodeProduction &&
        (!toggles.automaticVisualGeneration ||
          !toggles.automaticMotionGeneration ||
          !toggles.automaticNarration ||
          !toggles.automaticRendering) ? (
          <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
            Automatic Episode Production is on, but one or more media stages are off. Automatic
            runs will stop at the first disabled stage instead of skipping it.
          </p>
        ) : null}
      </section>

      {autonomyMode === 'MANUAL' ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h2 className="text-lg font-semibold">Approval controls (Manual Mode)</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {APPROVAL_TOGGLES.map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-2 text-sm" title={hint}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(toggles[key])}
                  onChange={(e) =>
                    setToggles((prev) => ({
                      ...prev,
                      [key]: e.target.checked,
                    }))
                  }
                />
                <span>
                  <span className="font-medium">{label}</span>
                  {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
                </span>
              </label>
            ))}
          </div>
        </section>
      ) : (
        <section className="space-y-2 rounded-xl border border-dashed border-border bg-muted/30 p-4">
          <h2 className="text-lg font-semibold">Approvals</h2>
          <p className="text-sm text-muted-foreground">
            Routine movie, episode, and replacement approvals are handled automatically while Fully
            Autonomous Mode is active. Switch to Manual Mode to restore human gates.
          </p>
        </section>
      )}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Advanced stage switches</h2>
          <Button size="sm" variant="outline" type="button" onClick={() => setShowAdvanced((v) => !v)}>
            {showAdvanced ? 'Hide' : 'Show'} advanced
          </Button>
        </div>
        {showAdvanced ? (
          <div className="grid gap-3 sm:grid-cols-2">
            {ADVANCED_STAGE_TOGGLES.map(({ key, label, hint }) => (
              <label key={key} className="flex items-start gap-2 text-sm" title={hint}>
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={Boolean(toggles[key])}
                  onChange={(e) =>
                    setToggles((prev) => ({
                      ...prev,
                      [key]: e.target.checked,
                    }))
                  }
                />
                <span>
                  <span className="font-medium">{label}</span>
                  {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
                </span>
              </label>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Keep individual stage safeties here. The production master switch does not override a
            disabled stage.
          </p>
        )}
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">4. Production settings</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Planned episode count">
            <Input
              value={form.defaultPlannedEpisodeCount ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, defaultPlannedEpisodeCount: e.target.value }))
              }
            />
          </Field>
          <Field label="Episode duration (seconds)">
            <Input
              value={form.defaultEpisodeDurationSeconds ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, defaultEpisodeDurationSeconds: e.target.value }))
              }
            />
          </Field>
          <Field label="Replacement trigger episode">
            <Input
              value={form.defaultReplacementTriggerEpisode ?? ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  defaultReplacementTriggerEpisode: e.target.value,
                }))
              }
            />
          </Field>
          <Field label="Max concurrent production">
            <Input
              value={form.maxConcurrentEpisodeProduction ?? ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  maxConcurrentEpisodeProduction: e.target.value,
                }))
              }
            />
          </Field>
          <Field label="Max retries">
            <Input
              value={form.maxRetries ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, maxRetries: e.target.value }))}
            />
          </Field>
          <Field label="Quality threshold">
            <Input
              value={form.qualityAcceptanceThreshold ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, qualityAcceptanceThreshold: e.target.value }))
              }
            />
          </Field>
          <Field label="Default production lead time (minutes)">
            <Input
              value={form.defaultProductionLeadTimeMinutes ?? ''}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  defaultProductionLeadTimeMinutes: e.target.value,
                }))
              }
            />
          </Field>
          <Field label="Default production start mode">
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={form.defaultProductionStartMode ?? 'NEXT_WINDOW'}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, defaultProductionStartMode: e.target.value }))
              }
            >
              <option value="IMMEDIATE">Immediately after approval</option>
              <option value="NEXT_WINDOW">At next scheduled production window</option>
              <option value="CUSTOM">Custom date and time</option>
              <option value="MANUAL">Manual start only</option>
            </select>
          </Field>
          <Field label="Language">
            <Input
              value={form.language ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
            />
          </Field>
          <Field label="Tone">
            <Input
              value={form.tone ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, tone: e.target.value }))}
            />
          </Field>
          <Field label="Visual direction">
            <Input
              value={form.visualDirection ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, visualDirection: e.target.value }))}
            />
          </Field>
          <Field label="Daily budget USD">
            <Input
              value={form.dailyBudgetUsd ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, dailyBudgetUsd: e.target.value }))}
            />
          </Field>
          <Field label="Monthly budget USD">
            <Input
              value={form.monthlyBudgetUsd ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, monthlyBudgetUsd: e.target.value }))}
            />
          </Field>
          <Field label="Max cost per episode USD">
            <Input
              value={form.maxCostPerEpisodeUsd ?? ''}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, maxCostPerEpisodeUsd: e.target.value }))
              }
            />
          </Field>
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">Channel publishing</h2>
        <div className="flex flex-wrap gap-4">
          {PLATFORMS.map((platform) => (
            <label key={platform} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={channels[platform] !== false}
                onChange={(e) =>
                  setChannels((prev) => ({ ...prev, [platform]: e.target.checked }))
                }
              />
              {platform}
            </label>
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-lg font-semibold">5. Creative defaults</h2>
        <p className="text-sm text-muted-foreground">
          Global creative defaults for Series Studio only (not standalone automation). Lane settings
          override these; movie snapshots freeze values at generation time.
        </p>
        <div className="space-y-2">
          <label className="text-sm font-medium">Genres</label>
          <div className="flex flex-wrap gap-2">
            {SERIES_GENRE_OPTIONS.map((genre) => (
              <button
                key={genre}
                type="button"
                className={`rounded-md border px-2 py-1 text-xs ${
                  (creative.genres ?? []).includes(genre)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input'
                }`}
                onClick={() =>
                  toggleList(creative.genres, genre, (genres) =>
                    setCreative((prev) => ({ ...prev, genres })),
                  )
                }
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium">Themes</label>
          <div className="flex flex-wrap gap-2">
            {SERIES_THEME_OPTIONS.map((theme) => (
              <button
                key={theme}
                type="button"
                className={`rounded-md border px-2 py-1 text-xs ${
                  (creative.themes ?? []).includes(theme)
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-input'
                }`}
                onClick={() =>
                  toggleList(creative.themes, theme, (themes) =>
                    setCreative((prev) => ({ ...prev, themes })),
                  )
                }
              >
                {theme}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Target audience">
            <Input
              value={creative.targetAudience ?? ''}
              onChange={(e) =>
                setCreative((prev) => ({ ...prev, targetAudience: e.target.value }))
              }
            />
          </Field>
          <Field label="Dialogue style">
            <Input
              value={creative.dialogueStyle ?? ''}
              onChange={(e) =>
                setCreative((prev) => ({ ...prev, dialogueStyle: e.target.value }))
              }
            />
          </Field>
          <Field label="Cliffhanger intensity">
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={creative.cliffhangerIntensity ?? 'medium'}
              onChange={(e) =>
                setCreative((prev) => ({
                  ...prev,
                  cliffhangerIntensity: e.target.value as 'low' | 'medium' | 'high',
                }))
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field label="Aspect ratio">
            <Input
              value={creative.aspectRatio ?? ''}
              onChange={(e) => setCreative((prev) => ({ ...prev, aspectRatio: e.target.value }))}
              placeholder="9:16"
            />
          </Field>
          <Field label="Story concept">
            <Input
              value={creative.storyConcept ?? ''}
              onChange={(e) =>
                setCreative((prev) => ({ ...prev, storyConcept: e.target.value }))
              }
            />
          </Field>
          <Field label="Custom creative instructions">
            <Input
              value={creative.customCreativeInstructions ?? ''}
              onChange={(e) =>
                setCreative((prev) => ({
                  ...prev,
                  customCreativeInstructions: e.target.value,
                }))
              }
            />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={creative.characterConsistencyRequired !== false}
            onChange={(e) =>
              setCreative((prev) => ({
                ...prev,
                characterConsistencyRequired: e.target.checked,
              }))
            }
          />
          Require character visual consistency
        </label>
      </section>

      <Button disabled={saveConfig.isPending} onClick={() => saveConfig.mutate()}>
        Save Series settings
      </Button>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">6. Lane configuration</h2>
        <p className="text-sm text-muted-foreground">
          Each lane has its own schedule, timezone, and creative overrides. New lanes default to
          Africa/Lagos.
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          {(lanesQuery.data ?? []).map((lane) => (
            <div key={lane.id} className="space-y-3 rounded-xl border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{lane.name}</h3>
                <Badge tone={statusTone(lane.status)}>{lane.status}</Badge>
              </div>
              <Field label="Name">
                <Input
                  value={laneDrafts[lane.id]?.name ?? ''}
                  onChange={(e) =>
                    setLaneDrafts((prev) => ({
                      ...prev,
                      [lane.id]: {
                        name: e.target.value,
                        publishTime: prev[lane.id]?.publishTime ?? lane.publishTime,
                        timezone: prev[lane.id]?.timezone ?? lane.timezone,
                        productionLeadTimeMinutes:
                          prev[lane.id]?.productionLeadTimeMinutes ??
                          String(lane.productionLeadTimeMinutes ?? 240),
                        preferredProductionTime:
                          prev[lane.id]?.preferredProductionTime ??
                          lane.preferredProductionTime ??
                          '',
                        productionStartMode:
                          prev[lane.id]?.productionStartMode ??
                          lane.productionStartMode ??
                          'NEXT_WINDOW',
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Publish time (HH:MM)">
                <Input
                  value={laneDrafts[lane.id]?.publishTime ?? ''}
                  onChange={(e) =>
                    setLaneDrafts((prev) => ({
                      ...prev,
                      [lane.id]: {
                        ...(prev[lane.id] ?? {
                          name: lane.name,
                          publishTime: lane.publishTime,
                          timezone: lane.timezone,
                          productionLeadTimeMinutes: String(lane.productionLeadTimeMinutes ?? 240),
                          preferredProductionTime: lane.preferredProductionTime ?? '',
                          productionStartMode: lane.productionStartMode ?? 'NEXT_WINDOW',
                        }),
                        publishTime: e.target.value,
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Timezone (IANA)">
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={laneDrafts[lane.id]?.timezone ?? 'Africa/Lagos'}
                  onChange={(e) =>
                    setLaneDrafts((prev) => ({
                      ...prev,
                      [lane.id]: {
                        ...(prev[lane.id] ?? {
                          name: lane.name,
                          publishTime: lane.publishTime,
                          timezone: lane.timezone,
                          productionLeadTimeMinutes: String(lane.productionLeadTimeMinutes ?? 240),
                          preferredProductionTime: lane.preferredProductionTime ?? '',
                          productionStartMode: lane.productionStartMode ?? 'NEXT_WINDOW',
                        }),
                        timezone: e.target.value,
                      },
                    }))
                  }
                >
                  <option value="Africa/Lagos">Africa/Lagos</option>
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">America/New_York</option>
                  <option value="Europe/London">Europe/London</option>
                  <option value="Asia/Dubai">Asia/Dubai</option>
                </select>
              </Field>
              <Field label="Production lead time (minutes)">
                <Input
                  value={laneDrafts[lane.id]?.productionLeadTimeMinutes ?? '240'}
                  onChange={(e) =>
                    setLaneDrafts((prev) => ({
                      ...prev,
                      [lane.id]: {
                        ...(prev[lane.id] ?? {
                          name: lane.name,
                          publishTime: lane.publishTime,
                          timezone: lane.timezone,
                          productionLeadTimeMinutes: '240',
                          preferredProductionTime: '',
                          productionStartMode: 'NEXT_WINDOW',
                        }),
                        productionLeadTimeMinutes: e.target.value,
                      },
                    }))
                  }
                />
              </Field>
              <Field label="Preferred production start (HH:MM, optional)">
                <Input
                  value={laneDrafts[lane.id]?.preferredProductionTime ?? ''}
                  placeholder="Derived from publish − lead"
                  onChange={(e) =>
                    setLaneDrafts((prev) => ({
                      ...prev,
                      [lane.id]: {
                        ...(prev[lane.id] ?? {
                          name: lane.name,
                          publishTime: lane.publishTime,
                          timezone: lane.timezone,
                          productionLeadTimeMinutes: '240',
                          preferredProductionTime: '',
                          productionStartMode: 'NEXT_WINDOW',
                        }),
                        preferredProductionTime: e.target.value,
                      },
                    }))
                  }
                />
              </Field>
              <Field label="When should media production begin?">
                <select
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={laneDrafts[lane.id]?.productionStartMode ?? 'NEXT_WINDOW'}
                  onChange={(e) =>
                    setLaneDrafts((prev) => ({
                      ...prev,
                      [lane.id]: {
                        ...(prev[lane.id] ?? {
                          name: lane.name,
                          publishTime: lane.publishTime,
                          timezone: lane.timezone,
                          productionLeadTimeMinutes: '240',
                          preferredProductionTime: '',
                          productionStartMode: 'NEXT_WINDOW',
                        }),
                        productionStartMode: e.target.value,
                      },
                    }))
                  }
                >
                  <option value="IMMEDIATE">Immediately after approval</option>
                  <option value="NEXT_WINDOW">At next scheduled production window</option>
                  <option value="CUSTOM">Custom date and time</option>
                  <option value="MANUAL">Manual start only</option>
                </select>
              </Field>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setLaneCreativeId(lane.id);
                  setLaneCreative(lane.creativeSettings ?? {});
                }}
              >
                Edit creative for this lane
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={saveLane.isPending}
                onClick={() => saveLane.mutate(lane)}
              >
                Save lane
              </Button>
            </div>
          ))}
        </div>

        {laneCreativeId ? (
          <div className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h3 className="font-medium">
              Lane creative —{' '}
              {(lanesQuery.data ?? []).find((l) => l.id === laneCreativeId)?.name ?? 'Lane'}
            </h3>
            <p className="text-xs text-muted-foreground">Genres</p>
            <div className="flex flex-wrap gap-2">
              {SERIES_GENRE_OPTIONS.map((genre) => (
                <button
                  key={genre}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs ${
                    (laneCreative.genres ?? []).includes(genre)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input'
                  }`}
                  onClick={() =>
                    toggleList(laneCreative.genres, genre, (genres) =>
                      setLaneCreative((prev) => ({ ...prev, genres })),
                    )
                  }
                >
                  {genre}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Themes</p>
            <div className="flex flex-wrap gap-2">
              {SERIES_THEME_OPTIONS.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  className={`rounded-md border px-2 py-1 text-xs ${
                    (laneCreative.themes ?? []).includes(theme)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-input'
                  }`}
                  onClick={() =>
                    toggleList(laneCreative.themes, theme, (themes) =>
                      setLaneCreative((prev) => ({ ...prev, themes })),
                    )
                  }
                >
                  {theme}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Audience">
                <Input
                  value={laneCreative.targetAudience ?? ''}
                  onChange={(e) =>
                    setLaneCreative((prev) => ({ ...prev, targetAudience: e.target.value }))
                  }
                />
              </Field>
              <Field label="Language">
                <Input
                  value={laneCreative.language ?? ''}
                  onChange={(e) =>
                    setLaneCreative((prev) => ({ ...prev, language: e.target.value }))
                  }
                  placeholder="en"
                />
              </Field>
              <Field label="Visual style">
                <Input
                  value={laneCreative.visualStyle ?? ''}
                  onChange={(e) =>
                    setLaneCreative((prev) => ({ ...prev, visualStyle: e.target.value }))
                  }
                />
              </Field>
              <Field label="Tone">
                <Input
                  value={laneCreative.tone ?? ''}
                  onChange={(e) => setLaneCreative((prev) => ({ ...prev, tone: e.target.value }))}
                />
              </Field>
            </div>
            <Field label="Story concept / creative instructions">
              <Input
                value={laneCreative.storyConcept ?? ''}
                onChange={(e) =>
                  setLaneCreative((prev) => ({ ...prev, storyConcept: e.target.value }))
                }
              />
            </Field>
            <Field label="Content exclusions">
              <Input
                value={(laneCreative.contentExclusions ?? []).join(', ')}
                onChange={(e) =>
                  setLaneCreative((prev) => ({
                    ...prev,
                    contentExclusions: e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
                placeholder="Comma-separated exclusions"
              />
            </Field>
            <Button
              size="sm"
              disabled={saveLane.isPending}
              onClick={() => {
                const lane = (lanesQuery.data ?? []).find((l) => l.id === laneCreativeId);
                if (lane) saveLane.mutate(lane);
              }}
            >
              Save lane creative
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
