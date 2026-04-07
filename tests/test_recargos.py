# test_recargos.py
# Copia de la lógica de cálculo usada en verificar_casos_v2.py
JORNADA_NORMAL = 10.33
INICIO_NOCTURNO = 19
FIN_NOCTURNO = 6

def es_nocturna(hora):
    h = hora % 24
    return h >= INICIO_NOCTURNO or h < FIN_NOCTURNO

def calcular(hora_inicio, hora_fin, jornada, es_festivo=False):
    hed = hen = hefd = hefn = rn = rd = rndf = 0.0
    hora_actual = hora_inicio
    horas_acumuladas = 0.0

    while hora_actual < hora_fin:
        siguiente = min(hora_actual + 0.5, hora_fin)
        fraccion = round(siguiente - hora_actual, 4)
        nocturna = es_nocturna(hora_actual)
        es_extra = horas_acumuladas >= jornada

        if es_festivo:
            if es_extra:
                if nocturna:
                    hefn += fraccion
                else:
                    hefd += fraccion
            else:
                rest = jornada - horas_acumuladas
                if fraccion <= rest:
                    if nocturna:
                        rndf += fraccion
                    else:
                        rd += fraccion
                else:
                    p_ord = round(rest, 4)
                    p_ext = round(fraccion - rest, 4)
                    if nocturna:
                        rndf += p_ord
                        hefn += p_ext
                    else:
                        rd += p_ord
                        hefd += p_ext
        else:
            if es_extra:
                if nocturna:
                    hen += fraccion
                else:
                    hed += fraccion
            else:
                rest = jornada - horas_acumuladas
                if fraccion <= rest:
                    if nocturna:
                        rn += fraccion
                    else:
                        pass  # diurna ordinaria
                else:
                    p_ord = round(rest, 4)
                    p_ext = round(fraccion - rest, 4)
                    if nocturna:
                        rn += p_ord
                        hen += p_ext
                    else:
                        hed += p_ext

        horas_acumuladas += fraccion
        hora_actual = siguiente

    r = lambda x: round(x * 100) / 100
    return {
        'rn': r(rn), 'hen': r(hen), 'hed': r(hed),
        'hefd': r(hefd), 'hefn': r(hefn),
        'rndf': r(rndf), 'rd': r(rd),
        'total': r(horas_acumuladas),
    }

def sumar_recargos(dicts):
    keys = ['rn','hen','hed','hefd','hefn','rndf','rd']
    s = {k: 0.0 for k in keys}
    for d in dicts:
        for k in keys:
            s[k] += d.get(k, 0)
    for k in keys:
        s[k] = round(s[k] * 100) / 100
    return s

if __name__ == '__main__':
    # Intervalos:
    # Día 27: 16 -> 24  (horas absolutas)
    # Día 28: 24 -> 47  (24 + 23 = 47)
    inicio = 16.0
    fin = 47.0

    print("\n=== MODO A: Turno COMBINADO (una sola jornada 10.33 sobre el total 16->47) ===")
    combined = calcular(inicio, fin, JORNADA_NORMAL, es_festivo=False)
    print("Combined (16->47) :", combined)

    print("\n=== MODO B: Por día separado (cada día jornada 10.33) ===")
    d1 = calcular(16.0, 24.0, JORNADA_NORMAL, es_festivo=False)
    d2 = calcular(24.0, 47.0, JORNADA_NORMAL, es_festivo=False)
    print("Dia 27 (16->24):", d1)
    print("Dia 28 (24->47):", d2)
    suma_b = sumar_recargos([d1, d2])
    print("Suma dias (B):", suma_b)

    print("\n=== MODO C: Por día con jornadas 7.33 (dia27) y 11.33 (dia28) ===")
    d1c = calcular(16.0, 24.0, 7.33, es_festivo=False)
    d2c = calcular(24.0, 47.0, 11.33, es_festivo=False)
    print("Dia 27 (16->24, J=7.33):", d1c)
    print("Dia 28 (24->47, J=11.33):", d2c)
    suma_c = sumar_recargos([d1c, d2c])
    print("Suma dias (C):", suma_c)

    print("\n=== COMPARACION ESPERADA (según Excel que mencionaste) ===")
    print("Esperado total -> RN: 10.33, HEN: 4.67, HED: 7.67") 