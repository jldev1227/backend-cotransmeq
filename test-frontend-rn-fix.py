#!/usr/bin/env python3
"""
Test del cálculo de RN en frontend después del fix
Caso: 0:00 - 48:00 (48h festivo)
"""

INICIO_NOCTURNO = 21
FIN_NOCTURNO = 6
JORNADA_NORMAL = 10

def normalizar_hora(hora):
    return hora % 24

def calcular_rn_frontend_fixed(hora_inicio, total_horas):
    """Simulación del nuevo cálculo de frontend (limitado a 10h)"""
    rn = 0
    hora_actual = hora_inicio
    hora_limite_rn = min(hora_inicio + total_horas, hora_inicio + JORNADA_NORMAL)
    
    while hora_actual < hora_limite_rn:
        hora_del_dia = normalizar_hora(hora_actual)
        siguiente_hora = min(hora_actual + 0.5, hora_limite_rn)
        
        if hora_del_dia >= INICIO_NOCTURNO or hora_del_dia < FIN_NOCTURNO:
            rn += siguiente_hora - hora_actual
        
        hora_actual = siguiente_hora
    
    return rn

# Caso de prueba
hora_inicio = 0
total_horas = 48
es_festivo = True

rn_calculado = calcular_rn_frontend_fixed(hora_inicio, total_horas)

print("="*60)
print("TEST CÁLCULO RN FRONTEND (DESPUÉS DEL FIX)")
print("="*60)
print(f"Turno: {hora_inicio}:00 - {hora_inicio + total_horas}:00 ({total_horas}h)")
print(f"Festivo: {es_festivo}")
print(f"\n✅ RN calculado (frontend): {rn_calculado}h")
print(f"✅ RN esperado (backend): 6.0h")
print(f"\n{'✅ CORRECTO!' if rn_calculado == 6.0 else '❌ ERROR'}")

if rn_calculado == 6.0:
    print("\n🎉 El frontend ahora calcula RN correctamente:")
    print("   - Limita el cálculo a las primeras 10 horas")
    print("   - 0:00-6:00 = 6h nocturnas (dentro de las primeras 10h)")
    print("   - 6:00-10:00 = 0h nocturnas (horario diurno)")
    print("   - Total RN = 6.0h ✓")
else:
    print(f"\n❌ Aún hay un error. Se esperaba 6.0h pero se obtuvo {rn_calculado}h")
