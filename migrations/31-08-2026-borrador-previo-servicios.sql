-- ═══════════════════════════════════════════════════════════════════════════
--  BORRADOR PREVIO DE LIQUIDACIONES DE SERVICIOS
--
--  Cubre la fase en la que el autoguardado TODAVÍA NO PUEDE crear la fila real:
--  `cliente_id` y `consecutivo` son obligatorios en `liquidacion_servicio`, así
--  que hasta que el usuario elija cliente y escriba consecutivo no hay nada que
--  insertar. Ese hueco es justo donde hoy se pierde el trabajo.
--
--  Calcada de `liquidacion_tercero_ocasional_draft`, que ya existe y funciona,
--  con UNA diferencia: aquí `liquidacion_id` es NULLABLE, porque el caso «aún
--  no hay fila» no existe en el módulo ocasional.
--
--  LO EJECUTA UNA PERSONA, NUNCA UN AGENTE.
--  El COMMIT lo escribes tú. NO usar `prisma migrate dev`.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS liquidacion_servicio_draft (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    usuario_id     UUID        NOT NULL,
    -- NULL = borrador de una liquidación que todavía no existe.
    liquidacion_id UUID        NULL,
    -- Exactamente lo que devuelve `buildDraftPayload()` en el editor. Ese
    -- objeto ya era el DTO; no hay nada que diseñar aquí.
    payload        JSONB       NOT NULL,
    version        INTEGER     NOT NULL DEFAULT 1,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT liquidacion_servicio_draft_usuario_fkey
        -- `users`, no `usuarios`: ese es el nombre del MODELO de Prisma, que
        -- lleva `@@map("users")`. La tabla real siempre se ha llamado `users`,
        -- como confirman el resto de FK del repo.
        FOREIGN KEY (usuario_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT liquidacion_servicio_draft_liquidacion_fkey
        FOREIGN KEY (liquidacion_id) REFERENCES liquidacion_servicio (id) ON DELETE CASCADE
);

-- ─── Los dos índices únicos, y por qué son dos ─────────────────────────────
--
-- Un `UNIQUE (usuario_id, liquidacion_id)` normal NO sirve: en Postgres dos
-- NULL no colisionan entre sí, así que el mismo usuario podría acumular
-- infinitos borradores «nuevos» y ninguno sería el bueno.
--
-- Con índices parciales se dice lo que de verdad se quiere: UNO por usuario
-- para el borrador sin liquidación, y UNO por (liquidación, usuario) para los
-- que ya cuelgan de una fila.
--
-- Prisma no sabe expresar índices únicos parciales, así que en `schema.prisma`
-- van declarados como `@@index` normales y la unicidad vive solo aquí. Por eso
-- el servicio usa `findFirst` + `create`/`update` en transacción y no `upsert`.
CREATE UNIQUE INDEX IF NOT EXISTS liq_svc_draft_nuevo_uq
    ON liquidacion_servicio_draft (usuario_id)
 WHERE liquidacion_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS liq_svc_draft_liq_uq
    ON liquidacion_servicio_draft (liquidacion_id, usuario_id)
 WHERE liquidacion_id IS NOT NULL;

-- Para el barrido de borradores viejos.
CREATE INDEX IF NOT EXISTS liq_svc_draft_updated_idx
    ON liquidacion_servicio_draft (updated_at);

-- ─── CONTROL ───────────────────────────────────────────────────────────────
DO $$
DECLARE faltan INTEGER;
BEGIN
    SELECT count(*) INTO faltan
      FROM pg_indexes
     WHERE tablename = 'liquidacion_servicio_draft'
       AND indexname IN ('liq_svc_draft_nuevo_uq', 'liq_svc_draft_liq_uq');
    IF faltan <> 2 THEN
        RAISE EXCEPTION
            'Faltan índices únicos parciales (encontrados %). Sin ellos un usuario acumula borradores duplicados.',
            faltan;
    END IF;
END $$;

-- El COMMIT lo escribes tú.
-- COMMIT;
