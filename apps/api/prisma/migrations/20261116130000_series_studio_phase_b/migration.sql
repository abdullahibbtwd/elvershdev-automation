-- AI Series Studio Phase B: independent config, lanes, canon, continuity, scheduling

CREATE TYPE "SeriesLaneType" AS ENUM ('MORNING', 'EVENING');
CREATE TYPE "SeriesLaneStatus" AS ENUM ('ACTIVE', 'PAUSED', 'DISABLED');
CREATE TYPE "StorySeriesStatus" AS ENUM ('DRAFT', 'PLANNING', 'READY', 'ACTIVE', 'COMPLETED', 'ARCHIVED', 'FAILED', 'SUPERSEDED', 'REPLACEMENT_CANDIDATE');
CREATE TYPE "SeriesApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVISION');
CREATE TYPE "SeriesCharacterRole" AS ENUM ('PROTAGONIST', 'ANTAGONIST', 'SUPPORTING', 'CAMEO', 'NARRATOR');
CREATE TYPE "SeriesCharacterLifecycle" AS ENUM ('ACTIVE', 'INJURED', 'MISSING', 'DECEASED', 'UNKNOWN');
CREATE TYPE "SeriesEpisodeStatus" AS ENUM ('PLANNED', 'SCRIPTING', 'SCRIPT_READY', 'APPROVED', 'PRODUCING', 'RENDERED', 'SCHEDULED', 'PUBLISHED', 'FAILED', 'SKIPPED');
CREATE TYPE "SeriesEpisodeApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "SeriesEpisodeProductionState" AS ENUM ('IDLE', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "SeriesScheduleState" AS ENUM ('PENDING', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED', 'SKIPPED', 'MISSED');
CREATE TYPE "SeriesProductionRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'RETRYING');
CREATE TYPE "SeriesReplacementStatus" AS ENUM ('PENDING', 'PLANNING', 'EVALUATING', 'READY_FOR_REVIEW', 'APPROVED', 'REJECTED', 'FAILED', 'CANCELLED', 'ACTIVATED');
CREATE TYPE "SeriesMemoryVisibility" AS ENUM ('PUBLIC', 'AUDIENCE_ONLY', 'CHARACTER_RESTRICTED', 'SECRET');
CREATE TYPE "SeriesContinuityPoint" AS ENUM ('BEFORE', 'AFTER');

CREATE TABLE "series_automation_configs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "series_studio_enabled" BOOLEAN NOT NULL DEFAULT false,
    "run_mode" "AutomationRunMode" NOT NULL DEFAULT 'PAUSED',
    "morning_lane_enabled" BOOLEAN NOT NULL DEFAULT true,
    "evening_lane_enabled" BOOLEAN NOT NULL DEFAULT true,
    "automatic_movie_planning" BOOLEAN NOT NULL DEFAULT true,
    "automatic_character_generation" BOOLEAN NOT NULL DEFAULT true,
    "automatic_episode_script_generation" BOOLEAN NOT NULL DEFAULT true,
    "automatic_visual_generation" BOOLEAN NOT NULL DEFAULT true,
    "automatic_narration" BOOLEAN NOT NULL DEFAULT true,
    "automatic_rendering" BOOLEAN NOT NULL DEFAULT true,
    "automatic_publishing" BOOLEAN NOT NULL DEFAULT false,
    "automatic_replacement_planning" BOOLEAN NOT NULL DEFAULT true,
    "automatic_replacement_approval" BOOLEAN NOT NULL DEFAULT false,
    "episode_approval_required" BOOLEAN NOT NULL DEFAULT true,
    "default_planned_episode_count" INTEGER NOT NULL DEFAULT 10,
    "default_episode_duration_seconds" INTEGER NOT NULL DEFAULT 60,
    "default_replacement_trigger_episode" INTEGER NOT NULL DEFAULT 8,
    "max_concurrent_episode_production" INTEGER NOT NULL DEFAULT 1,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "quality_acceptance_threshold" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT,
    "visual_direction" TEXT,
    "visual_style_id" TEXT,
    "narration_voice_id" TEXT,
    "active_channel_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "channel_publishing_enabled" JSONB NOT NULL DEFAULT '{"FACEBOOK":true,"INSTAGRAM":true,"TIKTOK":true,"YOUTUBE":true}',
    "daily_budget_usd" DECIMAL(12,4),
    "monthly_budget_usd" DECIMAL(12,4),
    "max_cost_per_episode_usd" DECIMAL(12,4),
    "emergency_stop_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_automation_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_automation_configs_user_id_key" ON "series_automation_configs"("user_id");
CREATE INDEX "series_automation_configs_series_studio_enabled_run_mode_idx" ON "series_automation_configs"("series_studio_enabled", "run_mode");

ALTER TABLE "series_automation_configs" ADD CONSTRAINT "series_automation_configs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "series_lanes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lane_type" "SeriesLaneType" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" "SeriesLaneStatus" NOT NULL DEFAULT 'PAUSED',
    "publish_time" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "active_series_id" TEXT,
    "planned_episode_count" INTEGER NOT NULL DEFAULT 10,
    "target_episode_duration_seconds" INTEGER NOT NULL DEFAULT 60,
    "replacement_trigger_episode" INTEGER NOT NULL DEFAULT 8,
    "current_episode_number" INTEGER NOT NULL DEFAULT 0,
    "last_published_episode_number" INTEGER NOT NULL DEFAULT 0,
    "last_published_at" TIMESTAMP(3),
    "next_publish_at" TIMESTAMP(3),
    "paused_at" TIMESTAMP(3),
    "publishing_config" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_lanes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_lanes_active_series_id_key" ON "series_lanes"("active_series_id");
CREATE UNIQUE INDEX "series_lanes_user_id_lane_type_key" ON "series_lanes"("user_id", "lane_type");
CREATE INDEX "series_lanes_user_id_idx" ON "series_lanes"("user_id");
CREATE INDEX "series_lanes_status_idx" ON "series_lanes"("status");
CREATE INDEX "series_lanes_enabled_status_idx" ON "series_lanes"("enabled", "status");
CREATE INDEX "series_lanes_next_publish_at_idx" ON "series_lanes"("next_publish_at");

ALTER TABLE "series_lanes" ADD CONSTRAINT "series_lanes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "story_series" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lane_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logline" TEXT,
    "synopsis" TEXT,
    "genre" TEXT,
    "subgenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "target_audience" TEXT,
    "visual_style" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT,
    "target_episode_duration_seconds" INTEGER NOT NULL DEFAULT 60,
    "planned_episode_count" INTEGER NOT NULL DEFAULT 10,
    "current_episode_number" INTEGER NOT NULL DEFAULT 0,
    "status" "StorySeriesStatus" NOT NULL DEFAULT 'DRAFT',
    "approval_status" "SeriesApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approved_at" TIMESTAMP(3),
    "quality_scores" JSONB,
    "poster_media_asset_id" TEXT,
    "is_replacement_candidate" BOOLEAN NOT NULL DEFAULT false,
    "activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_series_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_series_user_id_slug_key" ON "story_series"("user_id", "slug");
CREATE INDEX "story_series_user_id_idx" ON "story_series"("user_id");
CREATE INDEX "story_series_lane_id_idx" ON "story_series"("lane_id");
CREATE INDEX "story_series_status_idx" ON "story_series"("status");
CREATE INDEX "story_series_approval_status_idx" ON "story_series"("approval_status");
CREATE INDEX "story_series_lane_id_status_idx" ON "story_series"("lane_id", "status");

ALTER TABLE "story_series" ADD CONSTRAINT "story_series_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_series" ADD CONSTRAINT "story_series_lane_id_fkey" FOREIGN KEY ("lane_id") REFERENCES "series_lanes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_series" ADD CONSTRAINT "story_series_poster_media_asset_id_fkey" FOREIGN KEY ("poster_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "series_lanes" ADD CONSTRAINT "series_lanes_active_series_id_fkey" FOREIGN KEY ("active_series_id") REFERENCES "story_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "series_bibles" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "premise" TEXT NOT NULL,
    "world_rules" TEXT NOT NULL,
    "setting" TEXT NOT NULL,
    "master_plot" TEXT NOT NULL,
    "beginning" TEXT NOT NULL,
    "middle" TEXT NOT NULL,
    "climax" TEXT NOT NULL,
    "resolution" TEXT NOT NULL,
    "major_conflicts" TEXT NOT NULL,
    "secrets" JSONB NOT NULL DEFAULT '[]',
    "reveals" JSONB NOT NULL DEFAULT '[]',
    "ending" TEXT NOT NULL,
    "canonical_outline" JSONB NOT NULL DEFAULT '{}',
    "episode_outlines" JSONB NOT NULL DEFAULT '[]',
    "foreshadowing_map" JSONB NOT NULL DEFAULT '[]',
    "cliffhanger_payoff_map" JSONB NOT NULL DEFAULT '[]',
    "character_arcs" JSONB NOT NULL DEFAULT '[]',
    "knowledge_map" JSONB NOT NULL DEFAULT '{}',
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_bibles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_bibles_series_id_key" ON "series_bibles"("series_id");
ALTER TABLE "series_bibles" ADD CONSTRAINT "series_bibles_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "series_characters" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "SeriesCharacterRole" NOT NULL DEFAULT 'SUPPORTING',
    "species" TEXT NOT NULL DEFAULT 'human',
    "age_range" TEXT,
    "personality" TEXT NOT NULL,
    "motivation" TEXT NOT NULL,
    "backstory" TEXT NOT NULL,
    "physical_description" TEXT NOT NULL,
    "facial_structure" TEXT,
    "eye_color" TEXT,
    "eye_shape" TEXT,
    "hair_fur_color" TEXT,
    "markings" TEXT,
    "body_proportions" TEXT,
    "clothing" TEXT,
    "accessories" TEXT,
    "height_relative" TEXT,
    "voice_profile" TEXT,
    "emotional_characteristics" TEXT,
    "relationships" JSONB NOT NULL DEFAULT '[]',
    "secrets" JSONB NOT NULL DEFAULT '[]',
    "flaws" JSONB NOT NULL DEFAULT '[]',
    "lifecycle_status" "SeriesCharacterLifecycle" NOT NULL DEFAULT 'ACTIVE',
    "canonical_visual_description" TEXT,
    "visual_consistency_notes" TEXT,
    "identity_version" INTEGER NOT NULL DEFAULT 1,
    "approved_at" TIMESTAMP(3),
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_characters_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_characters_series_id_name_key" ON "series_characters"("series_id", "name");
CREATE INDEX "series_characters_series_id_idx" ON "series_characters"("series_id");
CREATE INDEX "series_characters_role_idx" ON "series_characters"("role");
ALTER TABLE "series_characters" ADD CONSTRAINT "series_characters_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "character_reference_assets" (
    "id" TEXT NOT NULL,
    "series_character_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "is_approved" BOOLEAN NOT NULL DEFAULT false,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "prompt" TEXT NOT NULL,
    "provider" TEXT,
    "provider_model" TEXT,
    "generation_metadata" JSONB NOT NULL DEFAULT '{}',
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "character_reference_assets_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "character_reference_assets_series_character_id_idx" ON "character_reference_assets"("series_character_id");
CREATE INDEX "character_reference_assets_media_asset_id_idx" ON "character_reference_assets"("media_asset_id");
CREATE INDEX "character_reference_assets_series_character_id_is_primary_idx" ON "character_reference_assets"("series_character_id", "is_primary");
CREATE INDEX "character_reference_assets_series_character_id_is_approved_idx" ON "character_reference_assets"("series_character_id", "is_approved");
ALTER TABLE "character_reference_assets" ADD CONSTRAINT "character_reference_assets_series_character_id_fkey" FOREIGN KEY ("series_character_id") REFERENCES "series_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "character_reference_assets" ADD CONSTRAINT "character_reference_assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "series_episodes" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "episode_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "synopsis" TEXT,
    "script" TEXT,
    "hook" TEXT,
    "ending" TEXT,
    "cliffhanger" TEXT,
    "narration_text" TEXT,
    "next_episode_setup" TEXT,
    "target_duration_seconds" INTEGER NOT NULL DEFAULT 60,
    "actual_duration_seconds" DOUBLE PRECISION,
    "spoken_word_count" INTEGER,
    "status" "SeriesEpisodeStatus" NOT NULL DEFAULT 'PLANNED',
    "approval_status" "SeriesEpisodeApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "production_state" "SeriesEpisodeProductionState" NOT NULL DEFAULT 'IDLE',
    "approved_at" TIMESTAMP(3),
    "scheduled_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "story_id" TEXT,
    "video_project_id" TEXT,
    "video_render_id" TEXT,
    "continuity_changes" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_episodes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_episodes_series_id_episode_number_key" ON "series_episodes"("series_id", "episode_number");
CREATE INDEX "series_episodes_series_id_idx" ON "series_episodes"("series_id");
CREATE INDEX "series_episodes_status_idx" ON "series_episodes"("status");
CREATE INDEX "series_episodes_production_state_idx" ON "series_episodes"("production_state");
CREATE INDEX "series_episodes_story_id_idx" ON "series_episodes"("story_id");
CREATE INDEX "series_episodes_video_render_id_idx" ON "series_episodes"("video_render_id");
CREATE INDEX "series_episodes_scheduled_at_idx" ON "series_episodes"("scheduled_at");

ALTER TABLE "series_episodes" ADD CONSTRAINT "series_episodes_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_episodes" ADD CONSTRAINT "series_episodes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "series_episodes" ADD CONSTRAINT "series_episodes_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "video_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "series_episodes" ADD CONSTRAINT "series_episodes_video_render_id_fkey" FOREIGN KEY ("video_render_id") REFERENCES "video_renders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "episode_scenes" (
    "id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "scene_order" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "characters" JSONB NOT NULL DEFAULT '[]',
    "action" TEXT NOT NULL,
    "visual_description" TEXT NOT NULL,
    "dialogue" TEXT,
    "narration" TEXT,
    "emotional_direction" TEXT,
    "shot_direction" TEXT,
    "asset_references" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_scenes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "episode_scenes_episode_id_scene_order_key" ON "episode_scenes"("episode_id", "scene_order");
CREATE INDEX "episode_scenes_episode_id_idx" ON "episode_scenes"("episode_id");
ALTER TABLE "episode_scenes" ADD CONSTRAINT "episode_scenes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "series_continuity_snapshots" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "point" "SeriesContinuityPoint" NOT NULL,
    "character_states" JSONB NOT NULL DEFAULT '{}',
    "relationships" JSONB NOT NULL DEFAULT '{}',
    "locations" JSONB NOT NULL DEFAULT '{}',
    "object_ownership" JSONB NOT NULL DEFAULT '{}',
    "open_mysteries" JSONB NOT NULL DEFAULT '[]',
    "knowledge_state" JSONB NOT NULL DEFAULT '{}',
    "timeline_notes" TEXT,
    "summary" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_continuity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_continuity_snapshots_episode_id_point_key" ON "series_continuity_snapshots"("episode_id", "point");
CREATE INDEX "series_continuity_snapshots_series_id_idx" ON "series_continuity_snapshots"("series_id");
CREATE INDEX "series_continuity_snapshots_episode_id_idx" ON "series_continuity_snapshots"("episode_id");
ALTER TABLE "series_continuity_snapshots" ADD CONSTRAINT "series_continuity_snapshots_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_continuity_snapshots" ADD CONSTRAINT "series_continuity_snapshots_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "series_memory_events" (
    "id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "episode_id" TEXT,
    "episode_number" INTEGER,
    "event_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "affected_character_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "importance" INTEGER NOT NULL DEFAULT 5,
    "visibility" "SeriesMemoryVisibility" NOT NULL DEFAULT 'PUBLIC',
    "known_by_character_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience_knows" BOOLEAN NOT NULL DEFAULT true,
    "occurred_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_memory_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "series_memory_events_series_id_idx" ON "series_memory_events"("series_id");
CREATE INDEX "series_memory_events_episode_id_idx" ON "series_memory_events"("episode_id");
CREATE INDEX "series_memory_events_series_id_episode_number_idx" ON "series_memory_events"("series_id", "episode_number");
CREATE INDEX "series_memory_events_series_id_created_at_idx" ON "series_memory_events"("series_id", "created_at");
CREATE INDEX "series_memory_events_event_type_idx" ON "series_memory_events"("event_type");
ALTER TABLE "series_memory_events" ADD CONSTRAINT "series_memory_events_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_memory_events" ADD CONSTRAINT "series_memory_events_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "series_schedules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lane_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "scheduled_at" TIMESTAMP(3) NOT NULL,
    "publication_destination" JSONB NOT NULL DEFAULT '{}',
    "state" "SeriesScheduleState" NOT NULL DEFAULT 'PENDING',
    "publish_record_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "published_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_schedules_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_schedules_idempotency_key_key" ON "series_schedules"("idempotency_key");
CREATE UNIQUE INDEX "series_schedules_episode_id_lane_id_key" ON "series_schedules"("episode_id", "lane_id");
CREATE INDEX "series_schedules_user_id_idx" ON "series_schedules"("user_id");
CREATE INDEX "series_schedules_lane_id_idx" ON "series_schedules"("lane_id");
CREATE INDEX "series_schedules_state_idx" ON "series_schedules"("state");
CREATE INDEX "series_schedules_scheduled_at_idx" ON "series_schedules"("scheduled_at");
CREATE INDEX "series_schedules_state_scheduled_at_idx" ON "series_schedules"("state", "scheduled_at");
CREATE INDEX "series_schedules_user_id_state_scheduled_at_idx" ON "series_schedules"("user_id", "state", "scheduled_at");

ALTER TABLE "series_schedules" ADD CONSTRAINT "series_schedules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_schedules" ADD CONSTRAINT "series_schedules_lane_id_fkey" FOREIGN KEY ("lane_id") REFERENCES "series_lanes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_schedules" ADD CONSTRAINT "series_schedules_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "series_production_runs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "series_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "SeriesProductionRunStatus" NOT NULL DEFAULT 'PENDING',
    "stage" TEXT,
    "provider_usage_summary" JSONB NOT NULL DEFAULT '{}',
    "estimated_cost_usd" DECIMAL(12,6),
    "actual_cost_usd" DECIMAL(12,6),
    "bull_job_ids" JSONB NOT NULL DEFAULT '[]',
    "generation_job_id" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_production_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "series_production_runs_user_id_idx" ON "series_production_runs"("user_id");
CREATE INDEX "series_production_runs_series_id_idx" ON "series_production_runs"("series_id");
CREATE INDEX "series_production_runs_episode_id_idx" ON "series_production_runs"("episode_id");
CREATE INDEX "series_production_runs_status_idx" ON "series_production_runs"("status");
CREATE INDEX "series_production_runs_episode_id_attempt_number_idx" ON "series_production_runs"("episode_id", "attempt_number");

ALTER TABLE "series_production_runs" ADD CONSTRAINT "series_production_runs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_production_runs" ADD CONSTRAINT "series_production_runs_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_production_runs" ADD CONSTRAINT "series_production_runs_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_production_runs" ADD CONSTRAINT "series_production_runs_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "series_replacement_plans" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "lane_id" TEXT NOT NULL,
    "source_series_id" TEXT NOT NULL,
    "proposed_series_id" TEXT,
    "trigger_episode" INTEGER NOT NULL,
    "status" "SeriesReplacementStatus" NOT NULL DEFAULT 'PENDING',
    "quality_scores" JSONB,
    "review_notes" TEXT,
    "approval_status" "SeriesApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "approved_at" TIMESTAMP(3),
    "rejected_at" TIMESTAMP(3),
    "activated_at" TIMESTAMP(3),
    "readiness" JSONB NOT NULL DEFAULT '{}',
    "last_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_replacement_plans_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_replacement_plans_idempotency_key_key" ON "series_replacement_plans"("idempotency_key");
CREATE INDEX "series_replacement_plans_user_id_idx" ON "series_replacement_plans"("user_id");
CREATE INDEX "series_replacement_plans_lane_id_idx" ON "series_replacement_plans"("lane_id");
CREATE INDEX "series_replacement_plans_source_series_id_idx" ON "series_replacement_plans"("source_series_id");
CREATE INDEX "series_replacement_plans_status_idx" ON "series_replacement_plans"("status");
CREATE INDEX "series_replacement_plans_lane_id_source_series_id_status_idx" ON "series_replacement_plans"("lane_id", "source_series_id", "status");

ALTER TABLE "series_replacement_plans" ADD CONSTRAINT "series_replacement_plans_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_replacement_plans" ADD CONSTRAINT "series_replacement_plans_lane_id_fkey" FOREIGN KEY ("lane_id") REFERENCES "series_lanes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_replacement_plans" ADD CONSTRAINT "series_replacement_plans_source_series_id_fkey" FOREIGN KEY ("source_series_id") REFERENCES "story_series"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_replacement_plans" ADD CONSTRAINT "series_replacement_plans_proposed_series_id_fkey" FOREIGN KEY ("proposed_series_id") REFERENCES "story_series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Prevent duplicate open replacement plans for the same lane + source series
CREATE UNIQUE INDEX "series_replacement_plans_open_unique"
ON "series_replacement_plans"("lane_id", "source_series_id")
WHERE "status" IN ('PENDING', 'PLANNING', 'EVALUATING', 'READY_FOR_REVIEW', 'APPROVED');

CREATE TABLE "series_audit_logs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "series_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "series_audit_logs_user_id_idx" ON "series_audit_logs"("user_id");
CREATE INDEX "series_audit_logs_created_at_idx" ON "series_audit_logs"("created_at");
CREATE INDEX "series_audit_logs_user_id_created_at_idx" ON "series_audit_logs"("user_id", "created_at");
CREATE INDEX "series_audit_logs_entity_type_entity_id_idx" ON "series_audit_logs"("entity_type", "entity_id");
ALTER TABLE "series_audit_logs" ADD CONSTRAINT "series_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
