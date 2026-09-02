-- ═══════════════════════════════════════════════════════════════════════════
--  AUTOGUARDADO DE LIQUIDACIONES DE SERVICIOS
--
--  Tres columnas en `liquidacion_servicio` para que un borrador a medio
--  escribir viva en el servidor —persistente y abrible por otro usuario— en vez
--  de solo en el `localStorage` de quien lo teclea.
--
--  LO EJECUTA UNA PERSONA, NUNCA UN AGENTE. Va aparte del SQL de operadoras a
--  propósito: son dos cambios independientes y cada uno se aplica cuando toque.
--
--  Este archivo abre transacción y NO la cierra: el COMMIT lo escribes tú tras
--  leer la salida de los controles del final.
--
--  NO usar `prisma migrate dev`. El historial está en reconciliación (rama
--  `fix/migraciones-baseline`) y `migrate dev` puede proponer un reset.
--
--  Las tres columnas llevan default constante o son NULL, así que en PG 11+ no
--  reescriben la tabla: el ALTER es instantáneo aunque haya muchas filas.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── PASO 1 · `version` — testigo del compare-and-swap ─────────────────────
--
-- `updated_at` NO sirve para esto: es `@updatedAt`, así que cambia por cosas
-- que no son edición del usuario (un cambio de estado, un soft delete), y dos
-- autoguardados dentro del mismo milisegundo son indistinguibles. Un entero que
-- solo incrementa el propio autoguardado sí distingue «nadie tocó esto desde
-- que lo leí» de «alguien escribió en medio».
ALTER TABLE liquidacion_servicio
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- ─── PASO 2 · `confirmada_at` — la frontera de la visibilidad ──────────────
--
-- NULL significa «esta fila nació de un autoguardado y nadie ha pulsado
-- Guardar todavía». Es lo que la mantiene fuera del listado, del canvas y de
-- las notificaciones del resto del mundo: para los demás, una liquidación nace
-- cuando alguien la guarda a propósito, no cuando alguien empieza a teclearla.
--
-- Las filas que YA existen se marcan como confirmadas: todas se crearon con un
-- Guardar explícito, que es lo único que había hasta ahora.
ALTER TABLE liquidacion_servicio
    ADD COLUMN IF NOT EXISTS confirmada_at TIMESTAMPTZ NULL;

UPDATE liquidacion_servicio
   SET confirmada_at = COALESCE(created_at, NOW())
 WHERE confirmada_at IS NULL;

-- ─── PASO 3 · `cliente_key` — idempotencia del alta ───────────────────────
--
-- La genera el editor, una por sesión de edición. Sin esto, dos autoguardados
-- en vuelo a la vez —el debounce dispara, la red tarda, el usuario sigue
-- escribiendo— crean DOS liquidaciones, porque ninguno de los dos conoce
-- todavía el id que devolvió el otro.
--
-- Índice único PARCIAL: en Postgres los NULL no colisionan entre sí, pero un
-- índice único normal sobre una columna casi toda NULL es peso muerto. Con el
-- `WHERE` solo indexa las que de verdad tienen clave.
ALTER TABLE liquidacion_servicio
    ADD COLUMN IF NOT EXISTS cliente_key UUID NULL;

CREATE UNIQUE INDEX IF NOT EXISTS liquidacion_servicio_cliente_key_uq
    ON liquidacion_servicio (cliente_key)
 WHERE cliente_key IS NOT NULL;

-- Para el barrido de borradores viejos y para el filtro de visibilidad.
CREATE INDEX IF NOT EXISTS liquidacion_servicio_sin_confirmar_idx
    ON liquidacion_servicio (confirmada_at)
 WHERE deleted_at IS NULL;

-- ─── CONTROLES ─────────────────────────────────────────────────────────────

-- (1) Ninguna liquidación preexistente puede quedar sin confirmar: se
--     volvería invisible en el listado de todo el mundo, que es justo el
--     accidente que este cambio no puede permitirse.
DO $$
DECLARE invisibles BIGINT;
BEGIN
    SELECT count(*) INTO invisibles
      FROM liquidacion_servicio
     WHERE confirmada_at IS NULL
       AND deleted_at IS NULL;
    IF invisibles > 0 THEN
        RAISE EXCEPTION
            'HAY % liquidaciones sin confirmar tras la migración. Deberían ser 0: todas las existentes se crearon con un Guardar explícito.',
            invisibles;
    END IF;
END $$;

-- (2) Y la versión arranca en 1 para todas, que es lo que el cliente asumirá
--     como `base_version` la primera vez.
DO $$
DECLARE raras BIGINT;
BEGIN
    SELECT count(*) INTO raras FROM liquidacion_servicio WHERE version IS NULL OR version < 1;
    IF raras > 0 THEN
        RAISE EXCEPTION 'HAY % liquidaciones con version inválida.', raras;
    END IF;
END $$;

SELECT count(*) AS total,
       count(*) FILTER (WHERE confirmada_at IS NOT NULL) AS confirmadas,
       count(*) FILTER (WHERE cliente_key IS NOT NULL)   AS con_clave
  FROM liquidacion_servicio
 WHERE deleted_at IS NULL;

-- El COMMIT lo escribes tú, tras leer el resumen de arriba.
-- COMMIT;
