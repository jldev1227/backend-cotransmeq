-- Agregar campos share_token a la tabla liquidaciones para compartir desprendibles
ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE;
ALTER TABLE liquidaciones ADD COLUMN IF NOT EXISTS share_token_expires_at TIMESTAMPTZ;

-- Índice para búsquedas rápidas por token
CREATE INDEX IF NOT EXISTS idx_liquidaciones_share_token ON liquidaciones(share_token) WHERE share_token IS NOT NULL;
