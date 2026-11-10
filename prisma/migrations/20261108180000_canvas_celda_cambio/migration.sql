CREATE TABLE IF NOT EXISTS canvas_celda_cambio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scope varchar(40) NOT NULL,
  anio integer NOT NULL,
  mes integer NOT NULL,
  sheet_key varchar(150),
  entity_type varchar(60) NOT NULL,
  entity_id varchar(200) NOT NULL,
  field varchar(200) NOT NULL,
  valor_anterior jsonb,
  valor_nuevo jsonb,
  usuario_id uuid,
  usuario_nombre varchar(200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS canvas_celda_cambio_hoja_idx
  ON canvas_celda_cambio (scope, anio, mes, sheet_key, created_at DESC);
CREATE INDEX IF NOT EXISTS canvas_celda_cambio_entidad_idx
  ON canvas_celda_cambio (scope, entity_id, created_at DESC);
