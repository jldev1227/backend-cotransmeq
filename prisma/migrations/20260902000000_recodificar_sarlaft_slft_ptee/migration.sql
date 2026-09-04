-- Recodificación de formularios SARLAFT: GC-FR-0X -> SLFT-PTEE-FR-0X
--
-- El catálogo de formularios (formularios-sarlaft.constants.ts) ya no conoce
-- los códigos GC-FR-04/05/06. Las filas ya radicadas con esos códigos quedan
-- huérfanas: `getFormularioPorCodigo` devuelve undefined y la descarga de PDF
-- de esos radicados retorna null (ver formularios-sarlaft.service.ts:1356).
-- Este UPDATE realinea los datos con el nuevo catálogo.
--
-- NO altera radicados (se generan por tipo_formulario, no por código) ni el
-- snapshot de respuestas. codigo_formulario es VarChar(20) y "SLFT-PTEE-FR-04"
-- mide 15 caracteres, así que cabe sin cambiar el schema.

BEGIN;

UPDATE formulario_sarlaft_ptee
SET codigo_formulario = 'SLFT-PTEE-FR-' || right(codigo_formulario, 2)
WHERE codigo_formulario IN ('GC-FR-04', 'GC-FR-05', 'GC-FR-06');

-- Verificación antes de confirmar: no debe quedar ninguna fila GC-FR-*
-- SELECT codigo_formulario, count(*) FROM formulario_sarlaft_ptee GROUP BY 1 ORDER BY 1;

COMMIT;
