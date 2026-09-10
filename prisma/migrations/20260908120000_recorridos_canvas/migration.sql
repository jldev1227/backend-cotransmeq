-- Canvas de recorridos: concurrencia optimista por celda y snapshots de periodo.
--
-- Escrita a mano y NO aplicada por `prisma migrate dev`: el historial de
-- migraciones de este proyecto está desalineado con la base real y `migrate
-- dev`/`deploy` ofrecen un reset que vacía tablas. Se aplica ejecutando este
-- SQL dentro de una transacción y marcándolo después con
-- `prisma migrate resolve --applied 20260908120000_recorridos_canvas`.
--
-- Todo es aditivo: columnas nuevas con DEFAULT y una tabla nueva. No borra ni
-- reescribe nada; los DROP de reversión están comentados al final.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Concurrencia optimista (compare-and-swap) del canvas
-- ─────────────────────────────────────────────────────────────────────────
--
-- El protocolo `sheet:patch` convierte cada edición de celda en un CAS:
-- `UPDATE ... WHERE id = ? AND version = ?`. Sin columna `version` no hay
-- forma de detectar que otro usuario escribió antes, y el último en guardar
-- pisaría el cambio del primero sin que ninguno se entere.
--
-- Va en las DOS tablas porque el canvas tiene dos clases de fila:
--   · una fila POR SEGMENTO (el recorrido: cliente, placa, horario, pernocte)
--   · una fila placeholder por DÍA sin segmentos (DESCANSO, MANTENIMIENTO),
--     que solo puede editar campos del padre.
-- Los bonos no llevan versión propia: se marcan y desmarcan contra la fila
-- que los contiene, así que el CAS del segmento (o del día) los cubre.

ALTER TABLE "registro_dia_laboral"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "registro_dia_laboral_segmento"
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN "registro_dia_laboral"."version" IS
  'Concurrencia optimista del canvas de recorridos (CAS por celda) para las filas de día sin segmento.';
COMMENT ON COLUMN "registro_dia_laboral_segmento"."version" IS
  'Concurrencia optimista del canvas de recorridos (CAS por celda). Cubre también el marcado de bonos del tramo.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Snapshots del periodo
-- ─────────────────────────────────────────────────────────────────────────
--
-- Misma forma EXACTA que `nomina_periodo_snapshot` y que
-- `liquidacion_tercero_final_snapshot`, para que el `SnapshotPanel` del
-- frontend sirva sin tocarlo.
--
-- La identidad es el PERIODO (anio, mes) y no el conductor: revertir la hoja
-- de una sola persona dejaría el libro descuadrado frente a los bonos, que se
-- cuentan por mes y placa cruzando a todos los conductores.

CREATE TABLE IF NOT EXISTS "recorridos_periodo_snapshot" (
  "id"              UUID         NOT NULL DEFAULT gen_random_uuid(),
  "anio"            INTEGER      NOT NULL,
  "mes"             INTEGER      NOT NULL,
  "rama"            VARCHAR(60)  NOT NULL DEFAULT 'main',
  "version"         INTEGER      NOT NULL,
  "origen"          VARCHAR(20)  NOT NULL DEFAULT 'manual',
  "revertido_de_id" UUID,
  "usuario_id"      UUID,
  "payload"         JSONB        NOT NULL,
  "diff"            JSONB,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "recorridos_periodo_snapshot_pkey" PRIMARY KEY ("id")
);

-- El UNIQUE es lo que hace segura la numeración: `reservarVersionSnapshot`
-- toma un `pg_advisory_xact_lock` antes de leer el máximo, y este índice es
-- la red por si alguna vez se insertara fuera de esa función.
CREATE UNIQUE INDEX IF NOT EXISTS "recorridos_periodo_snapshot_anio_mes_version_key"
  ON "recorridos_periodo_snapshot" ("anio", "mes", "version");

CREATE INDEX IF NOT EXISTS "recorridos_periodo_snapshot_periodo_rama_idx"
  ON "recorridos_periodo_snapshot" ("anio", "mes", "rama");
CREATE INDEX IF NOT EXISTS "recorridos_periodo_snapshot_created_idx"
  ON "recorridos_periodo_snapshot" ("created_at");
CREATE INDEX IF NOT EXISTS "recorridos_periodo_snapshot_usuario_idx"
  ON "recorridos_periodo_snapshot" ("usuario_id");

-- ⚠️ El modelo Prisma se llama `usuarios` pero la TABLA es `users` (@@map en
-- schema.prisma). Escribir `usuarios` aquí hace fallar la migración con
-- «relation "usuarios" does not exist».
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recorridos_periodo_snapshot_usuario_fkey'
  ) THEN
    ALTER TABLE "recorridos_periodo_snapshot"
      ADD CONSTRAINT "recorridos_periodo_snapshot_usuario_fkey"
      FOREIGN KEY ("usuario_id") REFERENCES "users"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recorridos_periodo_snapshot_revertido_de_fkey'
  ) THEN
    ALTER TABLE "recorridos_periodo_snapshot"
      ADD CONSTRAINT "recorridos_periodo_snapshot_revertido_de_fkey"
      FOREIGN KEY ("revertido_de_id") REFERENCES "recorridos_periodo_snapshot"("id")
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- Reversión (comentada a propósito)
-- ─────────────────────────────────────────────────────────────────────────
-- DROP TABLE IF EXISTS "recorridos_periodo_snapshot";
-- ALTER TABLE "registro_dia_laboral_segmento" DROP COLUMN IF EXISTS "version";
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "version";
