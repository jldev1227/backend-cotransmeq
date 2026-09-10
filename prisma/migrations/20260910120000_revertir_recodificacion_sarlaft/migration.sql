-- Vuelve los formatos SARLAFT a su código de siempre: SLFT-PTEE-FR-0X -> GC-FR-0X
--
-- Deshace `20260902000000_recodificar_sarlaft_slft_ptee`. Aquel renombró los
-- tres formatos a SLFT-PTEE-FR-04/05/06, pero el código controlado de estos
-- documentos en COTRANSMEQ es GC-FR-04/05/06 —es el que llevan impreso los
-- formatos del sistema de gestión y el que la empresa reconoce—, así que el
-- PDF y el catálogo vuelven a él.
--
-- Sin este UPDATE los radicados enviados entre el 2 y el 10 de septiembre se
-- quedan huérfanos: `getFormularioPorCodigo` ya no conoce SLFT-PTEE-FR-0X y la
-- descarga del PDF de esos radicados devuelve null.
--
-- SOLO los tres del recodificado. `SLFT-PTEE-FR-12` (Autorización del
-- Propietario) NO entra: ese código nunca fue GC-FR-12 en el catálogo —el
-- nombre GC-FR-12 solo aparece en `archivo_origen`, el PDF del que se
-- transcribió—. `GC-FOR-13` tampoco se tocó nunca.
--
-- No altera radicados (se generan por tipo_formulario, no por código) ni el
-- snapshot de respuestas. `codigo_formulario` es VarChar(20) y "GC-FR-04" mide
-- 8 caracteres, así que cabe de sobra.
--
-- Es idempotente: el WHERE acota a los tres códigos exactos, y volver a
-- ejecutarla sobre datos ya revertidos no toca ninguna fila.
--
-- Escrita a mano y NO aplicada por `prisma migrate dev`: el historial de
-- migraciones de este proyecto está desalineado con la base real y `dev` /
-- `deploy` ofrecen un reset que vacía tablas. Se aplica ejecutando este SQL en
-- una transacción y marcándolo después con `prisma migrate resolve --applied`.

BEGIN;

UPDATE "formulario_sarlaft_ptee"
   SET "codigo_formulario" = 'GC-FR-' || right("codigo_formulario", 2)
 WHERE "codigo_formulario" IN ('SLFT-PTEE-FR-04', 'SLFT-PTEE-FR-05', 'SLFT-PTEE-FR-06');

-- Verificación antes de confirmar: no debe quedar ningún SLFT-PTEE-FR-0[456],
-- y SLFT-PTEE-FR-12 debe seguir intacto.
-- SELECT codigo_formulario, count(*) FROM formulario_sarlaft_ptee GROUP BY 1 ORDER BY 1;

COMMIT;
