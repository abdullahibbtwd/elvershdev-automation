-- Series Studio dialogue-driven cinematic pipeline

CREATE TYPE "LipSyncJobStatus" AS ENUM ('PENDING', 'QUEUED', 'GENERATING', 'DOWNLOADING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "DialogueLineStatus" AS ENUM ('DRAFT', 'AUDIO_PENDING', 'AUDIO_READY', 'LIP_SYNC_PENDING', 'LIP_SYNC_READY', 'FAILED');
CREATE TYPE "EpisodeShotStatus" AS ENUM ('PLANNED', 'STILL_PENDING', 'STILL_READY', 'ANIMATING', 'READY', 'FAILED');

CREATE TABLE "series_character_voices" (
    "id" TEXT NOT NULL,
    "series_character_id" TEXT NOT NULL,
    "voice_profile_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "provider_voice_id" TEXT NOT NULL,
    "voice_description" TEXT,
    "gender_presentation" TEXT,
    "approximate_vocal_age" TEXT,
    "accent" TEXT,
    "pitch" TEXT,
    "speaking_style" TEXT,
    "emotional_range" JSONB NOT NULL DEFAULT '[]',
    "speech_speed" TEXT NOT NULL DEFAULT 'normal',
    "consistency_locked" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_character_voices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "series_character_voices_series_character_id_key" ON "series_character_voices"("series_character_id");
CREATE INDEX "series_character_voices_voice_profile_id_idx" ON "series_character_voices"("voice_profile_id");
CREATE INDEX "series_character_voices_provider_provider_voice_id_idx" ON "series_character_voices"("provider", "provider_voice_id");

CREATE TABLE "episode_dialogue_lines" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "scene_order" INTEGER NOT NULL,
    "shot_order" INTEGER NOT NULL,
    "line_order" INTEGER NOT NULL,
    "speaker_name" TEXT NOT NULL,
    "series_character_id" TEXT,
    "voice_profile_id" TEXT,
    "text" TEXT NOT NULL,
    "emotion" TEXT,
    "speaking_style" TEXT,
    "status" "DialogueLineStatus" NOT NULL DEFAULT 'DRAFT',
    "audio_media_asset_id" TEXT,
    "duration_seconds" DOUBLE PRECISION,
    "start_ms" INTEGER,
    "end_ms" INTEGER,
    "estimated_cost_usd" DECIMAL(12,6),
    "actual_cost_usd" DECIMAL(12,6),
    "provider" TEXT,
    "provider_model" TEXT,
    "idempotency_key" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_dialogue_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "episode_dialogue_lines_audio_media_asset_id_key" ON "episode_dialogue_lines"("audio_media_asset_id");
CREATE UNIQUE INDEX "episode_dialogue_lines_idempotency_key_key" ON "episode_dialogue_lines"("idempotency_key");
CREATE UNIQUE INDEX "episode_dialogue_lines_episode_id_scene_order_shot_order_line_order_key" ON "episode_dialogue_lines"("episode_id", "scene_order", "shot_order", "line_order");
CREATE INDEX "episode_dialogue_lines_user_id_idx" ON "episode_dialogue_lines"("user_id");
CREATE INDEX "episode_dialogue_lines_episode_id_idx" ON "episode_dialogue_lines"("episode_id");
CREATE INDEX "episode_dialogue_lines_status_idx" ON "episode_dialogue_lines"("status");
CREATE INDEX "episode_dialogue_lines_speaker_name_idx" ON "episode_dialogue_lines"("speaker_name");

CREATE TABLE "episode_shots" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "scene_order" INTEGER NOT NULL,
    "shot_order" INTEGER NOT NULL,
    "shot_type" TEXT NOT NULL,
    "speaker_name" TEXT,
    "dialogue_line_id" TEXT,
    "characters_visible" JSONB NOT NULL DEFAULT '[]',
    "camera_direction" TEXT,
    "camera_movement" TEXT,
    "facial_expression" TEXT,
    "body_language" TEXT,
    "environment" TEXT,
    "lighting" TEXT,
    "duration_seconds" DOUBLE PRECISION NOT NULL,
    "requires_lip_sync" BOOLEAN NOT NULL DEFAULT false,
    "status" "EpisodeShotStatus" NOT NULL DEFAULT 'PLANNED',
    "still_media_asset_id" TEXT,
    "video_media_asset_id" TEXT,
    "prompt" TEXT,
    "estimated_cost_usd" DECIMAL(12,6),
    "actual_cost_usd" DECIMAL(12,6),
    "idempotency_key" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_shots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "episode_shots_dialogue_line_id_key" ON "episode_shots"("dialogue_line_id");
CREATE UNIQUE INDEX "episode_shots_idempotency_key_key" ON "episode_shots"("idempotency_key");
CREATE UNIQUE INDEX "episode_shots_episode_id_scene_order_shot_order_key" ON "episode_shots"("episode_id", "scene_order", "shot_order");
CREATE INDEX "episode_shots_user_id_idx" ON "episode_shots"("user_id");
CREATE INDEX "episode_shots_episode_id_idx" ON "episode_shots"("episode_id");
CREATE INDEX "episode_shots_status_idx" ON "episode_shots"("status");
CREATE INDEX "episode_shots_requires_lip_sync_idx" ON "episode_shots"("requires_lip_sync");

CREATE TABLE "lip_sync_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "episode_shot_id" TEXT,
    "dialogue_line_id" TEXT,
    "provider" TEXT NOT NULL,
    "provider_model" TEXT NOT NULL,
    "status" "LipSyncJobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "source_image_asset_id" TEXT,
    "source_audio_asset_id" TEXT,
    "source_image_url" TEXT,
    "source_audio_url" TEXT,
    "output_media_asset_id" TEXT,
    "provider_request_id" TEXT,
    "duration_seconds" DOUBLE PRECISION,
    "estimated_cost_usd" DECIMAL(12,6),
    "actual_cost_usd" DECIMAL(12,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "mocked" BOOLEAN NOT NULL DEFAULT false,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "generation_job_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "provider_metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lip_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "lip_sync_jobs_output_media_asset_id_key" ON "lip_sync_jobs"("output_media_asset_id");
CREATE UNIQUE INDEX "lip_sync_jobs_idempotency_key_key" ON "lip_sync_jobs"("idempotency_key");
CREATE INDEX "lip_sync_jobs_user_id_idx" ON "lip_sync_jobs"("user_id");
CREATE INDEX "lip_sync_jobs_episode_id_idx" ON "lip_sync_jobs"("episode_id");
CREATE INDEX "lip_sync_jobs_status_idx" ON "lip_sync_jobs"("status");
CREATE INDEX "lip_sync_jobs_provider_idx" ON "lip_sync_jobs"("provider");
CREATE INDEX "lip_sync_jobs_generation_job_id_idx" ON "lip_sync_jobs"("generation_job_id");

CREATE TABLE "episode_audio_mixes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "mixed_audio_asset_id" TEXT,
    "subtitle_asset_id" TEXT,
    "dialogue_gain_db" DOUBLE PRECISION,
    "music_gain_db" DOUBLE PRECISION,
    "ambient_gain_db" DOUBLE PRECISION,
    "duration_seconds" DOUBLE PRECISION,
    "cue_sheet" JSONB NOT NULL DEFAULT '[]',
    "subtitle_cues" JSONB NOT NULL DEFAULT '[]',
    "estimated_cost_usd" DECIMAL(12,6),
    "idempotency_key" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_audio_mixes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "episode_audio_mixes_mixed_audio_asset_id_key" ON "episode_audio_mixes"("mixed_audio_asset_id");
CREATE UNIQUE INDEX "episode_audio_mixes_subtitle_asset_id_key" ON "episode_audio_mixes"("subtitle_asset_id");
CREATE UNIQUE INDEX "episode_audio_mixes_idempotency_key_key" ON "episode_audio_mixes"("idempotency_key");
CREATE UNIQUE INDEX "episode_audio_mixes_episode_id_version_key" ON "episode_audio_mixes"("episode_id", "version");
CREATE INDEX "episode_audio_mixes_user_id_idx" ON "episode_audio_mixes"("user_id");
CREATE INDEX "episode_audio_mixes_episode_id_idx" ON "episode_audio_mixes"("episode_id");
CREATE INDEX "episode_audio_mixes_status_idx" ON "episode_audio_mixes"("status");

ALTER TABLE "series_character_voices" ADD CONSTRAINT "series_character_voices_series_character_id_fkey" FOREIGN KEY ("series_character_id") REFERENCES "series_characters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "series_character_voices" ADD CONSTRAINT "series_character_voices_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "episode_dialogue_lines" ADD CONSTRAINT "episode_dialogue_lines_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_dialogue_lines" ADD CONSTRAINT "episode_dialogue_lines_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_dialogue_lines" ADD CONSTRAINT "episode_dialogue_lines_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "episode_dialogue_lines" ADD CONSTRAINT "episode_dialogue_lines_audio_media_asset_id_fkey" FOREIGN KEY ("audio_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "episode_shots" ADD CONSTRAINT "episode_shots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_shots" ADD CONSTRAINT "episode_shots_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_shots" ADD CONSTRAINT "episode_shots_dialogue_line_id_fkey" FOREIGN KEY ("dialogue_line_id") REFERENCES "episode_dialogue_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "episode_shots" ADD CONSTRAINT "episode_shots_still_media_asset_id_fkey" FOREIGN KEY ("still_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "episode_shots" ADD CONSTRAINT "episode_shots_video_media_asset_id_fkey" FOREIGN KEY ("video_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_episode_shot_id_fkey" FOREIGN KEY ("episode_shot_id") REFERENCES "episode_shots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_dialogue_line_id_fkey" FOREIGN KEY ("dialogue_line_id") REFERENCES "episode_dialogue_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_source_image_asset_id_fkey" FOREIGN KEY ("source_image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_source_audio_asset_id_fkey" FOREIGN KEY ("source_audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "lip_sync_jobs" ADD CONSTRAINT "lip_sync_jobs_output_media_asset_id_fkey" FOREIGN KEY ("output_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "episode_audio_mixes" ADD CONSTRAINT "episode_audio_mixes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_audio_mixes" ADD CONSTRAINT "episode_audio_mixes_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "episode_audio_mixes" ADD CONSTRAINT "episode_audio_mixes_mixed_audio_asset_id_fkey" FOREIGN KEY ("mixed_audio_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "episode_audio_mixes" ADD CONSTRAINT "episode_audio_mixes_subtitle_asset_id_fkey" FOREIGN KEY ("subtitle_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
