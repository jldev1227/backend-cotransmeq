-- Pago de los cierres finales de terceros.
--
-- Desde el 10-oct un cierre pasa a PAGADA (antes FACTURADA) cuando la empresa
-- le paga al propietario, pero el estado no decía cuándo, por qué medio ni con
-- qué soporte. Cada paso a PAGADA deja ahora una fila aquí.
--
-- Tabla y no columnas en el cierre: si Administración devuelve un PAGADA a
-- APROBADA (se marcó por error), la fila se archiva con `deleted_at` en vez de
-- borrarse, y el siguiente paso a PAGADA crea otra. El rastro de lo que se
-- registró queda. Solo puede haber UN pago vivo por cierre.
--
-- Los cierres que ya estaban en PAGADA antes de esto no tienen fila: la UI los
-- muestra como «sin registro» y se pueden completar después.
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261011120100_pagos_cierres_terceros

CREATE TABLE IF NOT EXISTS liquidacion_tercero_final_pago (
  id                            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  liquidacion_tercero_final_id  uuid NOT NULL REFERENCES liquidacion_tercero_final (id) ON DELETE CASCADE,
  fecha                         date NOT NULL,
  medio                         varchar(20) NOT NULL,
  referencia                    varchar(120),
  -- Lo que el cierre decía pagar en ese momento: el total puede cambiar si
  -- el cierre se reabre, y el pago registrado fue por este valor.
  valor                         decimal(12, 2),
  comprobante_s3_key            text,
  comprobante_nombre            varchar(255),
  observaciones                 text,
  registrado_por_id             uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at                    timestamptz NOT NULL DEFAULT now(),
  updated_at                    timestamptz NOT NULL DEFAULT now(),
  deleted_at                    timestamptz,
  eliminado_por_id              uuid REFERENCES users (id) ON DELETE SET NULL,
  motivo_eliminacion            text,
  CONSTRAINT lt_final_pago_medio_chk
    CHECK (medio IN ('TRANSFERENCIA', 'CONSIGNACION', 'CHEQUE', 'EFECTIVO', 'OTRO'))
);

CREATE INDEX IF NOT EXISTS lt_final_pago_cierre_idx ON liquidacion_tercero_final_pago (liquidacion_tercero_final_id);

-- Un pago vivo por cierre. Parcial: los archivados conservan su fila.
CREATE UNIQUE INDEX IF NOT EXISTS lt_final_pago_activo_uniq
  ON liquidacion_tercero_final_pago (liquidacion_tercero_final_id)
  WHERE deleted_at IS NULL;
