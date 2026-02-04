-- Script para asignar un creado_por_id a los recargos existentes que no tienen uno
-- Esto es opcional, pero ayuda a mantener la integridad de los datos de auditoría

-- Primero, verificar cuántos recargos no tienen creado_por_id
SELECT COUNT(*) as recargos_sin_creador
FROM recargos_planillas
WHERE creado_por_id IS NULL;

-- Ver los recargos sin creador
SELECT 
  id,
  numero_planilla,
  mes,
  a_o,
  estado,
  created_at
FROM recargos_planillas
WHERE creado_por_id IS NULL
ORDER BY created_at DESC
LIMIT 10;

-- Opción 1: Asignar un usuario específico como creador (REEMPLAZAR 'USER_ID_AQUI' con un ID real)
-- UPDATE recargos_planillas
-- SET creado_por_id = 'USER_ID_AQUI'
-- WHERE creado_por_id IS NULL;

-- Opción 2: Buscar el primer usuario disponible y asignarlo
DO $$
DECLARE
  admin_user_id UUID;
  affected_rows INT;
BEGIN
  -- Buscar el primer usuario (ajustar condiciones según necesites)
  SELECT id INTO admin_user_id
  FROM users
  ORDER BY created_at ASC
  LIMIT 1;

  -- Si se encontró un usuario, actualizar los recargos
  IF admin_user_id IS NOT NULL THEN
    UPDATE recargos_planillas
    SET creado_por_id = admin_user_id
    WHERE creado_por_id IS NULL;
    
    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RAISE NOTICE 'Se actualizaron % recargos con el usuario: %', affected_rows, admin_user_id;
  ELSE
    RAISE NOTICE 'No se encontró ningún usuario para asignar';
  END IF;
END $$;

-- Verificar los cambios
SELECT COUNT(*) as recargos_sin_creador
FROM recargos_planillas
WHERE creado_por_id IS NULL;

-- Ver algunos registros actualizados
SELECT 
  r.id,
  r.numero_planilla,
  r.mes,
  r.a_o,
  r.creado_por_id,
  u.nombre || ' ' || u.apellido as creado_por_nombre
FROM recargos_planillas r
LEFT JOIN users u ON r.creado_por_id = u.id
ORDER BY r.created_at DESC
LIMIT 10;
