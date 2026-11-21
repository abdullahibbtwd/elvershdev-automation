-- Phase 2: structured Series character identity fields for Grok Lite prompt consistency.
ALTER TABLE "series_characters"
  ADD COLUMN IF NOT EXISTS "gender_presentation" TEXT,
  ADD COLUMN IF NOT EXISTS "skin_tone" TEXT,
  ADD COLUMN IF NOT EXISTS "hairstyle" TEXT,
  ADD COLUMN IF NOT EXISTS "facial_hair" TEXT;
