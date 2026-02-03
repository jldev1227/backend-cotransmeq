-- Agregar campo 'oculto' a conductores, vehiculos y empresas
-- Fecha: 26-01-2026
-- Propósito: Permitir ocultar registros sin eliminarlos (soft hide)

-- Agregar campo a conductores
ALTER TABLE conductores 
ADD COLUMN oculto BOOLEAN NOT NULL DEFAULT false;

-- Agregar índice para mejorar performance en consultas
CREATE INDEX idx_conductores_oculto ON conductores(oculto);

-- Agregar campo a vehiculos
ALTER TABLE vehiculos 
ADD COLUMN oculto BOOLEAN NOT NULL DEFAULT false;

-- Agregar índice para mejorar performance en consultas
CREATE INDEX idx_vehiculos_oculto ON vehiculos(oculto);

-- Agregar campo a empresas (clientes)
ALTER TABLE empresas 
ADD COLUMN oculto BOOLEAN NOT NULL DEFAULT false;

-- Agregar índice para mejorar performance en consultas
CREATE INDEX idx_empresas_oculto ON empresas(oculto);

-- Comentarios para documentación
COMMENT ON COLUMN conductores.oculto IS 'Indica si el conductor está oculto en las vistas principales. Solo visible para administradores en vista de ocultos.';
COMMENT ON COLUMN vehiculos.oculto IS 'Indica si el vehículo está oculto en las vistas principales. Solo visible para administradores en vista de ocultos.';
COMMENT ON COLUMN empresas.oculto IS 'Indica si la empresa está oculta en las vistas principales. Solo visible para administradores en vista de ocultos.';
