-- ============================================================================
-- Quitar el campo `vehiculo` (LOOKUP/VEHICLE) de las semillas HSEQ publicadas.
--
-- POR QUÉ HACE FALTA ESTE SQL
--
-- Las semillas dejaron de emitir el campo, pero `cargar.ts` es UPSERT-ONLY: en
-- ningún punto borra filas. El bucle simplemente ya no visita ese campo, así que
-- la fila que creó una carga anterior se queda intacta en `form_fields`, con su
-- `version_id` y su `section_id`, y el formulario la sigue mostrando. Volver a
-- correr el cargador NO la elimina, por muchas veces que se sincronice.
--
-- El campo es además indiligenciable: el portal no tiene renderer para `LOOKUP`
-- (`FieldRenderer.svelte` solo pinta el snapshot y cae en «Sin seleccionar»), así
-- que nunca recibe valor. En FR-08 y FR-09 está `required: true` con
-- `visibilityRule: null`, y `validateSubmissionAnswers`
-- (`formularios-respuestas.ts:211-214`) rechaza en el servidor todo envío que
-- deje un obligatorio sin responder: los dos preoperacionales están BLOQUEADOS
-- en producción y este SQL es lo que los desbloquea.
--
-- La placa no se pierde: el vehículo es contexto del envío (`vehicleId`), lo
-- elige el conductor en el selector previo del portal y vive en la columna
-- `form_submissions.vehicle_id`, que es de donde salen la unicidad
-- `ONE_PER_CONTEXT`, la columna `placa` del export y el dashboard.
--
-- QUÉ HACE
--
--   1. comprueba que el campo no tenga ni una respuesta;
--   2. anota el estado actual de cada versión afectada;
--   3. las pasa a DRAFT;
--   4. borra las ocho filas de `form_fields`;
--   5. devuelve cada versión EXACTAMENTE al estado que tenía;
--   6. sube `revision` para invalidar el ETag del portal.
--
-- Todo en UNA transacción. Postgres da aislamiento por snapshot, así que ninguna
-- sesión concurrente llega a ver las versiones en DRAFT: o ven el árbol de antes
-- o el de después. No hay ventana en la que el portal rechace un formulario por
-- no estar publicado.
--
-- POR QUÉ EL PASO 6 NO ES OPCIONAL
--
-- `obtenerDefinicionPortal` devuelve `etag: "<version_id>-<revision>"`
-- (`formularios-portal.service.ts:289`) apoyándose en que una versión publicada
-- es inmutable. Aquí la estamos mutando, así que sin subir `revision` el ETag no
-- cambia, los teléfonos revalidan contra su caché, se les responde «no ha
-- cambiado» y SEGUIRÍAN MOSTRANDO EL CAMPO. El borrado sería invisible.
--
-- POR QUÉ NO SE CLONA A UNA v2
--
-- Es el camino que la arquitectura prefiere, pero `clonarVersion` genera ids con
-- `randomUUID()` mientras que el cargador usa UUID v5 derivado de
-- `code + revisión`: una v2 clonada queda fuera del alcance de `cargar.ts` para
-- siempre y las semillas dejan de poder mantener estos formularios. La regla de
-- no tocar lo publicado existe para proteger respuestas, y este campo tiene cero
-- y no puede llegar a tener ninguna. Se elige mantener semillas y base alineadas.
--
-- QUÉ BORRA
--
-- Ocho filas de `form_fields`, una por formulario. Los ids son UUID v5
-- determinísticos derivados de `code + revisión + 'vehiculo'` (ver `ids.ts`), así
-- que son los mismos en todos los entornos y en los dos proyectos (transmeralda
-- y Cotransmeq). Los envíos ya existentes no se tocan: responden a otros campos.
--
-- Es idempotente: correrlo dos veces no hace nada la segunda vez.
--
-- DESPUÉS DE ESTO, NO VUELVAS A CORRER `cargar.ts`
--
-- El cargador se niega a escribir sobre una versión que no esté en DRAFT, así que
-- abortará solo. No hace falta: el árbol ya queda como dicen las semillas. El
-- hueco que deja el campo en la numeración de `sort_order` es inocuo — la columna
-- solo ordena y admite huecos.
--
-- Uso:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migration.sql
-- ============================================================================

BEGIN;

-- ─── 1. Guard: abortar si algún envío ya respondió el campo ──────────────────
--
-- Esta es la guarda que de verdad protege datos, y se mantiene intacta.
-- `form_answers.field_id` es ON DELETE NO ACTION, así que la base rechazaría el
-- borrado igualmente; aquí se detecta antes y con un mensaje legible. Si salta,
-- NO lo fuerces: significa que el supuesto de partida era falso y hay que
-- decidir con HSEQ qué pasa con esos envíos.

DO $$
DECLARE
	respuestas bigint;
	detalle text;
BEGIN
	SELECT count(*) INTO respuestas
	FROM form_answers a
	JOIN form_fields f ON f.id = a.field_id
	WHERE f.key = 'vehiculo'
	  AND f.type = 'LOOKUP';

	IF respuestas > 0 THEN
		SELECT string_agg(DISTINCT d.code, ', ') INTO detalle
		FROM form_answers a
		JOIN form_fields f ON f.id = a.field_id
		JOIN form_versions v ON v.id = f.version_id
		JOIN form_definitions d ON d.id = v.form_id
		WHERE f.key = 'vehiculo' AND f.type = 'LOOKUP';

		RAISE EXCEPTION
			'ABORTADO: hay % respuesta(s) al campo `vehiculo` en: %. Borrar el campo dejaría esas respuestas huérfanas. Revisa con HSEQ antes de continuar.',
			respuestas, detalle;
	END IF;
END $$;

-- ─── 2. Anotar el estado actual de cada versión afectada ─────────────────────
--
-- Se guarda el estado REAL en vez de asumir PUBLISHED en las ocho. Si alguna
-- estuviera ARCHIVED, devolverla a PUBLISHED a ciegas la resucitaría; si alguna
-- ya estuviera en DRAFT, la publicaría sin que nadie lo haya decidido. El paso 5
-- restaura lo que había, sea lo que sea.
--
-- Las versiones se derivan de los propios campos, no de una lista fija: después
-- del DELETE ese vínculo desaparece, por eso se anota antes.

CREATE TEMP TABLE _versiones_afectadas ON COMMIT DROP AS
SELECT DISTINCT f.version_id, v.status AS status_original
FROM form_fields f
JOIN form_versions v ON v.id = f.version_id
WHERE f.key = 'vehiculo'
  AND f.type = 'LOOKUP'
  AND f.id IN (
	'b2e8304f-5190-59e0-b4c2-efe1c4315b36',  -- HSEQ-FR-08 rev 6  Preoperacional automóviles/camperos/camionetas
	'd182268b-abdb-5443-ac21-6bf90db783c8',  -- HSEQ-FR-09 rev 3  Preoperacional microbuses/busetas/buses
	'7aa046e8-b355-5bef-8054-ebd6fe33616e',  -- HSEQ-FR-56 rev 2  Acta de entrega/recibo de tractocamión
	'1145a5d4-a7ca-5e4f-95c8-1b82bdfd4a90',  -- HSEQ-FR-04 rev 3  Inspección de extintores
	'38e741f4-5d1b-5155-82b4-4fa017a3f7b6',  -- HSEQ-FR-05 rev 2  Inspección de botiquines
	'7dcc97f7-5a70-5523-b8ad-bb1877ec98f9',  -- HSEQ-FR-07 rev 2  Reporte de falla o avería
	'f52ebf95-dfc5-5b0a-8d67-65f72f569022',  -- HSEQ-FR-17 rev 2  Inspección de herramientas
	'3f26ab20-74da-5373-a4d0-306f1da3415f'   -- HSEQ-FR-22 rev 3  Inspección kit de derrames
  );

-- ─── 3. Pasar a DRAFT ────────────────────────────────────────────────────────
--
-- `published_at` y `published_by_id` NO se tocan a propósito: son la trazabilidad
-- de quién publicó y cuándo, y el paso 5 devuelve el estado, no la historia.

UPDATE form_versions v
SET status = 'DRAFT'
FROM _versiones_afectadas a
WHERE v.id = a.version_id;

-- ─── 4. Borrar el campo ──────────────────────────────────────────────────────
--
-- Se filtra por `key` y `type` además de por id: si un id no correspondiera a lo
-- que creemos, no se toca nada en lugar de borrar algo ajeno.
-- `form_field_options` caería por ON DELETE CASCADE, aunque un LOOKUP no tiene
-- opciones.

DELETE FROM form_fields f
USING _versiones_afectadas a
WHERE f.version_id = a.version_id
  AND f.key = 'vehiculo'
  AND f.type = 'LOOKUP';

-- ─── 5. Devolver cada versión a su estado original ───────────────────────────

UPDATE form_versions v
SET status = a.status_original
FROM _versiones_afectadas a
WHERE v.id = a.version_id;

-- ─── 6. Invalidar el ETag del portal ─────────────────────────────────────────
--
-- Sin esto el borrado es invisible para cualquier teléfono con el formulario ya
-- descargado. Ver la nota de cabecera.

UPDATE form_versions v
SET revision = v.revision + 1
FROM _versiones_afectadas a
WHERE v.id = a.version_id;

-- ─── 7. Verificación ─────────────────────────────────────────────────────────

-- 7a. Debe devolver CERO filas.
SELECT d.code, f.id, f.key, f.type
FROM form_fields f
JOIN form_versions v ON v.id = f.version_id
JOIN form_definitions d ON d.id = v.form_id
WHERE f.key = 'vehiculo'
  AND f.type = 'LOOKUP';

-- 7b. Debe devolver las 8 versiones, con `status` idéntico al original,
--     `coincide` en true y `revision` ya incrementada.
SELECT d.code,
       a.status_original,
       v.status AS status_actual,
       (v.status = a.status_original) AS coincide,
       v.revision,
       v.published_at
FROM _versiones_afectadas a
JOIN form_versions v ON v.id = a.version_id
JOIN form_definitions d ON d.id = v.form_id
ORDER BY d.code;

COMMIT;
