ALTER TABLE "cap_cursos"
  ADD COLUMN "codigo" VARCHAR(50),
  ADD COLUMN "slug" VARCHAR(200),
  ADD COLUMN "duracion_horas" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "configuracion" JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX "cap_cursos_codigo_key" ON "cap_cursos"("codigo");
CREATE UNIQUE INDEX "cap_cursos_slug_key" ON "cap_cursos"("slug");
