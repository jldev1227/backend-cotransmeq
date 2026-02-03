-- Migration: Add deleted_at column to vehiculos table for soft delete
-- Date: 20-01-2026
-- Description: Adds deleted_at timestamp column to enable soft delete functionality

ALTER TABLE vehiculos 
ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Add index for better query performance when filtering by deleted_at
CREATE INDEX IF NOT EXISTS idx_vehiculos_deleted_at ON vehiculos(deleted_at);

-- Comment
COMMENT ON COLUMN vehiculos.deleted_at IS 'Timestamp when the vehicle was soft deleted. NULL means the vehicle is active.';
