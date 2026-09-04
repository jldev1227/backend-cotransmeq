-- Auditoría y protección de borrados de asistencias.
--
-- Contexto (28-ago-2026): la suite de tests corrió con DATABASE_URL apuntando a
-- la base real y ejecutó `prisma.respuestas_asistencia.deleteMany()`, que emite
-- `DELETE FROM "public"."respuestas_asistencia" WHERE 1=1`. Se perdieron 2042
-- respuestas. Los formularios sobrevivieron porque su trigger ya devolvía NULL;
-- el de respuestas solo auditaba y dejaba borrar.
--
-- Esta migración:
--   1. Mueve la tabla de auditoría al schema `auditoria`. Prisma solo gestiona
--      `public`, así que desde aquí ninguna migración futura podrá proponer
--      borrarla ni generará diffs fantasma sobre ella.
--   2. Deja formularios y respuestas con la MISMA protección:
--        borrado dirigido (WHERE id IN (...))  -> permitido, se audita
--        borrado sin filtro / WHERE 1=1        -> bloqueado, se audita
--        TRUNCATE                              -> bloqueado con error

CREATE SCHEMA IF NOT EXISTS auditoria;

CREATE TABLE IF NOT EXISTS auditoria.borrado_asistencia (
  id           bigserial PRIMARY KEY,
  ocurrido_en  timestamptz NOT NULL DEFAULT now(),
  tabla        text NOT NULL,
  fila_id      text,
  query_origen text,
  app_name     text,
  client_ip    inet,
  usuario_db   text
);

-- Conserva el historial ya registrado en public._audit_borrado_asistencia.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = '_audit_borrado_asistencia'
  ) THEN
    INSERT INTO auditoria.borrado_asistencia
      (ocurrido_en, tabla, fila_id, query_origen, app_name, client_ip, usuario_db)
    SELECT ocurrido_en, tabla, fila_id, query_origen, app_name, client_ip, usuario_db
    FROM public._audit_borrado_asistencia;

    DROP TABLE public._audit_borrado_asistencia;
  END IF;
END $$;

-- ¿La sentencia en curso borra sin filtrar filas concretas?
CREATE OR REPLACE FUNCTION auditoria.borrado_es_masivo(p_tabla text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE q text;
BEGIN
  q := coalesce(current_query(), '');
  -- Se considera masivo cualquier DELETE que no filtre filas concretas:
  --   DELETE FROM tabla;                 (sin WHERE)
  --   DELETE FROM public.tabla WHERE 1=1 (lo que emite `deleteMany()` sin args)
  --   DELETE FROM "tabla" WHERE true
  -- El prefijo de schema y las comillas son opcionales.
  RETURN q ~* (
    '^\s*delete\s+from\s+(?:"?public"?\s*\.\s*)?"?' || p_tabla || '"?' ||
    '\s*(?:where\s+(?:1\s*=\s*1|true)\s*)?;?\s*$'
  );
END $$;

CREATE OR REPLACE FUNCTION public.auditar_delete_respuestas_asistencia()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auditoria.borrado_asistencia (tabla, fila_id, query_origen, app_name, client_ip, usuario_db)
  VALUES ('respuestas_asistencia', OLD.id::text, current_query(),
          current_setting('application_name', true), inet_client_addr(), current_user);

  IF auditoria.borrado_es_masivo('respuestas_asistencia') THEN
    -- RETURN NULL en BEFORE DELETE: la fila NO se borra y la transacción sigue,
    -- así el registro de auditoría queda commiteado.
    RAISE WARNING 'Borrado masivo de respuestas_asistencia BLOQUEADO. Query: %', current_query();
    RETURN NULL;
  END IF;

  RETURN OLD;
END $$;

CREATE OR REPLACE FUNCTION public.bloquear_delete_formularios_asistencia()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auditoria.borrado_asistencia (tabla, fila_id, query_origen, app_name, client_ip, usuario_db)
  VALUES ('formularios_asistencia', OLD.id::text, current_query(),
          current_setting('application_name', true), inet_client_addr(), current_user);
  RAISE WARNING 'Borrado de formularios_asistencia BLOQUEADO (usar soft delete). Query: %', current_query();
  RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.bloquear_truncate_asistencias()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TRUNCATE sobre % está bloqueado por política de datos de asistencias', TG_TABLE_NAME;
END $$;

DROP TRIGGER IF EXISTS trg_auditar_delete_resp_asistencia ON public.respuestas_asistencia;
CREATE TRIGGER trg_auditar_delete_resp_asistencia
  BEFORE DELETE ON public.respuestas_asistencia
  FOR EACH ROW EXECUTE FUNCTION public.auditar_delete_respuestas_asistencia();

DROP TRIGGER IF EXISTS trg_bloquear_delete_form_asistencia ON public.formularios_asistencia;
CREATE TRIGGER trg_bloquear_delete_form_asistencia
  BEFORE DELETE ON public.formularios_asistencia
  FOR EACH ROW EXECUTE FUNCTION public.bloquear_delete_formularios_asistencia();

DROP TRIGGER IF EXISTS trg_bloquear_truncate_resp_asistencia ON public.respuestas_asistencia;
CREATE TRIGGER trg_bloquear_truncate_resp_asistencia
  BEFORE TRUNCATE ON public.respuestas_asistencia
  FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_truncate_asistencias();

DROP TRIGGER IF EXISTS trg_bloquear_truncate_form_asistencia ON public.formularios_asistencia;
CREATE TRIGGER trg_bloquear_truncate_form_asistencia
  BEFORE TRUNCATE ON public.formularios_asistencia
  FOR EACH STATEMENT EXECUTE FUNCTION public.bloquear_truncate_asistencias();
