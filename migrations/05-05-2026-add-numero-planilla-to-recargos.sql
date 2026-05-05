-- Migration: add numero_planilla column to recargos table
-- Date: 2026-05-05

ALTER TABLE "public"."recargos"
  ADD COLUMN IF NOT EXISTS "numero_planilla" VARCHAR(50);
