-- El MAX(numero_planilla) aislado devolvía el mismo valor a dos formularios
-- que consultaban a la vez. Este contador guarda cada asignación sin depender
-- de que el usuario termine guardando el recargo.
CREATE TABLE "recargos_planillas_consecutivos" (
  "prefijo" VARCHAR(5) NOT NULL,
  "ultimo_numero" BIGINT NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "recargos_planillas_consecutivos_pkey" PRIMARY KEY ("prefijo"),
  CONSTRAINT "recargos_planillas_consecutivos_ultimo_numero_check" CHECK ("ultimo_numero" >= 0)
);
