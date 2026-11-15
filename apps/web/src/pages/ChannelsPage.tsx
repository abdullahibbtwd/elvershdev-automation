import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Share2 } from 'lucide-react';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { statusTone } from '@/lib/status';

const PLATFORMS = [
  {
    id: 'facebook',
    label: 'Facebook Pages',
    enum: 'FACEBOOK',
    note: 'Pages only — personal profiles are not supported.',
  },
  {
    id: 'instagram',
    label: 'Instagram Professional',
    enum: 'INSTAGRAM',
    note: 'Business or Creator accounts linked to a Facebook Page.',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    enum: 'TIKTOK',
    note: 'Unaudited apps are limited to private (SELF_ONLY) posts.',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    enum: 'YOUTUBE',
    note: 'Uploads via YouTube Data API v3 (youtube.upload scope).',
  },
] as const;

type Channel = {
  id: string;
  platform: string;
  accountName: string;
  username?: string | null;
  profileImageUrl?: string | null;
  accountType?: string | null;
  connectionStatus: string;
  isActive: boolean;
  tokenExpiresAt?: string | null;
  warnings?: string[];
  unsupportedReasons?: string[];
  publishingCapabilities?: {
    canPublishVideo?: boolean;
    canPublishPublic?: boolean;
    testOrPrivateOnly?: boolean;
    flags?: string[];
  };
  lastError?: string | null;
};

type CapabilityRow = {
  platform: string;
  isConfigured: boolean;
  useMock: boolean;
  capabilities: {
    canPublishVideo: boolean;
    canPublishPublic: boolean;
    testOrPrivateOnly: boolean;
    warnings: string[];
  };
};

function connectionLabel(status: string) {
  switch (status) {
    case 'PUBLIC_READY':
      return 'Public publishing enabled';
    case 'TEST_ONLY':
      return 'Test / private-only';
    case 'MISSING_PERMISSIONS':
      return 'Connected — missing permissions';
    case 'NOT_ELIGIBLE':
      return 'Connected — not eligible';
    case 'EXPIRED':
      return 'Expired — reauthorize';
    case 'REVOKED':
      return 'Revoked — reconnect';
    case 'ERROR':
      return 'Connection error';
    case 'CONNECTED':
      return 'Connected';
    default:
      return status;
  }
}

export function ChannelsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['channels'],
    queryFn: async () => {
      const res = await api.get('/channels', { params: { limit: 50 } });
      return res.data as { data: Channel[] };
    },
  });

  const capabilitiesQuery = useQuery({
    queryKey: ['channels', 'capabilities'],
    queryFn: async () => {
      const res = await api.get('/channels/capabilities');
      return res.data as { data: CapabilityRow[] };
    },
  });

  useEffect(() => {
    const connected = searchParams.get('connected');
    const oauthError = searchParams.get('error');
    const message = searchParams.get('message');
    if (connected) {
      toast.success(`Connected ${connected}${searchParams.get('accounts') ? ` (${searchParams.get('accounts')} account(s))` : ''}`);
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      setSearchParams({}, { replace: true });
    } else if (oauthError) {
      toast.error(message ? decodeURIComponent(message) : `OAuth failed for ${oauthError}`);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, queryClient, setSearchParams]);

  const connectMutation = useMutation({
    mutationFn: async (provider: string) => {
      const res = await api.post(`/channels/${provider}/connect`, {});
      return res.data as { data: { authorizationUrl: string } };
    },
    onSuccess: (res) => {
      const url = res.data.authorizationUrl;
      if (!url) {
        toast.error('No authorization URL returned');
        return;
      }
      window.location.href = url;
    },
    onError: () => toast.error('Failed to start OAuth connect'),
  });

  const refreshMutation = useMutation({
    mutationFn: async (id: string) => api.post(`/channels/${id}/refresh`),
    onSuccess: () => {
      toast.success('Channel refreshed');
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: () => toast.error('Failed to refresh channel'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/channels/${id}`),
    onSuccess: () => {
      toast.success('Channel disconnected');
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: () => toast.error('Failed to disconnect'),
  });

  const channels = data?.data ?? [];
  const caps = capabilitiesQuery.data?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Social Channels</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Connect Facebook Pages, Instagram Professional, TikTok, and YouTube. Tokens are
            encrypted at rest and never sent to the browser.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refetch()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {PLATFORMS.map((platform) => {
          const cap = caps.find((c) => c.platform === platform.enum);
          return (
            <div key={platform.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-medium">{platform.label}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{platform.note}</p>
                  {cap && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge tone={cap.isConfigured ? 'success' : 'warning'}>
                        {cap.isConfigured ? 'App configured' : 'Credentials missing'}
                      </Badge>
                      {cap.useMock && <Badge tone="info">Mock mode</Badge>}
                      {cap.capabilities.testOrPrivateOnly && (
                        <Badge tone="warning">Private/test only</Badge>
                      )}
                    </div>
                  )}
                </div>
                <Button
                  onClick={() => connectMutation.mutate(platform.id)}
                  disabled={connectMutation.isPending}
                >
                  Connect
                </Button>
              </div>
              {cap?.capabilities.warnings?.slice(0, 2).map((w) => (
                <p key={w} className="mt-2 text-xs text-amber-300">
                  {w}
                </p>
              ))}
            </div>
          );
        })}
      </div>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load channels" onRetry={() => void refetch()} />
      ) : channels.length === 0 ? (
        <EmptyState
          icon={Share2}
          title="No channels connected"
          description="Use Connect above to authorize a Facebook Page, Instagram Professional account, TikTok, or YouTube channel."
        />
      ) : (
        <div className="space-y-3">
          <h2 className="text-lg font-medium">Connected accounts</h2>
          {channels.map((channel) => (
            <div
              key={channel.id}
              className="flex flex-col gap-3 rounded-xl border border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="font-medium">
                  {channel.accountName}
                  {channel.username ? (
                    <span className="text-muted-foreground"> · @{channel.username.replace(/^@/, '')}</span>
                  ) : null}
                  <span className="text-muted-foreground"> · {channel.platform}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge tone={statusTone(channel.connectionStatus)}>
                    {connectionLabel(channel.connectionStatus)}
                  </Badge>
                  {channel.accountType && <Badge tone="default">{channel.accountType}</Badge>}
                  {!channel.isActive && <Badge tone="warning">Inactive</Badge>}
                  {channel.publishingCapabilities?.canPublishVideo === false && (
                    <Badge tone="danger">Cannot publish video</Badge>
                  )}
                  {channel.publishingCapabilities?.testOrPrivateOnly && (
                    <Badge tone="warning">Private/test publishing</Badge>
                  )}
                  {channel.tokenExpiresAt &&
                    new Date(channel.tokenExpiresAt).getTime() < Date.now() + 86400000 && (
                      <Badge tone="warning">Token expiring soon</Badge>
                    )}
                </div>
                {(channel.warnings?.[0] || channel.lastError) && (
                  <p className="mt-2 text-xs text-amber-300">
                    {channel.lastError || channel.warnings?.[0]}
                  </p>
                )}
                {channel.unsupportedReasons?.[0] && (
                  <p className="mt-1 text-xs text-destructive">{channel.unsupportedReasons[0]}</p>
                )}
              </div>
              <div className="flex flex-shrink-0 gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refreshMutation.mutate(channel.id)}
                  disabled={refreshMutation.isPending}
                >
                  Refresh
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => deleteMutation.mutate(channel.id)}
                  disabled={deleteMutation.isPending}
                >
                  Disconnect
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
