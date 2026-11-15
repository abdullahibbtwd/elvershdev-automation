-- Phase 11: analytics, costs, synchronization, insights and optimization
CREATE TYPE "MetricAvailabilityStatus" AS ENUM ('AVAILABLE', 'UNAVAILABLE', 'NOT_SYNCED', 'SYNC_FAILED', 'ESTIMATED');
CREATE TYPE "AnalyticsMetricSource" AS ENUM ('PROVIDER_API', 'MOCK', 'ESTIMATED', 'DERIVED', 'UNAVAILABLE');
CREATE TYPE "AnalyticsSyncJobStatus" AS ENUM ('PENDING', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "AnalyticsSyncJobType" AS ENUM ('FULL', 'MANUAL', 'INITIAL_POST', 'POST_REFRESH', 'ACCOUNT_REFRESH', 'AGGREGATION', 'INSIGHTS');
CREATE TYPE "AnalyticsInsightConfidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');
CREATE TYPE "ContentPerformanceStatus" AS ENUM ('UNKNOWN', 'UNDERPERFORMING', 'AVERAGE', 'STRONG', 'TOP');

ALTER TABLE "automation_configs"
ADD COLUMN "performance_optimization_enabled" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "video_analytics" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "story_id" TEXT NOT NULL,
  "video_render_id" TEXT NOT NULL, "title" TEXT, "category" TEXT, "published_at" TIMESTAMP(3),
  "render_duration_ms" INTEGER, "video_duration_seconds" DOUBLE PRECISION,
  "generation_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "rendering_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "total_production_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0,
  "cost_is_estimate" BOOLEAN NOT NULL DEFAULT true,
  "platforms_published_count" INTEGER NOT NULL DEFAULT 0,
  "aggregate_views" BIGINT, "aggregate_likes" BIGINT, "aggregate_comments" BIGINT,
  "aggregate_shares" BIGINT, "aggregate_engagement" BIGINT,
  "aggregation_method" TEXT NOT NULL DEFAULT 'sum_available_platforms_only',
  "platforms_with_views_count" INTEGER NOT NULL DEFAULT 0,
  "platforms_with_engagement_count" INTEGER NOT NULL DEFAULT 0,
  "performance_status" "ContentPerformanceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "last_synced_at" TIMESTAMP(3), "cost_breakdown" JSONB NOT NULL DEFAULT '{}',
  "metadata" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "video_analytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "platform_post_analytics" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "publish_record_id" TEXT NOT NULL,
  "video_analytics_id" TEXT, "video_render_id" TEXT, "channel_id" TEXT,
  "platform" "SocialPlatform" NOT NULL, "provider_post_id" TEXT, "post_url" TEXT,
  "published_at" TIMESTAMP(3), "views" BIGINT, "reach" BIGINT, "impressions" BIGINT,
  "likes" BIGINT, "comments" BIGINT, "shares" BIGINT, "saves" BIGINT,
  "watch_time_seconds" DOUBLE PRECISION, "average_watch_seconds" DOUBLE PRECISION,
  "completion_rate" DOUBLE PRECISION, "engagement_rate" DOUBLE PRECISION,
  "followers_gained" INTEGER, "metric_availability" JSONB NOT NULL DEFAULT '{}',
  "metric_source" "AnalyticsMetricSource" NOT NULL DEFAULT 'UNAVAILABLE',
  "last_successful_sync_at" TIMESTAMP(3), "last_sync_attempt_at" TIMESTAMP(3),
  "last_sync_error" TEXT, "sync_fail_count" INTEGER NOT NULL DEFAULT 0,
  "raw_provider_response" JSONB, "platform_metric_notes" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_post_analytics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_snapshots" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "window_type" TEXT NOT NULL,
  "window_start" TIMESTAMP(3) NOT NULL, "window_end" TIMESTAMP(3) NOT NULL,
  "snapshot_key" TEXT NOT NULL, "scope" TEXT NOT NULL DEFAULT 'overview',
  "platform" "SocialPlatform", "metrics" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "analytics_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_performance_summaries" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "dimension" TEXT NOT NULL,
  "dimension_value" TEXT NOT NULL, "platform" "SocialPlatform", "sample_size" INTEGER NOT NULL DEFAULT 0,
  "date_from" TIMESTAMP(3) NOT NULL, "date_to" TIMESTAMP(3) NOT NULL,
  "avg_views" DOUBLE PRECISION, "avg_engagement" DOUBLE PRECISION,
  "avg_engagement_rate" DOUBLE PRECISION, "avg_completion_rate" DOUBLE PRECISION,
  "avg_cost_usd" DOUBLE PRECISION, "total_views" BIGINT,
  "performance_status" "ContentPerformanceStatus" NOT NULL DEFAULT 'UNKNOWN',
  "supporting_metrics" JSONB NOT NULL DEFAULT '{}', "summary_key" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "content_performance_summaries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cost_breakdowns" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "scope_type" TEXT NOT NULL,
  "scope_key" TEXT NOT NULL, "story_id" TEXT, "video_render_id" TEXT, "provider" TEXT,
  "stage" TEXT, "period_start" TIMESTAMP(3), "period_end" TIMESTAMP(3),
  "estimated_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0, "actual_cost_usd" DECIMAL(12,6),
  "is_estimate" BOOLEAN NOT NULL DEFAULT true, "usage_record_count" INTEGER NOT NULL DEFAULT 0,
  "failed_retry_cost_usd" DECIMAL(12,6) NOT NULL DEFAULT 0, "breakdown" JSONB NOT NULL DEFAULT '{}',
  "breakdown_key" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "cost_breakdowns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_sync_jobs" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "job_type" "AnalyticsSyncJobType" NOT NULL,
  "status" "AnalyticsSyncJobStatus" NOT NULL DEFAULT 'PENDING', "platform" "SocialPlatform",
  "publish_record_id" TEXT, "channel_id" TEXT, "video_render_id" TEXT, "queue_name" TEXT,
  "queue_job_id" TEXT, "attempt_count" INTEGER NOT NULL DEFAULT 0, "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "progress" INTEGER NOT NULL DEFAULT 0, "posts_targeted" INTEGER NOT NULL DEFAULT 0,
  "posts_succeeded" INTEGER NOT NULL DEFAULT 0, "posts_failed" INTEGER NOT NULL DEFAULT 0,
  "posts_skipped" INTEGER NOT NULL DEFAULT 0, "last_error" TEXT,
  "platform_results" JSONB NOT NULL DEFAULT '{}', "payload" JSONB NOT NULL DEFAULT '{}',
  "started_at" TIMESTAMP(3), "completed_at" TIMESTAMP(3), "next_retry_at" TIMESTAMP(3),
  "idempotency_key" TEXT, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "analytics_sync_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_insights" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL, "recommendation" TEXT NOT NULL,
  "supporting_metrics" JSONB NOT NULL DEFAULT '{}', "sample_size" INTEGER NOT NULL,
  "confidence" "AnalyticsInsightConfidence" NOT NULL, "platform" "SocialPlatform",
  "suggested_experiment" TEXT NOT NULL, "date_from" TIMESTAMP(3) NOT NULL,
  "date_to" TIMESTAMP(3) NOT NULL, "category" TEXT,
  "evidence_type" TEXT NOT NULL DEFAULT 'observational', "dismissed_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}', "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL, CONSTRAINT "analytics_insights_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "analytics_optimization_settings" (
  "id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "performance_optimization_enabled" BOOLEAN NOT NULL DEFAULT false,
  "min_sample_size_for_optimization" INTEGER NOT NULL DEFAULT 10,
  "prefer_strong_categories" BOOLEAN NOT NULL DEFAULT true,
  "avoid_weak_formats" BOOLEAN NOT NULL DEFAULT false,
  "suggest_duration_adjustments" BOOLEAN NOT NULL DEFAULT true,
  "suggest_caption_experiments" BOOLEAN NOT NULL DEFAULT true,
  "diversity_floor_percent" INTEGER NOT NULL DEFAULT 30,
  "insight_lookback_days" INTEGER NOT NULL DEFAULT 90,
  "sync_recent_hours" INTEGER NOT NULL DEFAULT 6, "sync_older_hours" INTEGER NOT NULL DEFAULT 48,
  "recent_post_max_age_days" INTEGER NOT NULL DEFAULT 7,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "analytics_optimization_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "video_analytics_video_render_id_key" ON "video_analytics"("video_render_id");
CREATE INDEX "video_analytics_user_id_idx" ON "video_analytics"("user_id");
CREATE INDEX "video_analytics_story_id_idx" ON "video_analytics"("story_id");
CREATE INDEX "video_analytics_published_at_idx" ON "video_analytics"("published_at");
CREATE INDEX "video_analytics_category_idx" ON "video_analytics"("category");
CREATE INDEX "video_analytics_user_id_published_at_idx" ON "video_analytics"("user_id","published_at");
CREATE INDEX "video_analytics_performance_status_idx" ON "video_analytics"("performance_status");
CREATE UNIQUE INDEX "platform_post_analytics_publish_record_id_key" ON "platform_post_analytics"("publish_record_id");
CREATE INDEX "platform_post_analytics_user_id_idx" ON "platform_post_analytics"("user_id");
CREATE INDEX "platform_post_analytics_platform_idx" ON "platform_post_analytics"("platform");
CREATE INDEX "platform_post_analytics_video_render_id_idx" ON "platform_post_analytics"("video_render_id");
CREATE INDEX "platform_post_analytics_channel_id_idx" ON "platform_post_analytics"("channel_id");
CREATE INDEX "platform_post_analytics_published_at_idx" ON "platform_post_analytics"("published_at");
CREATE INDEX "platform_post_analytics_user_id_platform_published_at_idx" ON "platform_post_analytics"("user_id","platform","published_at");
CREATE INDEX "platform_post_analytics_last_successful_sync_at_idx" ON "platform_post_analytics"("last_successful_sync_at");
CREATE UNIQUE INDEX "analytics_snapshots_snapshot_key_key" ON "analytics_snapshots"("snapshot_key");
CREATE INDEX "analytics_snapshots_user_id_idx" ON "analytics_snapshots"("user_id");
CREATE INDEX "analytics_snapshots_window_start_window_end_idx" ON "analytics_snapshots"("window_start","window_end");
CREATE INDEX "analytics_snapshots_user_id_window_type_idx" ON "analytics_snapshots"("user_id","window_type");
CREATE UNIQUE INDEX "content_performance_summaries_summary_key_key" ON "content_performance_summaries"("summary_key");
CREATE INDEX "content_performance_summaries_user_id_idx" ON "content_performance_summaries"("user_id");
CREATE INDEX "content_performance_summaries_dimension_dimension_value_idx" ON "content_performance_summaries"("dimension","dimension_value");
CREATE INDEX "content_performance_summaries_user_id_dimension_idx" ON "content_performance_summaries"("user_id","dimension");
CREATE UNIQUE INDEX "cost_breakdowns_breakdown_key_key" ON "cost_breakdowns"("breakdown_key");
CREATE INDEX "cost_breakdowns_user_id_idx" ON "cost_breakdowns"("user_id");
CREATE INDEX "cost_breakdowns_scope_type_idx" ON "cost_breakdowns"("scope_type");
CREATE INDEX "cost_breakdowns_provider_idx" ON "cost_breakdowns"("provider");
CREATE INDEX "cost_breakdowns_story_id_idx" ON "cost_breakdowns"("story_id");
CREATE INDEX "cost_breakdowns_video_render_id_idx" ON "cost_breakdowns"("video_render_id");
CREATE INDEX "cost_breakdowns_user_id_scope_type_period_start_idx" ON "cost_breakdowns"("user_id","scope_type","period_start");
CREATE UNIQUE INDEX "analytics_sync_jobs_idempotency_key_key" ON "analytics_sync_jobs"("idempotency_key");
CREATE INDEX "analytics_sync_jobs_user_id_idx" ON "analytics_sync_jobs"("user_id");
CREATE INDEX "analytics_sync_jobs_status_idx" ON "analytics_sync_jobs"("status");
CREATE INDEX "analytics_sync_jobs_job_type_idx" ON "analytics_sync_jobs"("job_type");
CREATE INDEX "analytics_sync_jobs_user_id_status_idx" ON "analytics_sync_jobs"("user_id","status");
CREATE INDEX "analytics_sync_jobs_next_retry_at_idx" ON "analytics_sync_jobs"("next_retry_at");
CREATE INDEX "analytics_insights_user_id_idx" ON "analytics_insights"("user_id");
CREATE INDEX "analytics_insights_confidence_idx" ON "analytics_insights"("confidence");
CREATE INDEX "analytics_insights_user_id_created_at_idx" ON "analytics_insights"("user_id","created_at");
CREATE UNIQUE INDEX "analytics_optimization_settings_user_id_key" ON "analytics_optimization_settings"("user_id");

ALTER TABLE "video_analytics" ADD CONSTRAINT "video_analytics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "video_analytics" ADD CONSTRAINT "video_analytics_video_render_id_fkey" FOREIGN KEY ("video_render_id") REFERENCES "video_renders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_post_analytics" ADD CONSTRAINT "platform_post_analytics_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_post_analytics" ADD CONSTRAINT "platform_post_analytics_publish_record_id_fkey" FOREIGN KEY ("publish_record_id") REFERENCES "publish_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_post_analytics" ADD CONSTRAINT "platform_post_analytics_video_analytics_id_fkey" FOREIGN KEY ("video_analytics_id") REFERENCES "video_analytics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "platform_post_analytics" ADD CONSTRAINT "platform_post_analytics_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "social_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "analytics_snapshots" ADD CONSTRAINT "analytics_snapshots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_performance_summaries" ADD CONSTRAINT "content_performance_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cost_breakdowns" ADD CONSTRAINT "cost_breakdowns_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_sync_jobs" ADD CONSTRAINT "analytics_sync_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_insights" ADD CONSTRAINT "analytics_insights_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "analytics_optimization_settings" ADD CONSTRAINT "analytics_optimization_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
