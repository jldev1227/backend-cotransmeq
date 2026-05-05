-- Migration: add incluir and emisor columns to recargos table
-- Date: 2026-05-05

ALTER TABLE "public"."recargos"
  ADD COLUMN IF NOT EXISTS "incluir" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "emisor" VARCHAR(50);
