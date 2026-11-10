CREATE TABLE IF NOT EXISTS liquidacion_ingreso_periodo_snapshot (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anio integer NOT NULL,
  mes integer NOT NULL,
  version integer NOT NULL,
  rama varchar(60) NOT NULL DEFAULT 'main',
  origen varchar(20) NOT NULL DEFAULT 'manual',
  usuario_id uuid NULL,
  revertido_de_id uuid NULL,
  payload jsonb NOT NULL,
  diff jsonb NULL,
  created_at timestamptz(6) NOT NULL DEFAULT now(),
  CONSTRAINT ingreso_periodo_snapshot_usuario_fkey FOREIGN KEY (usuario_id) REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT ingreso_periodo_snapshot_revertido_fkey FOREIGN KEY (revertido_de_id) REFERENCES liquidacion_ingreso_periodo_snapshot(id) ON DELETE SET NULL,
  CONSTRAINT ingreso_periodo_snapshot_version_key UNIQUE (anio, mes, version)
);
CREATE INDEX IF NOT EXISTS ingreso_periodo_snapshot_scope_idx ON liquidacion_ingreso_periodo_snapshot(anio, mes, rama);
CREATE INDEX IF NOT EXISTS ingreso_periodo_snapshot_created_idx ON liquidacion_ingreso_periodo_snapshot(created_at);
CREATE INDEX IF NOT EXISTS ingreso_periodo_snapshot_usuario_idx ON liquidacion_ingreso_periodo_snapshot(usuario_id);
