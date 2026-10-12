-- Cartera (cuentas por cobrar) sobre las facturas de liquidaciones de servicios.
--
-- Hasta aquí la factura era un número digitado ligado a liquidaciones: no se
-- sabía cuándo se emitió, cuándo vencía ni cuánto había pagado el cliente.
--
-- 1. La factura gana sus condiciones de cobro:
--    - `cliente_id`: a quién se le cobra. Se derivaba de las liquidaciones
--      ligadas en cada consulta; guardado, una factura sigue siendo de su
--      cliente aunque se le quiten todas las liquidaciones.
--    - `fecha_emision`, `plazo_dias`, `fecha_vencimiento`: la fecha de la
--      factura electrónica (no la de registro en el sistema, que es
--      `fecha_facturacion`) y su vencimiento.
--    - `ajuste_valor`: diferencia entre lo facturado y la suma de las
--      liquidaciones. `valor_total` sigue siendo LO QUE SE COBRA y vale
--      siempre suma + ajuste; así, asociar o quitar una liquidación después de
--      corregir el valor a mano no borra la corrección.
-- 2. Tabla de abonos, con las retenciones que aplica el cliente.
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261011120000_cartera_facturas

ALTER TABLE factura_liquidacion_servicio
  ADD COLUMN IF NOT EXISTS cliente_id        uuid,
  ADD COLUMN IF NOT EXISTS fecha_emision     date,
  ADD COLUMN IF NOT EXISTS plazo_dias        integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS fecha_vencimiento date,
  ADD COLUMN IF NOT EXISTS ajuste_valor      decimal(14, 2) NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'factura_liq_cliente_fkey') THEN
    ALTER TABLE factura_liquidacion_servicio
      ADD CONSTRAINT factura_liq_cliente_fkey FOREIGN KEY (cliente_id)
      REFERENCES empresas (id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'factura_liq_plazo_chk') THEN
    ALTER TABLE factura_liquidacion_servicio
      ADD CONSTRAINT factura_liq_plazo_chk CHECK (plazo_dias BETWEEN 0 AND 365);
  END IF;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────

-- Cliente: el de sus liquidaciones vivas. Hoy ninguna factura mezcla clientes;
-- si alguna lo hiciera, se queda con el de mayor valor.
UPDATE factura_liquidacion_servicio f
SET cliente_id = x.cliente_id
FROM (
  SELECT DISTINCT ON (i.factura_id) i.factura_id, l.cliente_id
  FROM factura_liquidacion_item i
  JOIN liquidacion_servicio l ON l.id = i.liquidacion_id
  WHERE i.deleted_at IS NULL AND l.cliente_id IS NOT NULL
  GROUP BY i.factura_id, l.cliente_id
  ORDER BY i.factura_id, SUM(i.valor_liquidacion) DESC
) x
WHERE f.id = x.factura_id AND f.cliente_id IS NULL;

-- Valor: la suma de las liquidaciones ligadas (pivotes vivos), sin ajuste.
-- Solo facturas no eliminadas y solo si difiere: las activas ya cuadran.
UPDATE factura_liquidacion_servicio f
SET valor_total = s.suma
FROM (
  SELECT factura_id, SUM(valor_liquidacion) AS suma
  FROM factura_liquidacion_item
  WHERE deleted_at IS NULL
  GROUP BY factura_id
) s
WHERE f.id = s.factura_id
  AND f.deleted_at IS NULL
  AND f.ajuste_valor = 0
  AND f.valor_total <> s.suma;

-- Emisión: el día (hora de Colombia) en que se registró. Vencimiento a 30 días.
UPDATE factura_liquidacion_servicio
SET fecha_emision = (created_at AT TIME ZONE 'America/Bogota')::date
WHERE fecha_emision IS NULL;

UPDATE factura_liquidacion_servicio
SET fecha_vencimiento = fecha_emision + plazo_dias
WHERE fecha_vencimiento IS NULL;

-- Los defaults solo cubren inserciones que no los manden (scripts, tests): el
-- servicio siempre escribe la fecha de Colombia explícita.
ALTER TABLE factura_liquidacion_servicio
  ALTER COLUMN fecha_emision SET DEFAULT CURRENT_DATE,
  ALTER COLUMN fecha_emision SET NOT NULL,
  ALTER COLUMN fecha_vencimiento SET DEFAULT (CURRENT_DATE + 30),
  ALTER COLUMN fecha_vencimiento SET NOT NULL;

CREATE INDEX IF NOT EXISTS factura_liq_cliente_idx     ON factura_liquidacion_servicio (cliente_id);
CREATE INDEX IF NOT EXISTS factura_liq_vencimiento_idx ON factura_liquidacion_servicio (fecha_vencimiento);

-- ── Abonos ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS factura_liquidacion_abono (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  factura_id          uuid NOT NULL REFERENCES factura_liquidacion_servicio (id) ON DELETE CASCADE,
  fecha               date NOT NULL,
  -- Lo que entró al banco.
  valor               decimal(14, 2) NOT NULL DEFAULT 0,
  -- Lo que el cliente descontó y no paga: también baja el saldo.
  retefuente          decimal(14, 2) NOT NULL DEFAULT 0,
  reteica             decimal(14, 2) NOT NULL DEFAULT 0,
  reteiva             decimal(14, 2) NOT NULL DEFAULT 0,
  otros_descuentos    decimal(14, 2) NOT NULL DEFAULT 0,
  medio               varchar(20) NOT NULL,
  referencia          varchar(120),
  comprobante_s3_key  text,
  comprobante_nombre  varchar(255),
  comprobante_mime    varchar(100),
  observaciones       text,
  creado_por_id       uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  eliminado_por_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  motivo_eliminacion  text,
  CONSTRAINT factura_abono_medio_chk
    CHECK (medio IN ('TRANSFERENCIA', 'CONSIGNACION', 'CHEQUE', 'EFECTIVO', 'OTRO')),
  CONSTRAINT factura_abono_no_negativos_chk
    CHECK (valor >= 0 AND retefuente >= 0 AND reteica >= 0 AND reteiva >= 0 AND otros_descuentos >= 0),
  CONSTRAINT factura_abono_algo_chk
    CHECK (valor + retefuente + reteica + reteiva + otros_descuentos > 0)
);

CREATE INDEX IF NOT EXISTS factura_abono_factura_idx ON factura_liquidacion_abono (factura_id);
CREATE INDEX IF NOT EXISTS factura_abono_fecha_idx   ON factura_liquidacion_abono (fecha);
