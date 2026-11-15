-- CreateEnum
CREATE TYPE "StoryGenerationType" AS ENUM ('STORY', 'SCENES', 'REGENERATE');

-- AlterEnum GenerationJobType
ALTER TYPE "GenerationJobType" ADD VALUE 'SCENE_PLANNING';

-- AlterTable Story
ALTER TABLE "stories" ADD COLUMN "topic" TEXT;
ALTER TABLE "stories" ADD COLUMN "niche" TEXT;
ALTER TABLE "stories" ADD COLUMN "target_audience" TEXT;
ALTER TABLE "stories" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';
ALTER TABLE "stories" ADD COLUMN "tone" TEXT;
ALTER TABLE "stories" ADD COLUMN "category" TEXT;
ALTER TABLE "stories" ADD COLUMN "target_duration_seconds" INTEGER;
ALTER TABLE "stories" ADD COLUMN "opening_hook" TEXT;
ALTER TABLE "stories" ADD COLUMN "narration_script" TEXT;
ALTER TABLE "stories" ADD COLUMN "closing_message" TEXT;
ALTER TABLE "stories" ADD COLUMN "description" TEXT;
ALTER TABLE "stories" ADD COLUMN "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable GenerationJob
ALTER TABLE "generation_jobs" ADD COLUMN "story_id" TEXT;
CREATE INDEX "generation_jobs_story_id_idx" ON "generation_jobs"("story_id");
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable StoryGeneration
CREATE TABLE "story_generations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "generation_job_id" TEXT,
    "request_type" "StoryGenerationType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "prompt_params" JSONB NOT NULL,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "estimated_cost" DECIMAL(12,6),
    "error_message" TEXT,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "story_generations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_generations_generation_job_id_key" ON "story_generations"("generation_job_id");
CREATE INDEX "story_generations_user_id_idx" ON "story_generations"("user_id");
CREATE INDEX "story_generations_story_id_idx" ON "story_generations"("story_id");
CREATE INDEX "story_generations_status_idx" ON "story_generations"("status");

ALTER TABLE "story_generations" ADD CONSTRAINT "story_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_generations" ADD CONSTRAINT "story_generations_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "story_generations" ADD CONSTRAINT "story_generations_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable StoryScene
CREATE TABLE "story_scenes" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "scene_number" INTEGER NOT NULL,
    "duration_seconds" DOUBLE PRECISION NOT NULL,
    "narration" TEXT NOT NULL,
    "visual_description" TEXT NOT NULL,
    "image_prompt" TEXT NOT NULL,
    "video_prompt" TEXT NOT NULL,
    "camera_movement" TEXT NOT NULL,
    "lighting" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "character_consistency_instructions" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "story_scenes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "story_scenes_story_id_scene_number_key" ON "story_scenes"("story_id", "scene_number");
CREATE INDEX "story_scenes_story_id_idx" ON "story_scenes"("story_id");
ALTER TABLE "story_scenes" ADD CONSTRAINT "story_scenes_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable CharacterProfile
CREATE TABLE "character_profiles" (
    "id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "appearance" TEXT NOT NULL,
    "clothing" TEXT NOT NULL,
    "age_range" TEXT NOT NULL,
    "hair" TEXT NOT NULL,
    "distinctive_features" TEXT NOT NULL,
    "consistency_notes" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "character_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "character_profiles_story_id_name_key" ON "character_profiles"("story_id", "name");
CREATE INDEX "character_profiles_story_id_idx" ON "character_profiles"("story_id");
ALTER TABLE "character_profiles" ADD CONSTRAINT "character_profiles_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable ProviderUsage
CREATE TABLE "provider_usages" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT,
    "generation_job_id" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "request_type" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "estimated_cost" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "provider_usages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "provider_usages_user_id_idx" ON "provider_usages"("user_id");
CREATE INDEX "provider_usages_story_id_idx" ON "provider_usages"("story_id");
CREATE INDEX "provider_usages_provider_model_idx" ON "provider_usages"("provider", "model");
ALTER TABLE "provider_usages" ADD CONSTRAINT "provider_usages_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "provider_usages" ADD CONSTRAINT "provider_usages_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "provider_usages" ADD CONSTRAINT "provider_usages_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
