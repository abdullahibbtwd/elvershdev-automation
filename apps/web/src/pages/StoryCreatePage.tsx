import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  STORY_CATEGORIES,
  STORY_NICHES,
  STORY_TONES,
} from '@ai-video/shared';
import { Button } from '@/components/ui/button';
import { ChoiceGroup } from '@/components/ui/choice-group';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';

const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'pt', label: 'Portuguese' },
];

const DURATIONS = [30, 45, 60, 90, 120];

export function StoryCreatePage() {
  const navigate = useNavigate();
  const [topic, setTopic] = useState('');
  const [niche, setNiche] = useState<string>(STORY_NICHES[0]);
  const [targetAudience, setTargetAudience] = useState('General audience');
  const [language, setLanguage] = useState('en');
  const [tone, setTone] = useState<string>(STORY_TONES[0]);
  const [duration, setDuration] = useState(60);
  const [category, setCategory] = useState<string>(STORY_CATEGORIES[0]);
  const [additionalInstructions, setAdditionalInstructions] = useState('');

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post('/stories/generate', {
        topic,
        niche,
        targetAudience,
        language,
        tone,
        desiredDurationSeconds: duration,
        category,
        additionalInstructions: additionalInstructions || undefined,
      });
      return res.data.data as {
        story: { id: string };
        job: { id: string };
      };
    },
    onSuccess: (data) => {
      toast.success('Story generation queued');
      navigate(`/stories/${data.story.id}`);
    },
    onError: () => toast.error('Failed to start story generation'),
  });

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <Link to="/stories" className="text-sm text-muted-foreground hover:underline">
          ← Back to stories
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">Create AI story</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Describe the brief. Gemini will draft the story, then plan scenes automatically.
        </p>
      </div>

      <form
        className="space-y-4 rounded-xl border border-border bg-card p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (topic.trim().length < 3) {
            toast.error('Topic must be at least 3 characters');
            return;
          }
          generateMutation.mutate();
        }}
      >
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Topic / story idea</label>
          <Textarea
            placeholder="A founder who almost quit the night before their breakthrough..."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="min-h-[100px]"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Niche</Label>
            <Select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              options={STORY_NICHES.map((n) => ({ value: n, label: n }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Tone</Label>
            <Select
              value={tone}
              onChange={(e) => setTone(e.target.value)}
              options={STORY_TONES.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Language</Label>
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              options={LANGUAGES}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Duration</Label>
            <ChoiceGroup
              value={String(duration)}
              onChange={(next) => setDuration(Number(next))}
              options={DURATIONS.map((d) => ({ value: String(d), label: `${d}s` }))}
              size="sm"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Category</Label>
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={STORY_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Target audience</label>
          <Input
            value={targetAudience}
            onChange={(e) => setTargetAudience(e.target.value)}
            placeholder="Aspiring entrepreneurs"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Additional instructions (optional)</label>
          <Textarea
            value={additionalInstructions}
            onChange={(e) => setAdditionalInstructions(e.target.value)}
            placeholder="Use normal everyday English. Short sentences. No fancy or literary words."
          />
        </div>

        <Button type="submit" disabled={generateMutation.isPending} className="w-full sm:w-auto">
          {generateMutation.isPending ? 'Queuing…' : 'Generate story'}
        </Button>
      </form>
    </div>
  );
}
