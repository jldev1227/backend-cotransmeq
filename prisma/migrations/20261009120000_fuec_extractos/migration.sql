-- Extractos de contrato (FUEC, OP-FR-04): catálogos reutilizables, datos del
-- vehículo que pide el formato y la firma de cada extracto emitido.
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261009120000_fuec_extractos

-- Hoja de vida del vehículo: lo que el extracto imprime y hoy vivía solo en el xlsm.
ALTER TABLE vehiculos
  ADD COLUMN IF NOT EXISTS numero_interno     varchar(20),
  ADD COLUMN IF NOT EXISTS tarjeta_operacion  varchar(60),
  ADD COLUMN IF NOT EXISTS empresa_afiliacion varchar(255);

-- Contratante con su contrato y el responsable que firma por él. Una fila por
-- contratante; cada extracto copia los valores al emitirse (snapshot).
CREATE TABLE IF NOT EXISTS fuec_contratante (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                varchar(255) NOT NULL,
  nit                   varchar(50),
  numero_contrato       varchar(40),
  cliente_id            uuid REFERENCES empresas(id) ON DELETE SET NULL,
  responsable_nombre    varchar(255),
  responsable_cedula    varchar(50),
  responsable_telefono  varchar(50),
  responsable_direccion varchar(255),
  usos                  integer NOT NULL DEFAULT 0,
  ultimo_uso_at         timestamptz,
  deleted_at            timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fuec_contratante_nombre_idx ON fuec_contratante (nombre);
CREATE INDEX IF NOT EXISTS fuec_contratante_cliente_id_idx ON fuec_contratante (cliente_id);

-- Textos que se repiten de un extracto a otro: objeto del contrato, convenio
-- de colaboración y origen-destino. `usos` ordena el desplegable.
CREATE TABLE IF NOT EXISTS fuec_catalogo (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo          varchar(20) NOT NULL,
  texto         text NOT NULL,
  usos          integer NOT NULL DEFAULT 0,
  ultimo_uso_at timestamptz,
  deleted_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fuec_catalogo_tipo_texto_key UNIQUE (tipo, texto)
);
CREATE INDEX IF NOT EXISTS fuec_catalogo_tipo_usos_idx ON fuec_catalogo (tipo, usos DESC);

-- Lo que el formato imprime y faltaba en la tabla, más la firma.
ALTER TABLE fuec_extract
  ADD COLUMN IF NOT EXISTS contratante_id      uuid REFERENCES fuec_contratante(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS contratante_nombre  varchar(255),
  ADD COLUMN IF NOT EXISTS contratante_nit     varchar(50),
  ADD COLUMN IF NOT EXISTS contrato_numero     varchar(40),
  ADD COLUMN IF NOT EXISTS objeto_contrato     text,
  ADD COLUMN IF NOT EXISTS convenio            varchar(255),
  ADD COLUMN IF NOT EXISTS modelo              varchar(20),
  ADD COLUMN IF NOT EXISTS marca               varchar(100),
  ADD COLUMN IF NOT EXISTS clase               varchar(100),
  ADD COLUMN IF NOT EXISTS responsable_json    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS codigo_verificacion varchar(24),
  ADD COLUMN IF NOT EXISTS firma_sha512        varchar(128),
  ADD COLUMN IF NOT EXISTS emitido_at          timestamptz;
CREATE UNIQUE INDEX IF NOT EXISTS fuec_extract_codigo_verificacion_key ON fuec_extract (codigo_verificacion);
CREATE INDEX IF NOT EXISTS fuec_extract_contratante_id_idx ON fuec_extract (contratante_id);
CREATE INDEX IF NOT EXISTS fuec_extract_vehiculo_placa_idx ON fuec_extract (vehiculo_placa);
