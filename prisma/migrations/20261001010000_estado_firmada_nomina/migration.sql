-- ESTADO «FIRMADA» DE LA LIQUIDACIÓN DE NÓMINA.
--
-- Hasta ahora el flujo terminaba en PAGADA y saber si el conductor ya había
-- firmado el desprendible obligaba a ir a `firmas_desprendibles`. Ahora la
-- firma desde el portal pasa la liquidación de PAGADA a FIRMADA, y el canvas,
-- el selector de hojas y el análisis lo distinguen por estado.
--
-- `estado_flujo` es VARCHAR(20) sin restricción: los estados válidos vivían
-- solo en el código (`nomina-estado.service.ts`). Este CHECK los lleva a la
-- base con el nuevo estado incluido, para que nada escriba un valor fuera
-- del flujo. Si alguna fila tuviera un valor ajeno, la migración falla aquí
-- a propósito: mejor saberlo que taparlo.
ALTER TABLE "liquidaciones"
  DROP CONSTRAINT IF EXISTS "liquidaciones_estado_flujo_check";
ALTER TABLE "liquidaciones"
  ADD CONSTRAINT "liquidaciones_estado_flujo_check"
  CHECK ("estado_flujo" IN ('BORRADOR', 'LIQUIDADA', 'APROBADA', 'PAGADA', 'FIRMADA', 'ANULADA'));

-- Lo ya firmado pasa a FIRMADA: toda liquidación PAGADA con una firma activa
-- real (no el marcador «pending» que deja la solicitud por correo).
-- Primero el historial, para que quede escrito quién lo hizo: nadie (fue la
-- migración), con el motivo explicado.
INSERT INTO "historial_estado_liquidacion_nomina"
  ("id", "liquidacion_id", "estado_anterior", "estado_nuevo", "usuario_id", "motivo", "created_at")
SELECT gen_random_uuid(), l."id", 'PAGADA', 'FIRMADA', NULL,
       'Migración: el desprendible ya estaba firmado por el conductor', now()
FROM "liquidaciones" l
WHERE l."estado_flujo" = 'PAGADA'
  AND l."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "firmas_desprendibles" f
    WHERE f."liquidacion_id" = l."id"
      AND f."estado" = 'Activa'
      AND f."firma_url" NOT IN ('', 'pending')
  );

UPDATE "liquidaciones" l
SET "estado_flujo" = 'FIRMADA',
    "version"      = l."version" + 1,
    "updated_at"   = now()
WHERE l."estado_flujo" = 'PAGADA'
  AND l."deleted_at" IS NULL
  AND EXISTS (
    SELECT 1 FROM "firmas_desprendibles" f
    WHERE f."liquidacion_id" = l."id"
      AND f."estado" = 'Activa'
      AND f."firma_url" NOT IN ('', 'pending')
  );
