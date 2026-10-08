-- Viáticos: el comprobante de un anticipo por transferencia es opcional.
--
-- `viatico_anticipo_metodo_datos` exigía `comprobante_key` en las
-- transferencias. Ahora la transferencia puede registrarse sin comprobante;
-- el retiro con tarjeta sigue pidiendo de qué tarjeta o cuenta salió.
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261008130000_viaticos_comprobante_opcional

ALTER TABLE viatico_anticipo DROP CONSTRAINT IF EXISTS viatico_anticipo_metodo_datos;
ALTER TABLE viatico_anticipo ADD CONSTRAINT viatico_anticipo_metodo_datos CHECK (
  metodo = 'TRANSFERENCIA'
  OR (metodo = 'RETIRO_TARJETA' AND tarjeta_cuenta IS NOT NULL AND length(trim(tarjeta_cuenta)) > 0)
);
