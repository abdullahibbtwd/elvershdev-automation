-- CreateEnum
CREATE TYPE "MotionGenerationStatus" AS ENUM (
  'PENDING',
  'ANALYZING',
  'SUBMITTING',
  'PROCESSING',
  'DOWNLOADING',
  'VALIDATING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- AlterEnum
ALTER TYPE "GenerationJobType" ADD VALUE 'MOTION_ANALYSIS';

-- CreateTable
CREATE TABLE "motion_generations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "source_visual_id" TEXT NOT NULL,
    "source_media_asset_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'kling',
    "provider_model" TEXT,
    "provider_task_id" TEXT,
    "motion_prompt" TEXT NOT NULL,
    "negative_prompt" TEXT,
    "structured_brief" JSONB,
    "generation_parameters" JSONB,
    "status" "MotionGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "output_media_asset_id" TEXT,
    "duration_seconds" INTEGER NOT NULL DEFAULT 5,
    "resolution" TEXT NOT NULL DEFAULT '720p',
    "estimated_cost" DECIMAL(12,6),
    "actual_cost" DECIMAL(12,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "generation_job_id" TEXT,
    "poll_attempt" INTEGER NOT NULL DEFAULT 0,
    "error_code" TEXT,
    "error_message" TEXT,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "motion_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "motion_generations_output_media_asset_id_key" ON "motion_generations"("output_media_asset_id");

-- CreateIndex
CREATE INDEX "motion_generations_user_id_idx" ON "motion_generations"("user_id");

-- CreateIndex
CREATE INDEX "motion_generations_story_id_idx" ON "motion_generations"("story_id");

-- CreateIndex
CREATE INDEX "motion_generations_scene_id_idx" ON "motion_generations"("scene_id");

-- CreateIndex
CREATE INDEX "motion_generations_source_visual_id_idx" ON "motion_generations"("source_visual_id");

-- CreateIndex
CREATE INDEX "motion_generations_status_idx" ON "motion_generations"("status");

-- CreateIndex
CREATE INDEX "motion_generations_provider_task_id_idx" ON "motion_generations"("provider_task_id");

-- CreateIndex
CREATE INDEX "motion_generations_generation_job_id_idx" ON "motion_generations"("generation_job_id");

-- CreateIndex
CREATE INDEX "motion_generations_scene_id_is_selected_idx" ON "motion_generations"("scene_id", "is_selected");

-- CreateIndex
CREATE INDEX "motion_generations_story_id_status_idx" ON "motion_generations"("story_id", "status");

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_source_visual_id_fkey" FOREIGN KEY ("source_visual_id") REFERENCES "scene_visuals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_source_media_asset_id_fkey" FOREIGN KEY ("source_media_asset_id") REFERENCES "media_assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_output_media_asset_id_fkey" FOREIGN KEY ("output_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "motion_generations" ADD CONSTRAINT "motion_generations_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
