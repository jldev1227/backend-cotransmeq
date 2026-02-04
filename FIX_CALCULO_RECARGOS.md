# 🔧 Fix: Cálculo de Recargos - Backend vs Frontend

## 📋 Problema Identificado

Los cálculos de recargos entre el backend y el frontend NO coincidían cuando las jornadas cruzaban la medianoche (horas > 24) o cuando había horas extras.

### Caso Problemático Reportado
**Recargo:** da56638f-3ec9-481b-92b5-8c10cfcd6b1d  
**Día 1:** hora_inicio=1, hora_fin=48 (47 horas), festivo=Sí

**Valores Incorrectos (antes del fix):**
- RN: 17 horas ❌ (debería ser 5)
- RD: 10 horas ✅
- HEFD: 25 horas ✅  
- HEFN: 12 horas ✅

---

## 🐛 Causa Raíz

El backend estaba calculando el **Recargo Nocturno (RN)** en TODAS las horas de la jornada, cuando debería calcularlo **SOLO en las primeras 10 horas** (jornada normal).

### Lógica Incorrecta (ANTES):
```typescript
// ❌ Calculaba RN en toda la jornada
let horaActual = hora_inicio
while (horaActual < hora_inicio + total_horas) {  // ← Recorría todas las horas
  const horaDelDia = horaActual % 24
  if (horaDelDia >= 21 || horaDelDia < 6) {
    rn += 0.5  // ← Sumaba RN incluso en horas extras
  }
  horaActual += 0.5
}
```

**Problema:** En el caso de 47 horas (1:00-48:00), estaba contando:
- RN en las primeras 10 horas: 5 horas ✅
- RN en las horas extras (10-47): 12 horas ❌ (NO debería contarse)
- **Total:** 17 horas (INCORRECTO)

### Por qué es incorrecto:
- Las **horas extras nocturnas** ya están contabilizadas en **HEN** (Hora Extra Nocturna) o **HEFN** (Hora Extra Festiva Nocturna)
- El **RN** (Recargo Nocturno) solo aplica a las primeras 10 horas de jornada normal
- Contarlo dos veces (RN + HEN/HEFN) duplica el pago por las mismas horas

---

## ✅ Solución Implementada

### Cambio en el Backend

**Archivo:** `src/modules/recargos/recargos.service.ts`

```typescript
// ✅ Ahora calcula RN SOLO en las primeras 10 horas
let horaActual = hora_inicio
while (horaActual < Math.min(hora_inicio + total_horas, hora_inicio + HORAS_LIMITE.JORNADA_NORMAL)) {
  //                ↑ Limita el loop a las primeras 10 horas
  const horaDelDia = horaActual % 24
  const siguienteHora = Math.min(
    horaActual + 0.5, 
    hora_inicio + total_horas, 
    hora_inicio + HORAS_LIMITE.JORNADA_NORMAL  // ← Límite de jornada normal
  )
  
  if (horaDelDia >= HORAS_LIMITE.INICIO_NOCTURNO || horaDelDia < HORAS_LIMITE.FIN_NOCTURNO) {
    rn += siguienteHora - horaActual
  }
  
  horaActual = siguienteHora
}
```

### Lógica Correcta:
1. **RN (Recargo Nocturno):** Se calcula SOLO en las primeras 10 horas de trabajo
2. **HED/HEN:** Horas extras (después de 10h) en días normales
3. **HEFD/HEFN:** Horas extras (después de 10h) en días festivos/domingos
4. **RD:** Recargo dominical/festivo en las primeras 10 horas

---

## 📊 Casos de Prueba

Se creó el script `test-calculo-recargos.ts` que verifica 5 casos:

### Caso 1: 47 horas festivas (1:00-48:00) 🎯
```
Antes:  RN=17  RD=10  HEFD=25  HEFN=12  ❌
Ahora:  RN=5   RD=10  HEFD=25  HEFN=12  ✅
```
**Fix:** RN reducido de 17 a 5 horas (solo primeras 10h)

### Caso 2: 10 horas festivas (1:00-11:00)
```
RN=5  RD=10  HEFD=0  HEFN=0  ✅
```
**Correcto desde el inicio** (no hay horas extras)

### Caso 3: 10 horas normales (8:00-18:00)
```
RN=0  RD=0  HED=0  HEN=0  ✅
```
**Correcto** (horario diurno, sin recargos)

### Caso 4: 14 horas normales (8:00-22:00)
```
Antes:  RN=1  HED=3  HEN=1  ❌
Ahora:  RN=0  HED=3  HEN=1  ✅
```
**Fix:** RN eliminado (la hora nocturna 21-22 es hora extra, cuenta como HEN)

### Caso 5: 24 horas festivas nocturnas (22:00-46:00)
```
Antes:  RN=9  RD=10  HEFD=13  HEFN=1  ❌
Ahora:  RN=8  RD=10  HEFD=13  HEFN=1  ✅
```
**Fix:** RN reducido de 9 a 8 horas (solo primeras 10h)

---

## 🧪 Verificación

### Ejecutar el Script de Prueba
```bash
cd backend-nest-main\ 2
npx tsx test-calculo-recargos.ts
```

**Salida Esperada:**
```
🧪 VERIFICACIÓN DE CÁLCULOS DE RECARGOS
================================================================================

📋 CASO 1: Día 1: 1:00-48:00 (47h) festivo - EL PROBLEMA PRINCIPAL
--------------------------------------------------------------------------------
🔵 Backend:   RN=5  RD=10  HED=0  HEN=0  HEFD=25  HEFN=12
🟢 Frontend:  RN=5  RD=10  HED=0  HEN=0  HEFD=25  HEFN=12
✅ CÁLCULOS COINCIDEN PERFECTAMENTE

... (más casos) ...

📊 RESUMEN: ✅ TODOS LOS CÁLCULOS CORRECTOS
```

---

## 🔄 Recargos Existentes con Valores Incorrectos

### Problema
Los recargos creados ANTES de este fix tienen valores incorrectos en la base de datos.

### Identificar Recargos Afectados
```sql
-- Buscar recargos con RN sospechosamente alto
SELECT 
  r.id,
  r.numero_planilla,
  r.mes,
  r.año,
  SUM(d.total_horas) as total_horas,
  SUM(CAST(dr.horas AS DECIMAL)) FILTER (WHERE tr.codigo = 'RN') as total_rn
FROM recargos_planillas r
JOIN dias_laborales_planillas d ON r.id = d.recargo_planilla_id
LEFT JOIN detalles_recargos_dias dr ON d.id = dr.dia_laboral_id
LEFT JOIN tipos_recargos tr ON dr.tipo_recargo_id = tr.id
WHERE r.deleted_at IS NULL
GROUP BY r.id
HAVING SUM(CAST(dr.horas AS DECIMAL)) FILTER (WHERE tr.codigo = 'RN') > 10
ORDER BY total_rn DESC;
```

### Solución 1: Reeditar el Recargo (Recomendado)
1. Abrir el recargo en la interfaz
2. Hacer clic en "Editar"
3. Modificar cualquier campo (puede ser el mismo valor)
4. Guardar

**✅ El backend recalculará automáticamente con la nueva lógica correcta**

### Solución 2: Script SQL Masivo (Solo si hay muchos recargos)
```sql
-- ⚠️ CUIDADO: Esto eliminará todos los detalles y recalculará
-- Solo usar si entiendes las implicaciones

DO $$
DECLARE
  recargo_record RECORD;
BEGIN
  FOR recargo_record IN 
    SELECT DISTINCT r.id
    FROM recargos_planillas r
    JOIN dias_laborales_planillas d ON r.id = d.recargo_planilla_id
    WHERE r.deleted_at IS NULL
  LOOP
    -- Eliminar detalles existentes
    DELETE FROM detalles_recargos_dias
    WHERE dia_laboral_id IN (
      SELECT id FROM dias_laborales_planillas 
      WHERE recargo_planilla_id = recargo_record.id
    );
    
    -- Los detalles se recrearán cuando se actualice el recargo
    -- Actualizar la fecha para forzar recálculo
    UPDATE recargos_planillas 
    SET updated_at = NOW() 
    WHERE id = recargo_record.id;
  END LOOP;
  
  RAISE NOTICE 'Recargos preparados para recálculo';
END $$;
```

**Nota:** Este script solo prepara los recargos. Necesitas actualizarlos desde la interfaz para que se recalculen.

### Solución 3: Recrear desde Cero
Si el recargo es nuevo y no tiene dependencias:
1. Eliminar el recargo (soft delete)
2. Crear un nuevo recargo con los mismos datos

**✅ Se creará con los cálculos correctos**

---

## 📝 Archivos Modificados

### Backend
- ✅ `src/modules/recargos/recargos.service.ts`
  - Línea 31-52: Función `calcularRecargosDia()` actualizada
  - Cambio crítico: Limitar cálculo de RN a las primeras 10 horas

### Archivos Creados
- ✅ `test-calculo-recargos.ts` - Script de verificación
- ✅ `FIX_CALCULO_RECARGOS.md` - Este documento

---

## 🎯 Impacto del Fix

### Antes (Incorrecto)
- RN se contaba en toda la jornada
- Podía llegar a valores muy altos (ej: 17h en jornada de 47h)
- Sobrepago por horas nocturnas (RN + HEN/HEFN)

### Después (Correcto)
- RN solo se cuenta en primeras 10 horas
- Valores realistas (máximo 9h de RN en jornada de 10h nocturnas)
- Sin doble conteo: RN para jornada normal, HEN/HEFN para extras

### Ejemplo de Ahorro
**Jornada de 47 horas festivas (1:00-48:00):**
- RN antes: 17 horas × 35% = 5.95 horas de recargo ❌
- RN ahora: 5 horas × 35% = 1.75 horas de recargo ✅
- **Diferencia:** 4.2 horas de recargo mal calculadas

Si el salario base es $50,000/hora:
- Sobrepago antes del fix: $210,000 por recargo ❌
- Con el fix: Cálculo correcto según ley laboral ✅

---

## ✅ Checklist de Verificación

- [x] Script de prueba pasa todos los casos
- [x] Backend calcula RN solo en primeras 10h
- [x] Coincide 100% con cálculos del frontend
- [ ] Recargos existentes reedita dos desde la interfaz
- [ ] Documentación actualizada
- [ ] Equipo notificado del cambio

---

## 🚀 Próximos Pasos

1. **Inmediato:**
   - ✅ Fix aplicado y verificado
   - ⏳ Identificar recargos afectados en base de datos

2. **Corto Plazo:**
   - [ ] Reeditar recargos con valores incorrectos
   - [ ] Validar con usuario que los nuevos cálculos son correctos

3. **Mediano Plazo:**
   - [ ] Agregar validaciones en frontend para detectar discrepancias
   - [ ] Dashboard para auditar recargos históricos
   - [ ] Tests automatizados en CI/CD

---

**Fecha del Fix:** 4 de febrero de 2026  
**Versión:** 1.0  
**Desarrollador:** Sistema de Cálculo de Recargos Cotransmeq
