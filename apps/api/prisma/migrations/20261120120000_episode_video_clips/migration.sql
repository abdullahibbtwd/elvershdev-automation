-- CreateEnum
CREATE TYPE "EpisodeVideoClipStatus" AS ENUM (
  'PLANNED',
  'QUEUED',
  'SUBMITTED',
  'GENERATING',
  'DOWNLOADING',
  'COMPLETED',
  'FAILED',
  'RETRYING',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE "episode_video_clips" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "episode_id" TEXT NOT NULL,
    "clip_index" INTEGER NOT NULL,
    "scene_order" INTEGER NOT NULL,
    "shot_orders" JSONB NOT NULL DEFAULT '[]',
    "source_shot_ids" JSONB NOT NULL DEFAULT '[]',
    "duration_seconds" DOUBLE PRECISION NOT NULL,
    "start_offset_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "end_offset_seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "characters" JSONB NOT NULL DEFAULT '[]',
    "speaker_name" TEXT,
    "dialogue" TEXT,
    "location" TEXT,
    "environment" TEXT,
    "camera" TEXT,
    "action" TEXT,
    "audio_direction" TEXT,
    "music_direction" TEXT,
    "previous_clip_summary" TEXT,
    "next_clip_hint" TEXT,
    "prompt" TEXT NOT NULL,
    "continuity" JSONB NOT NULL DEFAULT '{}',
    "status" "EpisodeVideoClipStatus" NOT NULL DEFAULT 'PLANNED',
    "provider" TEXT DEFAULT 'xai',
    "provider_model" TEXT,
    "provider_request_id" TEXT,
    "video_media_asset_id" TEXT,
    "estimated_cost_usd" DECIMAL(12,6),
    "actual_cost_usd" DECIMAL(12,6),
    "idempotency_key" TEXT,
    "error_message" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "episode_video_clips_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "episode_video_clips_idempotency_key_key" ON "episode_video_clips"("idempotency_key");

-- CreateIndex
CREATE INDEX "episode_video_clips_user_id_idx" ON "episode_video_clips"("user_id");

-- CreateIndex
CREATE INDEX "episode_video_clips_episode_id_idx" ON "episode_video_clips"("episode_id");

-- CreateIndex
CREATE INDEX "episode_video_clips_status_idx" ON "episode_video_clips"("status");

-- CreateIndex
CREATE INDEX "episode_video_clips_provider_request_id_idx" ON "episode_video_clips"("provider_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "episode_video_clips_episode_id_clip_index_key" ON "episode_video_clips"("episode_id", "clip_index");

-- AddForeignKey
ALTER TABLE "episode_video_clips" ADD CONSTRAINT "episode_video_clips_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_video_clips" ADD CONSTRAINT "episode_video_clips_episode_id_fkey" FOREIGN KEY ("episode_id") REFERENCES "series_episodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "episode_video_clips" ADD CONSTRAINT "episode_video_clips_video_media_asset_id_fkey" FOREIGN KEY ("video_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
