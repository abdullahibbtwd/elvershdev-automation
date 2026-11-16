-- Series Studio autonomy mode (safe default: MANUAL for existing rows).
-- Does NOT rewrite lane timezones or flip approval switches.

DO $$ BEGIN
  CREATE TYPE "SeriesAutonomyMode" AS ENUM ('MANUAL', 'FULLY_AUTONOMOUS');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "series_automation_configs"
  ADD COLUMN IF NOT EXISTS "autonomy_mode" "SeriesAutonomyMode" NOT NULL DEFAULT 'MANUAL';

CREATE INDEX IF NOT EXISTS "series_automation_configs_autonomy_mode_idx"
  ON "series_automation_configs"("autonomy_mode");
