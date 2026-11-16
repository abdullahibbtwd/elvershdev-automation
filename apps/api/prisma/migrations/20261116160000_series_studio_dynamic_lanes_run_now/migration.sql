-- Series Studio: dynamic lanes, creative settings, Run Now executions

DO $$ BEGIN
  ALTER TYPE "SeriesLaneType" ADD VALUE 'CUSTOM';
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TYPE "SeriesExecutionTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "SeriesExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'AWAITING_APPROVAL', 'COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED');
CREATE TYPE "SeriesExecutionAction" AS ENUM (
  'PLAN_MOVIE',
  'GENERATE_CHARACTERS',
  'PLAN_EPISODE',
  'PRODUCE_EPISODE',
  'ENSURE_SCHEDULE',
  'PUBLISH',
  'REPLACE_MOVIE',
  'AWAIT_SERIES_APPROVAL',
  'AWAIT_EPISODE_APPROVAL',
  'IDLE_REPORT'
);

ALTER TABLE "series_automation_configs"
  ADD COLUMN IF NOT EXISTS "creative_settings" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "series_lanes"
  ADD COLUMN IF NOT EXISTS "name" TEXT NOT NULL DEFAULT 'Series Lane',
  ADD COLUMN IF NOT EXISTS "description" TEXT,
  ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "creative_settings" JSONB NOT NULL DEFAULT '{}';

-- Backfill display names for existing morning/evening lanes
UPDATE "series_lanes"
SET "name" = CASE
  WHEN "lane_type"::text = 'MORNING' THEN 'Series A (Morning)'
  WHEN "lane_type"::text = 'EVENING' THEN 'Series B (Evening)'
  ELSE "name"
END
WHERE "name" = 'Series Lane' OR "name" IS NULL;

UPDATE "series_lanes"
SET "sort_order" = CASE
  WHEN "lane_type"::text = 'MORNING' THEN 0
  WHEN "lane_type"::text = 'EVENING' THEN 1
  ELSE "sort_order"
END;

-- Allow multiple CUSTOM lanes; keep at most one MORNING and one EVENING per user via partial uniques.
DROP INDEX IF EXISTS "series_lanes_user_id_lane_type_key";

CREATE UNIQUE INDEX "series_lanes_user_morning_unique"
  ON "series_lanes"("user_id")
  WHERE "lane_type" = 'MORNING' AND "deleted_at" IS NULL;

CREATE UNIQUE INDEX "series_lanes_user_evening_unique"
  ON "series_lanes"("user_id")
  WHERE "lane_type" = 'EVENING' AND "deleted_at" IS NULL;

CREATE INDEX "series_lanes_user_id_deleted_at_idx" ON "series_lanes"("user_id", "deleted_at");
CREATE INDEX "series_lanes_user_id_sort_order_idx" ON "series_lanes"("user_id", "sort_order");

CREATE TABLE "series_executions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lane_id" TEXT NOT NULL,
    "trigger_source" "SeriesExecutionTrigger" NOT NULL,
    "requested_action" "SeriesExecutionAction" NOT NULL,
    "resolved_action" "SeriesExecutionAction",
    "status" "SeriesExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "series_id" TEXT,
    "episode_id" TEXT,
    "queue_job_ids" JSONB NOT NULL DEFAULT '[]',
    "idempotency_key" TEXT NOT NULL,
    "error_message" TEXT,
    "result_summary" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_executions_idempotency_key_key" ON "series_executions"("idempotency_key");
CREATE INDEX "series_executions_user_id_idx" ON "series_executions"("user_id");
CREATE INDEX "series_executions_lane_id_idx" ON "series_executions"("lane_id");
CREATE INDEX "series_executions_status_idx" ON "series_executions"("status");
CREATE INDEX "series_executions_user_id_status_idx" ON "series_executions"("user_id", "status");
CREATE INDEX "series_executions_lane_id_status_idx" ON "series_executions"("lane_id", "status");
CREATE INDEX "series_executions_created_at_idx" ON "series_executions"("created_at");

ALTER TABLE "series_executions"
  ADD CONSTRAINT "series_executions_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "series_executions"
  ADD CONSTRAINT "series_executions_lane_id_fkey"
  FOREIGN KEY ("lane_id") REFERENCES "series_lanes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
