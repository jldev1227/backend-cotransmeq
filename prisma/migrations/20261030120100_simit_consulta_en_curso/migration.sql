-- Guarda cada consulta individual antes de enviarla al portal oficial para que
-- la ficha pueda mostrar el estado en curso y recibir el resultado por socket.
ALTER TABLE "simit_consultas"
    DROP CONSTRAINT "simit_consultas_estado_check";

ALTER TABLE "simit_consultas"
    ADD CONSTRAINT "simit_consultas_estado_check"
    CHECK ("estado_consulta" IN ('en_curso', 'sin_deuda', 'con_deuda', 'error'));
