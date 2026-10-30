CREATE TABLE "cap_archivos" (
  "id" UUID NOT NULL,
  "curso_id" UUID NOT NULL,
  "nombre" VARCHAR(255) NOT NULL,
  "tipo" VARCHAR(20) NOT NULL,
  "mime" VARCHAR(120) NOT NULL,
  "tamano" INTEGER NOT NULL,
  "clave" TEXT NOT NULL,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "cap_archivos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "cap_archivos_clave_key" ON "cap_archivos"("clave");
CREATE INDEX "cap_archivos_curso_id_created_at_idx" ON "cap_archivos"("curso_id", "created_at");
ALTER TABLE "cap_archivos" ADD CONSTRAINT "cap_archivos_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "cap_cursos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
