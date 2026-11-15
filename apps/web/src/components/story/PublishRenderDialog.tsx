import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Loader2, Send, Sparkles, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

type Channel = {
  id: string;
  platform: string;
  accountName: string;
  username?: string | null;
  connectionStatus: string;
  isActive: boolean;
  publishingCapabilities?: {
    canPublishVideo?: boolean;
    testOrPrivateOnly?: boolean;
    supportsTitle?: boolean;
    supportsDescription?: boolean;
  };
};

type TargetDraft = {
  channelId: string;
  title: string;
  caption: string;
  description: string;
  hashtags: string;
  privacyStatus: string;
};

type Props = {
  renderId: string;
  storyTitle?: string;
  storyDescription?: string;
  open: boolean;
  onClose: () => void;
};

const PRIVACY_BY_PLATFORM: Record<string, string[]> = {
  YOUTUBE: ['private', 'unlisted', 'public'],
  TIKTOK: ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'],
  FACEBOOK: [],
  INSTAGRAM: [],
};

function defaultPrivacy(platform: string) {
  if (platform === 'YOUTUBE') return 'private';
  if (platform === 'TIKTOK') return 'SELF_ONLY';
  return '';
}

export function PublishRenderDialog({
  renderId,
  storyTitle,
  storyDescription,
  open,
  onClose,
}: Props) {
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [drafts, setDrafts] = useState<Record<string, TargetDraft>>({});

  const channelsQuery = useQuery({
    queryKey: ['channels', 'publishable'],
    enabled: open,
    queryFn: async () => {
      const res = await api.get('/channels', { params: { limit: 100, isActive: true } });
      return (res.data.data as Channel[]).filter(
        (c) =>
          c.isActive &&
          c.publishingCapabilities?.canPublishVideo !== false &&
          !['REVOKED', 'DISCONNECTED', 'NOT_ELIGIBLE'].includes(c.connectionStatus),
      );
    },
  });

  const channels = channelsQuery.data ?? [];

  useEffect(() => {
    if (!open) return;
    setDrafts((prev) => {
      const next = { ...prev };
      for (const channel of channels) {
        if (next[channel.id]) continue;
        next[channel.id] = {
          channelId: channel.id,
          title: storyTitle?.slice(0, 100) ?? '',
          caption: storyDescription?.slice(0, 2200) ?? storyTitle ?? '',
          description: storyDescription?.slice(0, 5000) ?? '',
          hashtags: '',
          privacyStatus: defaultPrivacy(channel.platform),
        };
      }
      return next;
    });
  }, [open, channels, storyTitle, storyDescription]);

  const selectedChannels = useMemo(
    () => channels.filter((c) => selected.includes(c.id)),
    [channels, selected],
  );

  const suggestMutation = useMutation({
    mutationFn: async (channel: Channel) => {
      const res = await api.post('/publishing/suggest-caption', {
        platform: channel.platform,
        storyTitle,
        storyDescription,
        existingCaption: drafts[channel.id]?.caption,
      });
      return { channelId: channel.id, data: res.data.data as {
        title?: string;
        caption: string;
        description?: string;
        hashtags: string[];
      } };
    },
    onSuccess: ({ channelId, data }) => {
      setDrafts((prev) => ({
        ...prev,
        [channelId]: {
          ...prev[channelId],
          channelId,
          title: data.title ?? prev[channelId]?.title ?? '',
          caption: data.caption,
          description: data.description ?? prev[channelId]?.description ?? '',
          hashtags: (data.hashtags ?? []).join(' '),
          privacyStatus: prev[channelId]?.privacyStatus ?? '',
        },
      }));
      toast.success('Caption suggestion applied');
    },
    onError: () => toast.error('Failed to suggest caption'),
  });

  const publishMutation = useMutation({
    mutationFn: async () => {
      const targets = selectedChannels.map((channel) => {
        const draft = drafts[channel.id];
        const hashtags = (draft?.hashtags ?? '')
          .split(/[\s,]+/)
          .map((t) => t.replace(/^#/, '').trim())
          .filter(Boolean);
        return {
          channelId: channel.id,
          title: draft?.title || undefined,
          caption: draft?.caption || undefined,
          description: draft?.description || undefined,
          hashtags: hashtags.length ? hashtags : undefined,
          platformSettings: draft?.privacyStatus
            ? {
                privacyStatus: draft.privacyStatus,
                isAigc: true,
                isAiGenerated: true,
                brandContentToggle: false,
                brandOrganicToggle: false,
              }
            : {
                isAigc: true,
                isAiGenerated: true,
                brandContentToggle: false,
                brandOrganicToggle: false,
              },
        };
      });
      const res = await api.post(`/renders/${renderId}/publish`, { targets });
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Publishing queued');
      void queryClient.invalidateQueries({ queryKey: ['publishing'] });
      void queryClient.invalidateQueries({ queryKey: ['render-publications', renderId] });
      onClose();
    },
    onError: () => toast.error('Failed to queue publishing'),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div>
            <h2 className="text-lg font-semibold">Publish render</h2>
            <p className="text-sm text-muted-foreground">
              Choose channels and edit per-platform captions before publishing.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-4 p-4">
          <div>
            <h3 className="mb-2 text-sm font-medium">Channels</h3>
            {channelsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">Loading channels…</p>
            ) : channels.length === 0 ? (
              <p className="text-sm text-amber-300">
                No publish-ready channels. Connect accounts on the Social Channels page.
              </p>
            ) : (
              <div className="space-y-2">
                {channels.map((channel) => {
                  const checked = selected.includes(channel.id);
                  return (
                    <label
                      key={channel.id}
                      className="flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2"
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        onChange={(e) => {
                          setSelected((prev) =>
                            e.target.checked
                              ? [...prev, channel.id]
                              : prev.filter((id) => id !== channel.id),
                          );
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">
                          {channel.accountName} · {channel.platform}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-2">
                          <Badge tone="default">{channel.connectionStatus}</Badge>
                          {channel.publishingCapabilities?.testOrPrivateOnly && (
                            <Badge tone="warning">Private/test only</Badge>
                          )}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {selectedChannels.map((channel) => {
            const draft = drafts[channel.id];
            if (!draft) return null;
            const privacyOptions = PRIVACY_BY_PLATFORM[channel.platform] ?? [];
            return (
              <div key={channel.id} className="space-y-2 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-medium">
                    {channel.platform} · {channel.accountName}
                  </h3>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => suggestMutation.mutate(channel)}
                    disabled={suggestMutation.isPending}
                  >
                    {suggestMutation.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="mr-2 h-4 w-4" />
                    )}
                    Suggest caption
                  </Button>
                </div>
                {(channel.platform === 'YOUTUBE' ||
                  channel.platform === 'FACEBOOK' ||
                  channel.platform === 'TIKTOK') && (
                  <Input
                    placeholder="Title"
                    value={draft.title}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [channel.id]: { ...draft, title: e.target.value },
                      }))
                    }
                  />
                )}
                <Textarea
                  placeholder="Caption"
                  value={draft.caption}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [channel.id]: { ...draft, caption: e.target.value },
                    }))
                  }
                  rows={3}
                />
                {(channel.platform === 'YOUTUBE' || channel.platform === 'FACEBOOK') && (
                  <Textarea
                    placeholder="Description"
                    value={draft.description}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [channel.id]: { ...draft, description: e.target.value },
                      }))
                    }
                    rows={2}
                  />
                )}
                <Input
                  placeholder="Hashtags (space-separated, without #)"
                  value={draft.hashtags}
                  onChange={(e) =>
                    setDrafts((prev) => ({
                      ...prev,
                      [channel.id]: { ...draft, hashtags: e.target.value },
                    }))
                  }
                />
                {privacyOptions.length > 0 && (
                  <select
                    className="h-10 w-full rounded-md border px-3 text-sm"
                    value={draft.privacyStatus}
                    onChange={(e) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [channel.id]: { ...draft, privacyStatus: e.target.value },
                      }))
                    }
                  >
                    {privacyOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        Privacy: {opt}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => publishMutation.mutate()}
            disabled={selected.length === 0 || publishMutation.isPending}
          >
            {publishMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Send className="mr-2 h-4 w-4" />
            )}
            Publish now
          </Button>
        </div>
      </div>
    </div>
  );
}
