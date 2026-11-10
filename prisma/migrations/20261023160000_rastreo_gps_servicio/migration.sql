-- El conductor inicia este rastreo con consentimiento explícito por servicio.
-- No se migra ni se presume ubicación de recorridos anteriores.
CREATE TABLE "servicio_rastreo_sesion" (
    "id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "consentimiento_at" TIMESTAMPTZ(6) NOT NULL,
    "consentimiento_version" VARCHAR(40) NOT NULL,
    "plataforma" VARCHAR(10) NOT NULL,
    "iniciado_at" TIMESTAMPTZ(6) NOT NULL,
    "finalizado_at" TIMESTAMPTZ(6),
    "motivo_finalizacion" VARCHAR(80),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicio_rastreo_sesion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "servicio_rastreo_sesion_plataforma_check" CHECK ("plataforma" IN ('ios', 'android')),
    CONSTRAINT "servicio_rastreo_sesion_cierre_check" CHECK (
        ("finalizado_at" IS NULL AND "motivo_finalizacion" IS NULL) OR
        ("finalizado_at" IS NOT NULL AND "motivo_finalizacion" IS NOT NULL)
    ),
    CONSTRAINT "servicio_rastreo_sesion_servicio_fkey" FOREIGN KEY ("servicio_id")
        REFERENCES "servicios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "servicio_rastreo_sesion_conductor_fkey" FOREIGN KEY ("conductor_id")
        REFERENCES "conductores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "servicio_rastreo_sesion_servicio_idx"
    ON "servicio_rastreo_sesion"("servicio_id", "iniciado_at");
CREATE INDEX "servicio_rastreo_sesion_conductor_idx"
    ON "servicio_rastreo_sesion"("conductor_id", "iniciado_at");
CREATE INDEX "servicio_rastreo_sesion_finalizado_idx"
    ON "servicio_rastreo_sesion"("finalizado_at");
-- Solo puede existir una sesión activa por servicio, incluso en dos teléfonos.
CREATE UNIQUE INDEX "servicio_rastreo_sesion_servicio_activo_key"
    ON "servicio_rastreo_sesion"("servicio_id") WHERE "finalizado_at" IS NULL;
-- Un conductor solo puede rastrear un servicio a la vez desde la app.
CREATE UNIQUE INDEX "servicio_rastreo_sesion_conductor_activo_key"
    ON "servicio_rastreo_sesion"("conductor_id") WHERE "finalizado_at" IS NULL;

CREATE TABLE "servicio_rastreo_punto" (
    "id" UUID NOT NULL,
    "sesion_id" UUID NOT NULL,
    "latitud" DOUBLE PRECISION NOT NULL,
    "longitud" DOUBLE PRECISION NOT NULL,
    "precision_m" DOUBLE PRECISION NOT NULL,
    "velocidad_mps" DOUBLE PRECISION,
    "rumbo_grados" DOUBLE PRECISION,
    "capturado_at" TIMESTAMPTZ(6) NOT NULL,
    "recibido_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "servicio_rastreo_punto_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "servicio_rastreo_punto_latitud_check" CHECK ("latitud" BETWEEN -90 AND 90),
    CONSTRAINT "servicio_rastreo_punto_longitud_check" CHECK ("longitud" BETWEEN -180 AND 180),
    CONSTRAINT "servicio_rastreo_punto_precision_check" CHECK ("precision_m" BETWEEN 0 AND 10000),
    CONSTRAINT "servicio_rastreo_punto_velocidad_check" CHECK ("velocidad_mps" IS NULL OR "velocidad_mps" BETWEEN 0 AND 150),
    CONSTRAINT "servicio_rastreo_punto_rumbo_check" CHECK ("rumbo_grados" IS NULL OR ("rumbo_grados" >= 0 AND "rumbo_grados" < 360)),
    CONSTRAINT "servicio_rastreo_punto_sesion_fkey" FOREIGN KEY ("sesion_id")
        REFERENCES "servicio_rastreo_sesion"("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE INDEX "servicio_rastreo_punto_sesion_capturado_idx"
    ON "servicio_rastreo_punto"("sesion_id", "capturado_at");
