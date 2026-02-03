-- Migración: Sistema de Formularios de Asistencia
-- Fecha: 08-01-2026
-- Descripción: Crear tablas para formularios de asistencia y respuestas con control de duplicados

-- Tabla de formularios de asistencia
CREATE TABLE IF NOT EXISTS formularios_asistencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tematica VARCHAR(255) NOT NULL,
    descripcion TEXT,
    fecha DATE NOT NULL,
    token VARCHAR(64) UNIQUE NOT NULL,
    activo BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    creado_por_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

-- Índices para formularios_asistencia
CREATE INDEX IF NOT EXISTS idx_formularios_asistencia_token ON formularios_asistencia(token);
CREATE INDEX IF NOT EXISTS idx_formularios_asistencia_fecha ON formularios_asistencia(fecha);

-- Tabla de respuestas de asistencia
CREATE TABLE IF NOT EXISTS respuestas_asistencia (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    formulario_id UUID NOT NULL REFERENCES formularios_asistencia(id) ON DELETE CASCADE,
    nombre_completo VARCHAR(255) NOT NULL,
    numero_documento VARCHAR(50) NOT NULL,
    cargo VARCHAR(255) NOT NULL,
    numero_telefono VARCHAR(20) NOT NULL,
    firma TEXT NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NOT NULL,
    device_fingerprint VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices y constraint único para respuestas_asistencia
CREATE UNIQUE INDEX IF NOT EXISTS idx_respuestas_asistencia_unique ON respuestas_asistencia(formulario_id, device_fingerprint);
CREATE INDEX IF NOT EXISTS idx_respuestas_asistencia_formulario ON respuestas_asistencia(formulario_id);
CREATE INDEX IF NOT EXISTS idx_respuestas_asistencia_documento ON respuestas_asistencia(numero_documento);

-- Comentarios
COMMENT ON TABLE formularios_asistencia IS 'Formularios de asistencia creados por administradores para recolectar firmas';
COMMENT ON TABLE respuestas_asistencia IS 'Respuestas de asistencia con firma digital y control de duplicados por dispositivo';
COMMENT ON COLUMN respuestas_asistencia.firma IS 'Imagen de firma en formato base64';
COMMENT ON COLUMN respuestas_asistencia.device_fingerprint IS 'Hash único del dispositivo para evitar múltiples respuestas';
