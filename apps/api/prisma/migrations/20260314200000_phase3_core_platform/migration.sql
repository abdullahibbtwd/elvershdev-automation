-- CreateEnum
CREATE TYPE "PublishStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'PUBLISHING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- AlterTable VideoProject
ALTER TABLE "video_projects" ADD COLUMN "description" TEXT;
ALTER TABLE "video_projects" ADD COLUMN "target_platforms" "SocialPlatform"[] DEFAULT ARRAY[]::"SocialPlatform"[];

-- AlterTable MediaAsset
ALTER TABLE "media_assets" ADD COLUMN "original_name" TEXT;

-- AlterTable GenerationJob
ALTER TABLE "generation_jobs" ADD COLUMN "progress" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "generation_jobs" ADD COLUMN "queue_name" TEXT;
ALTER TABLE "generation_jobs" ADD COLUMN "queue_job_id" TEXT;
ALTER TABLE "generation_jobs" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "generation_jobs" ADD COLUMN "max_attempts" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "generation_jobs" ADD COLUMN "payload" JSONB;
ALTER TABLE "generation_jobs" ADD COLUMN "result" JSONB;
ALTER TABLE "generation_jobs" ADD COLUMN "started_at" TIMESTAMP(3);
ALTER TABLE "generation_jobs" ADD COLUMN "completed_at" TIMESTAMP(3);

CREATE INDEX "generation_jobs_queue_job_id_idx" ON "generation_jobs"("queue_job_id");

-- CreateTable PublishRecord
CREATE TABLE "publish_records" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "video_project_id" TEXT,
    "channel_id" TEXT,
    "platform" "SocialPlatform" NOT NULL,
    "status" "PublishStatus" NOT NULL DEFAULT 'DRAFT',
    "caption" TEXT,
    "external_post_id" TEXT,
    "error_message" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "publish_records_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "publish_records_user_id_idx" ON "publish_records"("user_id");
CREATE INDEX "publish_records_video_project_id_idx" ON "publish_records"("video_project_id");
CREATE INDEX "publish_records_channel_id_idx" ON "publish_records"("channel_id");
CREATE INDEX "publish_records_status_idx" ON "publish_records"("status");

ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_video_project_id_fkey" FOREIGN KEY ("video_project_id") REFERENCES "video_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "social_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
