/**
 * Pruebas de los trece calculadores.
 *
 * Sin base de datos y sin Fastify: los calculadores son puros justamente para
 * que estos casos —denominador cero, turno que cruza medianoche, envío
 * anulado, mantenimiento tardío— se puedan escribir en tres líneas. Montarlos
 * en Postgres cuesta tanto que en la práctica se acaba probando solo el camino
 * feliz, que es el único que nunca falla.
 *
 * El caso que más se repite aquí es el mismo: **cero y "sin datos" no son lo
 * mismo.** Un 0 % de cumplimiento es un hallazgo; un `SIN_DATOS` es un problema
 * de captura. Si el código los confundiera, la auditoría vería incumplimientos
 * donde solo hay campos vacíos.
 */

import { describe, expect, it } from 'vitest'
import {
  calcularCMP,
  calcularCPF,
  calcularCPFSV,
  calcularCPLAN,
  calcularCPMVH,
  calcularCSV,
  calcularEJLC,
  calcularELVL,
  calcularGRV,
  calcularGVE,
  calcularIDP,
  calcularNCAC,
  calcularRSVI,
  calcularTSV,
  type DiaLaboralInsumo,
  type PoliticaJornada,
} from '../src/modules/pesv/indicadores/calculadores'
import { interpretarEficacia } from '../src/modules/pesv/indicadores/repositorio'
import {
  calcularTendencia,
  evaluarSemaforo,
  porcentaje,
  tasaPorMillon,
} from '../src/modules/pesv/indicadores/tipos'
import {
  construirPeriodo,
  diasEntre,
  mesesDelPeriodo,
  periodoAnterior,
  ultimoDiaDelMes,
} from '../src/modules/pesv/dominio/periodos'
import {
  horasEntre,
  kilometrosDeTramo,
  normalizarIdentificacion,
  normalizarPlaca,
  pareceNombreDePersona,
  RegistroCobertura,
} from '../src/modules/pesv/dominio/calidad'
import { PASOS_PESV, soportesObligatorios, TOTAL_PASOS } from '../src/modules/pesv/dominio/catalogo'
import {
  acredita,
  clasificarVigencia,
} from '../src/modules/pesv/pesv-documentos.service'
import { clasificarCobertura, huellaFilaFuec } from '../src/modules/pesv/pesv-contratos.service'
import { parsearFechaTxt, parsearTxt } from '../src/modules/pesv/pesv-fuec-import.service'

// ─────────────────────────────────────────────────────────────────────────
//  Aritmética base
// ─────────────────────────────────────────────────────────────────────────

describe('porcentaje y tasa: denominador cero', () => {
  it('devuelve null cuando el denominador es cero, no 0', () => {
    // Es la regla central del módulo. Un 0 significaría «se midió y salió cero».
    expect(porcentaje(0, 0)).toBeNull()
    expect(porcentaje(5, 0)).toBeNull()
    expect(tasaPorMillon(3, 0)).toBeNull()
  })

  it('devuelve null con denominador negativo o no finito', () => {
    expect(porcentaje(1, -2)).toBeNull()
    expect(porcentaje(1, Number.NaN)).toBeNull()
  })

  it('calcula y redondea a dos decimales', () => {
    expect(porcentaje(1, 3)).toBe(33.33)
    expect(tasaPorMillon(2, 500_000)).toBe(4)
  })
})

describe('semáforo', () => {
  const meta = { valor: 90, sentido: 'MAYOR_ES_MEJOR' as const, umbralAlerta: 10 }

  it('sin valor es SIN_DATOS', () => {
    expect(evaluarSemaforo(null, meta).status).toBe('SIN_DATOS')
  })

  it('sin meta aprobada NO declara cumplimiento aunque haya valor', () => {
    const r = evaluarSemaforo(95, null)
    expect(r.status).toBe('SIN_DATOS')
    expect(r.razon).toContain('meta')
  })

  it('cumple la meta → OK', () => {
    expect(evaluarSemaforo(95, meta).status).toBe('OK')
    expect(evaluarSemaforo(90, meta).status).toBe('OK')
  })

  it('dentro del umbral → ALERTA; fuera → CRITICO', () => {
    expect(evaluarSemaforo(85, meta).status).toBe('ALERTA')
    expect(evaluarSemaforo(70, meta).status).toBe('CRITICO')
  })

  it('sin umbral configurado no inventa zona ámbar', () => {
    const sinUmbral = { valor: 90, sentido: 'MAYOR_ES_MEJOR' as const, umbralAlerta: null }
    expect(evaluarSemaforo(89, sinUmbral).status).toBe('CRITICO')
  })

  it('respeta MENOR_ES_MEJOR', () => {
    const menor = { valor: 5, sentido: 'MENOR_ES_MEJOR' as const, umbralAlerta: 2 }
    expect(evaluarSemaforo(3, menor).status).toBe('OK')
    expect(evaluarSemaforo(6, menor).status).toBe('ALERTA')
    expect(evaluarSemaforo(20, menor).status).toBe('CRITICO')
  })
})

describe('tendencia', () => {
  it('sin comparación cuando falta alguno de los dos valores', () => {
    expect(calcularTendencia(10, null, 'MAYOR_ES_MEJOR').direccion).toBe('SIN_COMPARACION')
    expect(calcularTendencia(null, 10, 'MAYOR_ES_MEJOR').direccion).toBe('SIN_COMPARACION')
  })

  it('interpreta el signo según el sentido de la meta', () => {
    expect(calcularTendencia(80, 70, 'MAYOR_ES_MEJOR').favorable).toBe(true)
    expect(calcularTendencia(80, 70, 'MENOR_ES_MEJOR').favorable).toBe(false)
    expect(calcularTendencia(60, 70, 'MENOR_ES_MEJOR').favorable).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Períodos
// ─────────────────────────────────────────────────────────────────────────

describe('períodos', () => {
  it('el mes gana sobre el trimestre y el trimestre sobre el año', () => {
    // Si fuera al revés, un filtro de mes en la URL no haría nada y el usuario
    // vería el acumulado creyendo que ve el mes.
    const p = construirPeriodo(2026, 2, 3)
    expect(p.granularidad).toBe('MENSUAL')
    expect(p.desde).toBe('2026-03-01')
    expect(p.hasta).toBe('2026-03-31')
  })

  it('cierra febrero bisiesto correctamente', () => {
    expect(ultimoDiaDelMes(2024, 2)).toBe(29)
    expect(ultimoDiaDelMes(2026, 2)).toBe(28)
    expect(construirPeriodo(2024, null, 2).hasta).toBe('2024-02-29')
  })

  it('el trimestre cubre sus tres meses completos', () => {
    const p = construirPeriodo(2026, 4, null)
    expect(p.desde).toBe('2026-10-01')
    expect(p.hasta).toBe('2026-12-31')
  })

  it('el período anterior cruza el año hacia atrás', () => {
    expect(periodoAnterior(construirPeriodo(2026, null, 1)).etiqueta).toContain('2025')
    expect(periodoAnterior(construirPeriodo(2026, 1, null)).trimestre).toBe(4)
    expect(periodoAnterior(construirPeriodo(2026, null, null)).anio).toBe(2025)
  })

  it('enumera los meses del período', () => {
    expect(mesesDelPeriodo(construirPeriodo(2026, 1, null))).toEqual(['2026-01', '2026-02', '2026-03'])
  })

  it('diasEntre no se descuadra por horas', () => {
    expect(diasEntre('2026-03-01', '2026-03-31')).toBe(30)
    expect(diasEntre('2026-03-31', '2026-03-01')).toBe(-30)
    expect(diasEntre('2026-12-31', '2027-01-01')).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Calidad de datos
// ─────────────────────────────────────────────────────────────────────────

describe('normalización', () => {
  it('normaliza placas y rechaza lo que no puede serlo', () => {
    expect(normalizarPlaca('abc-123')).toBe('ABC123')
    expect(normalizarPlaca(' ABC 123 ')).toBe('ABC123')
    expect(normalizarPlaca('12345')).toBeNull() // sin letras
    expect(normalizarPlaca('ABCDEF')).toBeNull() // sin dígitos
    expect(normalizarPlaca('')).toBeNull()
    expect(normalizarPlaca(null)).toBeNull()
  })

  it('normaliza identificaciones y rechaza los EXT- del importador viejo', () => {
    expect(normalizarIdentificacion('12.345.678')).toBe('12345678')
    expect(normalizarIdentificacion('CC 1023456789')).toBe('1023456789')
    // Los `EXT-<timestamp>` son la huella de conductores creados desde celdas
    // mal parseadas. No son documentos.
    expect(normalizarIdentificacion('EXT-1724358901234')).toBeNull()
    expect(normalizarIdentificacion('123')).toBeNull()
  })

  it('reconoce lo que no puede ser un nombre', () => {
    expect(pareceNombreDePersona('Juan Pérez')).toBe(true)
    expect(pareceNombreDePersona('0')).toBe(false)
    expect(pareceNombreDePersona('##########')).toBe(false)
    expect(pareceNombreDePersona('N/A')).toBe(false)
    expect(pareceNombreDePersona('')).toBe(false)
  })
})

describe('kilómetros de tramo', () => {
  it('excluye el tramo cuando el final es menor que el inicial', () => {
    // No se da la vuelta a la resta: puede ser cambio de odómetro o un dígito
    // de más, y elegir uno sería inventar.
    expect(kilometrosDeTramo(500, 300)).toEqual({ km: null, motivo: 'KILOMETRAJE_INVALIDO' })
  })

  it('excluye el tramo sin kilometraje', () => {
    expect(kilometrosDeTramo(null, 300).motivo).toBe('KILOMETRAJE_AUSENTE')
    expect(kilometrosDeTramo(300, null).motivo).toBe('KILOMETRAJE_AUSENTE')
  })

  it('acepta km iguales como cero kilómetros válidos', () => {
    expect(kilometrosDeTramo(1000, 1000)).toEqual({ km: 0, motivo: null })
  })

  it('calcula la diferencia', () => {
    expect(kilometrosDeTramo(1000, 1240).km).toBe(240)
  })
})

describe('horas entre, cruzando medianoche', () => {
  it('un turno de 22:00 a 06:00 del día siguiente son 8 horas, no −16', () => {
    expect(horasEntre('22:00', '06:00', false, true).horas).toBe(8)
  })

  it('un turno normal se calcula directo', () => {
    expect(horasEntre('06:00', '14:30').horas).toBe(8.5)
  })

  it('sin las banderas, un cruce de medianoche es incoherente y se excluye', () => {
    expect(horasEntre('22:00', '06:00').motivo).toBe('HORARIO_INCOHERENTE')
  })

  it('un horario ilegible no se convierte en cero', () => {
    expect(horasEntre(null, '06:00').horas).toBeNull()
    expect(horasEntre('99:99', '06:00').horas).toBeNull()
  })
})

describe('registro de cobertura', () => {
  it('cuadra esperados, válidos y excluidos', () => {
    const c = new RegistroCobertura()
    c.esperadoYValido(3)
    c.esperadoPeroExcluido('SIN_VEHICULO', 'a')
    c.esperadoPeroExcluido('SIN_VEHICULO', 'b')
    c.esperadoPeroExcluido('ANULADO', 'c')
    const r = c.resultado()
    expect(r.esperados).toBe(6)
    expect(r.validos).toBe(3)
    expect(r.excluidos).toBe(3)
    expect(r.motivos[0]).toEqual({ motivo: 'SIN_VEHICULO', cantidad: 2, ejemplos: ['a', 'b'] })
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Catálogo
// ─────────────────────────────────────────────────────────────────────────

describe('catálogo de los 24 pasos', () => {
  it('tiene exactamente 24 pasos, numerados sin huecos', () => {
    expect(TOTAL_PASOS).toBe(24)
    expect(PASOS_PESV.map((p) => p.numero)).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
  })

  it('cada paso declara al menos un soporte obligatorio', () => {
    // Un paso sin soportes obligatorios llegaría a CUMPLE sin evidencia, que es
    // exactamente lo que el módulo viene a impedir.
    for (const paso of PASOS_PESV) {
      expect(soportesObligatorios(paso.numero).length).toBeGreaterThan(0)
    }
  })

  it('cubre las cuatro fases', () => {
    expect(new Set(PASOS_PESV.map((p) => p.fase))).toEqual(
      new Set(['PLANIFICACION', 'IMPLEMENTACION', 'SEGUIMIENTO', 'MEJORA']),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  1. TSV
// ─────────────────────────────────────────────────────────────────────────

describe('TSV — tasa de siniestralidad', () => {
  const siniestro = (id: string, severidad: any = 'LESION_LEVE') => ({
    id,
    severidad,
    costoDirecto: null,
    costoIndirecto: null,
  })

  it('sin kilómetros válidos devuelve SIN_DATOS, nunca cero', () => {
    const r = calcularTSV([siniestro('s1')], [{ id: 't1', vehiculoId: 'v', kmInicial: null, kmFinal: null }])
    expect(r.value).toBeNull()
    expect(r.razonSinDatos).toContain('kilómetros')
    // El numerador sí se informa: hay un siniestro, y ocultarlo sería peor.
    expect(r.numerator).toBe(1)
  })

  it('expone los recorridos sin kilometraje como incidencia accionable', () => {
    const r = calcularTSV(
      [siniestro('s1')],
      [
        { id: 't1', vehiculoId: 'v', kmInicial: 0, kmFinal: 100 },
        { id: 't2', vehiculoId: 'v', kmInicial: null, kmFinal: null },
      ],
    )
    expect(r.issues.find((i) => i.code === 'RECORRIDOS_SIN_KILOMETRAJE')?.count).toBe(1)
    expect(r.dataCoverage.excluidos).toBe(1)
  })

  it('calcula la tasa por millón de kilómetros', () => {
    const r = calcularTSV(
      [siniestro('s1'), siniestro('s2')],
      [{ id: 't1', vehiculoId: 'v', kmInicial: 0, kmFinal: 500_000 }],
    )
    expect(r.value).toBe(4)
    expect(r.denominator).toBe(500_000)
  })

  it('desglosa por severidad', () => {
    const r = calcularTSV(
      [siniestro('s1', 'FATALIDAD'), siniestro('s2', 'LESION_LEVE')],
      [{ id: 't1', vehiculoId: 'v', kmInicial: 0, kmFinal: 1_000_000 }],
    )
    expect(r.desglose?.find((d) => d.etiqueta === 'Fatalidad')?.valor).toBe(1)
  })

  it('excluye el tramo con km_final menor que km_inicial', () => {
    const r = calcularTSV(
      [siniestro('s1')],
      [
        { id: 't1', vehiculoId: 'v', kmInicial: 0, kmFinal: 1_000_000 },
        { id: 't2', vehiculoId: 'v', kmInicial: 900, kmFinal: 100 },
      ],
    )
    expect(r.denominator).toBe(1_000_000)
    expect(r.dataCoverage.motivos.some((m) => m.motivo === 'KILOMETRAJE_INVALIDO')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  2. CSV
// ─────────────────────────────────────────────────────────────────────────

describe('CSV — costos de siniestralidad', () => {
  it('cero siniestros SÍ es un cero legítimo', () => {
    // Es la única de las trece donde el cero informa: hubo operación y no hubo
    // eventos.
    const r = calcularCSV([])
    expect(r.value).toBe(0)
    expect(r.razonSinDatos).toBeNull()
  })

  it('siniestros sin costo capturado no suman cero: quedan SIN_DATOS', () => {
    const r = calcularCSV([{ id: 's1', severidad: 'LESION_LEVE', costoDirecto: null, costoIndirecto: null }])
    expect(r.value).toBeNull()
    expect(r.razonSinDatos).toContain('costos')
  })

  it('suma directos e indirectos y avisa de los que faltan', () => {
    const r = calcularCSV([
      { id: 's1', severidad: 'SOLO_DANOS', costoDirecto: 1_000_000, costoIndirecto: 250_000 },
      { id: 's2', severidad: 'SOLO_DANOS', costoDirecto: null, costoIndirecto: null },
    ])
    expect(r.value).toBe(1_250_000)
    expect(r.issues.find((i) => i.code === 'SINIESTROS_SIN_COSTO')?.count).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  3. RSVI y GRV
// ─────────────────────────────────────────────────────────────────────────

describe('RSVI y GRV — matriz de riesgos', () => {
  it('sin valoración inicial no hay línea base', () => {
    const r = calcularRSVI([{ id: 'r1', nivelInicial: null, nivelFinal: 'ALTO' }])
    expect(r.value).toBeNull()
    expect(r.razonSinDatos).toContain('valoración inicial')
  })

  it('cuenta riesgos con valoración final frente a inicial', () => {
    const r = calcularRSVI([
      { id: 'r1', nivelInicial: 'ALTO', nivelFinal: 'MEDIO' },
      { id: 'r2', nivelInicial: 'MEDIO', nivelFinal: null },
    ])
    expect(r.numerator).toBe(1)
    expect(r.denominator).toBe(2)
    expect(r.value).toBe(-1)
    expect(r.issues.find((i) => i.code === 'RIESGOS_SIN_VALORACION_FINAL')?.count).toBe(1)
  })

  it('GRV mide la variación de riesgos altos y críticos', () => {
    const r = calcularGRV([
      { id: 'r1', nivelInicial: 'CRITICO', nivelFinal: 'MEDIO' },
      { id: 'r2', nivelInicial: 'ALTO', nivelFinal: 'ALTO' },
      { id: 'r3', nivelInicial: 'BAJO', nivelFinal: 'BAJO' },
    ])
    expect(r.denominator).toBe(2) // altos iniciales
    expect(r.numerator).toBe(1) // altos finales
    expect(r.value).toBe(-1) // se redujo uno
  })

  it('sin ninguna valoración final, GRV no es calculable', () => {
    const r = calcularGRV([{ id: 'r1', nivelInicial: 'ALTO', nivelFinal: null }])
    expect(r.value).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  4. CMP
// ─────────────────────────────────────────────────────────────────────────

describe('CMP — cumplimiento de metas', () => {
  it('una meta sin evaluar sale del denominador', () => {
    // Contarla como no lograda castigaría al ciclo por no haberla cerrado.
    const r = calcularCMP([
      { id: 'm1', lograda: true },
      { id: 'm2', lograda: null },
    ])
    expect(r.numerator).toBe(1)
    expect(r.denominator).toBe(1)
    expect(r.value).toBe(100)
    expect(r.issues.find((i) => i.code === 'METAS_SIN_EVALUAR')?.count).toBe(1)
  })

  it('sin metas definidas es SIN_DATOS', () => {
    expect(calcularCMP([]).value).toBeNull()
  })

  it('metas definidas pero ninguna evaluada es SIN_DATOS, no 0 %', () => {
    const r = calcularCMP([{ id: 'm1', lograda: null }])
    expect(r.value).toBeNull()
  })

  it('una meta no lograda sí baja el porcentaje', () => {
    const r = calcularCMP([
      { id: 'm1', lograda: true },
      { id: 'm2', lograda: false },
    ])
    expect(r.value).toBe(50)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  5. CPLAN
// ─────────────────────────────────────────────────────────────────────────

describe('CPLAN — plan anual', () => {
  it('las canceladas salen del denominador; las vencidas no', () => {
    const r = calcularCPLAN([
      { id: 'a1', estado: 'COMPLETADA' },
      { id: 'a2', estado: 'VENCIDA' },
      { id: 'a3', estado: 'CANCELADA' },
    ])
    expect(r.denominator).toBe(2)
    expect(r.numerator).toBe(1)
    expect(r.value).toBe(50)
    expect(r.issues.find((i) => i.code === 'ACTIVIDADES_VENCIDAS')?.count).toBe(1)
  })

  it('sin actividades programadas es SIN_DATOS', () => {
    expect(calcularCPLAN([]).value).toBeNull()
    expect(calcularCPLAN([{ id: 'a1', estado: 'CANCELADA' }]).value).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  6. EJLC
// ─────────────────────────────────────────────────────────────────────────

describe('EJLC — exceso de jornada', () => {
  const politica: PoliticaJornada[] = [
    { horasMaximasConduccion: 8, vigenteDesde: '2026-01-01', vigenteHasta: null },
  ]

  const dia = (id: string, fecha: string, segmentos: DiaLaboralInsumo['segmentos']): DiaLaboralInsumo => ({
    id,
    conductorId: 'c1',
    fecha,
    tipo: 'CONDUCCION',
    segmentos,
  })

  const seg = (horas: number | null, inicio?: string, fin?: string, finSig = false) => ({
    id: `s-${Math.random()}`,
    horasConducidas: horas,
    horaInicio: inicio ?? null,
    horaFin: fin ?? null,
    inicioDiaSiguiente: false,
    finDiaSiguiente: finSig,
  })

  it('detecta el día por encima del límite vigente', () => {
    const r = calcularEJLC(
      [dia('d1', '2026-03-10', [seg(9)]), dia('d2', '2026-03-11', [seg(7)])],
      politica,
    )
    expect(r.numerator).toBe(1)
    expect(r.denominator).toBe(2)
    expect(r.value).toBe(50)
  })

  it('suma los segmentos del día antes de comparar', () => {
    const r = calcularEJLC([dia('d1', '2026-03-10', [seg(5), seg(4)])], politica)
    expect(r.numerator).toBe(1)
  })

  it('un turno que cruza medianoche cuenta 8 horas, no −16', () => {
    const r = calcularEJLC([dia('d1', '2026-03-10', [seg(null, '22:00', '06:00', true)])], politica)
    expect(r.denominator).toBe(1)
    expect(r.numerator).toBe(0) // 8 horas, justo en el límite: no lo supera
  })

  it('un día sin política vigente se excluye y se cuenta', () => {
    // El límite se consulta por fecha. Un día anterior a la vigencia no se
    // evalúa con una regla que no existía entonces.
    const r = calcularEJLC([dia('d1', '2025-06-01', [seg(12)])], politica)
    expect(r.value).toBeNull()
    expect(r.issues.find((i) => i.code === 'SIN_POLITICA_JORNADA')?.count).toBe(1)
  })

  it('un día sin segmentos no entra en el denominador', () => {
    // Un DESCANSO no puede tener exceso de jornada.
    const r = calcularEJLC([dia('d1', '2026-03-10', []), dia('d2', '2026-03-11', [seg(9)])], politica)
    expect(r.denominator).toBe(1)
    expect(r.value).toBe(100)
  })

  it('un horario incoherente excluye el día en vez de contarlo como cero horas', () => {
    const r = calcularEJLC([dia('d1', '2026-03-10', [seg(null, '22:00', '06:00', false)])], politica)
    expect(r.value).toBeNull()
    expect(r.issues.find((i) => i.code === 'HORARIOS_INCOHERENTES')?.count).toBe(1)
  })

  it('usa la política vigente en la fecha del día, no la última', () => {
    const dos: PoliticaJornada[] = [
      { horasMaximasConduccion: 10, vigenteDesde: '2026-06-01', vigenteHasta: null },
      { horasMaximasConduccion: 8, vigenteDesde: '2026-01-01', vigenteHasta: '2026-05-31' },
    ]
    // 9 horas en marzo excede el límite de 8 que regía entonces...
    expect(calcularEJLC([dia('d1', '2026-03-10', [seg(9)])], dos).numerator).toBe(1)
    // ...y no excede el de 10 que rige desde junio.
    expect(calcularEJLC([dia('d2', '2026-07-10', [seg(9)])], dos).numerator).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  7. GVE
// ─────────────────────────────────────────────────────────────────────────

describe('GVE — cobertura del programa de velocidad', () => {
  it('el denominador son los vehículos usados, no la flota entera', () => {
    // Un vehículo parado todo el trimestre no necesita cobertura, y contarlo
    // bajaría el indicador sin que nadie pudiera hacer nada.
    const r = calcularGVE(['v1', 'v2'], ['v1', 'v3'])
    expect(r.denominator).toBe(2)
    expect(r.numerator).toBe(1)
    expect(r.value).toBe(50)
  })

  it('sin vehículos en operación es SIN_DATOS', () => {
    expect(calcularGVE([], ['v1']).value).toBeNull()
  })

  it('lista los descubiertos como incidencia', () => {
    const r = calcularGVE(['v1', 'v2', 'v3'], ['v1'])
    expect(r.issues.find((i) => i.code === 'VEHICULOS_SIN_PROGRAMA_VELOCIDAD')?.count).toBe(2)
  })

  it('deduplica vehículos repetidos en la operación', () => {
    const r = calcularGVE(['v1', 'v1', 'v2'], ['v1', 'v2'])
    expect(r.denominator).toBe(2)
    expect(r.value).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  8. ELVL
// ─────────────────────────────────────────────────────────────────────────

describe('ELVL — exceso de límites de velocidad', () => {
  const desplazamiento = (id: string, vehiculoId: string, fecha: string) => ({ id, vehiculoId, fecha })

  it('con solo la serie histórica mensual devuelve SIN_DATOS', () => {
    // Un total mensual no identifica desplazamientos. Repartirlo entre los
    // viajes sería inventar los eventos.
    const r = calcularELVL([], [desplazamiento('s1', 'v1', '2026-03-10')], true)
    expect(r.value).toBeNull()
    expect(r.razonSinDatos).toContain('totales mensuales')
  })

  it('sin eventos y sin histórico, cero es legítimo pero se marca la procedencia', () => {
    const r = calcularELVL([], [desplazamiento('s1', 'v1', '2026-03-10')], false)
    expect(r.value).toBe(0)
    expect(r.issues.find((i) => i.code === 'SIN_EVENTOS_DE_VELOCIDAD')).toBeDefined()
  })

  it('atribuye el evento a su servicio', () => {
    const r = calcularELVL(
      [{ id: 'e1', servicioId: 's1', vehiculoId: 'v1', businessDate: '2026-03-10' }],
      [desplazamiento('s1', 'v1', '2026-03-10'), desplazamiento('s2', 'v2', '2026-03-10')],
      false,
    )
    expect(r.numerator).toBe(1)
    expect(r.denominator).toBe(2)
    expect(r.value).toBe(50)
  })

  it('sin servicio, atribuye por vehículo y fecha', () => {
    const r = calcularELVL(
      [{ id: 'e1', servicioId: null, vehiculoId: 'v1', businessDate: '2026-03-10' }],
      [desplazamiento('s1', 'v1', '2026-03-10')],
      false,
    )
    expect(r.numerator).toBe(1)
  })

  it('varios eventos del mismo desplazamiento cuentan una vez', () => {
    const r = calcularELVL(
      [
        { id: 'e1', servicioId: 's1', vehiculoId: 'v1', businessDate: '2026-03-10' },
        { id: 'e2', servicioId: 's1', vehiculoId: 'v1', businessDate: '2026-03-10' },
      ],
      [desplazamiento('s1', 'v1', '2026-03-10')],
      false,
    )
    expect(r.numerator).toBe(1)
  })

  it('un evento que no casa con ningún desplazamiento se informa y no suma', () => {
    const r = calcularELVL(
      [{ id: 'e1', servicioId: null, vehiculoId: 'v9', businessDate: '2026-03-10' }],
      [desplazamiento('s1', 'v1', '2026-03-10')],
      false,
    )
    expect(r.numerator).toBe(0)
    expect(r.issues.find((i) => i.code === 'EVENTOS_VELOCIDAD_SIN_DESPLAZAMIENTO')?.count).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  9. IDP
// ─────────────────────────────────────────────────────────────────────────

describe('IDP — inspección preoperacional', () => {
  const envio = (id: string, vehiculoId: string | null, fecha: string, extra: Partial<any> = {}) => ({
    id,
    vehiculoId,
    businessDate: fecha,
    status: 'SUBMITTED' as const,
    sustituido: false,
    asignacionPesv: true,
    ...extra,
  })

  it('sin asignación etiquetada como PESV devuelve SIN_DATOS con acción', () => {
    const r = calcularIDP([], [{ vehiculoId: 'v1', fecha: '2026-03-10' }], false)
    expect(r.value).toBeNull()
    expect(r.issues[0].actionUrl).toContain('asignaciones')
  })

  it('un vehículo cuenta una sola vez por día', () => {
    // Sin deduplicar, el vehículo más usado hunde el porcentaje de la flota.
    const r = calcularIDP(
      [envio('e1', 'v1', '2026-03-10'), envio('e2', 'v1', '2026-03-10')],
      [
        { vehiculoId: 'v1', fecha: '2026-03-10' },
        { vehiculoId: 'v1', fecha: '2026-03-10' },
      ],
      true,
    )
    expect(r.numerator).toBe(1)
    expect(r.denominator).toBe(1)
    expect(r.value).toBe(100)
  })

  it('un borrador no cuenta', () => {
    const r = calcularIDP(
      [envio('e1', 'v1', '2026-03-10', { status: 'DRAFT' })],
      [{ vehiculoId: 'v1', fecha: '2026-03-10' }],
      true,
    )
    expect(r.value).toBe(0)
    expect(r.dataCoverage.motivos.some((m) => m.motivo === 'BORRADOR')).toBe(true)
  })

  it('un envío anulado no cuenta y su reemplazo válido ocupa su lugar', () => {
    const r = calcularIDP(
      [
        envio('e1', 'v1', '2026-03-10', { status: 'VOIDED' }),
        envio('e2', 'v1', '2026-03-10'),
      ],
      [{ vehiculoId: 'v1', fecha: '2026-03-10' }],
      true,
    )
    expect(r.value).toBe(100)
    expect(r.dataCoverage.motivos.some((m) => m.motivo === 'ANULADO')).toBe(true)
  })

  it('un envío sustituido no cuenta', () => {
    const r = calcularIDP(
      [envio('e1', 'v1', '2026-03-10', { sustituido: true })],
      [{ vehiculoId: 'v1', fecha: '2026-03-10' }],
      true,
    )
    expect(r.value).toBe(0)
    expect(r.dataCoverage.motivos.some((m) => m.motivo === 'SUSTITUIDO')).toBe(true)
  })

  it('un envío de otra asignación no acredita la inspección', () => {
    // Si contara cualquier formulario, una encuesta de clima acreditaría la
    // inspección del vehículo.
    const r = calcularIDP(
      [envio('e1', 'v1', '2026-03-10', { asignacionPesv: false })],
      [{ vehiculoId: 'v1', fecha: '2026-03-10' }],
      true,
    )
    expect(r.value).toBe(0)
    expect(r.dataCoverage.motivos.some((m) => m.motivo === 'SIN_ASIGNACION_PESV')).toBe(true)
  })

  it('sin operación registrada es SIN_DATOS', () => {
    expect(calcularIDP([envio('e1', 'v1', '2026-03-10')], [], true).value).toBeNull()
  })

  it('avisa de inspecciones sin día trabajado', () => {
    const r = calcularIDP(
      [envio('e1', 'v9', '2026-03-10')],
      [{ vehiculoId: 'v1', fecha: '2026-03-10' }],
      true,
    )
    expect(r.issues.find((i) => i.code === 'PREOPERACIONAL_SIN_DIA_TRABAJADO')?.count).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  10. CPMVH
// ─────────────────────────────────────────────────────────────────────────

describe('CPMVH — plan de mantenimiento', () => {
  const evento = (id: string, extra: Partial<any> = {}) => ({
    id,
    tipo: 'PREVENTIVO' as const,
    estado: 'EJECUTADO' as const,
    fechaProgramada: '2026-03-10',
    fechaEjecucion: '2026-03-10',
    ...extra,
  })

  it('ejecutar el mismo día es oportuno', () => {
    expect(calcularCPMVH([evento('m1')]).value).toBe(100)
  })

  it('ejecutar antes de la fecha también es oportuno', () => {
    expect(calcularCPMVH([evento('m1', { fechaEjecucion: '2026-03-05' })]).value).toBe(100)
  })

  it('ejecutar después del vencimiento NO cuenta como oportuno', () => {
    // Si contara, el indicador diría 100 % en una flota que hace todos sus
    // mantenimientos con dos meses de retraso.
    const r = calcularCPMVH([evento('m1', { fechaEjecucion: '2026-04-20' })])
    expect(r.value).toBe(0)
    expect(r.issues.find((i) => i.code === 'MANTENIMIENTOS_TARDIOS')?.count).toBe(1)
  })

  it('sin ejecutar cuenta en el denominador y se avisa', () => {
    const r = calcularCPMVH([evento('m1', { estado: 'PROGRAMADO', fechaEjecucion: null })])
    expect(r.denominator).toBe(1)
    expect(r.numerator).toBe(0)
    expect(r.issues.find((i) => i.code === 'MANTENIMIENTOS_SIN_EJECUTAR')?.count).toBe(1)
  })

  it('los correctivos y los cancelados salen del cálculo', () => {
    const r = calcularCPMVH([
      evento('m1'),
      evento('m2', { tipo: 'CORRECTIVO' }),
      evento('m3', { estado: 'CANCELADO' }),
    ])
    expect(r.denominator).toBe(1)
  })

  it('sin fecha programada no se puede juzgar la oportunidad', () => {
    const r = calcularCPMVH([evento('m1', { fechaProgramada: null })])
    expect(r.value).toBeNull()
  })

  it('desglosa oportunos, tardíos y sin ejecutar', () => {
    const r = calcularCPMVH([
      evento('m1'),
      evento('m2', { fechaEjecucion: '2026-04-01' }),
      evento('m3', { estado: 'PROGRAMADO', fechaEjecucion: null }),
    ])
    expect(r.desglose).toEqual([
      { etiqueta: 'Oportunos', valor: 1, unidad: 'COUNT' },
      { etiqueta: 'Tardíos', valor: 1, unidad: 'COUNT' },
      { etiqueta: 'Sin ejecutar', valor: 1, unidad: 'COUNT' },
    ])
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  11. CPFSV y 12. CPF
// ─────────────────────────────────────────────────────────────────────────

describe('CPFSV y CPF — formación', () => {
  it('CPFSV mide ejecutadas sobre planificadas', () => {
    const r = calcularCPFSV([
      { id: 'f1', ejecutado: true, fechaPlanificada: '2026-03-01', asistentes: [] },
      { id: 'f2', ejecutado: false, fechaPlanificada: '2026-03-15', asistentes: [] },
    ])
    expect(r.value).toBe(50)
    expect(r.issues.find((i) => i.code === 'CAPACITACIONES_PENDIENTES')?.count).toBe(1)
  })

  it('una formación sin fecha planificada no entra en el denominador', () => {
    const r = calcularCPFSV([{ id: 'f1', ejecutado: true, fechaPlanificada: null, asistentes: [] }])
    expect(r.value).toBeNull()
  })

  it('CPF cuenta personas distintas, no asistencias', () => {
    const r = calcularCPF(
      [
        { id: 'f1', ejecutado: true, fechaPlanificada: '2026-03-01', asistentes: ['1', '2'] },
        { id: 'f2', ejecutado: true, fechaPlanificada: '2026-03-15', asistentes: ['2', '3'] },
      ],
      10,
    )
    expect(r.numerator).toBe(3)
    expect(r.value).toBe(30)
  })

  it('CPF sin población objetivo congelada es SIN_DATOS', () => {
    // Recalcularla en vivo haría que un alta de diciembre bajara la cobertura
    // de marzo.
    const r = calcularCPF([{ id: 'f1', ejecutado: true, fechaPlanificada: '2026-03-01', asistentes: ['1'] }], null)
    expect(r.value).toBeNull()
    expect(r.numerator).toBe(1)
    expect(r.issues[0].code).toBe('SIN_POBLACION_OBJETIVO')
  })

  it('CPF ignora las formaciones no ejecutadas', () => {
    const r = calcularCPF(
      [{ id: 'f1', ejecutado: false, fechaPlanificada: '2026-03-01', asistentes: ['1', '2'] }],
      10,
    )
    expect(r.numerator).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  13. NCAC
// ─────────────────────────────────────────────────────────────────────────

describe('NCAC — no conformidades', () => {
  it('solo cuenta los hallazgos de origen PESV', () => {
    // Contar todas las acciones de la empresa mediría la gestión de calidad
    // entera y no la del PESV.
    const r = calcularNCAC([
      { id: 'a1', origenPesv: true, cerrada: true, eficaz: true },
      { id: 'a2', origenPesv: false, cerrada: false, eficaz: null },
    ])
    expect(r.denominator).toBe(1)
    expect(r.value).toBe(100)
  })

  it('cerrar sin eficacia evaluada no cuenta como gestionado', () => {
    const r = calcularNCAC([{ id: 'a1', origenPesv: true, cerrada: true, eficaz: null }])
    expect(r.value).toBe(0)
    expect(r.issues.find((i) => i.code === 'CIERRE_SIN_EFICACIA')?.count).toBe(1)
  })

  it('sin hallazgos PESV es SIN_DATOS, no 100 %', () => {
    const r = calcularNCAC([{ id: 'a1', origenPesv: false, cerrada: true, eficaz: true }])
    expect(r.value).toBeNull()
  })

  it('los abiertos se informan como incidencia', () => {
    const r = calcularNCAC([{ id: 'a1', origenPesv: true, cerrada: false, eficaz: null }])
    expect(r.issues.find((i) => i.code === 'HALLAZGOS_ABIERTOS')?.count).toBe(1)
  })
})

describe('interpretación de la eficacia (texto libre histórico)', () => {
  it('«NO EFICAZ» no se confunde con «EFICAZ»', () => {
    // Un `includes('EFICAZ')` daría el resultado contrario.
    expect(interpretarEficacia('EFICAZ')).toBe(true)
    expect(interpretarEficacia('NO EFICAZ')).toBe(false)
  })

  it('lo desconocido es «sin evaluar», no «ineficaz»', () => {
    expect(interpretarEficacia('pendiente de revisar')).toBeNull()
    expect(interpretarEficacia('')).toBeNull()
    expect(interpretarEficacia(null)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Estados documentales
// ─────────────────────────────────────────────────────────────────────────

describe('vigencia documental', () => {
  it('clasifica los cuatro estados con la ventana por defecto de 30 días', () => {
    expect(clasificarVigencia(null, '2026-03-10').estado).toBe('SIN_FECHA')
    expect(clasificarVigencia('2026-03-09', '2026-03-10').estado).toBe('VENCIDO')
    expect(clasificarVigencia('2026-04-05', '2026-03-10').estado).toBe('POR_VENCER')
    expect(clasificarVigencia('2026-12-31', '2026-03-10').estado).toBe('VIGENTE')
  })

  it('el borde del umbral: el día 30 todavía es POR_VENCER; el 31 ya es VIGENTE', () => {
    expect(clasificarVigencia('2026-04-09', '2026-03-10').estado).toBe('POR_VENCER') // 30 días
    expect(clasificarVigencia('2026-04-10', '2026-03-10').estado).toBe('VIGENTE') // 31 días
  })

  it('vencer hoy todavía es POR_VENCER, no VENCIDO', () => {
    expect(clasificarVigencia('2026-03-10', '2026-03-10').estado).toBe('POR_VENCER')
  })

  it('la ventana es configurable por tipo', () => {
    expect(clasificarVigencia('2026-03-20', '2026-03-10', 5).estado).toBe('VIGENTE')
    expect(clasificarVigencia('2026-03-20', '2026-03-10', 15).estado).toBe('POR_VENCER')
  })

  it('acreditar exige aprobación Y vigencia, no una de las dos', () => {
    expect(acredita('APROBADO', 'VIGENTE')).toBe(true)
    expect(acredita('APROBADO', 'POR_VENCER')).toBe(true)
    // Aprobado hace un año y vencido ayer NO acredita.
    expect(acredita('APROBADO', 'VENCIDO')).toBe(false)
    expect(acredita('PENDIENTE', 'VIGENTE')).toBe(false)
    expect(acredita('RECHAZADO', 'VIGENTE')).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Cobertura contractual
// ─────────────────────────────────────────────────────────────────────────

describe('cobertura de un servicio', () => {
  const fecha = (s: string) => new Date(`${s}T00:00:00Z`)
  const base = {
    vehiculo_id: 'v1',
    conductor_id: 'c1',
    contrato_id: 'k1',
    contrato: { fecha_inicio: fecha('2026-01-01'), fecha_fin: fecha('2026-12-31'), estado: 'VIGENTE' },
    fuec: {
      estado: 'VIGENTE',
      vigencia_desde: fecha('2026-01-01'),
      vigencia_hasta: fecha('2026-06-30'),
      vehiculo_id: 'v1',
      contrato_id: 'k1',
      conductores: [{ conductor_id: 'c1' }],
    },
  }

  it('todo en regla → CUBIERTO', () => {
    expect(clasificarCobertura(base, '2026-03-10', [])).toBe('CUBIERTO')
  })

  it('sin contrato es lo primero que se informa', () => {
    expect(clasificarCobertura({ ...base, contrato: null }, '2026-03-10', [])).toBe('SIN_CONTRATO')
  })

  it('sin FUEC', () => {
    expect(clasificarCobertura({ ...base, fuec: null }, '2026-03-10', [])).toBe('SIN_FUEC')
  })

  it('FUEC anulado', () => {
    const s = { ...base, fuec: { ...base.fuec, estado: 'ANULADO' } }
    expect(clasificarCobertura(s, '2026-03-10', [])).toBe('FUEC_ANULADO')
  })

  it('servicio fuera de la vigencia del FUEC', () => {
    expect(clasificarCobertura(base, '2026-08-10', [])).toBe('VENCIDO')
  })

  it('un FUEC de otro contrato no cubre este servicio', () => {
    const s = { ...base, fuec: { ...base.fuec, contrato_id: 'otro' } }
    expect(clasificarCobertura(s, '2026-03-10', [])).toBe('SIN_FUEC')
  })

  it('vehículo distinto al del extracto', () => {
    const s = { ...base, vehiculo_id: 'v9' }
    expect(clasificarCobertura(s, '2026-03-10', [])).toBe('VEHICULO_NO_COINCIDE')
  })

  it('conductor que no figura en el extracto', () => {
    const s = { ...base, conductor_id: 'c9' }
    expect(clasificarCobertura(s, '2026-03-10', [])).toBe('CONDUCTOR_NO_COINCIDE')
  })

  it('con el FUEC sin conductores conciliados no afirma que no coincide', () => {
    // Afirmarlo sobre datos sin conciliar produciría cientos de alertas falsas
    // el primer día de la importación.
    const s = { ...base, conductor_id: 'c9', fuec: { ...base.fuec, conductores: [] } }
    expect(clasificarCobertura(s, '2026-03-10', [])).toBe('CUBIERTO')
  })

  it('documentos habilitantes vencidos', () => {
    expect(clasificarCobertura(base, '2026-03-10', ['SOAT vencido'])).toBe('DOCUMENTOS_NO_VIGENTES')
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Importación del TXT
// ─────────────────────────────────────────────────────────────────────────

describe('importación de extractos', () => {
  it('la huella es estable frente a espacios y mayúsculas', () => {
    // Es lo que hace idempotente la reimportación.
    const a = huellaFilaFuec({
      consecutivo: '0012',
      contratante: 'Empresa  X  S.A.S',
      placa: 'abc-123',
      fechaInicial: '01/03/2026',
      fechaFinal: '31/03/2026',
    })
    const b = huellaFilaFuec({
      consecutivo: '12',
      contratante: 'EMPRESA X S.A.S',
      placa: 'ABC123',
      fechaInicial: '01/03/2026',
      fechaFinal: '31/03/2026',
    })
    expect(a).toBe(b)
  })

  it('la huella cambia si cambia la vigencia', () => {
    const a = huellaFilaFuec({ consecutivo: '1', contratante: 'X', placa: 'ABC123', fechaInicial: '01/03/2026', fechaFinal: '31/03/2026' })
    const b = huellaFilaFuec({ consecutivo: '1', contratante: 'X', placa: 'ABC123', fechaInicial: '01/03/2026', fechaFinal: '30/04/2026' })
    expect(a).not.toBe(b)
  })

  it('parsea las fechas del archivo y rechaza las imposibles', () => {
    expect(parsearFechaTxt('01/03/2026')).toBe('2026-03-01')
    expect(parsearFechaTxt('1/3/26')).toBe('2026-03-01')
    expect(parsearFechaTxt('2026-03-01')).toBe('2026-03-01')
    // 31 de febrero no existe: aceptarla produciría un Date que salta al 3 de
    // marzo sin avisar.
    expect(parsearFechaTxt('31/02/2026')).toBeNull()
    expect(parsearFechaTxt('')).toBeNull()
    expect(parsearFechaTxt('sin fecha')).toBeNull()
  })

  it('parsea el TSV y descarta las filas de relleno', () => {
    const contenido = [
      '0001\tEMPRESA X\tBOGOTA - TUNJA\t01/03/2026\t31/03/2026\tABC123\t101\tTO-999\tJUAN PEREZ\t01/01/2030\t##########\t\t\t',
      '#¡REF!\tbasura',
      '',
      '0002\tEMPRESA Y\tCALI - PASTO\t01/04/2026\t30/04/2026\tXYZ789\t102\tTO-888\tANA GOMEZ\t01/01/2031\t\t\t\t',
    ].join('\n')

    const filas = parsearTxt(contenido)
    expect(filas).toHaveLength(2)
    expect(filas[0].consecutivo).toBe('0001')
    expect(filas[0].placa).toBe('ABC123')
    // El relleno `##########` no se convierte en un conductor llamado así.
    expect(filas[0].conductores).toHaveLength(1)
    expect(filas[0].conductores[0].nombre).toBe('JUAN PEREZ')
    expect(filas[0].linea).toBe(1)
    expect(filas[1].linea).toBe(4)
  })

  it('reconstruye la fila cuando el contratante trae un tabulador dentro', () => {
    const contenido =
      '0003\tEMPRESA\tCON TAB\tMEDELLIN - PEREIRA\t01/05/2026\t31/05/2026\tQWE456\t103\tTO-777\tLUIS DIAZ\t01/01/2032\t\t\t\t'
    const filas = parsearTxt(contenido)
    expect(filas).toHaveLength(1)
    expect(filas[0].contratante).toBe('EMPRESA CON TAB')
    expect(filas[0].placa).toBe('QWE456')
  })
})
