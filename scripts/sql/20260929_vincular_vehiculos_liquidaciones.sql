-- VINCULAR VEHÍCULOS A LAS LIQUIDACIONES QUE NO TIENEN NINGUNO.
--
-- El generador de borradores del canvas no escribía `liquidacion_vehiculo`
-- (el formulario sí). El análisis de nómina casa cada bono, recargo y pernote
-- con su placa a través de esa tabla, así que los meses generados desde el
-- canvas salían en cero. El código ya lo hace al generar (`vincularVehiculos`);
-- esto repara lo que se generó antes.
--
-- Solo toca liquidaciones vivas SIN NINGÚN vínculo activo, y los vehículos
-- salen de lo que la liquidación ya usa: días de su copia, bonos, recargos y
-- pernotes. `ON CONFLICT DO NOTHING`: repetirlo no cambia nada.
INSERT INTO liquidacion_vehiculo (liquidacion_id, vehiculo_id, created_at, updated_at)
SELECT DISTINCT x.liquidacion_id, x.vehiculo_id, now(), now()
FROM (
  SELECT liquidacion_id, vehiculo_id FROM liquidaciones_dias WHERE deleted_at IS NULL
  UNION SELECT liquidacion_id, vehiculo_id FROM bonificaciones WHERE deleted_at IS NULL
  UNION SELECT liquidacion_id, vehiculo_id FROM recargos WHERE deleted_at IS NULL
  UNION SELECT liquidacion_id, vehiculo_id FROM pernotes WHERE deleted_at IS NULL
) x
JOIN liquidaciones l ON l.id = x.liquidacion_id AND l.deleted_at IS NULL
JOIN vehiculos v ON v.id = x.vehiculo_id
WHERE x.vehiculo_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM liquidacion_vehiculo lv
    WHERE lv.liquidacion_id = l.id AND lv.deleted_at IS NULL
  )
ON CONFLICT (liquidacion_id, vehiculo_id) DO NOTHING;
