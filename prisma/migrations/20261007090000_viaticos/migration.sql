-- Viáticos: anticipos de operaciones a un conductor y los gastos con que los
-- legaliza.
--
-- Prefijo `viatico_` a propósito: la tabla `anticipos` ya existe y es de
-- NÓMINA (se descuenta del neto en `lib/nomina/liquidar.ts`). Un anticipo de
-- viáticos no es salario ni se descuenta de la nómina: es dinero entregado para
-- gastos del viaje que el conductor justifica con facturas.
--
-- El saldo NO se guarda: es `valor - SUM(gastos vigentes)`. Guardarlo invita a
-- que se descuadre con una anulación o una edición.
--
-- Tablas nuevas, aditivas e idempotentes: no tocan datos existentes.
-- Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261007090000_viaticos
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

-- Solicitudes antes que anticipos: un anticipo puede nacer de una solicitud.
CREATE TABLE IF NOT EXISTS viatico_solicitud (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Anticipo desde el que el conductor pidió más: de él salen conductor y placa.
  anticipo_origen_id    uuid NOT NULL,
  conductor_id          uuid NOT NULL REFERENCES conductores(id),
  vehiculo_id           uuid NOT NULL REFERENCES vehiculos(id),
  valor_solicitado      numeric(12,2) NOT NULL CHECK (valor_solicitado > 0),
  observaciones         text,
  estado                varchar(20) NOT NULL DEFAULT 'PENDIENTE'
                          CHECK (estado IN ('PENDIENTE', 'APROBADA', 'RECHAZADA')),
  motivo_rechazo        text,
  resuelta_por_id       uuid REFERENCES users(id),
  resuelta_at           timestamptz,
  -- Lo genera el teléfono: la cola offline reintenta sin duplicar.
  client_solicitud_id   varchar(64) NOT NULL UNIQUE,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viatico_solicitud_estado_idx ON viatico_solicitud (estado, created_at DESC);
CREATE INDEX IF NOT EXISTS viatico_solicitud_conductor_idx ON viatico_solicitud (conductor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS viatico_anticipo (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conductor_id          uuid NOT NULL REFERENCES conductores(id),
  vehiculo_id           uuid NOT NULL REFERENCES vehiculos(id),
  concepto              text NOT NULL,
  valor                 numeric(12,2) NOT NULL CHECK (valor > 0),
  -- TRANSFERENCIA: hay comprobante y fecha. RETIRO_TARJETA: el conductor sacó
  -- el dinero con una tarjeta o cuenta de la empresa; se anota cuál.
  metodo                varchar(20) NOT NULL CHECK (metodo IN ('TRANSFERENCIA', 'RETIRO_TARJETA')),
  fecha                 date NOT NULL,
  numero_comprobante    varchar(60),
  entidad               varchar(120),
  tarjeta_cuenta        varchar(120),
  comprobante_key       text,
  comprobante_mime      varchar(100),
  comprobante_nombre    varchar(255),
  -- Lo que leyó el modelo del comprobante, tal cual, para auditar la captura.
  comprobante_lectura   jsonb,
  solicitud_id          uuid UNIQUE REFERENCES viatico_solicitud(id),
  -- Se marca al avisar del saldo bajo y se limpia si el saldo se recupera
  -- (una anulación), así el aviso sale una vez por caída y no en cada gasto.
  alerta_saldo_bajo_at  timestamptz,
  creado_por_id         uuid REFERENCES users(id),
  actualizado_por_id    uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz,
  CONSTRAINT viatico_anticipo_metodo_datos CHECK (
    (metodo = 'TRANSFERENCIA' AND comprobante_key IS NOT NULL)
    OR (metodo = 'RETIRO_TARJETA' AND tarjeta_cuenta IS NOT NULL AND length(trim(tarjeta_cuenta)) > 0)
  )
);
CREATE INDEX IF NOT EXISTS viatico_anticipo_conductor_idx ON viatico_anticipo (conductor_id, fecha DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS viatico_anticipo_vehiculo_idx ON viatico_anticipo (vehiculo_id) WHERE deleted_at IS NULL;

DO $$ BEGIN
  ALTER TABLE viatico_solicitud
    ADD CONSTRAINT viatico_solicitud_anticipo_origen_fk
    FOREIGN KEY (anticipo_origen_id) REFERENCES viatico_anticipo(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS viatico_gasto (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  anticipo_id           uuid NOT NULL REFERENCES viatico_anticipo(id),
  conductor_id          uuid NOT NULL REFERENCES conductores(id),
  -- Total de las facturas adjuntas: una factura con su valor, o varias en un
  -- PDF con el total. Es lo que se descuenta del saldo.
  valor                 numeric(12,2) NOT NULL CHECK (valor > 0),
  descripcion           text,
  fecha                 date NOT NULL,
  client_gasto_id       varchar(64) NOT NULL UNIQUE,
  anulado_at            timestamptz,
  anulado_por_id        uuid REFERENCES users(id),
  motivo_anulacion      text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS viatico_gasto_anticipo_idx ON viatico_gasto (anticipo_id, fecha DESC);

CREATE TABLE IF NOT EXISTS viatico_gasto_adjunto (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gasto_id              uuid NOT NULL REFERENCES viatico_gasto(id),
  conductor_id          uuid NOT NULL REFERENCES conductores(id),
  client_attachment_id  varchar(64) NOT NULL UNIQUE,
  object_key            text NOT NULL,
  mime_type             varchar(100) NOT NULL,
  byte_size             integer NOT NULL CHECK (byte_size > 0),
  sha256                varchar(64) NOT NULL,
  original_name         varchar(255),
  status                varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'UPLOADED')),
  uploaded_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  deleted_at            timestamptz
);
CREATE INDEX IF NOT EXISTS viatico_gasto_adjunto_gasto_idx ON viatico_gasto_adjunto (gasto_id) WHERE deleted_at IS NULL;
