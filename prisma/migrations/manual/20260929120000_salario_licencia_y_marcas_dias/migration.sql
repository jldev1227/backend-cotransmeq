-- SALARIO DE LA LICENCIA Y MARCAS POR DÍA DEL DESPRENDIBLE.
--
-- `salario_licencia`: el mismo trato que `salario_vacaciones`. NULL significa
-- «del básico», que es lo que se hacía hasta ahora, así que ninguna
-- liquidación existente cambia de importe.
--
-- `marcas_dias`: decisiones por día trabajado sobre el desprendible, tomadas
-- en el canvas. Clave `AAAA-MM-DD|empresa_id` → `{ "ocultar": bool,
-- "noSumar": bool }`. NULL = ningún día marcado.
--   · ocultar: el día no aparece en las tablas de recargos.
--   · noSumar: el día aparece, pero su valor no entra en los recargos pagados.
-- En JSON porque es una lista corta, siempre leída junto a la liquidación y
-- sin nada que la referencie.
ALTER TABLE "liquidaciones"
  ADD COLUMN IF NOT EXISTS "salario_licencia" DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS "marcas_dias"      JSONB;
