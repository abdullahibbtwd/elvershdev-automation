-- Series Studio lifecycle: production scheduling + master automation switches

CREATE TYPE "SeriesProductionStartMode" AS ENUM ('IMMEDIATE', 'NEXT_WINDOW', 'CUSTOM', 'MANUAL');

ALTER TABLE "series_automation_configs"
  ADD COLUMN IF NOT EXISTS "automatic_episode_production" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "automatic_motion_generation" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "movie_approval_required" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "start_media_after_movie_planning" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "default_production_start_mode" "SeriesProductionStartMode" NOT NULL DEFAULT 'NEXT_WINDOW',
  ADD COLUMN IF NOT EXISTS "default_production_lead_time_minutes" INTEGER NOT NULL DEFAULT 240;

ALTER TABLE "series_lanes"
  ADD COLUMN IF NOT EXISTS "production_lead_time_minutes" INTEGER NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS "preferred_production_time" TEXT,
  ADD COLUMN IF NOT EXISTS "production_start_mode" "SeriesProductionStartMode" NOT NULL DEFAULT 'NEXT_WINDOW',
  ADD COLUMN IF NOT EXISTS "custom_production_start_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "next_production_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "series_lanes_next_production_at_idx" ON "series_lanes"("next_production_at");

ALTER TABLE "series_episodes"
  ADD COLUMN IF NOT EXISTS "production_eligible_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "blocked_reason" TEXT;

CREATE INDEX IF NOT EXISTS "series_episodes_production_eligible_at_idx" ON "series_episodes"("production_eligible_at");
