-- Backfill: Para servicios vinculados a recargos_planillas que no tienen fecha_realizacion,
-- establecer el primer día del mes/año del recargo planilla correspondiente.

UPDATE servicio s
SET fecha_realizacion = make_timestamp(rp.a_o, rp.mes, 1, 6, 0, 0)
FROM recargos_planillas rp
WHERE rp.servicio_id = s.id
  AND s.fecha_realizacion IS NULL;

-- Verificar resultados
SELECT s.id, s.fecha_realizacion, rp.mes, rp.a_o
FROM servicio s
JOIN recargos_planillas rp ON rp.servicio_id = s.id
ORDER BY rp.a_o, rp.mes
LIMIT 20;
