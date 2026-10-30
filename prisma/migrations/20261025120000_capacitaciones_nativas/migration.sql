CREATE TABLE "cap_cursos" (
  "id" UUID NOT NULL,
  "titulo" VARCHAR(180) NOT NULL,
  "descripcion" TEXT,
  "portada_url" TEXT,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'borrador',
  "puntaje_aprobacion" INTEGER NOT NULL DEFAULT 80,
  "requiere_biometria" BOOLEAN NOT NULL DEFAULT false,
  "vigencia_dias" INTEGER,
  "creado_por" UUID,
  "publicado_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "cap_cursos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_modulos" (
  "id" UUID NOT NULL,
  "curso_id" UUID NOT NULL,
  "titulo" VARCHAR(180) NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "cap_modulos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_lecciones" (
  "id" UUID NOT NULL,
  "modulo_id" UUID NOT NULL,
  "titulo" VARCHAR(180) NOT NULL,
  "tipo" VARCHAR(30) NOT NULL,
  "contenido" JSONB NOT NULL,
  "duracion_seg" INTEGER NOT NULL DEFAULT 0,
  "obligatoria" BOOLEAN NOT NULL DEFAULT true,
  "orden" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "cap_lecciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_asignaciones" (
  "id" UUID NOT NULL,
  "curso_id" UUID NOT NULL,
  "persona_tipo" VARCHAR(20) NOT NULL,
  "persona_id" UUID NOT NULL,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
  "asignado_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completado_at" TIMESTAMPTZ(6),
  "biometria_verificada_at" TIMESTAMPTZ(6),
  CONSTRAINT "cap_asignaciones_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_progresos" (
  "id" UUID NOT NULL,
  "asignacion_id" UUID NOT NULL,
  "leccion_id" UUID NOT NULL,
  "porcentaje" INTEGER NOT NULL DEFAULT 0,
  "segundos_vistos" INTEGER NOT NULL DEFAULT 0,
  "completado_at" TIMESTAMPTZ(6),
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "cap_progresos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_preguntas" (
  "id" UUID NOT NULL,
  "curso_id" UUID NOT NULL,
  "enunciado" TEXT NOT NULL,
  "opciones" JSONB NOT NULL,
  "respuesta_indice" INTEGER NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "cap_preguntas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_intentos" (
  "id" UUID NOT NULL,
  "asignacion_id" UUID NOT NULL,
  "respuestas" JSONB NOT NULL,
  "puntaje" INTEGER NOT NULL,
  "aprobado" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cap_intentos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_certificados" (
  "id" UUID NOT NULL,
  "asignacion_id" UUID NOT NULL,
  "codigo" VARCHAR(36) NOT NULL,
  "nombre" VARCHAR(200) NOT NULL,
  "emitido_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "vigente_hasta" TIMESTAMPTZ(6),
  CONSTRAINT "cap_certificados_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cap_biometria" (
  "id" UUID NOT NULL,
  "persona_tipo" VARCHAR(20) NOT NULL,
  "persona_id" UUID NOT NULL,
  "cifrado" TEXT NOT NULL,
  "iv" VARCHAR(40) NOT NULL,
  "auth_tag" VARCHAR(40) NOT NULL,
  "modelo" VARCHAR(80) NOT NULL,
  "calidad" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "cap_biometria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cap_modulos_curso_id_orden_idx" ON "cap_modulos"("curso_id", "orden");
CREATE INDEX "cap_lecciones_modulo_id_orden_idx" ON "cap_lecciones"("modulo_id", "orden");
CREATE UNIQUE INDEX "cap_asignaciones_curso_id_persona_tipo_persona_id_key" ON "cap_asignaciones"("curso_id", "persona_tipo", "persona_id");
CREATE INDEX "cap_asignaciones_persona_tipo_persona_id_idx" ON "cap_asignaciones"("persona_tipo", "persona_id");
CREATE UNIQUE INDEX "cap_progresos_asignacion_id_leccion_id_key" ON "cap_progresos"("asignacion_id", "leccion_id");
CREATE INDEX "cap_preguntas_curso_id_orden_idx" ON "cap_preguntas"("curso_id", "orden");
CREATE INDEX "cap_intentos_asignacion_id_created_at_idx" ON "cap_intentos"("asignacion_id", "created_at");
CREATE UNIQUE INDEX "cap_certificados_asignacion_id_key" ON "cap_certificados"("asignacion_id");
CREATE UNIQUE INDEX "cap_certificados_codigo_key" ON "cap_certificados"("codigo");
CREATE UNIQUE INDEX "cap_biometria_persona_tipo_persona_id_key" ON "cap_biometria"("persona_tipo", "persona_id");

ALTER TABLE "cap_modulos" ADD CONSTRAINT "cap_modulos_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "cap_cursos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_lecciones" ADD CONSTRAINT "cap_lecciones_modulo_id_fkey" FOREIGN KEY ("modulo_id") REFERENCES "cap_modulos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_asignaciones" ADD CONSTRAINT "cap_asignaciones_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "cap_cursos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_progresos" ADD CONSTRAINT "cap_progresos_asignacion_id_fkey" FOREIGN KEY ("asignacion_id") REFERENCES "cap_asignaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_progresos" ADD CONSTRAINT "cap_progresos_leccion_id_fkey" FOREIGN KEY ("leccion_id") REFERENCES "cap_lecciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_preguntas" ADD CONSTRAINT "cap_preguntas_curso_id_fkey" FOREIGN KEY ("curso_id") REFERENCES "cap_cursos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_intentos" ADD CONSTRAINT "cap_intentos_asignacion_id_fkey" FOREIGN KEY ("asignacion_id") REFERENCES "cap_asignaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cap_certificados" ADD CONSTRAINT "cap_certificados_asignacion_id_fkey" FOREIGN KEY ("asignacion_id") REFERENCES "cap_asignaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
