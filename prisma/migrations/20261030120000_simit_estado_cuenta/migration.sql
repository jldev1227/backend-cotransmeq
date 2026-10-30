-- Historial inmutable de consultas al estado de cuenta SIMIT.
CREATE TABLE "simit_consultas" (
    "id" UUID NOT NULL,
    "tipo_entidad" VARCHAR(20) NOT NULL,
    "identificador" VARCHAR(255) NOT NULL,
    "proveedor" VARCHAR(40),
    "estado_consulta" VARCHAR(30) NOT NULL,
    "comparendos" INTEGER,
    "multas" INTEGER,
    "acuerdos_pago" INTEGER,
    "saldo_total" DECIMAL(14,2),
    "detalle" JSONB,
    "error" TEXT,
    "consultado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vehiculo_id" UUID,
    "conductor_id" UUID,
    CONSTRAINT "simit_consultas_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "simit_consultas_tipo_entidad_check" CHECK ("tipo_entidad" IN ('vehiculo', 'conductor')),
    CONSTRAINT "simit_consultas_estado_check" CHECK ("estado_consulta" IN ('sin_deuda', 'con_deuda', 'error')),
    CONSTRAINT "simit_consultas_vehiculo_fkey" FOREIGN KEY ("vehiculo_id")
        REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "simit_consultas_conductor_fkey" FOREIGN KEY ("conductor_id")
        REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE INDEX "simit_consultas_vehiculo_fecha_idx"
    ON "simit_consultas"("vehiculo_id", "consultado_at" DESC);
CREATE INDEX "simit_consultas_conductor_fecha_idx"
    ON "simit_consultas"("conductor_id", "consultado_at" DESC);
CREATE INDEX "simit_consultas_fecha_idx"
    ON "simit_consultas"("consultado_at" DESC);
