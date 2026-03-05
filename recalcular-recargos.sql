-- Script para recalcular todos los detalles_recargos_dias en Cotransmeq
-- JORNADA_NORMAL = 9.33 (días normales), JORNADA_FESTIVA = 7.33 (domingos/festivos)
-- Porcentajes: RD=80%, HEFD=105%, HEFN=155%

-- IDs de tipos de recargo (Cotransmeq)
-- HED: 09ebdb5d-d4c1-47f7-9e45-5c9b7aa78c83
-- HEN: 321144e9-294f-47c9-b750-f1fe082a32d5
-- HEFD: 9714bb64-5030-468c-bb1c-b7cdd9d031b5
-- HEFN: b5a20064-d558-4ef4-a821-5c05e288fc34
-- RN: 5f5f5ec1-22ae-4c57-ba90-0ab95cf7268a
-- RD: 7bd9e5e6-e6c1-4fd2-a4d8-ce77db33ad82

DO $$
DECLARE
  dia_rec RECORD;
  v_jornada_normal NUMERIC := 9.33;
  v_jornada_festiva NUMERIC := 7.33;
  v_jornada_aplicable NUMERIC;
  v_inicio_nocturno NUMERIC := 19;
  v_fin_nocturno NUMERIC := 6;
  v_total_horas NUMERIC;
  v_hora_inicio NUMERIC;
  v_hora_fin NUMERIC;
  v_es_domingo BOOLEAN;
  v_es_festivo BOOLEAN;
  v_es_domingo_o_festivo BOOLEAN;
  v_hed NUMERIC := 0;
  v_hen NUMERIC := 0;
  v_hefd NUMERIC := 0;
  v_hefn NUMERIC := 0;
  v_rn NUMERIC := 0;
  v_rd NUMERIC := 0;
  v_horas_extras NUMERIC;
  v_hora_actual NUMERIC;
  v_hora_del_dia NUMERIC;
  v_siguiente_hora NUMERIC;
  v_hora_inicio_extras NUMERIC;
  v_horas_extras_nocturnas NUMERIC;
  v_now TIMESTAMP := NOW();
  v_count INTEGER := 0;
  v_total INTEGER;
  
  -- IDs de tipos de recargo (Cotransmeq)
  v_hed_tipo_id UUID := '09ebdb5d-d4c1-47f7-9e45-5c9b7aa78c83';
  v_hen_tipo_id UUID := '321144e9-294f-47c9-b750-f1fe082a32d5';
  v_hefd_tipo_id UUID := '9714bb64-5030-468c-bb1c-b7cdd9d031b5';
  v_hefn_tipo_id UUID := 'b5a20064-d558-4ef4-a821-5c05e288fc34';
  v_rn_tipo_id UUID := '5f5f5ec1-22ae-4c57-ba90-0ab95cf7268a';
  v_rd_tipo_id UUID := '7bd9e5e6-e6c1-4fd2-a4d8-ce77db33ad82';
BEGIN
  -- Contar total de días a procesar
  SELECT COUNT(*) INTO v_total
  FROM dias_laborales_planillas dl
  JOIN recargos_planillas rp ON dl.recargo_planilla_id = rp.id
  WHERE dl.deleted_at IS NULL AND rp.deleted_at IS NULL;
  
  RAISE NOTICE '🔄 Recalculando % días laborales con JORNADA_NORMAL=% y JORNADA_FESTIVA=%', v_total, v_jornada_normal, v_jornada_festiva;

  FOR dia_rec IN 
    SELECT dl.id, dl.hora_inicio, dl.hora_fin, dl.total_horas, dl.es_domingo, dl.es_festivo
    FROM dias_laborales_planillas dl
    JOIN recargos_planillas rp ON dl.recargo_planilla_id = rp.id
    WHERE dl.deleted_at IS NULL AND rp.deleted_at IS NULL
    ORDER BY rp.id, dl.dia
  LOOP
    v_count := v_count + 1;
    
    -- Inicializar valores
    v_hed := 0; v_hen := 0; v_hefd := 0; v_hefn := 0; v_rn := 0; v_rd := 0;
    
    v_hora_inicio := COALESCE(dia_rec.hora_inicio, 0);
    v_hora_fin := COALESCE(dia_rec.hora_fin, 0);
    v_total_horas := COALESCE(dia_rec.total_horas, 0);
    v_es_domingo := COALESCE(dia_rec.es_domingo, false);
    v_es_festivo := COALESCE(dia_rec.es_festivo, false);
    v_es_domingo_o_festivo := v_es_domingo OR v_es_festivo;
    
    -- Determinar jornada aplicable
    IF v_es_domingo_o_festivo THEN
      v_jornada_aplicable := v_jornada_festiva;
    ELSE
      v_jornada_aplicable := v_jornada_normal;
    END IF;
    
    IF v_total_horas <= 0 THEN
      CONTINUE;
    END IF;
    
    -- 1. Calcular Recargo Nocturno (RN) sobre TODAS las horas trabajadas
    v_hora_actual := v_hora_inicio;
    WHILE v_hora_actual < v_hora_inicio + v_total_horas LOOP
      v_hora_del_dia := v_hora_actual - FLOOR(v_hora_actual / 24) * 24;
      v_siguiente_hora := LEAST(v_hora_actual + 0.5, v_hora_inicio + v_total_horas);
      
      IF v_hora_del_dia >= v_inicio_nocturno OR v_hora_del_dia < v_fin_nocturno THEN
        v_rn := v_rn + (v_siguiente_hora - v_hora_actual);
      END IF;
      
      v_hora_actual := v_siguiente_hora;
    END LOOP;
    
    -- 2. Calcular extras según si es domingo/festivo o no
    IF v_es_domingo_o_festivo THEN
      -- Recargo dominical: mínimo entre total_horas y jornada festiva
      v_rd := LEAST(v_total_horas, v_jornada_festiva);
      
      -- Horas extras festivas (después de jornada festiva)
      IF v_total_horas > v_jornada_festiva THEN
        v_horas_extras := v_total_horas - v_jornada_festiva;
        v_hora_inicio_extras := v_hora_inicio + v_jornada_festiva;
        v_horas_extras_nocturnas := 0;
        
        v_hora_actual := v_hora_inicio_extras;
        WHILE v_hora_actual < v_hora_inicio + v_total_horas LOOP
          v_hora_del_dia := v_hora_actual - FLOOR(v_hora_actual / 24) * 24;
          v_siguiente_hora := LEAST(v_hora_actual + 0.5, v_hora_inicio + v_total_horas);
          
          IF v_hora_del_dia >= v_inicio_nocturno OR v_hora_del_dia < v_fin_nocturno THEN
            v_horas_extras_nocturnas := v_horas_extras_nocturnas + (v_siguiente_hora - v_hora_actual);
          END IF;
          
          v_hora_actual := v_siguiente_hora;
        END LOOP;
        
        v_hefn := LEAST(v_horas_extras_nocturnas, v_horas_extras);
        v_hefd := v_horas_extras - v_hefn;
      END IF;
    ELSE
      -- Día normal: extras después de jornada normal
      IF v_total_horas > v_jornada_normal THEN
        v_horas_extras := v_total_horas - v_jornada_normal;
        v_hora_inicio_extras := v_hora_inicio + v_jornada_normal;
        v_horas_extras_nocturnas := 0;
        
        v_hora_actual := v_hora_inicio_extras;
        WHILE v_hora_actual < v_hora_inicio + v_total_horas LOOP
          v_hora_del_dia := v_hora_actual - FLOOR(v_hora_actual / 24) * 24;
          v_siguiente_hora := LEAST(v_hora_actual + 0.5, v_hora_inicio + v_total_horas);
          
          IF v_hora_del_dia >= v_inicio_nocturno OR v_hora_del_dia < v_fin_nocturno THEN
            v_horas_extras_nocturnas := v_horas_extras_nocturnas + (v_siguiente_hora - v_hora_actual);
          END IF;
          
          v_hora_actual := v_siguiente_hora;
        END LOOP;
        
        v_hen := LEAST(v_horas_extras_nocturnas, v_horas_extras);
        v_hed := v_horas_extras - v_hen;
      END IF;
    END IF;
    
    -- Redondear a 1 decimal
    v_hed := ROUND(v_hed::numeric, 1);
    v_hen := ROUND(v_hen::numeric, 1);
    v_hefd := ROUND(v_hefd::numeric, 1);
    v_hefn := ROUND(v_hefn::numeric, 1);
    v_rn := ROUND(v_rn::numeric, 1);
    v_rd := ROUND(v_rd::numeric, 1);
    
    -- Actualizar horas_ordinarias del día (usa jornada festiva o normal según corresponda)
    UPDATE dias_laborales_planillas 
    SET horas_ordinarias = LEAST(v_total_horas, v_jornada_aplicable),
        updated_at = v_now
    WHERE id = dia_rec.id;
    
    -- Soft-delete todos los detalles existentes de este día
    UPDATE detalles_recargos_dias 
    SET activo = false, deleted_at = v_now, updated_at = v_now
    WHERE dia_laboral_id = dia_rec.id AND deleted_at IS NULL;
    
    -- Insertar nuevos detalles recalculados
    IF v_hed > 0 THEN
      INSERT INTO detalles_recargos_dias (id, dia_laboral_id, tipo_recargo_id, horas, activo, created_at, updated_at)
      VALUES (gen_random_uuid(), dia_rec.id, v_hed_tipo_id, v_hed, true, v_now, v_now);
    END IF;
    
    IF v_hen > 0 THEN
      INSERT INTO detalles_recargos_dias (id, dia_laboral_id, tipo_recargo_id, horas, activo, created_at, updated_at)
      VALUES (gen_random_uuid(), dia_rec.id, v_hen_tipo_id, v_hen, true, v_now, v_now);
    END IF;
    
    IF v_hefd > 0 THEN
      INSERT INTO detalles_recargos_dias (id, dia_laboral_id, tipo_recargo_id, horas, activo, created_at, updated_at)
      VALUES (gen_random_uuid(), dia_rec.id, v_hefd_tipo_id, v_hefd, true, v_now, v_now);
    END IF;
    
    IF v_hefn > 0 THEN
      INSERT INTO detalles_recargos_dias (id, dia_laboral_id, tipo_recargo_id, horas, activo, created_at, updated_at)
      VALUES (gen_random_uuid(), dia_rec.id, v_hefn_tipo_id, v_hefn, true, v_now, v_now);
    END IF;
    
    IF v_rn > 0 THEN
      INSERT INTO detalles_recargos_dias (id, dia_laboral_id, tipo_recargo_id, horas, activo, created_at, updated_at)
      VALUES (gen_random_uuid(), dia_rec.id, v_rn_tipo_id, v_rn, true, v_now, v_now);
    END IF;
    
    IF v_rd > 0 THEN
      INSERT INTO detalles_recargos_dias (id, dia_laboral_id, tipo_recargo_id, horas, activo, created_at, updated_at)
      VALUES (gen_random_uuid(), dia_rec.id, v_rd_tipo_id, v_rd, true, v_now, v_now);
    END IF;
    
    -- Progreso cada 50 registros
    IF v_count % 50 = 0 THEN
      RAISE NOTICE '  Procesados %/% días...', v_count, v_total;
    END IF;
  END LOOP;
  
  RAISE NOTICE '✅ Recálculo completado: % días procesados', v_count;
END $$;
