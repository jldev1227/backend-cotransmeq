#!/usr/bin/env python3
"""
Test completo frontend vs backend - Cálculo de recargos
Verificar que ambos sistemas calculan exactamente igual después del fix
"""

INICIO_NOCTURNO = 21
FIN_NOCTURNO = 6
JORNADA_NORMAL = 10

def normalizar_hora(hora):
    return hora % 24

def calcular_recargos_frontend(hora_inicio, hora_fin, es_festivo):
    """Simulación exacta del cálculo frontend después del fix"""
    total_horas = hora_fin - hora_inicio
    
    if total_horas <= 0:
        return {'HED': 0, 'HEN': 0, 'HEFD': 0, 'HEFN': 0, 'RN': 0, 'RD': 0}
    
    hed = hen = hefd = hefn = rn = rd = 0
    
    # RN - Solo primeras 10 horas
    hora_actual = hora_inicio
    hora_limite_rn = min(hora_inicio + total_horas, hora_inicio + JORNADA_NORMAL)
    
    while hora_actual < hora_limite_rn:
        hora_del_dia = normalizar_hora(hora_actual)
        siguiente_hora = min(hora_actual + 0.5, hora_limite_rn)
        
        if hora_del_dia >= INICIO_NOCTURNO or hora_del_dia < FIN_NOCTURNO:
            rn += siguiente_hora - hora_actual
        
        hora_actual = siguiente_hora
    
    if es_festivo:
        # RD - primeras 10 horas
        rd = min(total_horas, JORNADA_NORMAL)
        
        # HEFD/HEFN - después de 10 horas
        if total_horas > JORNADA_NORMAL:
            horas_extras = total_horas - JORNADA_NORMAL
            hora_inicio_extras = hora_inicio + JORNADA_NORMAL
            horas_extras_nocturnas = 0
            
            hora_actual_extra = hora_inicio_extras
            while hora_actual_extra < hora_fin:
                hora_del_dia = normalizar_hora(hora_actual_extra)
                siguiente_hora = min(hora_actual_extra + 0.5, hora_fin)
                
                if hora_del_dia >= INICIO_NOCTURNO or hora_del_dia < FIN_NOCTURNO:
                    horas_extras_nocturnas += siguiente_hora - hora_actual_extra
                
                hora_actual_extra = siguiente_hora
            
            hefn = min(horas_extras_nocturnas, horas_extras)
            hefd = horas_extras - hefn
    else:
        # Día normal - HED/HEN después de 10 horas
        if total_horas > JORNADA_NORMAL:
            horas_extras = total_horas - JORNADA_NORMAL
            hora_inicio_extras = hora_inicio + JORNADA_NORMAL
            horas_extras_nocturnas = 0
            
            hora_actual_extra = hora_inicio_extras
            while hora_actual_extra < hora_fin:
                hora_del_dia = normalizar_hora(hora_actual_extra)
                siguiente_hora = min(hora_actual_extra + 0.5, hora_fin)
                
                if hora_del_dia >= INICIO_NOCTURNO or hora_del_dia < FIN_NOCTURNO:
                    horas_extras_nocturnas += siguiente_hora - hora_actual_extra
                
                hora_actual_extra = siguiente_hora
            
            hen = min(horas_extras_nocturnas, horas_extras)
            hed = horas_extras - hen
    
    return {'HED': hed, 'HEN': hen, 'HEFD': hefd, 'HEFN': hefn, 'RN': rn, 'RD': rd}

# Casos de prueba (los mismos del backend)
casos = [
    {
        'nombre': 'CASO 1: 1:00-48:00 (47h festivo)',
        'hora_inicio': 1,
        'hora_fin': 48,
        'es_festivo': True,
        'backend': {'RN': 5, 'RD': 10, 'HEFD': 25, 'HEFN': 12}
    },
    {
        'nombre': 'CASO 2: 10:00-20:00 (10h festivo)',
        'hora_inicio': 10,
        'hora_fin': 20,
        'es_festivo': True,
        'backend': {'RN': 0, 'RD': 10, 'HEFD': 0, 'HEFN': 0}
    },
    {
        'nombre': 'CASO 3: 8:00-18:00 (10h normal)',
        'hora_inicio': 8,
        'hora_fin': 18,
        'es_festivo': False,
        'backend': {'RN': 0, 'RD': 0, 'HED': 0, 'HEN': 0}
    },
    {
        'nombre': 'CASO 4: 6:00-20:00 (14h normal)',
        'hora_inicio': 6,
        'hora_fin': 20,
        'es_festivo': False,
        'backend': {'RN': 0, 'RD': 0, 'HED': 4, 'HEN': 0}
    },
    {
        'nombre': 'CASO 5: 21:00-45:00 (24h nocturno)',
        'hora_inicio': 21,
        'hora_fin': 45,
        'es_festivo': False,
        'backend': {'RN': 9, 'RD': 0, 'HED': 1, 'HEN': 13}
    },
    {
        'nombre': 'CASO 6: 0:00-48:00 (48h festivo) - CASO REPORTADO',
        'hora_inicio': 0,
        'hora_fin': 48,
        'es_festivo': True,
        'backend': {'RN': 6, 'RD': 10, 'HEFD': 26, 'HEFN': 12}
    }
]

print("="*70)
print("TEST COMPLETO: FRONTEND vs BACKEND (después del fix)")
print("="*70)

todos_correctos = True

for i, caso in enumerate(casos, 1):
    print(f"\n{'='*70}")
    print(f"{caso['nombre']}")
    print(f"{'='*70}")
    
    frontend = calcular_recargos_frontend(
        caso['hora_inicio'], 
        caso['hora_fin'], 
        caso['es_festivo']
    )
    backend = caso['backend']
    
    # Comparar todos los tipos de recargo
    tipos = ['HED', 'HEN', 'HEFD', 'HEFN', 'RN', 'RD']
    coinciden = True
    
    print(f"Backend:  ", end="")
    for tipo in tipos:
        if backend.get(tipo, 0) > 0:
            print(f"{tipo}={backend.get(tipo, 0):.0f}  ", end="")
    print()
    
    print(f"Frontend: ", end="")
    for tipo in tipos:
        if frontend.get(tipo, 0) > 0:
            print(f"{tipo}={frontend.get(tipo, 0):.0f}  ", end="")
    print()
    
    # Verificar diferencias
    diferencias = []
    for tipo in tipos:
        backend_val = backend.get(tipo, 0)
        frontend_val = frontend.get(tipo, 0)
        if backend_val != frontend_val:
            diferencias.append(f"{tipo}: Backend={backend_val} Frontend={frontend_val}")
            coinciden = False
    
    if coinciden:
        print("\n✅ CÁLCULOS COINCIDEN PERFECTAMENTE")
    else:
        print("\n❌ DIFERENCIAS ENCONTRADAS:")
        for diff in diferencias:
            print(f"   {diff}")
        todos_correctos = False

print("\n" + "="*70)
if todos_correctos:
    print("🎉 TODOS LOS CASOS PASARON - FRONTEND Y BACKEND CALCULAN IGUAL")
else:
    print("❌ HAY CASOS CON DIFERENCIAS - REVISAR")
print("="*70)
