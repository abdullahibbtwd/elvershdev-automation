import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';

export function SettingsPage() {
  const queryClient = useQueryClient();
  const [defaultAspectRatio, setDefaultAspectRatio] = useState('9:16');
  const [preferredLanguage, setPreferredLanguage] = useState('en');
  const [emailNotifications, setEmailNotifications] = useState(true);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const res = await api.get('/settings');
      return res.data.data;
    },
  });

  useEffect(() => {
    if (data) {
      setDefaultAspectRatio(data.defaultAspectRatio ?? '9:16');
      setPreferredLanguage(data.preferredLanguage ?? 'en');
      setEmailNotifications(Boolean(data.emailNotifications));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () =>
      api.patch('/settings', {
        defaultAspectRatio,
        preferredLanguage,
        emailNotifications,
      }),
    onSuccess: () => {
      toast.success('Settings saved');
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: () => toast.error('Failed to save settings'),
  });

  if (isLoading) return <LoadingState />;
  if (error) return <ErrorState message="Failed to load settings" onRetry={() => void refetch()} />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Workspace preferences for your account.</p>
      </div>

      <div className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Default aspect ratio</label>
          <Input
            value={defaultAspectRatio}
            onChange={(e) => setDefaultAspectRatio(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-sm font-medium">Preferred language</label>
          <Input
            value={preferredLanguage}
            onChange={(e) => setPreferredLanguage(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailNotifications}
            onChange={(e) => setEmailNotifications(e.target.checked)}
          />
          Email notifications
        </label>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Save settings
        </Button>
      </div>
    </div>
  );
}
