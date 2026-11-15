-- CreateEnum
CREATE TYPE "VisualGenerationStatus" AS ENUM ('PENDING', 'ANALYZING', 'PROMPT_READY', 'GENERATING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "GenerationJobType" ADD VALUE 'VISUAL_ANALYSIS';
ALTER TYPE "GenerationJobType" ADD VALUE 'CHARACTER_REFERENCE';

-- AlterTable stories
ALTER TABLE "stories" ADD COLUMN "visual_style_id" TEXT;

-- AlterTable character_profiles
ALTER TABLE "character_profiles"
ADD COLUMN "gender_presentation" TEXT,
ADD COLUMN "skin_tone" TEXT,
ADD COLUMN "facial_features" TEXT,
ADD COLUMN "hairstyle" TEXT,
ADD COLUMN "hair_color" TEXT,
ADD COLUMN "body_build" TEXT,
ADD COLUMN "accessories" TEXT,
ADD COLUMN "canonical_visual_description" TEXT,
ADD COLUMN "visual_consistency_instructions" TEXT;

-- CreateTable visual_styles
CREATE TABLE "visual_styles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "configuration" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "visual_styles_pkey" PRIMARY KEY ("id")
);

-- CreateTable scene_visuals
CREATE TABLE "scene_visuals" (
    "id" TEXT NOT NULL,
    "scene_id" TEXT NOT NULL,
    "visual_style_id" TEXT,
    "visual_prompt" TEXT NOT NULL,
    "negative_prompt" TEXT,
    "structured_brief" JSONB,
    "generation_status" "VisualGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "generated_image_media_id" TEXT,
    "is_selected" BOOLEAN NOT NULL DEFAULT false,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "provider" TEXT,
    "provider_model" TEXT,
    "generation_parameters" JSONB,
    "generation_job_id" TEXT,
    "seed" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scene_visuals_pkey" PRIMARY KEY ("id")
);

-- CreateTable character_visual_references
CREATE TABLE "character_visual_references" (
    "id" TEXT NOT NULL,
    "character_profile_id" TEXT NOT NULL,
    "media_asset_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "generation_job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "character_visual_references_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "visual_styles_user_id_name_key" ON "visual_styles"("user_id", "name");
CREATE INDEX "visual_styles_user_id_idx" ON "visual_styles"("user_id");
CREATE INDEX "visual_styles_is_default_idx" ON "visual_styles"("is_default");

CREATE UNIQUE INDEX "scene_visuals_generated_image_media_id_key" ON "scene_visuals"("generated_image_media_id");
CREATE INDEX "scene_visuals_scene_id_idx" ON "scene_visuals"("scene_id");
CREATE INDEX "scene_visuals_generation_status_idx" ON "scene_visuals"("generation_status");
CREATE INDEX "scene_visuals_generation_job_id_idx" ON "scene_visuals"("generation_job_id");
CREATE INDEX "scene_visuals_scene_id_is_selected_idx" ON "scene_visuals"("scene_id", "is_selected");

CREATE INDEX "character_visual_references_character_profile_id_idx" ON "character_visual_references"("character_profile_id");
CREATE INDEX "character_visual_references_media_asset_id_idx" ON "character_visual_references"("media_asset_id");
CREATE INDEX "character_visual_references_character_profile_id_is_primary_idx" ON "character_visual_references"("character_profile_id", "is_primary");

CREATE INDEX "stories_visual_style_id_idx" ON "stories"("visual_style_id");

-- ForeignKeys
ALTER TABLE "stories" ADD CONSTRAINT "stories_visual_style_id_fkey" FOREIGN KEY ("visual_style_id") REFERENCES "visual_styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "visual_styles" ADD CONSTRAINT "visual_styles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scene_visuals" ADD CONSTRAINT "scene_visuals_scene_id_fkey" FOREIGN KEY ("scene_id") REFERENCES "story_scenes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scene_visuals" ADD CONSTRAINT "scene_visuals_visual_style_id_fkey" FOREIGN KEY ("visual_style_id") REFERENCES "visual_styles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scene_visuals" ADD CONSTRAINT "scene_visuals_generated_image_media_id_fkey" FOREIGN KEY ("generated_image_media_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "scene_visuals" ADD CONSTRAINT "scene_visuals_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "character_visual_references" ADD CONSTRAINT "character_visual_references_character_profile_id_fkey" FOREIGN KEY ("character_profile_id") REFERENCES "character_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "character_visual_references" ADD CONSTRAINT "character_visual_references_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "character_visual_references" ADD CONSTRAINT "character_visual_references_generation_job_id_fkey" FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
