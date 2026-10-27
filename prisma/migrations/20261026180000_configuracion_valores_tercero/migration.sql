CREATE TABLE IF NOT EXISTS "configuracion_valores_tercero" (
  "id" VARCHAR(20) NOT NULL DEFAULT 'global',
  "valor_dia_conductor_nomina" DECIMAL(12,2) NOT NULL DEFAULT 78629.9,
  "valor_salario_manual" DECIMAL(12,2) NOT NULL DEFAULT 69510,
  "valor_auxilio_transporte_manual" DECIMAL(12,2) NOT NULL DEFAULT 8303,
  "valor_bonificacion_manual" DECIMAL(12,2) NOT NULL DEFAULT 26061,
  "valor_bonificacion_turno_doble_manual" DECIMAL(12,2) NOT NULL DEFAULT 25000,
  "valor_dotacion" DECIMAL(12,2) NOT NULL DEFAULT 3985,
  "valor_examen_medico" DECIMAL(12,2) NOT NULL DEFAULT 2882,
  "actualizado_por_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "configuracion_valores_tercero_pkey" PRIMARY KEY ("id")
);

INSERT INTO "configuracion_valores_tercero" ("id", "valor_dia_conductor_nomina")
SELECT
  'global',
  COALESCE(
    (
      SELECT "valor_dia_conductor"
      FROM "configuracion_descuento_tercero"
      WHERE "valor_dia_conductor" IS NOT NULL
      ORDER BY "categoria" ASC, "orden" ASC
      LIMIT 1
    ),
    78629.9
  )
ON CONFLICT ("id") DO NOTHING;
