import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Library } from 'lucide-react';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/EmptyState';
import { ErrorState } from '@/components/ErrorState';
import { LoadingState } from '@/components/LoadingState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';

export function MediaPage() {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['media', type],
    queryFn: async () => {
      const res = await api.get('/media', {
        params: { type: type || undefined, limit: 50 },
      });
      return res.data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return res.data.data;
    },
    onSuccess: () => {
      toast.success('Media uploaded');
      void queryClient.invalidateQueries({ queryKey: ['media'] });
    },
    onError: () => toast.error('Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/media/${id}`),
    onSuccess: () => {
      toast.success('Media deleted');
      void queryClient.invalidateQueries({ queryKey: ['media'] });
    },
  });

  const downloadMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await api.get(`/media/${id}/download-url`);
      return res.data.data.url as string;
    },
    onSuccess: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer');
    },
    onError: () => toast.error('Could not create download URL'),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Media Library</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Upload assets to MinIO. Downloads use temporary signed URLs only.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            accept="image/*,audio/*,video/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) uploadMutation.mutate(file);
              e.target.value = '';
            }}
          />
          <Button onClick={() => inputRef.current?.click()} disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? 'Uploading…' : 'Upload media'}
          </Button>
        </div>
      </div>

      <select
        className="h-10 rounded-md border px-3 text-sm"
        value={type}
        onChange={(e) => setType(e.target.value)}
      >
        <option value="">All types</option>
        {['IMAGE', 'AUDIO', 'VIDEO'].map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>

      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message="Failed to load media" onRetry={() => void refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          icon={Library}
          title="No media assets"
          description="Upload images, audio or video to associate with projects."
          actionLabel="Upload media"
          onAction={() => inputRef.current?.click()}
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <table className="min-w-full text-left text-sm">
            <thead className="border-b bg-secondary/40 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Size</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.data.map(
                (asset: {
                  id: string;
                  originalName?: string;
                  type: string;
                  fileSize?: number;
                }) => (
                  <tr key={asset.id} className="border-b last:border-0">
                    <td className="px-4 py-3">{asset.originalName || asset.id}</td>
                    <td className="px-4 py-3">
                      <Badge>{asset.type}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {asset.fileSize ? `${Math.round(asset.fileSize / 1024)} KB` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => downloadMutation.mutate(asset.id)}
                        >
                          Download URL
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => deleteMutation.mutate(asset.id)}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
