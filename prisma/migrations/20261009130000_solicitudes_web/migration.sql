-- Solicitudes recibidas por el formulario público de la landing (cotizaciones,
-- servicios, información). Reemplazan a los CTA de WhatsApp/teléfono/correo:
-- todo entra por aquí, se clasifica y se verifica antes de atender.
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261009130000_solicitudes_web

CREATE TABLE IF NOT EXISTS solicitud_web (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado           varchar(30) NOT NULL UNIQUE,
  tipo               varchar(20) NOT NULL,            -- cotizacion | servicio | informacion | otro
  estado             varchar(20) NOT NULL DEFAULT 'nueva', -- nueva | en_verificacion | verificada | atendida | descartada | spam
  prioridad          varchar(10) NOT NULL DEFAULT 'media',  -- alta | media | baja

  -- Quién solicita
  nombre             varchar(120) NOT NULL,
  empresa            varchar(160),
  documento          varchar(30),                     -- NIT o cédula, tal como lo escribió
  cargo              varchar(80),
  correo             varchar(160) NOT NULL,
  telefono           varchar(30) NOT NULL,

  -- Qué necesita
  origen             varchar(160),
  destino            varchar(160),
  fecha_servicio     date,
  pasajeros          integer,
  tipo_vehiculo      varchar(60),
  modalidad          varchar(20),                     -- eventual | recurrente | contrato | sin_definir
  mensaje            text NOT NULL,

  -- Clasificación automática al recibir (ver modules/solicitudes-web/triage.ts)
  urgente            boolean NOT NULL DEFAULT false,
  riesgo_nivel       varchar(10) NOT NULL DEFAULT 'bajo',   -- bajo | medio | alto
  riesgo_puntaje     integer NOT NULL DEFAULT 0,
  senales            jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{clave, texto, peso}]
  cliente_id         uuid REFERENCES empresas(id) ON DELETE SET NULL,

  -- Contexto técnico del envío
  origen_sitio       varchar(80),
  ip_origen          varchar(64),
  user_agent         text,
  referer            text,
  tiempo_llenado_ms  integer,

  -- Gestión interna
  asignado_a_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  historial          jsonb NOT NULL DEFAULT '[]'::jsonb,    -- [{en, por_id, por, accion, detalle}]
  atendida_at        timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS solicitud_web_estado_idx     ON solicitud_web (estado);
CREATE INDEX IF NOT EXISTS solicitud_web_created_idx    ON solicitud_web (created_at DESC);
CREATE INDEX IF NOT EXISTS solicitud_web_telefono_idx   ON solicitud_web (telefono);
CREATE INDEX IF NOT EXISTS solicitud_web_correo_idx     ON solicitud_web (correo);
CREATE INDEX IF NOT EXISTS solicitud_web_ip_idx         ON solicitud_web (ip_origen);
