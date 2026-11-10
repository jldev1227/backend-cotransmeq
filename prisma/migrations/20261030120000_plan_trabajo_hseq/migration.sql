ALTER TYPE enum_notificacion_tipo ADD VALUE IF NOT EXISTS 'PLAN_TRABAJO_RECORDATORIO';

CREATE TABLE plan_trabajo_anual (
  id UUID PRIMARY KEY,
  codigo VARCHAR(100) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  anio INTEGER NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'APROBADO',
  recordatorios_activos BOOLEAN NOT NULL DEFAULT FALSE,
  activado_at TIMESTAMPTZ(6),
  fuente_archivo VARCHAR(255),
  fuente_sha256 VARCHAR(64),
  importado_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  creado_por_id UUID,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_anual_codigo_anio_key UNIQUE (codigo, anio)
);
CREATE INDEX plan_trabajo_anual_anio_estado_idx ON plan_trabajo_anual(anio, estado);

CREATE TABLE plan_trabajo_indicador_config (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plan_trabajo_anual(id) ON DELETE CASCADE,
  numero_indicador INTEGER NOT NULL CHECK (numero_indicador BETWEEN 1 AND 6),
  nombre VARCHAR(500) NOT NULL,
  formula_fuente TEXT,
  meta_principal DOUBLE PRECISION NOT NULL,
  bandas_referencia JSONB NOT NULL DEFAULT '{}'::jsonb,
  unidad VARCHAR(100),
  frecuencia VARCHAR(255),
  vigencia VARCHAR(255),
  datos_fuente JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_indicador_config_plan_numero_key UNIQUE (plan_id, numero_indicador)
);
CREATE INDEX plan_trabajo_indicador_config_plan_idx ON plan_trabajo_indicador_config(plan_id);

CREATE TABLE plan_trabajo_actividad (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plan_trabajo_anual(id) ON DELETE CASCADE,
  numero_fuente INTEGER NOT NULL,
  fila_fuente INTEGER NOT NULL,
  unidad_programa VARCHAR(500) NOT NULL,
  actividad TEXT NOT NULL,
  recursos TEXT,
  responsable_cargos TEXT,
  alcance TEXT,
  metodo_seguimiento TEXT,
  frecuencia_fuente VARCHAR(100),
  es_pesv BOOLEAN NOT NULL DEFAULT FALSE,
  paso_pesv VARCHAR(100),
  requiere_evidencia BOOLEAN NOT NULL DEFAULT FALSE,
  avance_fuente VARCHAR(100),
  estado_fuente VARCHAR(100),
  fecha_ejecucion_fuente VARCHAR(100),
  asistentes_fuente VARCHAR(100),
  registro_fuente TEXT,
  evidencia_fuente TEXT,
  observacion_fuente TEXT,
  datos_fuente JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_actividad_plan_numero_key UNIQUE (plan_id, numero_fuente)
);
CREATE INDEX plan_trabajo_actividad_plan_unidad_idx ON plan_trabajo_actividad(plan_id, unidad_programa);
CREATE INDEX plan_trabajo_actividad_es_pesv_idx ON plan_trabajo_actividad(es_pesv);

CREATE TABLE plan_trabajo_ocurrencia (
  id UUID PRIMARY KEY,
  actividad_id UUID NOT NULL REFERENCES plan_trabajo_actividad(id) ON DELETE CASCADE,
  mes INTEGER NOT NULL CHECK (mes BETWEEN 1 AND 12),
  fecha_vencimiento DATE NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  ejecutada_en_mes_fuente BOOLEAN NOT NULL DEFAULT FALSE,
  completada_at TIMESTAMPTZ(6),
  completada_por_tipo VARCHAR(15),
  completada_por_id UUID,
  no_aplica_motivo TEXT,
  no_aplica_aprobada_por UUID,
  no_aplica_aprobada_at TIMESTAMPTZ(6),
  recordatorios_desde TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_ocurrencia_actividad_mes_key UNIQUE (actividad_id, mes)
);
CREATE INDEX plan_trabajo_ocurrencia_estado_vencimiento_idx ON plan_trabajo_ocurrencia(estado, fecha_vencimiento);
CREATE INDEX plan_trabajo_ocurrencia_actividad_mes_idx ON plan_trabajo_ocurrencia(actividad_id, mes);

CREATE TABLE plan_trabajo_cargo_usuario (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plan_trabajo_anual(id) ON DELETE CASCADE,
  cargo VARCHAR(255) NOT NULL,
  usuario_id UUID NOT NULL,
  rol VARCHAR(20) NOT NULL DEFAULT 'RESPONSABLE',
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_cargo_usuario_key UNIQUE (plan_id, cargo, usuario_id, rol)
);
CREATE INDEX plan_trabajo_cargo_usuario_plan_cargo_idx ON plan_trabajo_cargo_usuario(plan_id, cargo);
CREATE INDEX plan_trabajo_cargo_usuario_usuario_idx ON plan_trabajo_cargo_usuario(usuario_id);

CREATE TABLE plan_trabajo_asignacion (
  id UUID PRIMARY KEY,
  ocurrencia_id UUID NOT NULL REFERENCES plan_trabajo_ocurrencia(id) ON DELETE CASCADE,
  destinatario_tipo VARCHAR(15) NOT NULL CHECK (destinatario_tipo IN ('ADMIN', 'CONDUCTOR')),
  destinatario_id UUID NOT NULL,
  rol VARCHAR(20) NOT NULL DEFAULT 'RESPONSABLE',
  origen_cargo VARCHAR(255),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_asignacion_destinatario_key UNIQUE (ocurrencia_id, destinatario_tipo, destinatario_id, rol)
);
CREATE INDEX plan_trabajo_asignacion_destinatario_idx ON plan_trabajo_asignacion(destinatario_tipo, destinatario_id);

CREATE TABLE plan_trabajo_evidencia (
  id UUID PRIMARY KEY,
  objetivo_tipo VARCHAR(20) NOT NULL CHECK (objetivo_tipo IN ('OCURRENCIA', 'INDICADOR')),
  objetivo_id UUID NOT NULL,
  s3_key VARCHAR(1024) NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  tamano_bytes INTEGER NOT NULL CHECK (tamano_bytes > 0),
  subido_por_tipo VARCHAR(15) NOT NULL CHECK (subido_por_tipo IN ('ADMIN', 'CONDUCTOR')),
  subido_por_id UUID NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);
CREATE INDEX plan_trabajo_evidencia_objetivo_idx ON plan_trabajo_evidencia(objetivo_tipo, objetivo_id);
CREATE INDEX plan_trabajo_evidencia_actor_idx ON plan_trabajo_evidencia(subido_por_tipo, subido_por_id);

CREATE TABLE plan_trabajo_indicador_manual (
  id UUID PRIMARY KEY,
  plan_id UUID NOT NULL REFERENCES plan_trabajo_anual(id) ON DELETE CASCADE,
  numero_indicador INTEGER NOT NULL CHECK (numero_indicador IN (1, 2)),
  periodo VARCHAR(20) NOT NULL,
  cumple BOOLEAN NOT NULL,
  observacion TEXT,
  actualizado_por_id UUID,
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_indicador_manual_key UNIQUE (plan_id, numero_indicador, periodo)
);

CREATE TABLE plan_trabajo_recordatorio (
  id UUID PRIMARY KEY,
  ocurrencia_id UUID NOT NULL REFERENCES plan_trabajo_ocurrencia(id) ON DELETE CASCADE,
  destinatario_tipo VARCHAR(15) NOT NULL CHECK (destinatario_tipo IN ('ADMIN', 'CONDUCTOR')),
  destinatario_id UUID NOT NULL,
  regla VARCHAR(30) NOT NULL,
  enviado_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT plan_trabajo_recordatorio_destinatario_key UNIQUE (ocurrencia_id, destinatario_tipo, destinatario_id, regla)
);
CREATE INDEX plan_trabajo_recordatorio_enviado_idx ON plan_trabajo_recordatorio(enviado_at);
