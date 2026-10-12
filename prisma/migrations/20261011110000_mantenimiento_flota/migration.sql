-- Mantenimiento de flota: planes preventivos y órdenes de trabajo.
--
-- MOTIVO
--
-- `vehicle_maintenance_plan` y `vehicle_maintenance_event` nacieron con el
-- centro de cumplimiento PESV (20260904100000) pero nunca tuvieron API ni
-- pantalla: hoy están vacías. Esta migración las completa para que sean el
-- módulo de mantenimiento de verdad, en vez de crear tablas paralelas.
--
-- QUÉ AÑADE
--
--   1. Estado `EN_CURSO` en `enum_pesv_mantenimiento_estado`. La orden de
--      trabajo va abierta (PROGRAMADO) → en curso (EN_CURSO) → cerrada
--      (EJECUTADO) o anulada (CANCELADO). Se reutilizan los valores que ya
--      existían para no romper el indicador CPMVH del PESV, que lee EJECUTADO.
--   2. En el plan: `categoria` (qué se hace: aceite, frenos, llantas…),
--      `periodicidad_meses` (la gente piensa en «cada seis meses», no en 182
--      días) y `ultimo_evento_id` (la orden que dejó el plan donde está).
--      `ultimo_evento_id` va SIN clave foránea: una segunda relación entre las
--      mismas dos tablas obligaría a renombrar la que ya existe en Prisma.
--   3. En la orden: consecutivo legible (OT 12), número de factura, costo de
--      repuestos y de mano de obra por separado (el `costo` existente queda
--      como total), el detalle de repuestos como lista y las marcas de tiempo
--      de cada cambio de estado.
--   4. `vehicle_maintenance_attachment`: varias facturas y fotos por orden. La
--      columna `s3_key` de la orden admitía una sola.
--
-- QUÉ NO HACE
--
-- No toca una sola fila: las tablas están vacías en las dos bases. Tampoco
-- toca `mantenimientos`, que es un concepto de nómina y no de flota.
--
-- `ALTER TYPE … ADD VALUE` puede ir dentro de una transacción desde
-- PostgreSQL 12, siempre que el valor nuevo no se use en la misma; aquí no se
-- usa. Es idempotente y se puede reintentar entera.

ALTER TYPE "enum_pesv_mantenimiento_estado" ADD VALUE IF NOT EXISTS 'EN_CURSO' AFTER 'PROGRAMADO';

-- AlterTable: plan
ALTER TABLE "vehicle_maintenance_plan" ADD COLUMN IF NOT EXISTS "categoria" VARCHAR(40),
ADD COLUMN IF NOT EXISTS "periodicidad_meses" INTEGER,
ADD COLUMN IF NOT EXISTS "ultimo_evento_id" UUID;

-- AlterTable: orden de trabajo
-- El consecutivo va en un bloque aparte: `ADD COLUMN IF NOT EXISTS … SERIAL`
-- crea la secuencia aunque la columna ya exista, y un reintento dejaría una
-- secuencia huérfana.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'vehicle_maintenance_event' AND column_name = 'consecutivo'
  ) THEN
    ALTER TABLE "vehicle_maintenance_event" ADD COLUMN "consecutivo" SERIAL;
  END IF;
END $$;

ALTER TABLE "vehicle_maintenance_event" ADD COLUMN IF NOT EXISTS "numero_factura" VARCHAR(60),
ADD COLUMN IF NOT EXISTS "costo_repuestos" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "costo_mano_obra" DECIMAL(14,2),
ADD COLUMN IF NOT EXISTS "repuestos_detalle" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "iniciado_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "cerrado_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "anulado_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "motivo_anulacion" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "vehicle_maintenance_event_consecutivo_key" ON "vehicle_maintenance_event"("consecutivo");

-- El costo por periodo filtra por la fecha en que se cerró la orden.
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_event_fecha_ejecucion_idx" ON "vehicle_maintenance_event"("fecha_ejecucion");

-- CreateTable: adjuntos de la orden
CREATE TABLE IF NOT EXISTS "vehicle_maintenance_attachment" (
    "id" UUID NOT NULL,
    "evento_id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'OTRO',
    "nombre" VARCHAR(255) NOT NULL,
    "mimetype" VARCHAR(100) NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "s3_key" VARCHAR(500) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_maintenance_attachment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "vehicle_maintenance_attachment_evento_id_idx" ON "vehicle_maintenance_attachment"("evento_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_attachment_evento_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_attachment" ADD CONSTRAINT "vehicle_maintenance_attachment_evento_id_fkey" FOREIGN KEY ("evento_id") REFERENCES "vehicle_maintenance_event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
