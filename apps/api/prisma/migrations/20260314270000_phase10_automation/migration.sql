-- Phase 10: Automated content planning, generation orchestration, and publishing schedules

CREATE TYPE "AutomationRunMode" AS ENUM ('ENABLED', 'PAUSED', 'EMERGENCY_STOP');
CREATE TYPE "ContentPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'GENERATING', 'GENERATED', 'FAILED', 'CANCELLED', 'SKIPPED');
CREATE TYPE "ContentScheduleStatus" AS ENUM ('PLANNED', 'QUEUED', 'GENERATING', 'RENDERING', 'READY', 'SCHEDULING_PUBLISH', 'PUBLISHING', 'COMPLETED', 'FAILED', 'PAUSED', 'CANCELLED', 'BUDGET_BLOCKED', 'SKIPPED');
CREATE TYPE "AutomationStage" AS ENUM ('PLANNING', 'STORY_GENERATION', 'SCENE_PLANNING', 'VISUAL_INTELLIGENCE', 'MOTION_GENERATION', 'NARRATION', 'SPEECH', 'RENDER', 'PUBLISH_SCHEDULE', 'DONE');
CREATE TYPE "AutomationExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'PAUSED', 'BUDGET_BLOCKED', 'STALLED');
CREATE TYPE "ScheduledPublicationStatus" AS ENUM ('PENDING', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'SKIPPED', 'BUDGET_BLOCKED', 'INELIGIBLE');

ALTER TABLE "publish_records" ADD COLUMN "scheduled_at" TIMESTAMP(3);
CREATE INDEX "publish_records_scheduled_at_idx" ON "publish_records"("scheduled_at");

CREATE TABLE "automation_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "run_mode" "AutomationRunMode" NOT NULL DEFAULT 'PAUSED',
    "daily_generation_target" INTEGER NOT NULL DEFAULT 2,
    "monthly_generation_target" INTEGER NOT NULL DEFAULT 60,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "preferred_publishing_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "include_weekends" BOOLEAN NOT NULL DEFAULT true,
    "publishing_window_start" TEXT NOT NULL DEFAULT '09:00',
    "publishing_window_end" TEXT NOT NULL DEFAULT '21:00',
    "platform_publishing_times" JSONB NOT NULL DEFAULT '{}',
    "min_interval_minutes" INTEGER NOT NULL DEFAULT 60,
    "max_daily_publishing_attempts" INTEGER NOT NULL DEFAULT 20,
    "channel_publishing_enabled" JSONB NOT NULL DEFAULT '{"FACEBOOK":true,"INSTAGRAM":true,"TIKTOK":true,"YOUTUBE":true}',
    "active_channel_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "content_categories" TEXT[] DEFAULT ARRAY['Narrative', 'Motivation']::TEXT[],
    "story_genres" TEXT[] DEFAULT ARRAY['Cinematic storytelling']::TEXT[],
    "themes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_audience" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT,
    "target_duration_seconds" INTEGER NOT NULL DEFAULT 60,
    "visual_style_id" TEXT,
    "narration_voice_id" TEXT,
    "content_exclusions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "brand_identity" TEXT,
    "max_concurrent_generation" INTEGER NOT NULL DEFAULT 2,
    "max_concurrent_publishing" INTEGER NOT NULL DEFAULT 4,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "daily_budget_usd" DECIMAL(12,4),
    "monthly_budget_usd" DECIMAL(12,4),
    "max_cost_per_video_usd" DECIMAL(12,4),
    "max_generation_attempts" INTEGER NOT NULL DEFAULT 3,
    "max_image_generations_per_scene" INTEGER NOT NULL DEFAULT 3,
    "max_motion_attempts_per_scene" INTEGER NOT NULL DEFAULT 3,
    "emergency_stop_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "last_daily_plan_date" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_configs_user_id_key" ON "automation_configs"("user_id");
CREATE INDEX "automation_configs_enabled_run_mode_idx" ON "automation_configs"("enabled", "run_mode");

CREATE TABLE "content_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "planned_date" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "slot_index" INTEGER NOT NULL,
    "status" "ContentPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "category" TEXT,
    "genre" TEXT,
    "theme" TEXT,
    "idea_title" TEXT NOT NULL,
    "idea_summary" TEXT NOT NULL,
    "idea_fingerprint" TEXT NOT NULL,
    "story_brief" JSONB NOT NULL,
    "story_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_plans_idempotency_key_key" ON "content_plans"("idempotency_key");
CREATE UNIQUE INDEX "content_plans_user_id_planned_date_slot_index_key" ON "content_plans"("user_id", "planned_date", "slot_index");
CREATE INDEX "content_plans_user_id_idx" ON "content_plans"("user_id");
CREATE INDEX "content_plans_planned_date_idx" ON "content_plans"("planned_date");
CREATE INDEX "content_plans_status_idx" ON "content_plans"("status");
CREATE INDEX "content_plans_idea_fingerprint_idx" ON "content_plans"("idea_fingerprint");
CREATE INDEX "content_plans_user_id_planned_date_idx" ON "content_plans"("user_id", "planned_date");

CREATE TABLE "content_schedules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_plan_id" TEXT NOT NULL,
    "status" "ContentScheduleStatus" NOT NULL DEFAULT 'PLANNED',
    "current_stage" "AutomationStage" NOT NULL DEFAULT 'PLANNING',
    "scheduled_generation_at" TIMESTAMP(3),
    "scheduled_publish_at" TIMESTAMP(3),
    "story_id" TEXT,
    "video_render_id" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "paused_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "stage_started_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "content_schedules_content_plan_id_key" ON "content_schedules"("content_plan_id");
CREATE UNIQUE INDEX "content_schedules_idempotency_key_key" ON "content_schedules"("idempotency_key");
CREATE INDEX "content_schedules_user_id_idx" ON "content_schedules"("user_id");
CREATE INDEX "content_schedules_status_idx" ON "content_schedules"("status");
CREATE INDEX "content_schedules_current_stage_idx" ON "content_schedules"("current_stage");
CREATE INDEX "content_schedules_scheduled_generation_at_idx" ON "content_schedules"("scheduled_generation_at");
CREATE INDEX "content_schedules_scheduled_publish_at_idx" ON "content_schedules"("scheduled_publish_at");
CREATE INDEX "content_schedules_user_id_status_idx" ON "content_schedules"("user_id", "status");
CREATE INDEX "content_schedules_status_scheduled_generation_at_idx" ON "content_schedules"("status", "scheduled_generation_at");

CREATE TABLE "scheduled_publications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_schedule_id" TEXT NOT NULL,
    "publish_record_id" TEXT,
    "channel_id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" "ScheduledPublicationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_publications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_publications_publish_record_id_key" ON "scheduled_publications"("publish_record_id");
CREATE UNIQUE INDEX "scheduled_publications_idempotency_key_key" ON "scheduled_publications"("idempotency_key");
CREATE UNIQUE INDEX "scheduled_publications_content_schedule_id_channel_id_key" ON "scheduled_publications"("content_schedule_id", "channel_id");
CREATE INDEX "scheduled_publications_user_id_idx" ON "scheduled_publications"("user_id");
CREATE INDEX "scheduled_publications_status_idx" ON "scheduled_publications"("status");
CREATE INDEX "scheduled_publications_scheduled_at_idx" ON "scheduled_publications"("scheduled_at");
CREATE INDEX "scheduled_publications_status_scheduled_at_idx" ON "scheduled_publications"("status", "scheduled_at");
CREATE INDEX "scheduled_publications_channel_id_idx" ON "scheduled_publications"("channel_id");
CREATE INDEX "scheduled_publications_user_id_status_scheduled_at_idx" ON "scheduled_publications"("user_id", "status", "scheduled_at");

CREATE TABLE "automation_executions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "content_schedule_id" TEXT,
    "content_plan_id" TEXT,
    "stage" "AutomationStage" NOT NULL,
    "status" "AutomationExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "generation_job_id" TEXT,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "last_error" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "automation_executions_idempotency_key_key" ON "automation_executions"("idempotency_key");
CREATE INDEX "automation_executions_user_id_idx" ON "automation_executions"("user_id");
CREATE INDEX "automation_executions_content_schedule_id_idx" ON "automation_executions"("content_schedule_id");
CREATE INDEX "automation_executions_status_idx" ON "automation_executions"("status");
CREATE INDEX "automation_executions_stage_idx" ON "automation_executions"("stage");
CREATE INDEX "automation_executions_user_id_status_idx" ON "automation_executions"("user_id", "status");
CREATE INDEX "automation_executions_generation_job_id_idx" ON "automation_executions"("generation_job_id");

CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notifications_user_id_dedupe_key_key" ON "notifications"("user_id", "dedupe_key");
CREATE INDEX "notifications_user_id_idx" ON "notifications"("user_id");
CREATE INDEX "notifications_user_id_read_at_idx" ON "notifications"("user_id", "read_at");
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

CREATE TABLE "automation_audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "automation_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "automation_audit_logs_user_id_idx" ON "automation_audit_logs"("user_id");
CREATE INDEX "automation_audit_logs_created_at_idx" ON "automation_audit_logs"("created_at");
CREATE INDEX "automation_audit_logs_user_id_created_at_idx" ON "automation_audit_logs"("user_id", "created_at");

ALTER TABLE "automation_configs" ADD CONSTRAINT "automation_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_plans" ADD CONSTRAINT "content_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_schedules" ADD CONSTRAINT "content_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_schedules" ADD CONSTRAINT "content_schedules_content_plan_id_fkey" FOREIGN KEY ("content_plan_id") REFERENCES "content_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_content_schedule_id_fkey" FOREIGN KEY ("content_schedule_id") REFERENCES "content_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_publish_record_id_fkey" FOREIGN KEY ("publish_record_id") REFERENCES "publish_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_content_schedule_id_fkey" FOREIGN KEY ("content_schedule_id") REFERENCES "content_schedules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "automation_audit_logs" ADD CONSTRAINT "automation_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
