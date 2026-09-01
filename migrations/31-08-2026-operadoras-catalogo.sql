-- ═══════════════════════════════════════════════════════════════════════════
--  CATÁLOGO DE OPERADORAS + FK DESDE liquidacion_servicio
--
--  Se aplica DE UNA VEZ. Ya no hay que parar a mitad para sembrar el catálogo:
--  el PASO 3 lo deriva de lo que hay escrito en `liquidacion_servicio.operadora`,
--  así que por construcción contiene todos los códigos que el backfill busca.
--
--  Antes el orden era: crear tabla → parar → correr el seed a mano → seguir. Ese
--  paso manual es el que se salta cualquiera que ejecute el archivo entero, y el
--  síntoma era «BACKFILL INCOMPLETO: N liquidaciones …» sin decir qué códigos
--  faltaban. Además obligaba a mantener una lista escrita a mano POR EMPRESA:
--  el seed de cotransmeq es copia del de transmeralda y sus operadoras no son
--  las mismas.
--
--  Opcional, después y cuando se quiera:
--    `npm run seeds:operadoras:cargar -- --apply`
--  hace `upsert` por código, así que solo corrige nombres y orden («PAREX» →
--  «Parex»). No hace falta para que la migración funcione.
--
--  Este archivo abre transacción y NO la cierra: el COMMIT lo escribes tú,
--  después de leer la salida de los tres controles del final. Si alguno no
--  cuadra, el bloque lanza excepción y la transacción queda abortada, que es
--  lo que se quiere.
--
--  NO usar `prisma migrate dev` para esto. El historial de migraciones está
--  en reconciliación (rama `fix/migraciones-baseline`) y `migrate dev` puede
--  proponer un reset. Este SQL se aplica a mano, como los demás de esta
--  carpeta.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── PASO 1 · La tabla ─────────────────────────────────────────────────────
--
-- `codigo` normalizado (upper+trim) es la clave estable: la comparten el
-- backfill, el seed y las altas del CRUD. `nombre` es la etiqueta visible y sí
-- se puede editar.
--
-- `activo` existe para poder retirar una operadora sin romper la FK de las
-- liquidaciones que ya la referencian. `orden` porque el <select> del editor
-- necesita un orden estable que no sea el alfabético.
CREATE TABLE IF NOT EXISTS operadoras (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    codigo     VARCHAR(40)  NOT NULL,
    nombre     VARCHAR(120) NOT NULL,
    activo     BOOLEAN      NOT NULL DEFAULT TRUE,
    orden      INTEGER      NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── PASO 2 · Índices ──────────────────────────────────────────────────────
-- La unicidad va sobre `codigo` y no sobre `nombre`: el nombre es editable.
CREATE UNIQUE INDEX IF NOT EXISTS operadoras_codigo_key
    ON operadoras (codigo);
CREATE INDEX IF NOT EXISTS operadoras_activo_orden_idx
    ON operadoras (activo, orden);

-- ─── PASO 3 · Siembra DERIVADA de los datos ────────────────────────────────
--
-- El catálogo sale de lo que YA está escrito en `liquidacion_servicio.operadora`,
-- que es texto libre. Antes este paso era manual —«para aquí y corre el seed»—
-- y el archivo advertía de completar la lista si el inventario mostraba un
-- código nuevo. Ese aviso es exactamente el que se salta cualquiera que ejecute
-- el SQL de una vez, y el resultado era el control (1) abortando con
-- «BACKFILL INCOMPLETO: N liquidaciones con operadora escrita y sin
-- operadora_id», sin manera de saber de un vistazo qué códigos faltaban.
--
-- Derivándolo de los datos, el catálogo NO PUEDE quedarse corto: por
-- construcción contiene todos los códigos que el backfill va a buscar. El
-- control (1) deja de ser un muro y pasa a ser lo que debía ser, una red que no
-- debería dispararse nunca.
--
-- `upper(btrim(...))` es la MISMA normalización que usa el backfill del paso
-- siguiente y que `normalizarCodigo()` del seed. Si divergieran, esto sembraría
-- un código y el backfill buscaría otro.
--
-- `ON CONFLICT DO NOTHING` lo hace idempotente y respeta lo que ya exista: si
-- el seed corrió antes con nombres cuidados («Parex», «GeoPark»), no se pisan.
--
-- `orden` arranca en 101 y sube alfabéticamente, para que el desplegable tenga
-- un orden estable aunque nadie haya curado la lista. El seed
-- (`npm run seeds:operadoras:cargar -- --apply`) sigue siendo útil DESPUÉS:
-- hace `upsert` por código, así que corrige nombre y orden sin duplicar nada.
--
-- Lo que este paso NO hace es limpiar erratas: si alguien escribió «PAREXX» a
-- mano, entra como operadora propia. Entrar al catálogo y quedar visible en el
-- CRUD para fusionarla es mejor que bloquear la migración entera.
INSERT INTO operadoras (id, codigo, nombre, activo, orden)
SELECT gen_random_uuid(),
       c.codigo,
       c.codigo,
       TRUE,
       100 + (row_number() OVER (ORDER BY c.codigo))::int
  FROM (
      SELECT DISTINCT upper(btrim(operadora)) AS codigo
        FROM liquidacion_servicio
       WHERE operadora IS NOT NULL
         AND btrim(operadora) <> ''
  ) c
ON CONFLICT (codigo) DO NOTHING;

-- ─── PASO 4 · La columna, NULLABLE ─────────────────────────────────────────
--
-- Nunca NOT NULL: hay liquidaciones históricas con `operadora IS NULL` y no
-- existe un valor correcto que inventarles. NULL significa «anterior al
-- campo», que no es lo mismo que 'OTRA' —el default que escribe el editor—.
-- Perder esa distinción sería perder información.
ALTER TABLE liquidacion_servicio
    ADD COLUMN IF NOT EXISTS operadora_id UUID NULL;

-- ─── PASO 5 · Backfill ─────────────────────────────────────────────────────
--
-- El WHERE deja los NULL intactos por construcción.
UPDATE liquidacion_servicio ls
   SET operadora_id = o.id
  FROM operadoras o
 WHERE ls.operadora IS NOT NULL
   AND btrim(ls.operadora) <> ''
   AND o.codigo = upper(btrim(ls.operadora))
   AND ls.operadora_id IS DISTINCT FROM o.id;

-- ─── PASO 6 · La FK, en dos tiempos ────────────────────────────────────────
--
-- `NOT VALID` primero y `VALIDATE` después: así la validación de las filas
-- existentes no bloquea las escrituras de la tabla mientras corre.
--
-- ON DELETE RESTRICT y no SET NULL: borrar una operadora que tiene
-- liquidaciones jamás debe vaciar el dato en silencio. Para retirarla del
-- <select> está `activo = false`.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'liquidacion_servicio_operadora_id_fkey'
    ) THEN
        ALTER TABLE liquidacion_servicio
            ADD CONSTRAINT liquidacion_servicio_operadora_id_fkey
            FOREIGN KEY (operadora_id) REFERENCES operadoras (id)
            ON DELETE RESTRICT ON UPDATE CASCADE
            NOT VALID;
    END IF;
END $$;

ALTER TABLE liquidacion_servicio
    VALIDATE CONSTRAINT liquidacion_servicio_operadora_id_fkey;

CREATE INDEX IF NOT EXISTS liquidacion_servicio_operadora_id_idx
    ON liquidacion_servicio (operadora_id);

-- ─── CONTROLES ─────────────────────────────────────────────────────────────
--
-- Van DENTRO de la transacción a propósito: si alguno falla, lanza y deja la
-- transacción abortada, así que un ROLLBACK devuelve la base a como estaba.

-- (1) Ninguna liquidación con operadora escrita se quedó sin mapear.
--     Si esto salta, falta un código en el seed: míralo con el inventario,
--     añádelo, y vuelve a empezar.
DO $$
DECLARE huerfanas BIGINT;
BEGIN
    SELECT count(*) INTO huerfanas
      FROM liquidacion_servicio
     WHERE operadora IS NOT NULL
       AND btrim(operadora) <> ''
       AND operadora_id IS NULL;
    IF huerfanas > 0 THEN
        RAISE EXCEPTION
            'BACKFILL INCOMPLETO: % liquidaciones con operadora escrita y sin operadora_id. Faltan códigos en el catálogo.',
            huerfanas;
    END IF;
END $$;

-- (2) Las que no tenían operadora siguen sin tenerla. El backfill no inventa.
DO $$
DECLARE inventadas BIGINT;
BEGIN
    SELECT count(*) INTO inventadas
      FROM liquidacion_servicio
     WHERE operadora IS NULL
       AND operadora_id IS NOT NULL;
    IF inventadas > 0 THEN
        RAISE EXCEPTION
            'BACKFILL SOSPECHOSO: % liquidaciones sin operadora recibieron operadora_id.',
            inventadas;
    END IF;
END $$;

-- (3) Y el catálogo no quedó vacío, que sería el síntoma de haber aplicado
--     esto sin correr el seed.
DO $$
DECLARE cuantas BIGINT;
BEGIN
    SELECT count(*) INTO cuantas FROM operadoras;
    IF cuantas = 0 THEN
        RAISE EXCEPTION
            'CATÁLOGO VACÍO: ejecuta el seed (npm run seeds:operadoras:cargar -- --apply) antes del backfill.';
    END IF;
END $$;

-- Resumen para leer antes de decidir:
SELECT o.codigo,
       o.nombre,
       o.activo,
       count(ls.id) AS liquidaciones
  FROM operadoras o
  LEFT JOIN liquidacion_servicio ls ON ls.operadora_id = o.id
 GROUP BY o.id, o.codigo, o.nombre, o.activo
 ORDER BY o.orden, o.codigo;

-- El COMMIT lo escribes tú, tras leer el resumen de arriba.
-- COMMIT;
