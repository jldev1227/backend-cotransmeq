-- Borrado lógico en el árbol de liquidaciones de servicios.
--
-- MOTIVO
--
-- Una liquidación se restauró poniendo `deleted_at = NULL` y quedó vacía: sus
-- `liquidacion_servicio_item` no tenían `deleted_at` y la cascada
-- `ON DELETE CASCADE` ya los había borrado FÍSICAMENTE. Con ellos se fueron
-- los `liquidacion_tercero` que cuelgan de cada ítem, y de estos sus
-- conceptos. La cabecera sobrevivió con unos totales que no correspondían a
-- ninguna fila.
--
-- Además, la edición y el autoguardado reemplazaban los ítems con
-- `deleteMany` + `createMany`: cada guardado destruía los anteriores, así que
-- un payload vacío —una pestaña que se cierra antes de hidratar, una respuesta
-- que llega tarde— borraba la liquidación entera sin dejar rastro.
--
-- QUÉ HACE
--
--   1. `deleted_at` en las cuatro tablas del árbol que no lo tenían.
--   2. `client_key` en los ítems, para poder correlacionarlos al reconciliar
--      sin depender de la posición, que cambia al reordenar.
--   3. Índices parciales `WHERE deleted_at IS NULL`, que son los que usan las
--      consultas normales.
--   4. La unicidad de `factura_liquidacion_item` pasa a parcial: sin eso, una
--      liquidación cuyo ítem de factura se eliminó lógicamente no se podría
--      volver a facturar nunca.
--   5. Tabla de auditoría de eliminación y restauración.
--
-- QUÉ NO HACE
--
-- No toca una sola fila existente: `deleted_at` nace NULL, que significa
-- «activo». No modifica historial ni snapshots — son evidencia—. No retira las
-- cascadas: siguen siendo la red de seguridad para un borrado físico
-- deliberado; lo que cambia es que la aplicación deja de llegar a él.
--
-- Es idempotente: `IF NOT EXISTS` en todo. Ejecutarla dos veces no falla.

-- ─────────────────────────────────────────────────────────────────────
-- 1. deleted_at
-- ─────────────────────────────────────────────────────────────────────

ALTER TABLE liquidacion_servicio_item
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

ALTER TABLE liquidacion_tercero
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

ALTER TABLE liquidacion_tercero_concepto
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

ALTER TABLE factura_liquidacion_item
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 2. client_key: correlación estable de ítems
-- ─────────────────────────────────────────────────────────────────────
--
-- El frontend manda `id` en los ítems que ya existen y `client_key` en los que
-- acaba de crear y todavía no tienen id de servidor. La reconciliación empareja
-- por `id`, luego por `client_key`, y NUNCA por posición: `orden` cambia al
-- arrastrar una fila, y emparejar por índice de array mezcla los datos de dos
-- ítems distintos sin que nada falle.
--
-- Nace NULL en las 1112 filas existentes; esas se correlacionan por `id`, que
-- es lo que el frontend ya manda para lo que está guardado.

ALTER TABLE liquidacion_servicio_item
  ADD COLUMN IF NOT EXISTS client_key uuid NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Índices parciales
-- ─────────────────────────────────────────────────────────────────────
--
-- Parciales y no completos porque toda consulta de negocio lleva
-- `deleted_at IS NULL`: el índice es más pequeño y no carga con las filas
-- eliminadas, que solo se consultan desde las vistas de auditoría.

CREATE INDEX IF NOT EXISTS liquidacion_servicio_item_activos_idx
  ON liquidacion_servicio_item (liquidacion_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS liquidacion_tercero_activos_idx
  ON liquidacion_tercero (liquidacion_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS liquidacion_tercero_concepto_activos_idx
  ON liquidacion_tercero_concepto (liquidacion_tercero_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS factura_liquidacion_item_activos_idx
  ON factura_liquidacion_item (factura_id)
  WHERE deleted_at IS NULL;

-- Correlación por client_key dentro de una liquidación. Único y parcial: dos
-- ítems activos de la misma liquidación no pueden compartir `client_key`, pero
-- uno eliminado no bloquea que se cree otro con la misma clave.
CREATE UNIQUE INDEX IF NOT EXISTS liquidacion_servicio_item_client_key_uniq
  ON liquidacion_servicio_item (liquidacion_id, client_key)
  WHERE deleted_at IS NULL AND client_key IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Unicidad parcial en el pivote de facturación
-- ─────────────────────────────────────────────────────────────────────
--
-- La restricción global `(factura_id, liquidacion_id)` impediría volver a
-- añadir a una factura una liquidación cuyo ítem se eliminó lógicamente: la
-- fila sigue ahí ocupando el par. Se sustituye por un índice único parcial que
-- solo mira las filas activas.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'factura_liquidacion_item_factura_id_liquidacion_id_key'
  ) THEN
    ALTER TABLE factura_liquidacion_item
      DROP CONSTRAINT factura_liquidacion_item_factura_id_liquidacion_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS factura_liquidacion_item_activo_uniq
  ON factura_liquidacion_item (factura_id, liquidacion_id)
  WHERE deleted_at IS NULL;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Auditoría de eliminación y restauración
-- ─────────────────────────────────────────────────────────────────────
--
-- Vive en el schema `auditoria`, que Prisma no gestiona: así ninguna migración
-- futura propondrá borrarla ni generará diffs fantasma sobre ella. Es el mismo
-- criterio que ya sigue `auditoria.borrado_asistencia`.
--
-- Registra QUIÉN eliminó o restauró QUÉ y CUÁNDO. No sustituye a los datos
-- operativos: es la última red para reconstruir qué pasó.

CREATE SCHEMA IF NOT EXISTS auditoria;

CREATE TABLE IF NOT EXISTS auditoria.borrado_logico (
  id           bigserial PRIMARY KEY,
  ocurrido_en  timestamptz NOT NULL DEFAULT now(),
  entidad      text        NOT NULL,
  registro_id  text        NOT NULL,
  accion       text        NOT NULL CHECK (accion IN ('ELIMINAR', 'RESTAURAR')),
  usuario_id   text        NULL,
  motivo       text        NULL,
  -- Cuántas filas relacionadas se marcaron en la misma operación, por entidad.
  -- Sirve para detectar una restauración incompleta sin recorrer las tablas.
  relacionadas jsonb       NULL
);

CREATE INDEX IF NOT EXISTS borrado_logico_entidad_registro_idx
  ON auditoria.borrado_logico (entidad, registro_id, ocurrido_en DESC);

CREATE INDEX IF NOT EXISTS borrado_logico_ocurrido_idx
  ON auditoria.borrado_logico (ocurrido_en DESC);
