-- Borrado lógico de las liquidaciones de nómina.
--
-- MOTIVO
--
-- `eliminar()` destruía la liquidación Y SIETE TABLAS HIJAS en una transacción:
-- bonificaciones, mantenimientos, pernotes, recargos, anticipos,
-- liquidacion_vehiculo y `firmas_desprendibles`. Esta última es la FIRMA DEL
-- CONDUCTOR sobre su desprendible: la prueba de que recibió y aceptó su pago.
-- Un clic borraba la nómina de una persona y la evidencia de que la había
-- firmado, sin dejar el periodo, el valor ni la fecha.
--
-- QUÉ HACE
--
-- `deleted_at` en `liquidaciones`, y un índice parcial por conductor, que es la
-- ruta de consulta del módulo y del portal.
--
-- QUÉ NO HACE
--
-- No añade la columna a las siete hijas, y a propósito: ya no hace falta
-- destruirlas. Al marcar la madre, todas quedan colgando de algo que ninguna
-- consulta devuelve, y siguen ahí enteras para cuando haya que reconstruir. Es
-- la misma decisión que se tomó con el historial de las liquidaciones de
-- servicios: la evidencia no se toca.
--
-- No toca una sola fila: `deleted_at` nace NULL.
--
-- Es idempotente.

ALTER TABLE liquidaciones
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS liquidaciones_activas_conductor_idx
  ON liquidaciones (conductor_id)
  WHERE deleted_at IS NULL;
