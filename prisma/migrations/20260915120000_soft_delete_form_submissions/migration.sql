-- Borrado lógico de envíos de formularios dinámicos.
--
-- MOTIVO
--
-- Abrir un formulario en el portal del conductor YA crea la fila: el primer
-- backup del borrador inserta un `form_submissions` en `DRAFT`. Quien entra a
-- mirar un preoperacional y se sale deja una tarjeta "a medias" que no se puede
-- retirar por ninguna vía de producto, y esas tarjetas se acumulan en el portal
-- y en el explorador del dashboard. La única salida hasta hoy era un script
-- contra la base (`cerrar_draft_york_mendoza_20260903.sql` es uno de ellos).
--
-- El `DELETE` físico que hacía `descartarBorradorPortal` no servía como
-- solución general: se llevaba por cascada `form_answers`, `form_attachments` y
-- `form_submission_events`, así que un descarte accidental no se podía deshacer
-- ni auditar, y la evidencia ya subida a S3 quedaba sin dueño en la base.
--
-- QUÉ HACE
--
--   1. `deleted_at` en `form_submissions`.
--   2. Dos índices parciales `WHERE deleted_at IS NULL` sobre las dos rutas de
--      lectura reales: el historial del conductor y el de «Mis formularios».
--      Son los mismos que `idx_form_submissions_portal` y
--      `idx_form_submissions_usuario`, restringidos a lo vivo, que es lo único
--      que consultan las pantallas.
--
-- QUÉ NO HACE
--
-- No toca una sola fila: `deleted_at` nace NULL. No sustituye a `VOIDED`, que
-- es otra cosa: anular es retirar la validez de un envío ENTREGADO conservando
-- sus respuestas y exigiendo motivo. Borrar es retirar un borrador que nunca se
-- entregó. Por eso no se añade a `ck_form_submissions_terminal`: son ejes
-- distintos y un envío marcado conserva el estado que tenía.
--
-- Tampoco añade `deleted_by`: la bitácora de este módulo son los
-- `form_submission_events`, y el descarte escribe un evento `DISCARDED` con
-- `actor_type`/`actor_id`. Una columna más sería una segunda fuente de verdad
-- sobre lo mismo.
--
-- Es idempotente.

ALTER TABLE form_submissions
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ(6) NULL;

COMMENT ON COLUMN form_submissions.deleted_at IS
  'Borrado lógico. Solo se marcan borradores (status = DRAFT); un envío entregado se retira con VOIDED.';

CREATE INDEX IF NOT EXISTS idx_form_submissions_portal_vivos
  ON form_submissions (conductor_id, business_date DESC, status)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_form_submissions_usuario_vivos
  ON form_submissions (usuario_id, business_date DESC, status)
  WHERE deleted_at IS NULL;
