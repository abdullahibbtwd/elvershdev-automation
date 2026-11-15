-- CreateEnum
CREATE TYPE "VideoRenderStatus" AS ENUM (
  'PENDING',
  'PLANNING',
  'PREPARING_ASSETS',
  'RENDERING_SCENES',
  'MIXING_AUDIO',
  'GENERATING_SUBTITLES',
  'COMBINING',
  'VALIDATING',
  'UPLOADING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "VideoRenderSceneStatus" AS ENUM (
  'PENDING',
  'READY',
  'RENDERING',
  'COMPLETED',
  'FAILED',
  'SKIPPED'
);

-- CreateTable
CREATE TABLE "video_renders" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "status" "VideoRenderStatus" NOT NULL DEFAULT 'PENDING',
    "render_type" TEXT NOT NULL DEFAULT 'final',
    "aspect_ratio" TEXT NOT NULL DEFAULT '9:16',
    "width" INTEGER NOT NULL DEFAULT 1080,
    "height" INTEGER NOT NULL DEFAULT 1920,
    "frame_rate" INTEGER NOT NULL DEFAULT 30,
    "video_codec" TEXT NOT NULL DEFAULT 'libx264',
    "audio_codec" TEXT NOT NULL DEFAULT 'aac',
    "quality_preset" TEXT NOT NULL DEFAULT 'medium',
    "subtitle_enabled" BOOLEAN NOT NULL DEFAULT true,
    "subtitle_burned_in" BOOLEAN NOT NULL DEFAULT true,
    "background_music_asset_id" TEXT,
    "render_settings" JSONB NOT NULL DEFAULT '{}',
    "timeline" JSONB,
    "output_media_asset_id" TEXT,
    "subtitle_media_asset_id" TEXT,
    "duration" DOUBLE PRECISION,
    "file_size" BIGINT,
    "processing_time_ms" INTEGER,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "current_scene_sequence" INTEGER,
    "completed_scene_count" INTEGER NOT NULL DEFAULT 0,
    "total_scene_count" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "generation_job_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_renders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "video_render_scenes" (
    "id" TEXT NOT NULL,
    "video_render_id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "start_time" DOUBLE PRECISION NOT NULL,
    "end_time" DOUBLE PRECISION NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "selected_motion_generation_id" TEXT,
    "selected_visual_id" TEXT,
    "selected_audio_generation_id" TEXT,
    "transition_in" TEXT NOT NULL DEFAULT 'fade',
    "transition_out" TEXT NOT NULL DEFAULT 'fade',
    "status" "VideoRenderSceneStatus" NOT NULL DEFAULT 'PENDING',
    "segment_storage_key" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "video_render_scenes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "video_renders_output_media_asset_id_key" ON "video_renders"("output_media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_renders_subtitle_media_asset_id_key" ON "video_renders"("subtitle_media_asset_id");

-- CreateIndex
CREATE INDEX "video_renders_user_id_idx" ON "video_renders"("user_id");

-- CreateIndex
CREATE INDEX "video_renders_story_id_idx" ON "video_renders"("story_id");

-- CreateIndex
CREATE INDEX "video_renders_status_idx" ON "video_renders"("status");

-- CreateIndex
CREATE INDEX "video_renders_generation_job_id_idx" ON "video_renders"("generation_job_id");

-- CreateIndex
CREATE INDEX "video_renders_story_id_status_idx" ON "video_renders"("story_id", "status");

-- CreateIndex
CREATE INDEX "video_render_scenes_video_render_id_idx" ON "video_render_scenes"("video_render_id");

-- CreateIndex
CREATE INDEX "video_render_scenes_scene_id_idx" ON "video_render_scenes"("scene_id");

-- CreateIndex
CREATE INDEX "video_render_scenes_status_idx" ON "video_render_scenes"("status");

-- CreateIndex
CREATE UNIQUE INDEX "video_render_scenes_video_render_id_scene_id_key" ON "video_render_scenes"("video_render_id", "scene_id");

-- CreateIndex
CREATE UNIQUE INDEX "video_render_scenes_video_render_id_sequence_key" ON "video_render_scenes"("video_render_id", "sequence");

-- AddForeignKey
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_background_music_asset_id_fkey" FOREIGN KEY ("background_music_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_output_media_asset_id_fkey" FOREIGN KEY ("output_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_subtitle_media_asset_id_fkey" FOREIGN KEY ("subtitle_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_renders" ADD CONSTRAINT "video_renders_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_render_scenes" ADD CONSTRAINT "video_render_scenes_video_render_id_fkey" FOREIGN KEY ("video_render_id") REFERENCES "video_renders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "video_render_scenes" ADD CONSTRAINT "video_render_scenes_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
