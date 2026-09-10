-- Normaliza el nombre y el apellido de los conductores ya guardados.
--
-- A partir de ahora el backend los normaliza al crear y al actualizar
-- (`conductores/nombre-persona.ts`), pero los registros existentes venían de
-- años de tecleo libre: «Eudes », «william», «JOHNT CARLOS  », «Cubides
-- Morales ». Eso se ve en la ficha, en las pestañas del canvas de recorridos y
-- en los PDF, y rompe el orden por apellido —en el orden de códigos las
-- minúsculas van detrás de TODAS las mayúsculas, así que «perez» cae después
-- de «Zapata».
--
-- La regla es la misma que aplica el código:
--   · se quita lo que no es letra, espacio, apóstrofo o guion (dígitos y
--     puntuación en este campo siempre han sido erratas);
--   · se colapsan los espacios repetidos y se recortan los de los extremos;
--   · se pasa a MAYÚSCULAS.
--
-- Las tildes y la Ñ se CONSERVAN: quitarlas cambiaría el nombre de la persona,
-- no lo limpiaría. `[:alpha:]` las reconoce con la colación UTF-8 de esta base
-- (verificado: «josé muñoz» → «JOSÉ MUÑOZ»).
--
-- Es idempotente: volver a ejecutarla sobre datos ya normalizados no cambia
-- ninguna fila, porque el WHERE compara con el resultado.

-- Escrita a mano y NO aplicada por `prisma migrate dev`: el historial de
-- migraciones de este proyecto está desalineado con la base real y `dev`/
-- `deploy` ofrecen un reset que vacía tablas. Se aplica ejecutando este SQL en
-- una transacción y marcándolo después con `prisma migrate resolve --applied`.

UPDATE "conductores"
   SET "nombre"   = NULLIF(upper(btrim(regexp_replace(regexp_replace("nombre",   '[^[:alpha:][:space:]''-]', ' ', 'g'), '\s+', ' ', 'g'))), ''),
       "apellido" = NULLIF(upper(btrim(regexp_replace(regexp_replace("apellido", '[^[:alpha:][:space:]''-]', ' ', 'g'), '\s+', ' ', 'g'))), '')
 WHERE "nombre"   IS DISTINCT FROM NULLIF(upper(btrim(regexp_replace(regexp_replace("nombre",   '[^[:alpha:][:space:]''-]', ' ', 'g'), '\s+', ' ', 'g'))), '')
    OR "apellido" IS DISTINCT FROM NULLIF(upper(btrim(regexp_replace(regexp_replace("apellido", '[^[:alpha:][:space:]''-]', ' ', 'g'), '\s+', ' ', 'g'))), '');

-- Sin reversión: no se guarda el valor anterior porque lo que se corrige son
-- erratas de tecleo, no un dato de negocio que alguien pueda querer recuperar.
