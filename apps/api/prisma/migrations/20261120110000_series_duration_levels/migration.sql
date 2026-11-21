-- Separate complete-story, episode, and clip duration settings.
-- Existing rows keep episode default 60s and count-based story derivation (NULL story duration).

ALTER TABLE "series_automation_configs"
  ADD COLUMN IF NOT EXISTS "default_story_duration_seconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "default_max_clip_duration_seconds" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "default_production_format" TEXT NOT NULL DEFAULT 'episodic';

ALTER TABLE "series_lanes"
  ADD COLUMN IF NOT EXISTS "target_story_duration_seconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_clip_duration_seconds" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "production_format" TEXT NOT NULL DEFAULT 'episodic';

ALTER TABLE "story_series"
  ADD COLUMN IF NOT EXISTS "target_story_duration_seconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "max_clip_duration_seconds" INTEGER NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS "production_format" TEXT NOT NULL DEFAULT 'episodic';
