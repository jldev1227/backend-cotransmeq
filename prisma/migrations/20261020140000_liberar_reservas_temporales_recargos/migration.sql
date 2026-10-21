-- Las reservas anteriores eran permanentes y el contador no retrocedía.
-- Solo se descartan sugerencias sin recargo, nunca recargos registrados.
DELETE FROM "recargos_planillas_reservas";
DROP TABLE "recargos_planillas_consecutivos";
