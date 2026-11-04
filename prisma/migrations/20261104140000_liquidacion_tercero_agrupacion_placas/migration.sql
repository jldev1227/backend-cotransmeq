CREATE TABLE "liquidacion_tercero_final_vehiculo" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "cierre_origen_id" UUID NOT NULL,
    "liquidacion_servicio_id" UUID NOT NULL,
    "vehiculo_id" UUID,
    "placa" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_final_vehiculo_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "liquidacion_tercero_final_vehiculo_cierre_origen_id_key"
    ON "liquidacion_tercero_final_vehiculo"("cierre_origen_id");

CREATE INDEX "idx_lt_final_vehiculo_cierre_placa"
    ON "liquidacion_tercero_final_vehiculo"("liquidacion_tercero_final_id", "placa");

ALTER TABLE "liquidacion_tercero_final_vehiculo"
    ADD CONSTRAINT "liquidacion_tercero_final_vehiculo_liquidacion_tercero_final_id_fkey"
    FOREIGN KEY ("liquidacion_tercero_final_id")
    REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "liquidacion_tercero_final_vehiculo"
    ADD CONSTRAINT "liquidacion_tercero_final_vehiculo_cierre_origen_id_fkey"
    FOREIGN KEY ("cierre_origen_id")
    REFERENCES "liquidacion_tercero_final"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
