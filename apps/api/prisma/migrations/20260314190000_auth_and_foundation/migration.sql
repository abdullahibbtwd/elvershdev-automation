-- Drop legacy foundation tables (no production data yet)
DROP TABLE IF EXISTS "jobs" CASCADE;
DROP TABLE IF EXISTS "channels" CASCADE;
DROP TABLE IF EXISTS "media_assets" CASCADE;
DROP TABLE IF EXISTS "stories" CASCADE;
DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
DROP TABLE IF EXISTS "users" CASCADE;
DROP TABLE IF EXISTS "settings" CASCADE;

DROP TYPE IF EXISTS "UserRole" CASCADE;
DROP TYPE IF EXISTS "JobStatus" CASCADE;
DROP TYPE IF EXISTS "MediaType" CASCADE;
DROP TYPE IF EXISTS "PublishPlatform" CASCADE;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'EDITOR', 'VIEWER');
CREATE TYPE "StoryStatus" AS ENUM ('DRAFT', 'GENERATING', 'READY', 'FAILED', 'ARCHIVED');
CREATE TYPE "ProjectStatus" AS ENUM ('DRAFT', 'PROCESSING', 'RENDERING', 'READY', 'FAILED', 'PUBLISHED');
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'AUDIO', 'SUBTITLE', 'OTHER');
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'YOUTUBE');
CREATE TYPE "GenerationJobType" AS ENUM ('STORY', 'IMAGE', 'VIDEO', 'VOICE', 'RENDER', 'PUBLISH', 'ANALYTICS');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'EDITOR',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "refresh_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "refresh_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "social_channels" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "account_name" TEXT NOT NULL,
    "platform_account_id" TEXT NOT NULL,
    "access_token_encrypted" TEXT NOT NULL,
    "refresh_token_encrypted" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "social_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "StoryStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "video_projects" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "story_id" TEXT,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "duration" INTEGER,
    "aspect_ratio" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "video_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "video_project_id" TEXT,
    "type" "MediaType" NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_size" BIGINT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "generation_jobs" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "video_project_id" TEXT,
    "job_type" "GenerationJobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "estimated_cost" DECIMAL(12,4),
    "actual_cost" DECIMAL(12,4),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "generation_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- Indexes & constraints
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_email_idx" ON "users"("email");

CREATE UNIQUE INDEX "refresh_sessions_token_hash_key" ON "refresh_sessions"("token_hash");
CREATE INDEX "refresh_sessions_user_id_idx" ON "refresh_sessions"("user_id");
CREATE INDEX "refresh_sessions_expires_at_idx" ON "refresh_sessions"("expires_at");

CREATE UNIQUE INDEX "social_channels_user_id_platform_platform_account_id_key" ON "social_channels"("user_id", "platform", "platform_account_id");
CREATE INDEX "social_channels_user_id_idx" ON "social_channels"("user_id");
CREATE INDEX "social_channels_platform_idx" ON "social_channels"("platform");

CREATE INDEX "stories_user_id_idx" ON "stories"("user_id");
CREATE INDEX "stories_status_idx" ON "stories"("status");

CREATE INDEX "video_projects_user_id_idx" ON "video_projects"("user_id");
CREATE INDEX "video_projects_story_id_idx" ON "video_projects"("story_id");
CREATE INDEX "video_projects_status_idx" ON "video_projects"("status");

CREATE INDEX "media_assets_user_id_idx" ON "media_assets"("user_id");
CREATE INDEX "media_assets_video_project_id_idx" ON "media_assets"("video_project_id");
CREATE INDEX "media_assets_type_idx" ON "media_assets"("type");

CREATE INDEX "generation_jobs_user_id_idx" ON "generation_jobs"("user_id");
CREATE INDEX "generation_jobs_video_project_id_idx" ON "generation_jobs"("video_project_id");
CREATE INDEX "generation_jobs_job_type_status_idx" ON "generation_jobs"("job_type", "status");

CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- Foreign keys
ALTER TABLE "refresh_sessions" ADD CONSTRAINT "refresh_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stories" ADD CONSTRAINT "stories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_projects" ADD CONSTRAINT "video_projects_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "stories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "video_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "video_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
