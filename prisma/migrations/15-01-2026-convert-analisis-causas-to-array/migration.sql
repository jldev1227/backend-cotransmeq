-- AlterTable: Convert analisis_causas from TEXT to TEXT[] (array of strings)
-- This migration converts the field to support the 5 whys methodology properly

-- First, alter the column type to text array
ALTER TABLE "acciones_correctivas_preventivas" 
ALTER COLUMN "analisis_causas" TYPE TEXT[] USING 
CASE 
  WHEN "analisis_causas" IS NULL THEN NULL
  WHEN "analisis_causas" = '' THEN ARRAY[]::TEXT[]
  ELSE ARRAY["analisis_causas"]::TEXT[]
END;

-- Set default value to empty array
ALTER TABLE "acciones_correctivas_preventivas" 
ALTER COLUMN "analisis_causas" SET DEFAULT ARRAY[]::TEXT[];
