-- Crear enum si no existe
DO $$ BEGIN
  CREATE TYPE estado_factura_liq_enum AS ENUM ('ACTIVA', 'ANULADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Crear tabla factura_liquidacion_servicio
CREATE TABLE IF NOT EXISTS factura_liquidacion_servicio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  numero_factura VARCHAR(50) NOT NULL UNIQUE,
  fecha_facturacion TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  observaciones TEXT,
  valor_total DECIMAL(14,2) NOT NULL DEFAULT 0,
  estado estado_factura_liq_enum NOT NULL DEFAULT 'ACTIVA',
  facturado_por_id UUID NOT NULL REFERENCES users(id),
  anulado_por_id UUID REFERENCES users(id),
  motivo_anulacion TEXT,
  fecha_anulacion TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_factura_liq_numero ON factura_liquidacion_servicio(numero_factura);
CREATE INDEX IF NOT EXISTS idx_factura_liq_fecha ON factura_liquidacion_servicio(fecha_facturacion);
CREATE INDEX IF NOT EXISTS idx_factura_liq_estado ON factura_liquidacion_servicio(estado);
CREATE INDEX IF NOT EXISTS idx_factura_liq_facturado ON factura_liquidacion_servicio(facturado_por_id);

-- Crear tabla factura_liquidacion_item
CREATE TABLE IF NOT EXISTS factura_liquidacion_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id UUID NOT NULL REFERENCES factura_liquidacion_servicio(id) ON DELETE CASCADE,
  liquidacion_id UUID NOT NULL REFERENCES liquidacion_servicio(id),
  valor_liquidacion DECIMAL(14,2) NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  UNIQUE(factura_id, liquidacion_id)
);

CREATE INDEX IF NOT EXISTS idx_factura_liq_item_factura ON factura_liquidacion_item(factura_id);
CREATE INDEX IF NOT EXISTS idx_factura_liq_item_liq ON factura_liquidacion_item(liquidacion_id);
