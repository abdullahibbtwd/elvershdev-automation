import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

type View = 'day' | 'week' | 'month';

type Slot = {
  id: string;
  planId: string;
  plannedDate: string;
  slotIndex: number;
  ideaTitle?: string | null;
  ideaSummary?: string | null;
  category?: string | null;
  planStatus: string;
  scheduleStatus: string | null;
  generationStatus: string | null;
  renderingStatus: string | null;
  publishingStatus: Record<string, string>;
  scheduledGenerationAt: string | null;
  scheduledPublishAt: string | null;
  lastError?: string | null;
  publications: { id: string; platform: string; status: string; scheduledAt: string }[];
  actions: { canReschedule: boolean; canCancel: boolean; canTrigger: boolean; canPause: boolean };
};

type Calendar = {
  view: View;
  timezone: string;
  anchor: string;
  from: string;
  to: string;
  items: Slot[];
};

const fmt = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');

function shiftDate(anchor: string, view: View, dir: 1 | -1) {
  const date = new Date(`${anchor}T12:00:00Z`);
  if (view === 'month') date.setUTCMonth(date.getUTCMonth() + dir);
  else date.setUTCDate(date.getUTCDate() + dir * (view === 'week' ? 7 : 1));
  return date.toISOString().slice(0, 10);
}

export function AutomationCalendarPage() {
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>('week');
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['automation', 'calendar', view, date],
    queryFn: async () =>
      (await api.get('/automation/calendar', { params: { view, date } })).data.data as Calendar,
  });

  const action = useMutation({
    mutationFn: async (vars: { id: string; name: string; body?: object }) =>
      api.post(`/automation/calendar/${vars.id}/${vars.name}`, vars.body),
    onSuccess: (_, vars) => {
      toast.success(`Slot ${vars.name} succeeded`);
      void queryClient.invalidateQueries({ queryKey: ['automation'] });
    },
    onError: (_, vars) => toast.error(`Slot ${vars.name} failed`),
  });

  const reschedule = (slot: Slot) => {
    const gen = window.prompt(
      'New generation time (ISO datetime, e.g. 2026-11-20T09:00:00Z)',
      slot.scheduledGenerationAt ?? '',
    );
    if (!gen) return;
    const pub = window.prompt(
      'New publish time (ISO datetime, leave empty for generation + 60 min)',
      slot.scheduledPublishAt ?? '',
    );
    const toIso = (value: string) => new Date(value).toISOString();
    try {
      action.mutate({
        id: slot.id,
        name: 'reschedule',
        body: {
          scheduledGenerationAt: toIso(gen),
          ...(pub ? { scheduledPublishAt: toIso(pub) } : {}),
        },
      });
    } catch {
      toast.error('Invalid datetime');
    }
  };

  const items = data?.items ?? [];
  const grouped = items.reduce<Record<string, Slot[]>>((acc, slot) => {
    const key = slot.plannedDate.slice(0, 10);
    (acc[key] ??= []).push(slot);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Automation Calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {data ? `${data.from} → ${data.to} (${data.timezone})` : 'Planned content slots.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['day', 'week', 'month'] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? 'default' : 'outline'}
              onClick={() => setView(v)}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </Button>
          ))}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDate(shiftDate(date, view, -1))}
            aria-label="Previous"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDate(new Date().toISOString().slice(0, 10))}
          >
            Today
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setDate(shiftDate(date, view, 1))}
            aria-label="Next"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load calendar" onRetry={() => void refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No scheduled content"
          description="No slots in this range. Enable automation or use Run Now from the dashboard."
        />
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([day, slots]) => (
            <section key={day} className="space-y-3">
              <h2 className="text-sm font-semibold text-foreground">
                {new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
                  weekday: 'long',
                  month: 'short',
                  day: 'numeric',
                  timeZone: 'UTC',
                })}
              </h2>
              {slots.map((slot) => (
                <div key={slot.id} className="rounded-xl border border-border bg-card px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-medium">
                        {slot.ideaTitle || `Slot ${slot.slotIndex + 1}`}
                        {slot.category && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            {slot.category}
                          </span>
                        )}
                      </div>
                      {slot.ideaSummary && (
                        <p className="mt-1 text-sm text-muted-foreground">{slot.ideaSummary}</p>
                      )}
                      <div className="mt-2 text-xs text-muted-foreground">
                        Generate: {fmt(slot.scheduledGenerationAt)} · Publish:{' '}
                        {fmt(slot.scheduledPublishAt)}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone={statusTone(slot.planStatus)}>Plan {slot.planStatus}</Badge>
                        {slot.generationStatus && (
                          <Badge tone={statusTone(slot.scheduleStatus ?? '')}>
                            Gen {slot.generationStatus}
                          </Badge>
                        )}
                        {slot.renderingStatus && (
                          <Badge tone={statusTone(slot.renderingStatus)}>
                            Render {slot.renderingStatus}
                          </Badge>
                        )}
                        {Object.entries(slot.publishingStatus).map(([platform, status]) => (
                          <Badge key={platform} tone={statusTone(status)}>
                            {platform} {status}
                          </Badge>
                        ))}
                      </div>
                      {slot.publications.length > 0 && (
                        <div className="mt-2 text-xs text-muted-foreground">
                          {slot.publications
                            .map((p) => `${p.platform} @ ${fmt(p.scheduledAt)}`)
                            .join(' · ')}
                        </div>
                      )}
                      {slot.lastError && (
                        <p className="mt-2 text-sm text-destructive">{slot.lastError}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      {slot.actions.canReschedule && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() => reschedule(slot)}
                        >
                          Reschedule
                        </Button>
                      )}
                      {slot.actions.canTrigger && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() => action.mutate({ id: slot.id, name: 'trigger' })}
                        >
                          Trigger
                        </Button>
                      )}
                      {slot.actions.canPause && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={action.isPending}
                          onClick={() => action.mutate({ id: slot.id, name: 'pause' })}
                        >
                          Pause
                        </Button>
                      )}
                      {slot.actions.canCancel && (
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={action.isPending}
                          onClick={() => {
                            if (window.confirm('Cancel this scheduled slot?'))
                              action.mutate({ id: slot.id, name: 'cancel' });
                          }}
                        >
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
