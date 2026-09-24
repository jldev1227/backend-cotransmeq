-- La copia propia del conductor: los días del corte que edita la liquidación.
--
-- Hasta ahora el canvas DERIVABA los días de `recargos_planillas` en cada
-- lectura, así que corregir una hora obligaba a editar la planilla —el
-- documento que se le cobra al cliente— o a pasar por una tabla de ajustes.
-- Esta tabla es el borrador editable: se copia de las planillas al generar el
-- borrador y a partir de ahí vive por su cuenta.
--
-- Aditiva e idempotente: el historial de migraciones de este proyecto no
-- coincide con el de la base, así que se aplica con `psql --single-transaction`
-- y se registra con `prisma migrate resolve`.

CREATE TABLE IF NOT EXISTS "liquidaciones_dias" (
    "id"                     UUID         NOT NULL,
    "liquidacion_id"         UUID         NOT NULL,
    "fecha"                  DATE         NOT NULL,
    -- Un conductor con dos servicios el mismo día ocupa dos columnas; esto
    -- dice cuál de las dos es. 0 para la primera.
    "ocurrencia"             INTEGER      NOT NULL DEFAULT 0,
    -- Hora decimal (5.5 = 05:30), como la guarda la planilla.
    "hora_inicio"            DECIMAL(5,2),
    "hora_fin"               DECIMAL(5,2),
    "total_horas"            DECIMAL(6,2) NOT NULL DEFAULT 0,
    "es_festivo"             BOOLEAN      NOT NULL DEFAULT false,
    "es_domingo"             BOOLEAN      NOT NULL DEFAULT false,
    "disponibilidad"         BOOLEAN      NOT NULL DEFAULT false,
    "pernocte"               BOOLEAN      NOT NULL DEFAULT false,
    "continua_siguiente_dia" BOOLEAN      NOT NULL DEFAULT false,
    "empresa_id"             UUID,
    "vehiculo_id"            UUID,
    -- Placa COPIADA, no resuelta al leer: si el vehículo se da de baja o cambia
    -- de placa, el borrador debe seguir diciendo con qué carro se trabajó. Es
    -- el mismo criterio que `registro_dia_laboral.mantenimiento_vehiculo_placa`.
    "placa"                  VARCHAR(20),
    -- Horas por código: `{"RN": 2, "HED": 3}`. Van en JSON y no en siete
    -- columnas porque el conjunto de códigos lo decide `tipos_recargos`, no el
    -- esquema, y una fila se lee y se escribe entera.
    "horas"                  JSONB        NOT NULL DEFAULT '{}'::jsonb,
    "deleted_at"             TIMESTAMPTZ(6),
    "created_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"             TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "liquidaciones_dias_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "liquidaciones_dias"
        ADD CONSTRAINT "liquidaciones_dias_liquidacion_id_fkey"
        FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id")
        ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "liquidaciones_dias_liquidacion_id_idx"
    ON "liquidaciones_dias"("liquidacion_id");
CREATE INDEX IF NOT EXISTS "liquidaciones_dias_deleted_at_idx"
    ON "liquidaciones_dias"("deleted_at");

-- Una fila viva por liquidación, fecha y ocurrencia. Parcial porque el
-- soft-delete deja filas antiguas con la misma clave.
CREATE UNIQUE INDEX IF NOT EXISTS "liquidaciones_dias_vivo_idx"
    ON "liquidaciones_dias"("liquidacion_id", "fecha", "ocurrencia")
    WHERE "deleted_at" IS NULL;
