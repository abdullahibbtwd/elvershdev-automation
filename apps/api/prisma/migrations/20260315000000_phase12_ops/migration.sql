-- CreateEnum
CREATE TYPE "SystemAlertSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SystemAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'VERIFIED');

-- CreateTable
CREATE TABLE "system_alerts" (
    "id" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "SystemAlertSeverity" NOT NULL DEFAULT 'WARNING',
    "status" "SystemAlertStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "last_fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldown_until" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "email_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "backup_records" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'postgres',
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT,
    "file_size_bytes" BIGINT,
    "checksum" TEXT,
    "destination" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "verified_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "backup_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "system_alerts_dedupe_key_key" ON "system_alerts"("dedupe_key");

-- CreateIndex
CREATE INDEX "system_alerts_status_severity_idx" ON "system_alerts"("status", "severity");

-- CreateIndex
CREATE INDEX "system_alerts_type_idx" ON "system_alerts"("type");

-- CreateIndex
CREATE INDEX "system_alerts_last_fired_at_idx" ON "system_alerts"("last_fired_at");

-- CreateIndex
CREATE INDEX "backup_records_type_status_idx" ON "backup_records"("type", "status");

-- CreateIndex
CREATE INDEX "backup_records_started_at_idx" ON "backup_records"("started_at");
