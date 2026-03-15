-- Migration: add conductor_id FK to documentos_compartidos
ALTER TABLE IF EXISTS documentos_compartidos
  ADD COLUMN IF NOT EXISTS conductor_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fk_documentos_compartidos_conductor_id'
  ) THEN
    ALTER TABLE documentos_compartidos
      ADD CONSTRAINT fk_documentos_compartidos_conductor_id FOREIGN KEY (conductor_id) REFERENCES conductores(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_documentos_compartidos_conductor_id ON documentos_compartidos (conductor_id);
