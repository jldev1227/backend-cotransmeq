-- DISPONIBILIDAD MES, una por bloque del desprendible.
--
-- `disponibilidad` era una sola cifra para todo el corte, pero cada cliente
-- con bloque propio —PAREX y GEOPARK— tiene la suya, y el desprendible
-- enseñaba la suma de las tres en una única línea dentro de OTROS.
--
-- La columna que ya existía pasa a ser la de OTROS, que es lo que venía siendo
-- en las liquidaciones sin PAREX ni GEOPARK (la inmensa mayoría): por eso NO
-- se migra ningún dato. Las dos nuevas nacen en 0, que es «nada imputado».
--
-- Mismo patrón que `ajuste_parex` / `ajuste_geopark`.
ALTER TABLE "liquidaciones"
  ADD COLUMN "disponibilidad_parex"   DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN "disponibilidad_geopark" DECIMAL(10,2) DEFAULT 0;
