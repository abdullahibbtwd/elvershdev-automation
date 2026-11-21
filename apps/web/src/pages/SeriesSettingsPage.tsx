import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { SettingsSection } from '@/components/ui/settings-section';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
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

type SettingsTab = 'studio' | 'automation' | 'production' | 'creative' | 'lanes';

type LaneDraft = {
  name: string;
  publishTime: string;
  timezone: string;
  productionLeadTimeMinutes: string;
  preferredProductionTime: string;
  productionStartMode: string;
  plannedEpisodeCount: string;
  targetEpisodeDurationSeconds: string;
  targetStoryDurationSeconds: string;
  maxClipDurationSeconds: string;
  replacementTriggerEpisode: string;
};

const CORE_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  { key: 'seriesStudioEnabled', label: 'Series Studio enabled' },
  { key: 'morningLaneEnabled', label: 'Morning lane enabled' },
  { key: 'eveningLaneEnabled', label: 'Evening lane enabled' },
];

const MASTER_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  {
    key: 'automaticEpisodeProduction',
    label: 'Automatic episode production',
    hint: 'Scripts + media. Individual advanced stages must also be on.',
  },
  {
    key: 'automaticMoviePlanning',
    label: 'Automatic movie planning',
    hint: 'Plans a new movie when a lane needs one. Manual Plan Movie always works.',
  },
  {
    key: 'automaticPublishing',
    label: 'Automatic publishing',
    hint: 'Publishes completed episodes at the lane publish time.',
  },
  {
    key: 'automaticReplacementPlanning',
    label: 'Automatic replacement planning',
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
    hint: 'Default off — keep a human gate for replacement movies.',
  },
];

const ADVANCED_STAGE_TOGGLES: Array<{ key: keyof SeriesConfig; label: string; hint?: string }> = [
  { key: 'automaticCharacterGeneration', label: 'Automatic character generation' },
  { key: 'automaticEpisodeScriptGeneration', label: 'Automatic episode scripts' },
  {
    key: 'automaticVisualGeneration',
    label: 'Automatic visuals',
    hint: 'If off while production is on, runs stop before visuals.',
  },
  {
    key: 'automaticMotionGeneration',
    label: 'Automatic motion',
    hint: 'If off, runs stop before motion (nothing is skipped silently).',
  },
  { key: 'automaticNarration', label: 'Automatic narration' },
  { key: 'automaticRendering', label: 'Automatic rendering' },
  {
    key: 'startMediaAfterMoviePlanning',
    label: 'Start media after movie planning',
    hint: 'Default off — keeps planning separate from credit spend.',
  },
];

const ALL_TOGGLE_KEYS = [
  ...CORE_TOGGLES,
  ...MASTER_TOGGLES,
  ...APPROVAL_TOGGLES,
  ...ADVANCED_STAGE_TOGGLES,
].map((t) => t.key);

const STORY_DURATION_PRESETS = [
  { value: '', label: 'Legacy (count × episode)' },
  { value: '300', label: '5 min' },
  { value: '600', label: '10 min' },
  { value: '900', label: '15 min' },
  { value: '1200', label: '20 min' },
  { value: '1800', label: '30 min' },
];

const TIMEZONE_OPTIONS = [
  { value: 'Africa/Lagos', label: 'Africa/Lagos' },
  { value: 'UTC', label: 'UTC' },
  { value: 'America/New_York', label: 'America/New_York' },
  { value: 'Europe/London', label: 'Europe/London' },
  { value: 'Asia/Dubai', label: 'Asia/Dubai' },
];

const START_MODE_OPTIONS = [
  { value: 'IMMEDIATE', label: 'Immediately after approval' },
  { value: 'NEXT_WINDOW', label: 'At next scheduled window' },
  { value: 'CUSTOM', label: 'Custom date and time' },
  { value: 'MANUAL', label: 'Manual start only' },
];

function emptyLaneDraft(lane: SeriesLane): LaneDraft {
  return {
    name: lane.name,
    publishTime: lane.publishTime,
    timezone: lane.timezone,
    productionLeadTimeMinutes: String(lane.productionLeadTimeMinutes ?? 240),
    preferredProductionTime: lane.preferredProductionTime ?? '',
    productionStartMode: lane.productionStartMode ?? 'NEXT_WINDOW',
    plannedEpisodeCount: String(lane.plannedEpisodeCount ?? 10),
    targetEpisodeDurationSeconds: String(lane.targetEpisodeDurationSeconds ?? 60),
    targetStoryDurationSeconds:
      lane.targetStoryDurationSeconds == null ? '' : String(lane.targetStoryDurationSeconds),
    maxClipDurationSeconds: String(lane.maxClipDurationSeconds ?? 15),
    replacementTriggerEpisode: String(lane.replacementTriggerEpisode ?? 8),
  };
}

export function SeriesSettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<SettingsTab>('studio');
  const [toggles, setToggles] = useState<Partial<Record<keyof SeriesConfig, boolean>>>({});
  const [form, setForm] = useState<Record<string, string>>({});
  const [channels, setChannels] = useState<Record<string, boolean>>({});
  const [laneDrafts, setLaneDrafts] = useState<Record<string, LaneDraft>>({});
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
      defaultStoryDurationSeconds:
        data.defaultStoryDurationSeconds == null ? '' : String(data.defaultStoryDurationSeconds),
      defaultMaxClipDurationSeconds: String(data.defaultMaxClipDurationSeconds ?? 15),
      defaultProductionFormat: data.defaultProductionFormat ?? 'episodic',
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
    setLaneDrafts(Object.fromEntries(lanes.map((lane) => [lane.id, emptyLaneDraft(lane)])));
    if (!laneCreativeId && lanes[0]) {
      setLaneCreativeId(lanes[0].id);
      setLaneCreative(lanes[0].creativeSettings ?? {});
    }
  }, [lanesQuery.data, laneCreativeId]);

  const setToggle = (key: keyof SeriesConfig, value: boolean) =>
    setToggles((prev) => ({ ...prev, [key]: value }));

  const patchLaneDraft = (lane: SeriesLane, patch: Partial<LaneDraft>) =>
    setLaneDrafts((prev) => ({
      ...prev,
      [lane.id]: { ...(prev[lane.id] ?? emptyLaneDraft(lane)), ...patch },
    }));

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
        defaultStoryDurationSeconds: nullableNum('defaultStoryDurationSeconds') as number | null,
        defaultMaxClipDurationSeconds: num('defaultMaxClipDurationSeconds'),
        defaultProductionFormat: (form.defaultProductionFormat === 'standalone'
          ? 'standalone'
          : 'episodic') as 'episodic' | 'standalone',
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
        creativeSettings: {
          ...creative,
          episodeDurationSeconds: num('defaultEpisodeDurationSeconds'),
          storyDurationSeconds: nullableNum('defaultStoryDurationSeconds') ?? undefined,
          maxClipDurationSeconds: num('defaultMaxClipDurationSeconds'),
          productionFormat:
            form.defaultProductionFormat === 'standalone' ? 'standalone' : 'episodic',
          episodesPerMovie: num('defaultPlannedEpisodeCount'),
        },
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
      const plannedEpisodeCount = draft?.plannedEpisodeCount
        ? Number(draft.plannedEpisodeCount)
        : undefined;
      const replacementTriggerEpisode = draft?.replacementTriggerEpisode
        ? Number(draft.replacementTriggerEpisode)
        : undefined;
      return seriesApi.updateLane(lane.id, {
        name: draft?.name,
        publishTime: draft?.publishTime,
        timezone: draft?.timezone,
        productionLeadTimeMinutes: draft?.productionLeadTimeMinutes
          ? Number(draft.productionLeadTimeMinutes)
          : undefined,
        preferredProductionTime: draft?.preferredProductionTime?.trim() || null,
        productionStartMode: draft?.productionStartMode || undefined,
        plannedEpisodeCount,
        targetEpisodeDurationSeconds: draft?.targetEpisodeDurationSeconds
          ? Number(draft.targetEpisodeDurationSeconds)
          : undefined,
        targetStoryDurationSeconds: draft?.targetStoryDurationSeconds?.trim()
          ? Number(draft.targetStoryDurationSeconds)
          : null,
        maxClipDurationSeconds: draft?.maxClipDurationSeconds
          ? Number(draft.maxClipDurationSeconds)
          : undefined,
        replacementTriggerEpisode,
        ...(lane.id === laneCreativeId
          ? {
              creativeSettings: {
                ...laneCreative,
                // Series Studio is Grok-only for all lanes — never persist fal/narration mode.
                dialogueDrivenStorytelling: true,
                narrationPreference: laneCreative.narrationPreference ?? 'avoid',
                aspectRatio: '9:16',
                visualStyle:
                  laneCreative.visualStyle?.trim() ||
                  'Stylized cinematic 3D cartoon animation (Pixar/DreamWorks-like). Expressive cartoon faces, clean readable designs, consistent character model sheets. NOT photorealistic live-action humans.',
              },
            }
          : {}),
      });
    },
    onSuccess: (_, lane) => {
      toast.success(`${lane.name} saved`);
      void queryClient.invalidateQueries({ queryKey: ['series', 'lanes'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { error?: { message?: string }; message?: string } } })
          ?.response?.data?.error?.message ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        (err as Error)?.message ||
        'Failed to save lane';
      toast.error(String(message));
    },
  });

  if (configQuery.isLoading || lanesQuery.isLoading) return <LoadingState />;
  if (configQuery.error || !configQuery.data) {
    return (
      <ErrorState
        message="Failed to load Series settings"
        onRetry={() => void configQuery.refetch()}
      />
    );
  }

  const config = configQuery.data;
  const lanes = lanesQuery.data ?? [];
  const stageWarning =
    toggles.automaticEpisodeProduction &&
    (!toggles.automaticVisualGeneration ||
      !toggles.automaticMotionGeneration ||
      !toggles.automaticNarration ||
      !toggles.automaticRendering);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Series settings"
        description="Turn the studio on, set how it runs, then tune production and creative defaults."
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
        <Badge tone={statusTone(config.runMode)}>{config.runMode}</Badge>
        <Badge tone={config.seriesStudioEnabled ? 'success' : 'warning'}>
          {config.seriesStudioEnabled ? 'Studio on' : 'Studio off'}
        </Badge>
        <Badge tone={autonomyMode === 'FULLY_AUTONOMOUS' ? 'success' : 'default'}>
          {autonomyMode === 'FULLY_AUTONOMOUS' ? 'Fully autonomous' : 'Manual mode'}
        </Badge>
      </div>

      <ChoiceGroup
        value={tab}
        onChange={(value) => setTab(value as SettingsTab)}
        options={[
          { value: 'studio', label: 'Studio' },
          { value: 'automation', label: 'Automation' },
          { value: 'production', label: 'Production' },
          { value: 'creative', label: 'Creative' },
          { value: 'lanes', label: 'Lanes' },
        ]}
      />

      {tab === 'studio' ? (
        <div className="space-y-4">
          <SettingsSection
            title="Studio power"
            description="Enable Series Studio and the Morning / Evening lanes."
          >
            <div className="space-y-2">
              {CORE_TOGGLES.map(({ key, label, hint }) => (
                <Switch
                  key={key}
                  checked={Boolean(toggles[key])}
                  onCheckedChange={(v) => setToggle(key, v)}
                  label={label}
                  description={hint}
                />
              ))}
            </div>
          </SettingsSection>

          <SettingsSection
            title="Autonomy"
            description="Fully autonomous plans, produces, validates, and publishes without routine human approval. Separate from mock AI."
          >
            <ChoiceGroup
              variant="cards"
              value={autonomyMode}
              onChange={(value) => setAutonomyMode(value as 'MANUAL' | 'FULLY_AUTONOMOUS')}
              options={[
                {
                  value: 'MANUAL',
                  label: 'Manual mode',
                  description: 'Keep movie, episode, and replacement approval gates.',
                },
                {
                  value: 'FULLY_AUTONOMOUS',
                  label: 'Fully autonomous',
                  description: 'Skip routine approvals. Emergency stop, budgets, and quality still apply.',
                },
              ]}
            />
            {autonomyMode === 'FULLY_AUTONOMOUS' ? (
              <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm">
                Autonomy overrides routine approvals. Switch back to Manual anytime — your stored
                gates are preserved.
              </p>
            ) : null}
          </SettingsSection>
        </div>
      ) : null}

      {tab === 'automation' ? (
        <div className="space-y-4">
          <SettingsSection
            title="What runs automatically"
            description="Production builds media. Publishing is independent — finished episodes can wait as ready-to-publish."
          >
            <div className="space-y-2">
              {MASTER_TOGGLES.map(({ key, label, hint }) => (
                <Switch
                  key={key}
                  checked={Boolean(toggles[key])}
                  onCheckedChange={(v) => setToggle(key, v)}
                  label={label}
                  description={hint}
                />
              ))}
            </div>
            {stageWarning ? (
              <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
                Episode production is on, but a media stage is off. Runs stop at the first disabled
                stage.
              </p>
            ) : null}
          </SettingsSection>

          {autonomyMode === 'MANUAL' ? (
            <SettingsSection
              title="Approvals"
              description="Human gates while Manual mode is active."
            >
              <div className="space-y-2">
                {APPROVAL_TOGGLES.map(({ key, label, hint }) => (
                  <Switch
                    key={key}
                    checked={Boolean(toggles[key])}
                    onCheckedChange={(v) => setToggle(key, v)}
                    label={label}
                    description={hint}
                  />
                ))}
              </div>
            </SettingsSection>
          ) : (
            <SettingsSection title="Approvals">
              <p className="text-sm text-muted-foreground">
                Routine approvals are automatic in Fully Autonomous mode. Switch to Manual on the
                Studio tab to restore human gates.
              </p>
            </SettingsSection>
          )}

          <SettingsSection
            title="Advanced stages"
            description="Safeties for individual pipeline stages. The production master switch never overrides a disabled stage."
            action={
              <Button size="sm" variant="outline" type="button" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? 'Hide' : 'Show'}
              </Button>
            }
          >
            {showAdvanced ? (
              <div className="space-y-2">
                {ADVANCED_STAGE_TOGGLES.map(({ key, label, hint }) => (
                  <Switch
                    key={key}
                    checked={Boolean(toggles[key])}
                    onCheckedChange={(v) => setToggle(key, v)}
                    label={label}
                    description={hint}
                  />
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">Hidden by default to keep this page focused.</p>
            )}
          </SettingsSection>
        </div>
      ) : null}

      {tab === 'production' ? (
        <div className="space-y-4">
          <SettingsSection
            title="Format & duration"
            description="Movie length, episode length, and clip length are independent. Clips stay ≤15s for Grok Lite."
          >
            <FormField label="Production format">
              <ChoiceGroup
                value={form.defaultProductionFormat ?? 'episodic'}
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, defaultProductionFormat: value }))
                }
                options={[
                  { value: 'episodic', label: 'Episodic series' },
                  { value: 'standalone', label: 'Standalone movie' },
                ]}
              />
            </FormField>

            <FormField
              label="Complete story / movie duration"
              hint="Leave empty for legacy: episode count × episode duration."
            >
              <ChoiceGroup
                size="sm"
                value={form.defaultStoryDurationSeconds ?? ''}
                onChange={(value) =>
                  setForm((prev) => ({ ...prev, defaultStoryDurationSeconds: value }))
                }
                options={STORY_DURATION_PRESETS}
              />
              <Input
                className="mt-2"
                value={form.defaultStoryDurationSeconds ?? ''}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, defaultStoryDurationSeconds: e.target.value }))
                }
                placeholder="Custom seconds, e.g. 600"
              />
            </FormField>

            <div className="grid gap-4 sm:grid-cols-2">
              <FormField
                label="Episode duration (seconds)"
                hint="For a 60s movie with 2 episodes, set this to 30 (or set story + episode count and we fit them)."
              >
                <Input
                  value={form.defaultEpisodeDurationSeconds ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultEpisodeDurationSeconds: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField
                label="Episode count"
                hint="With story duration set, Plan Movie fits this many episodes into the movie (e.g. 60s ÷ 2 = 30s each)."
              >
                <Input
                  value={form.defaultPlannedEpisodeCount ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, defaultPlannedEpisodeCount: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Max clip duration (seconds)" hint="Grok Lite hard cap is 15.">
                <Input
                  value={form.defaultMaxClipDurationSeconds ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultMaxClipDurationSeconds: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Replacement trigger episode">
                <Input
                  value={form.defaultReplacementTriggerEpisode ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultReplacementTriggerEpisode: e.target.value,
                    }))
                  }
                />
              </FormField>
            </div>
          </SettingsSection>

          <SettingsSection title="Quality & schedule defaults">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Max concurrent production">
                <Input
                  value={form.maxConcurrentEpisodeProduction ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      maxConcurrentEpisodeProduction: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Max retries">
                <Input
                  value={form.maxRetries ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, maxRetries: e.target.value }))}
                />
              </FormField>
              <FormField
                label="Quality threshold"
                hint="Pass when score ≥ this value (0–1)."
              >
                <Input
                  value={form.qualityAcceptanceThreshold ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, qualityAcceptanceThreshold: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Default lead time (minutes)">
                <Input
                  value={form.defaultProductionLeadTimeMinutes ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultProductionLeadTimeMinutes: e.target.value,
                    }))
                  }
                />
              </FormField>
              <FormField label="Default production start">
                <Select
                  value={form.defaultProductionStartMode ?? 'NEXT_WINDOW'}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      defaultProductionStartMode: e.target.value,
                    }))
                  }
                  options={START_MODE_OPTIONS}
                />
              </FormField>
              <FormField label="Language">
                <Input
                  value={form.language ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, language: e.target.value }))}
                />
              </FormField>
              <FormField label="Tone">
                <Input
                  value={form.tone ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, tone: e.target.value }))}
                />
              </FormField>
              <FormField label="Visual direction">
                <Input
                  value={form.visualDirection ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, visualDirection: e.target.value }))
                  }
                />
              </FormField>
            </div>
          </SettingsSection>

          <SettingsSection title="Budgets & channels">
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Daily budget USD">
                <Input
                  value={form.dailyBudgetUsd ?? ''}
                  onChange={(e) => setForm((prev) => ({ ...prev, dailyBudgetUsd: e.target.value }))}
                />
              </FormField>
              <FormField label="Monthly budget USD">
                <Input
                  value={form.monthlyBudgetUsd ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, monthlyBudgetUsd: e.target.value }))
                  }
                />
              </FormField>
              <FormField label="Max cost per episode USD">
                <Input
                  value={form.maxCostPerEpisodeUsd ?? ''}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, maxCostPerEpisodeUsd: e.target.value }))
                  }
                />
              </FormField>
            </div>
            <FormField label="Publish channels">
              <ChoiceGroup
                multiple
                value={PLATFORMS.filter((p) => channels[p] !== false)}
                onChange={(selected) =>
                  setChannels(
                    Object.fromEntries(PLATFORMS.map((p) => [p, selected.includes(p)])),
                  )
                }
                options={PLATFORMS.map((platform) => ({
                  value: platform,
                  label: platform.charAt(0) + platform.slice(1).toLowerCase(),
                }))}
              />
            </FormField>
          </SettingsSection>
        </div>
      ) : null}

      {tab === 'creative' ? (
        <SettingsSection
          title="Creative defaults"
          description="Select genres, themes, and style — Plan Movie invents a fresh story from those choices. Lane settings override these; movies freeze values at generation time."
        >
          <FormField label="Genres">
            <ChoiceGroup
              multiple
              size="sm"
              value={creative.genres ?? []}
              onChange={(genres) => setCreative((prev) => ({ ...prev, genres }))}
              options={SERIES_GENRE_OPTIONS.map((genre) => ({ value: genre, label: genre }))}
            />
          </FormField>
          <FormField label="Themes">
            <ChoiceGroup
              multiple
              size="sm"
              value={creative.themes ?? []}
              onChange={(themes) => setCreative((prev) => ({ ...prev, themes }))}
              options={SERIES_THEME_OPTIONS.map((theme) => ({ value: theme, label: theme }))}
            />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Target audience">
              <Input
                value={creative.targetAudience ?? ''}
                onChange={(e) =>
                  setCreative((prev) => ({ ...prev, targetAudience: e.target.value }))
                }
              />
            </FormField>
            <FormField label="Dialogue style">
              <Input
                value={creative.dialogueStyle ?? ''}
                onChange={(e) =>
                  setCreative((prev) => ({ ...prev, dialogueStyle: e.target.value }))
                }
                placeholder="Simple everyday spoken English"
              />
            </FormField>
            <FormField label="Cliffhanger intensity">
              <ChoiceGroup
                value={creative.cliffhangerIntensity ?? 'medium'}
                onChange={(value) =>
                  setCreative((prev) => ({
                    ...prev,
                    cliffhangerIntensity: value as 'low' | 'medium' | 'high',
                  }))
                }
                options={[
                  { value: 'low', label: 'Low' },
                  { value: 'medium', label: 'Medium' },
                  { value: 'high', label: 'High' },
                ]}
              />
            </FormField>
            <FormField
              label="Aspect ratio"
              hint="Series Studio is locked to TikTok / YouTube Shorts vertical 9:16."
            >
              <ChoiceGroup
                value="9:16"
                onChange={() => setCreative((prev) => ({ ...prev, aspectRatio: '9:16' }))}
                options={[{ value: '9:16', label: '9:16 (TikTok / YouTube Shorts)' }]}
              />
            </FormField>
          </div>
          <FormField
            label="Story concept (optional)"
            hint="Leave empty so Plan Movie invents a fresh story from your selected genres and themes. Only fill this if you want a soft inspiration seed — it will not lock every movie to one plot."
          >
            <Textarea
              value={creative.storyConcept ?? ''}
              onChange={(e) => setCreative((prev) => ({ ...prev, storyConcept: e.target.value }))}
              rows={3}
              placeholder="Leave empty for automatic stories from genres/themes"
            />
          </FormField>
          <FormField label="Custom creative instructions">
            <Textarea
              value={creative.customCreativeInstructions ?? ''}
              onChange={(e) =>
                setCreative((prev) => ({
                  ...prev,
                  customCreativeInstructions: e.target.value,
                }))
              }
              rows={3}
              placeholder="Avoid purple prose. Write like a modern Netflix drama."
            />
          </FormField>
          <Switch
            checked={creative.characterConsistencyRequired !== false}
            onCheckedChange={(v) =>
              setCreative((prev) => ({ ...prev, characterConsistencyRequired: v }))
            }
            label="Require character visual consistency"
          />
        </SettingsSection>
      ) : null}

      {tab === 'lanes' ? (
        <div className="space-y-4">
          <SettingsSection
            title="Lane schedules & production"
            description="Each lane has its own schedule and production defaults (episode count, durations, replacement trigger). Global Production settings are defaults; lane values win for that lane."
          >
            <div className="grid gap-4 lg:grid-cols-2">
              {lanes.map((lane) => {
                const draft = laneDrafts[lane.id] ?? emptyLaneDraft(lane);
                return (
                  <div
                    key={lane.id}
                    className="space-y-3 rounded-xl border border-border bg-background/40 p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-medium">{lane.name}</h3>
                      <Badge tone={statusTone(lane.status)}>
                        {lane.status === 'PAUSED' ? 'Paused' : lane.status}
                      </Badge>
                    </div>
                    <FormField label="Name">
                      <Input
                        value={draft.name}
                        onChange={(e) => patchLaneDraft(lane, { name: e.target.value })}
                      />
                    </FormField>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField label="Publish time" hint="HH:MM">
                        <Input
                          value={draft.publishTime}
                          onChange={(e) => patchLaneDraft(lane, { publishTime: e.target.value })}
                        />
                      </FormField>
                      <FormField label="Timezone">
                        <Select
                          value={draft.timezone}
                          onChange={(e) => patchLaneDraft(lane, { timezone: e.target.value })}
                          options={TIMEZONE_OPTIONS}
                        />
                      </FormField>
                      <FormField label="Lead time (minutes)">
                        <Input
                          value={draft.productionLeadTimeMinutes}
                          onChange={(e) =>
                            patchLaneDraft(lane, { productionLeadTimeMinutes: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField label="Preferred start" hint="Optional HH:MM">
                        <Input
                          value={draft.preferredProductionTime}
                          placeholder="From publish − lead"
                          onChange={(e) =>
                            patchLaneDraft(lane, { preferredProductionTime: e.target.value })
                          }
                        />
                      </FormField>
                    </div>
                    <FormField label="When production begins">
                      <Select
                        value={draft.productionStartMode}
                        onChange={(e) =>
                          patchLaneDraft(lane, { productionStartMode: e.target.value })
                        }
                        options={START_MODE_OPTIONS}
                      />
                    </FormField>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <FormField label="Episode count">
                        <Input
                          value={draft.plannedEpisodeCount}
                          onChange={(e) =>
                            patchLaneDraft(lane, { plannedEpisodeCount: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField label="Episode duration (s)">
                        <Input
                          value={draft.targetEpisodeDurationSeconds}
                          onChange={(e) =>
                            patchLaneDraft(lane, {
                              targetEpisodeDurationSeconds: e.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Story duration (s)" hint="Optional complete movie length">
                        <Input
                          value={draft.targetStoryDurationSeconds}
                          placeholder="e.g. 60"
                          onChange={(e) =>
                            patchLaneDraft(lane, {
                              targetStoryDurationSeconds: e.target.value,
                            })
                          }
                        />
                      </FormField>
                      <FormField label="Max clip (s)" hint="Grok Lite ≤15">
                        <Input
                          value={draft.maxClipDurationSeconds}
                          onChange={(e) =>
                            patchLaneDraft(lane, { maxClipDurationSeconds: e.target.value })
                          }
                        />
                      </FormField>
                      <FormField
                        label="Replacement trigger episode"
                        hint="Must be ≤ episode count"
                      >
                        <Input
                          value={draft.replacementTriggerEpisode}
                          onChange={(e) =>
                            patchLaneDraft(lane, {
                              replacementTriggerEpisode: e.target.value,
                            })
                          }
                        />
                      </FormField>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={laneCreativeId === lane.id ? 'default' : 'outline'}
                        onClick={() => {
                          setLaneCreativeId(lane.id);
                          setLaneCreative(lane.creativeSettings ?? {});
                        }}
                      >
                        Edit creative
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
                  </div>
                );
              })}
            </div>
          </SettingsSection>

          {laneCreativeId ? (
            <SettingsSection
              title={`Creative — ${lanes.find((l) => l.id === laneCreativeId)?.name ?? 'Lane'}`}
              description="Overrides global creative defaults for this lane only."
            >
              <FormField label="Genres">
                <ChoiceGroup
                  multiple
                  size="sm"
                  value={laneCreative.genres ?? []}
                  onChange={(genres) => setLaneCreative((prev) => ({ ...prev, genres }))}
                  options={SERIES_GENRE_OPTIONS.map((genre) => ({ value: genre, label: genre }))}
                />
              </FormField>
              <FormField label="Themes">
                <ChoiceGroup
                  multiple
                  size="sm"
                  value={laneCreative.themes ?? []}
                  onChange={(themes) => setLaneCreative((prev) => ({ ...prev, themes }))}
                  options={SERIES_THEME_OPTIONS.map((theme) => ({ value: theme, label: theme }))}
                />
              </FormField>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Audience">
                  <Input
                    value={laneCreative.targetAudience ?? ''}
                    onChange={(e) =>
                      setLaneCreative((prev) => ({ ...prev, targetAudience: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Language">
                  <Input
                    value={laneCreative.language ?? ''}
                    onChange={(e) =>
                      setLaneCreative((prev) => ({ ...prev, language: e.target.value }))
                    }
                    placeholder="en"
                  />
                </FormField>
                <FormField
                  label="Visual style"
                  hint="Locked default is stylized 3D cartoon (not photoreal humans). Character reference stills are generated at Plan Movie and reused on every Grok clip."
                >
                  <Textarea
                    value={laneCreative.visualStyle ?? ''}
                    onChange={(e) =>
                      setLaneCreative((prev) => ({ ...prev, visualStyle: e.target.value }))
                    }
                    rows={3}
                    placeholder="Stylized cinematic 3D cartoon (Pixar/DreamWorks-like)…"
                  />
                </FormField>
                <FormField label="Tone">
                  <Input
                    value={laneCreative.tone ?? ''}
                    onChange={(e) =>
                      setLaneCreative((prev) => ({ ...prev, tone: e.target.value }))
                    }
                  />
                </FormField>
                <FormField label="Dialogue density">
                  <ChoiceGroup
                    value={laneCreative.dialogueDensity ?? 'high'}
                    onChange={(value) =>
                      setLaneCreative((prev) => ({
                        ...prev,
                        dialogueDensity: value as SeriesCreativeSettings['dialogueDensity'],
                      }))
                    }
                    options={[
                      { value: 'low', label: 'Low' },
                      { value: 'medium', label: 'Medium' },
                      { value: 'high', label: 'High' },
                    ]}
                  />
                </FormField>
                <FormField label="Narration">
                  <ChoiceGroup
                    value={laneCreative.narrationPreference ?? 'avoid'}
                    onChange={(value) =>
                      setLaneCreative((prev) => ({
                        ...prev,
                        narrationPreference:
                          value as SeriesCreativeSettings['narrationPreference'],
                      }))
                    }
                    options={[
                      { value: 'avoid', label: 'Avoid' },
                      { value: 'allowed', label: 'Allowed' },
                      { value: 'required', label: 'Required' },
                    ]}
                  />
                </FormField>
              </div>
              <div className="space-y-2">
                <Switch
                  checked
                  disabled
                  onCheckedChange={() => undefined}
                  label="Dialogue-driven storytelling"
                  description="Always on for every lane (morning, evening, custom). Grok clips only — fal / Hailuo narration path removed from Series Studio."
                />
                <Switch
                  checked={laneCreative.lipSyncRequired !== false}
                  onCheckedChange={(v) =>
                    setLaneCreative((prev) => ({ ...prev, lipSyncRequired: v }))
                  }
                  label="Require lip-sync for speaking shots"
                />
                <Switch
                  checked={laneCreative.subtitlePreference !== false}
                  onCheckedChange={(v) =>
                    setLaneCreative((prev) => ({ ...prev, subtitlePreference: v }))
                  }
                  label="Generate dialogue subtitles"
                />
              </div>
              <FormField
                label="Story concept (optional)"
                hint="Leave empty to auto-generate from this lane’s genres and themes. Clear any old fixed premise if you want variety."
              >
                <Textarea
                  value={laneCreative.storyConcept ?? ''}
                  onChange={(e) =>
                    setLaneCreative((prev) => ({ ...prev, storyConcept: e.target.value }))
                  }
                  rows={3}
                  placeholder="Leave empty for automatic stories from genres/themes"
                />
              </FormField>
              <FormField label="Content exclusions" hint="Comma-separated.">
                <Textarea
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
                  rows={2}
                />
              </FormField>
              <Button
                disabled={saveLane.isPending}
                onClick={() => {
                  const lane = lanes.find((l) => l.id === laneCreativeId);
                  if (lane) saveLane.mutate(lane);
                }}
              >
                Save lane creative
              </Button>
            </SettingsSection>
          ) : null}
        </div>
      ) : null}

      {tab !== 'lanes' ? (
        <div className="sticky bottom-4 z-20 flex items-center justify-between gap-3 rounded-xl border border-border bg-card/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="hidden text-sm text-muted-foreground sm:block">
            Changes on this tab save together.
          </p>
          <Button className="ml-auto" disabled={saveConfig.isPending} onClick={() => saveConfig.mutate()}>
            {saveConfig.isPending ? 'Saving…' : 'Save Series settings'}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
