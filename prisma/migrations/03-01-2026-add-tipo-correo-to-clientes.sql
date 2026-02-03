-- Agregar enum para tipo de cliente
DO $$ BEGIN
    CREATE TYPE tipo_cliente_enum AS ENUM ('EMPRESA', 'PERSONA_NATURAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Agregar columna tipo a la tabla empresas (clientes)
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tipo tipo_cliente_enum DEFAULT 'EMPRESA';

-- Agregar columna correo a la tabla empresas (clientes) con unique constraint
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS correo VARCHAR(255);

-- Crear índice único para correo (ignorando valores NULL)
CREATE UNIQUE INDEX IF NOT EXISTS empresas_correo_unique ON empresas(correo) WHERE correo IS NOT NULL;

-- Actualizar registros existentes
UPDATE empresas SET tipo = 'EMPRESA' WHERE tipo IS NULL;

-- Comentarios
COMMENT ON COLUMN empresas.tipo IS 'Tipo de cliente: EMPRESA o PERSONA_NATURAL';
COMMENT ON COLUMN empresas.correo IS 'Correo electrónico del cliente';
