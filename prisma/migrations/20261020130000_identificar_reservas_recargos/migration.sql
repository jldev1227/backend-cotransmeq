-- Un formulario conserva su asignación al revalidar; sin identidad cada clic
-- de Regenerar avanzaba el contador aunque su número siguiera disponible.
CREATE TABLE "recargos_planillas_reservas" (
  "id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "prefijo" VARCHAR(5) NOT NULL,
  "numero" BIGINT NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recargos_planillas_reservas_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recargos_planillas_reservas_numero_check" CHECK ("numero" > 0)
);

CREATE UNIQUE INDEX "recargos_planillas_reservas_prefijo_numero_key"
  ON "recargos_planillas_reservas"("prefijo", "numero");
