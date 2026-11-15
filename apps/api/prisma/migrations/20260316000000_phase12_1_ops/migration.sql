-- AlterEnum JobStatus
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';

-- AlterEnum VideoRenderStatus
ALTER TYPE "VideoRenderStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';

-- AlterEnum PublishStatus
ALTER TYPE "PublishStatus" ADD VALUE IF NOT EXISTS 'INTERRUPTED';

-- CreateTable
CREATE TABLE IF NOT EXISTS "interrupted_tasks" (
    "id" TEXT NOT NULL,
    "user_id" TEXT,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "previous_status" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "provider_task_id" TEXT,
    "provider" TEXT,
    "queue_name" TEXT,
    "queue_job_id" TEXT,
    "reason" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "republish_blocked" BOOLEAN NOT NULL DEFAULT true,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interrupted_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "interrupted_tasks_entity_type_entity_id_idx" ON "interrupted_tasks"("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "interrupted_tasks_outcome_idx" ON "interrupted_tasks"("outcome");
CREATE INDEX IF NOT EXISTS "interrupted_tasks_created_at_idx" ON "interrupted_tasks"("created_at");
CREATE INDEX IF NOT EXISTS "interrupted_tasks_republish_blocked_idx" ON "interrupted_tasks"("republish_blocked");
