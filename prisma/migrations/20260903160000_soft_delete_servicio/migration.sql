-- Borrado lógico de servicios.
--
-- MOTIVO
--
-- `servicio.delete()` borraba en duro, y el comentario del propio código lo
-- admitía: «hard delete por ahora». Un servicio eliminado se llevaba consigo
-- todo lo que colgara de él y no dejaba forma de saber qué había: ni el
-- consecutivo, ni el cliente, ni el valor.
--
-- La función ya marcaba con `deleted_at` los `recargos_planillas` asociados
-- —esos sí tenían la columna—, así que quedaba un estado a medias: los
-- recargos se podían recuperar y el servicio que los originó, no.
--
-- QUÉ HACE
--
--   1. `deleted_at` en `servicio`.
--   2. Índices parciales `WHERE deleted_at IS NULL` sobre las dos rutas de
--      consulta reales del módulo: por cliente y por conductor.
--
-- QUÉ NO HACE
--
-- No toca una sola fila: `deleted_at` nace NULL. No interfiere con el estado
-- `cancelado` del enum, que es una situación de negocio —el servicio existió y
-- no se prestó— y no lo mismo que borrarlo.
--
-- El modelo Prisma se llama `servicio` pero la tabla es `servicios` (@@map).
--
-- Es idempotente.

ALTER TABLE servicios
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS servicio_activos_cliente_idx
  ON servicios (cliente_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS servicio_activos_conductor_idx
  ON servicios (conductor_id)
  WHERE deleted_at IS NULL;
