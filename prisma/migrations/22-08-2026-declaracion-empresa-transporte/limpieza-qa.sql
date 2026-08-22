-- ═══════════════════════════════════════════════════════════════════════════
-- Limpieza de los radicados de QA de la declaración de empresa de transporte
--
-- La corrida de QA se hizo contra la base productiva (opción acordada), así que
-- quedaron radicados sintéticos que hay que retirar. Todos usan datos
-- inequívocamente ficticios: NIT 900999888-1 y razón social
-- "TRANSPORTES QA DOCUMENTAL S.A.S.".
--
-- El borrado del formulario arrastra en cascada sus anexos, sus versiones
-- documentales y sus registros de entrega (FK ON DELETE CASCADE).
--
-- ⚠ NO borra los objetos de S3. Las claves quedan listadas por el paso 1 para
--   que se eliminen aparte si se quiere; son PDF sintéticos, no información
--   real, así que dejarlos no es un riesgo de datos personales.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. REVISAR PRIMERO: qué se va a borrar y qué objetos quedan en S3.
SELECT f.radicado,
       f.nombre_completo,
       f.numero_documento,
       f.estado,
       f.fecha_envio,
       g.version_documento,
       g.estado_documental,
       g.s3_key
  FROM formulario_sarlaft_ptee f
  LEFT JOIN formulario_sarlaft_ptee_documento_generado g ON g.formulario_id = f.id
 WHERE f.tipo_formulario = 'declaracion_empresa_transporte'
   AND f.numero_documento = '900999888-1'
 ORDER BY f.fecha_envio, g.version_documento;

-- 1b. Claves S3 de los anexos subidos en QA (para borrarlas del bucket aparte).
SELECT f.radicado, d.tipo_documento, d.s3_key
  FROM formulario_sarlaft_ptee f
  JOIN formulario_sarlaft_ptee_documento d ON d.formulario_id = f.id
 WHERE f.tipo_formulario = 'declaracion_empresa_transporte'
   AND f.numero_documento = '900999888-1';

-- 2. BORRAR. Ejecutar solo después de revisar el paso 1.
--    El filtro por NIT sintético evita tocar cualquier radicado real que
--    llegue a existir con este mismo tipo de formulario.
BEGIN;

DELETE FROM formulario_sarlaft_ptee
 WHERE tipo_formulario = 'declaracion_empresa_transporte'
   AND numero_documento = '900999888-1';

-- Confirmar que no quedó nada antes de cerrar la transacción.
SELECT count(*) AS radicados_qa_restantes
  FROM formulario_sarlaft_ptee
 WHERE tipo_formulario = 'declaracion_empresa_transporte'
   AND numero_documento = '900999888-1';
-- Esperado: 0

COMMIT;

-- 3. VERIFICAR que la cascada limpió las tablas nuevas.  Esperado: 0 y 0.
SELECT count(*) AS generados_huerfanos
  FROM formulario_sarlaft_ptee_documento_generado g
  LEFT JOIN formulario_sarlaft_ptee f ON f.id = g.formulario_id
 WHERE f.id IS NULL;

SELECT count(*) AS entregas_huerfanas
  FROM formulario_sarlaft_ptee_documento_entrega e
  LEFT JOIN formulario_sarlaft_ptee_documento_generado g ON g.id = e.documento_generado_id
 WHERE g.id IS NULL;
