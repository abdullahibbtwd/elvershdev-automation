-- CreateEnum
CREATE TYPE "NarrationScriptStatus" AS ENUM ('DRAFT', 'PLANNING', 'READY', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "SceneNarrationStatus" AS ENUM ('DRAFT', 'READY', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "AudioGenerationStatus" AS ENUM (
  'PENDING',
  'GENERATING',
  'VALIDATING',
  'STORING',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);

-- AlterEnum
ALTER TYPE "GenerationJobType" ADD VALUE 'NARRATION_PLANNING';

-- CreateTable
CREATE TABLE "narration_scripts" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "NarrationScriptStatus" NOT NULL DEFAULT 'DRAFT',
    "full_text" TEXT,
    "notes" TEXT,
    "generation_job_id" TEXT,
    "approved_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "narration_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scene_narrations" (
    "id" TEXT NOT NULL,
    "narration_script_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "emotional_tone" TEXT NOT NULL,
    "speaking_style" TEXT NOT NULL,
    "delivery_instructions" TEXT,
    "pronunciation_guidance" TEXT,
    "estimated_duration" DOUBLE PRECISION NOT NULL,
    "status" "SceneNarrationStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_narrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voice_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "provider_voice_id" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en',
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "voice_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audio_generations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT NOT NULL,
    "scene_id" TEXT,
    "narration_script_id" TEXT NOT NULL,
    "scene_narration_id" TEXT,
    "voice_profile_id" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'gemini',
    "model" TEXT,
    "status" "AudioGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "source_text" TEXT NOT NULL,
    "speaking_style" TEXT,
    "provider_voice_id" TEXT,
    "audio_media_asset_id" TEXT,
    "duration" DOUBLE PRECISION,
    "format" TEXT,
    "sample_rate" INTEGER,
    "channels" INTEGER,
    "file_size" BIGINT,
    "estimated_cost" DECIMAL(12,6),
    "actual_cost" DECIMAL(12,6),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "generation_job_id" TEXT,
    "error_code" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audio_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "narration_scripts_user_id_idx" ON "narration_scripts"("user_id");

-- CreateIndex
CREATE INDEX "narration_scripts_story_id_idx" ON "narration_scripts"("story_id");

-- CreateIndex
CREATE INDEX "narration_scripts_status_idx" ON "narration_scripts"("status");

-- CreateIndex
CREATE INDEX "narration_scripts_generation_job_id_idx" ON "narration_scripts"("generation_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "narration_scripts_story_id_version_key" ON "narration_scripts"("story_id", "version");

-- CreateIndex
CREATE INDEX "scene_narrations_narration_script_id_idx" ON "scene_narrations"("narration_script_id");

-- CreateIndex
CREATE INDEX "scene_narrations_story_id_idx" ON "scene_narrations"("story_id");

-- CreateIndex
CREATE INDEX "scene_narrations_scene_id_idx" ON "scene_narrations"("scene_id");

-- CreateIndex
CREATE INDEX "scene_narrations_status_idx" ON "scene_narrations"("status");

-- CreateIndex
CREATE UNIQUE INDEX "scene_narrations_narration_script_id_scene_id_key" ON "scene_narrations"("narration_script_id", "scene_id");

-- CreateIndex
CREATE UNIQUE INDEX "scene_narrations_narration_script_id_sequence_key" ON "scene_narrations"("narration_script_id", "sequence");

-- CreateIndex
CREATE INDEX "voice_profiles_user_id_idx" ON "voice_profiles"("user_id");

-- CreateIndex
CREATE INDEX "voice_profiles_user_id_is_default_idx" ON "voice_profiles"("user_id", "is_default");

-- CreateIndex
CREATE INDEX "voice_profiles_provider_provider_voice_id_idx" ON "voice_profiles"("provider", "provider_voice_id");

-- CreateIndex
CREATE UNIQUE INDEX "voice_profiles_user_id_name_key" ON "voice_profiles"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "audio_generations_audio_media_asset_id_key" ON "audio_generations"("audio_media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "audio_generations_idempotency_key_key" ON "audio_generations"("idempotency_key");

-- CreateIndex
CREATE INDEX "audio_generations_user_id_idx" ON "audio_generations"("user_id");

-- CreateIndex
CREATE INDEX "audio_generations_story_id_idx" ON "audio_generations"("story_id");

-- CreateIndex
CREATE INDEX "audio_generations_scene_id_idx" ON "audio_generations"("scene_id");

-- CreateIndex
CREATE INDEX "audio_generations_narration_script_id_idx" ON "audio_generations"("narration_script_id");

-- CreateIndex
CREATE INDEX "audio_generations_scene_narration_id_idx" ON "audio_generations"("scene_narration_id");

-- CreateIndex
CREATE INDEX "audio_generations_voice_profile_id_idx" ON "audio_generations"("voice_profile_id");

-- CreateIndex
CREATE INDEX "audio_generations_status_idx" ON "audio_generations"("status");

-- CreateIndex
CREATE INDEX "audio_generations_generation_job_id_idx" ON "audio_generations"("generation_job_id");

-- CreateIndex
CREATE INDEX "audio_generations_scene_id_is_selected_idx" ON "audio_generations"("scene_id", "is_selected");

-- CreateIndex
CREATE INDEX "audio_generations_story_id_status_idx" ON "audio_generations"("story_id", "status");

-- AddForeignKey
ALTER TABLE "narration_scripts" ADD CONSTRAINT "narration_scripts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narration_scripts" ADD CONSTRAINT "narration_scripts_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "narration_scripts" ADD CONSTRAINT "narration_scripts_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_narrations" ADD CONSTRAINT "scene_narrations_narration_script_id_fkey" FOREIGN KEY ("narration_script_id") REFERENCES "narration_scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scene_narrations" ADD CONSTRAINT "scene_narrations_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_narration_script_id_fkey" FOREIGN KEY ("narration_script_id") REFERENCES "narration_scripts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_scene_narration_id_fkey" FOREIGN KEY ("scene_narration_id") REFERENCES "scene_narrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_voice_profile_id_fkey" FOREIGN KEY ("voice_profile_id") REFERENCES "voice_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_audio_media_asset_id_fkey" FOREIGN KEY ("audio_media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audio_generations" ADD CONSTRAINT "audio_generations_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
