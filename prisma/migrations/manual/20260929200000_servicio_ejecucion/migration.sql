-- INICIO Y LIBERACIÓN DEL SERVICIO POR EL CONDUCTOR.
--
-- `servicio_ejecucion`: 1:1 con `servicios`. Lo que hizo el conductor desde la
-- app —con qué preoperacional inició, cuándo, cuándo liberó y su reporte del
-- recorrido—. Tabla aparte para no mezclar la versión del conductor con la del
-- despacho: `servicios.fecha_realizacion` (fecha PLANEADA) no se toca, y la hora
-- de liberación declarada se copia a `servicios.fecha_finalizacion`.
--
-- Dos relojes por evento: `*_at` (servidor al recibir; en la liberación, la
-- hora declarada) y `*_dispositivo_at` (teléfono al pulsar). `*_diferido` marca
-- lo que llegó desde la cola offline.
--
-- Aditiva: tabla nueva e índices. Ningún dato existente cambia.
CREATE TABLE IF NOT EXISTS "servicio_ejecucion" (
  "servicio_id"                   UUID NOT NULL,
  "conductor_id"                  UUID NOT NULL,
  "preoperacional_submission_id"  UUID,
  "formato_elegido_por_conductor" BOOLEAN NOT NULL DEFAULT false,
  "iniciado_at"                   TIMESTAMPTZ(6),
  "iniciado_dispositivo_at"       TIMESTAMPTZ(6),
  "iniciado_diferido"             BOOLEAN NOT NULL DEFAULT false,
  "liberado_at"                   TIMESTAMPTZ(6),
  "liberado_registrado_at"        TIMESTAMPTZ(6),
  "liberado_dispositivo_at"       TIMESTAMPTZ(6),
  "liberado_diferido"             BOOLEAN NOT NULL DEFAULT false,
  "km_final"                      INTEGER,
  "via_trocha"                    BOOLEAN,
  "via_afirmado"                  BOOLEAN,
  "via_mixto"                     BOOLEAN,
  "via_pavimentada"               BOOLEAN,
  "riesgo_desniveles"             BOOLEAN,
  "riesgo_deslizamientos"         BOOLEAN,
  "riesgo_sin_senalizacion"       BOOLEAN,
  "riesgo_animales"               BOOLEAN,
  "riesgo_peatones"               BOOLEAN,
  "riesgo_trafico_alto"           BOOLEAN,
  "estado_conductor"              VARCHAR(20),
  "novedades"                     TEXT,
  "created_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "servicio_ejecucion_pkey" PRIMARY KEY ("servicio_id"),
  CONSTRAINT "servicio_ejecucion_servicio_id_fkey"
    FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "servicio_ejecucion_conductor_id_fkey"
    FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION,
  CONSTRAINT "servicio_ejecucion_preoperacional_submission_id_fkey"
    FOREIGN KEY ("preoperacional_submission_id") REFERENCES "form_submissions"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION,
  CONSTRAINT "ck_servicio_ejecucion_estado_conductor"
    CHECK ("estado_conductor" IS NULL OR "estado_conductor" IN ('optimo', 'fatigado', 'regular', 'malo'))
);

CREATE INDEX IF NOT EXISTS "idx_servicio_ejecucion_conductor"
  ON "servicio_ejecucion" ("conductor_id");
CREATE INDEX IF NOT EXISTS "idx_servicio_ejecucion_preoperacional"
  ON "servicio_ejecucion" ("preoperacional_submission_id");

-- Preoperacionales ligados a un servicio: la app y el detalle del servicio los
-- buscan por `service_id`, que hasta ahora no tenía índice.
CREATE INDEX IF NOT EXISTS "idx_form_submissions_service"
  ON "form_submissions" ("service_id");
