-- CreateTable
CREATE TABLE "causas_accion_correctiva" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accion_correctiva_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "analisis_causa" TEXT NOT NULL,
    "descripcion_plan_accion" TEXT,
    "fecha_limite_implementacion" DATE,
    "responsable_ejecucion" VARCHAR(255),
    "fecha_seguimiento" DATE,
    "estado_seguimiento" VARCHAR(50),
    "descripcion_observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "causas_accion_correctiva_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "causas_accion_correctiva_accion_correctiva_id_idx" ON "causas_accion_correctiva"("accion_correctiva_id");

-- CreateIndex
CREATE INDEX "causas_accion_correctiva_estado_seguimiento_idx" ON "causas_accion_correctiva"("estado_seguimiento");

-- CreateIndex
CREATE UNIQUE INDEX "causas_accion_correctiva_accion_correctiva_id_orden_key" ON "causas_accion_correctiva"("accion_correctiva_id", "orden");

-- AddForeignKey
ALTER TABLE "causas_accion_correctiva" ADD CONSTRAINT "causas_accion_correctiva_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Remove old columns from acciones_correctivas_preventivas
ALTER TABLE "acciones_correctivas_preventivas" 
DROP COLUMN IF EXISTS "analisis_causas",
DROP COLUMN IF EXISTS "descripcion_accion_plan",
DROP COLUMN IF EXISTS "fecha_limite_implementacion",
DROP COLUMN IF EXISTS "responsable_ejecucion",
DROP COLUMN IF EXISTS "fecha_seguimiento",
DROP COLUMN IF EXISTS "estado_accion_planeada",
DROP COLUMN IF EXISTS "descripcion_estado_observaciones";
