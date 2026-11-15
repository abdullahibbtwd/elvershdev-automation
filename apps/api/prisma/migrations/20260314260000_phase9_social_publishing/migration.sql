-- CreateEnum
CREATE TYPE "SocialConnectionStatus" AS ENUM (
  'CONNECTED',
  'MISSING_PERMISSIONS',
  'NOT_ELIGIBLE',
  'TEST_ONLY',
  'PUBLIC_READY',
  'EXPIRED',
  'REVOKED',
  'ERROR',
  'DISCONNECTED'
);

-- AlterEnum PublishStatus
ALTER TYPE "PublishStatus" ADD VALUE 'QUEUED';
ALTER TYPE "PublishStatus" ADD VALUE 'VALIDATING';
ALTER TYPE "PublishStatus" ADD VALUE 'UPLOADING';
ALTER TYPE "PublishStatus" ADD VALUE 'PROCESSING';
ALTER TYPE "PublishStatus" ADD VALUE 'ACTION_REQUIRED';

-- AlterTable social_channels
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "profile_image_url" TEXT;
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "account_type" TEXT;
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "connection_status" "SocialConnectionStatus" NOT NULL DEFAULT 'CONNECTED';
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "granted_scopes" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "publishing_capabilities" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "last_connection_check_at" TIMESTAMP(3);
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "last_error" TEXT;
ALTER TABLE "social_channels" ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "social_channels_connection_status_idx" ON "social_channels"("connection_status");

-- CreateTable oauth_states
CREATE TABLE IF NOT EXISTS "oauth_states" (
  "id" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" "SocialPlatform" NOT NULL,
  "code_verifier" TEXT,
  "redirect_path" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "oauth_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "oauth_states_state_key" ON "oauth_states"("state");
CREATE INDEX IF NOT EXISTS "oauth_states_user_id_idx" ON "oauth_states"("user_id");
CREATE INDEX IF NOT EXISTS "oauth_states_expires_at_idx" ON "oauth_states"("expires_at");

ALTER TABLE "oauth_states"
  DROP CONSTRAINT IF EXISTS "oauth_states_user_id_fkey";
ALTER TABLE "oauth_states"
  ADD CONSTRAINT "oauth_states_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable publish_records
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "video_render_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "description" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "platform_settings" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "provider_upload_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "provider_publish_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "provider_post_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "post_url" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "upload_progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "error_code" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "retry_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "idempotency_key" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "generation_job_id" TEXT;
ALTER TABLE "publish_records" ADD COLUMN IF NOT EXISTS "submitted_at" TIMESTAMP(3);

-- caption may already exist as TEXT; widen if needed
ALTER TABLE "publish_records" ALTER COLUMN "caption" TYPE TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "publish_records_idempotency_key_key" ON "publish_records"("idempotency_key");
CREATE INDEX IF NOT EXISTS "publish_records_video_render_id_idx" ON "publish_records"("video_render_id");
CREATE INDEX IF NOT EXISTS "publish_records_generation_job_id_idx" ON "publish_records"("generation_job_id");
CREATE INDEX IF NOT EXISTS "publish_records_provider_publish_id_idx" ON "publish_records"("provider_publish_id");
CREATE INDEX IF NOT EXISTS "publish_records_provider_post_id_idx" ON "publish_records"("provider_post_id");

ALTER TABLE "publish_records"
  DROP CONSTRAINT IF EXISTS "publish_records_video_render_id_fkey";
ALTER TABLE "publish_records"
  ADD CONSTRAINT "publish_records_video_render_id_fkey"
  FOREIGN KEY ("video_render_id") REFERENCES "video_renders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "publish_records"
  DROP CONSTRAINT IF EXISTS "publish_records_generation_job_id_fkey";
ALTER TABLE "publish_records"
  ADD CONSTRAINT "publish_records_generation_job_id_fkey"
  FOREIGN KEY ("generation_job_id") REFERENCES "generation_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
