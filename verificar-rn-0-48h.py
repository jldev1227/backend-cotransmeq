#!/usr/bin/env python3
"""
Verificar cálculo de RN para caso 0:00 - 48:00 (48 horas festivo)
"""

INICIO_NOCTURNO = 21
FIN_NOCTURNO = 6
JORNADA_NORMAL = 10

hora_inicio = 0  # 00:00
total_horas = 48
es_festivo = True

# BACKEND LOGIC (limitado a primeras 10 horas)
rn_backend = 0
hora_actual = hora_inicio

print("=== BACKEND (limitado a primeras 10h) ===")
while hora_actual < min(hora_inicio + total_horas, hora_inicio + JORNADA_NORMAL):
    hora_del_dia = hora_actual % 24
    siguiente_hora = min(
        hora_actual + 0.5,
        hora_inicio + total_horas,
        hora_inicio + JORNADA_NORMAL
    )
    
    es_nocturno = hora_del_dia >= INICIO_NOCTURNO or hora_del_dia < FIN_NOCTURNO
    incremento = siguiente_hora - hora_actual
    
    if es_nocturno:
        rn_backend += incremento
        print(f"  {hora_actual:5.1f} - {siguiente_hora:5.1f} (hora_del_dia={hora_del_dia:5.1f}) = {incremento:.1f}h NOCTURNO ✓")
    else:
        print(f"  {hora_actual:5.1f} - {siguiente_hora:5.1f} (hora_del_dia={hora_del_dia:5.1f}) = {incremento:.1f}h diurno")
    
    hora_actual = siguiente_hora

print(f"\n📊 BACKEND RN = {rn_backend}h")

# FRONTEND LOGIC (calculando toda la jornada - SI NO TIENE LÍMITE)
rn_frontend = 0
hora_actual = hora_inicio

print("\n=== FRONTEND (si calcula todas las 48h) ===")
ciclo = 1
for i in range(int(total_horas / 0.5)):
    hora_del_dia = hora_actual % 24
    siguiente_hora = min(hora_actual + 0.5, hora_inicio + total_horas)
    
    es_nocturno = hora_del_dia >= INICIO_NOCTURNO or hora_del_dia < FIN_NOCTURNO
    incremento = siguiente_hora - hora_actual
    
    if es_nocturno:
        rn_frontend += incremento
        if i < 20 or i >= 94:  # Mostrar primeras 10h y últimas 2h
            print(f"  {hora_actual:5.1f} - {siguiente_hora:5.1f} (hora_del_dia={hora_del_dia:5.1f}) = {incremento:.1f}h NOCTURNO ✓")
    
    hora_actual = siguiente_hora
    
    # Mostrar separador cada 24h
    if i == 47:
        print("  ... (ciclo 2) ...")

print(f"\n📊 FRONTEND RN = {rn_frontend}h")

print("\n" + "="*60)
print("RESUMEN:")
print("="*60)
print(f"Turno: {hora_inicio}:00 - {hora_inicio + total_horas}:00 ({total_horas}h) FESTIVO")
print(f"\n✅ BACKEND (correcto): RN = {rn_backend}h")
print(f"   → Solo primeras 10h: 0:00-6:00 = 6h nocturnas")
print(f"\n❌ FRONTEND (incorrecto): RN = {rn_frontend}h")
print(f"   → Calcula todas las 48h:")
print(f"     • 0:00-6:00 = 6h")
print(f"     • 21:00-24:00 = 3h")
print(f"     • 24:00-30:00 = 6h")
print(f"     • 45:00-48:00 = 3h")
print(f"     Total = 18h (ERROR)")
print(f"\n🔧 El FRONTEND debe limitar RN a las primeras 10 horas")
