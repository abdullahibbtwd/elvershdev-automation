-- AlterTable
ALTER TABLE "video_renders" ADD COLUMN "intermediates_purged_at" TIMESTAMP(3);
ALTER TABLE "video_renders" ADD COLUMN "output_purged_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "video_renders_intermediates_purged_at_idx" ON "video_renders"("intermediates_purged_at");
CREATE INDEX "video_renders_output_purged_at_idx" ON "video_renders"("output_purged_at");
