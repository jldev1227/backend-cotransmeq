-- Tabla para Acciones Correctivas y Preventivas
CREATE TABLE IF NOT EXISTS acciones_correctivas_preventivas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    accion_numero VARCHAR(50) UNIQUE NOT NULL,
    lugar_sede VARCHAR(255),
    proceso_origen_hallazgo VARCHAR(255),
    componente_elemento_referencia TEXT,
    fuente_genero_hallazgo TEXT,
    marco_legal_normativo TEXT,
    fecha_identificacion_hallazgo DATE,
    descripcion_hallazgo TEXT,
    tipo_hallazgo_detectado VARCHAR(100),
    variable_categoria_analisis VARCHAR(255),
    correccion_solucion_inmediata TEXT,
    fecha_implementacion DATE,
    valoracion_riesgo VARCHAR(50),
    requiere_actualizar_matriz TEXT,
    tipo_accion_ejecutar VARCHAR(100),
    analisis_causas TEXT,
    descripcion_accion_plan TEXT,
    fecha_limite_implementacion DATE,
    responsable_ejecucion VARCHAR(255),
    fecha_seguimiento DATE,
    estado_accion_planeada VARCHAR(50),
    descripcion_estado_observaciones TEXT,
    fecha_evaluacion_eficacia DATE,
    criterio_evaluacion_eficacia TEXT,
    analisis_evidencias_cierre TEXT,
    evaluacion_cierre_eficaz VARCHAR(50),
    soporte_cierre_eficaz TEXT,
    fecha_cierre_definitivo DATE,
    responsable_cierre VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    creado_por_id UUID REFERENCES users(id)
);

-- Índices para mejorar rendimiento
CREATE INDEX IF NOT EXISTS idx_acciones_numero ON acciones_correctivas_preventivas(accion_numero);
CREATE INDEX IF NOT EXISTS idx_acciones_tipo ON acciones_correctivas_preventivas(tipo_accion_ejecutar);
CREATE INDEX IF NOT EXISTS idx_acciones_estado ON acciones_correctivas_preventivas(estado_accion_planeada);
CREATE INDEX IF NOT EXISTS idx_acciones_fecha ON acciones_correctivas_preventivas(fecha_identificacion_hallazgo);

-- Comentarios para documentación
COMMENT ON TABLE acciones_correctivas_preventivas IS 'Matriz de Acciones Correctivas y Preventivas HSEQ-MTR-07';
COMMENT ON COLUMN acciones_correctivas_preventivas.accion_numero IS 'Identificador único de la acción (ej: A22_1)';
COMMENT ON COLUMN acciones_correctivas_preventivas.valoracion_riesgo IS 'Valores permitidos: ALTO, MEDIO, BAJO';
COMMENT ON COLUMN acciones_correctivas_preventivas.tipo_accion_ejecutar IS 'Valores: CORRECTIVA, PREVENTIVA, MEJORA';
COMMENT ON COLUMN acciones_correctivas_preventivas.estado_accion_planeada IS 'Valores: Cumplidas, En Proceso, Vencidas';
COMMENT ON COLUMN acciones_correctivas_preventivas.evaluacion_cierre_eficaz IS 'Valores: EFICAZ, NO EFICAZ';
