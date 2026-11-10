CREATE TABLE usuario_area_responsable (
  area VARCHAR(40) PRIMARY KEY CHECK (area IN (
    'administracion', 'operaciones', 'contabilidad', 'facturacion',
    'talento_humano', 'hseq', 'mantenimiento'
  )),
  usuario_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX usuario_area_responsable_usuario_idx ON usuario_area_responsable(usuario_id);

CREATE TABLE plan_trabajo_cargo_area (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plan_trabajo_anual(id) ON DELETE CASCADE,
  cargo VARCHAR(255) NOT NULL,
  area VARCHAR(40) NOT NULL CHECK (area IN (
    'administracion', 'operaciones', 'contabilidad', 'facturacion',
    'talento_humano', 'hseq', 'mantenimiento'
  )),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_cargo_area_plan_cargo_key UNIQUE (plan_id, cargo)
);
CREATE INDEX plan_trabajo_cargo_area_plan_area_idx ON plan_trabajo_cargo_area(plan_id, area);
