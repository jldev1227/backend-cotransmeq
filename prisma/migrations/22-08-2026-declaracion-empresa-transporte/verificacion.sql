-- ═══════════════════════════════════════════════════════════════════════════
-- Verificación post-migración — Declaración SARLAFT/PTEE para empresa de transporte
--
-- Solo SELECT: no modifica nada. Ejecutar contra la misma base donde se aplicó
-- `migration.sql`. Cada bloque imprime el resultado esperado.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Las dos tablas existen.  Esperado: 2 filas.
SELECT table_name
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('formulario_sarlaft_ptee_documento_generado',
                      'formulario_sarlaft_ptee_documento_entrega')
 ORDER BY table_name;

-- 2. Columnas y tipos.
--    Esperado: 15 columnas en documento_generado, 14 en documento_entrega.
SELECT table_name, column_name, data_type, character_maximum_length,
       is_nullable, column_default
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('formulario_sarlaft_ptee_documento_generado',
                      'formulario_sarlaft_ptee_documento_entrega')
 ORDER BY table_name, ordinal_position;

-- 2b. Conteo rápido de columnas.  Esperado: 15 y 14.
SELECT table_name, count(*) AS columnas
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('formulario_sarlaft_ptee_documento_generado',
                      'formulario_sarlaft_ptee_documento_entrega')
 GROUP BY table_name
 ORDER BY table_name;

-- 3. Índices.
--    Esperado: 5 en documento_generado (PK + 4) y 6 en documento_entrega (PK + 5).
SELECT tablename, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename IN ('formulario_sarlaft_ptee_documento_generado',
                     'formulario_sarlaft_ptee_documento_entrega')
 ORDER BY tablename, indexname;

-- 3b. Los dos índices ÚNICOS que sostienen las garantías del diseño:
--     · fspd_generado_formulario_clase_version_key → impide sobrescribir o
--       duplicar una versión documental ya emitida.
--     · fspd_entrega_doc_canal_dest_intento_key    → hace idempotente el
--       reintento de entrega.
--     Esperado: 3 filas (esos dos + el token_hash único).
SELECT indexname
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND indexdef LIKE 'CREATE UNIQUE INDEX%'
   AND tablename IN ('formulario_sarlaft_ptee_documento_generado',
                     'formulario_sarlaft_ptee_documento_entrega')
 ORDER BY indexname;

-- 4. Claves foráneas y su regla de borrado.
--    Esperado: 3 filas.
--      fspd_generado_formulario_fkey → formulario_sarlaft_ptee  · CASCADE
--      fspd_generado_usuario_fkey    → users                    · SET NULL
--      fspd_entrega_documento_fkey   → ..._documento_generado    · CASCADE
SELECT tc.constraint_name,
       tc.table_name,
       kcu.column_name,
       ccu.table_name AS referencia,
       rc.delete_rule
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON tc.constraint_name = ccu.constraint_name
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
 WHERE tc.constraint_type = 'FOREIGN KEY'
   AND tc.table_name IN ('formulario_sarlaft_ptee_documento_generado',
                         'formulario_sarlaft_ptee_documento_entrega')
 ORDER BY tc.table_name, tc.constraint_name;

-- ── Las siguientes solo tienen sentido una vez existan radicados de QA ──────

-- 5. Ningún token de descarga almacenado en claro: todo token_hash presente
--    debe ser exactamente 64 caracteres hexadecimales.  Esperado: 0.
SELECT count(*) AS tokens_mal_formados
  FROM formulario_sarlaft_ptee_documento_entrega
 WHERE token_hash IS NOT NULL
   AND token_hash !~ '^[0-9a-f]{64}$';

-- 6. Nunca dos versiones con el mismo número para un formulario.  Esperado: 0 filas.
SELECT formulario_id, clase, version_documento, count(*)
  FROM formulario_sarlaft_ptee_documento_generado
 GROUP BY 1, 2, 3
HAVING count(*) > 1;

-- 7. Coherencia versión ↔ estado documental: la versión 1 es la `recibida` y
--    toda versión posterior es `evaluada`.  Esperado: 0 filas.
SELECT id, formulario_id, version_documento, estado_documental
  FROM formulario_sarlaft_ptee_documento_generado
 WHERE (version_documento = 1 AND estado_documental <> 'recibida')
    OR (version_documento > 1 AND estado_documental <> 'evaluada');

-- 8. Panorama de lo recibido por este formato (vacío antes de QA).
SELECT f.radicado,
       f.estado,
       g.version_documento,
       g.estado_documental,
       g.codigo_template,
       g.pdf_sha256,
       g.created_at
  FROM formulario_sarlaft_ptee f
  JOIN formulario_sarlaft_ptee_documento_generado g
    ON g.formulario_id = f.id
 WHERE f.tipo_formulario = 'declaracion_empresa_transporte'
 ORDER BY f.fecha_envio DESC, g.version_documento ASC;
