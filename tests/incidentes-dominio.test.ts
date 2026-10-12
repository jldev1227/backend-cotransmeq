/**
 * Reglas puras del módulo de incidentes: transiciones de estado, plazo de 15
 * días de la Res. 1401, cuándo toca el recordatorio, coherencia del reporte,
 * qué falta para cerrar y la serie de indicadores. Sin base de datos.
 */
import { describe, expect, it } from 'vitest'
import {
  areasAviso,
  codigoIncidente,
  consecutivoDeTexto,
  diasSinAccidentes,
  erroresDeGravedad,
  faltantesParaCerrar,
  fechaLimiteInvestigacion,
  mesInicioVentana,
  plazoInvestigacion,
  requiereRecordatorio,
  serieMensual,
  transicion,
  type DatosInvestigacion,
} from '../src/modules/incidentes/incidentes.dominio'

const HOY = '2026-10-10'

describe('transiciones de estado', () => {
  it('REPORTADO → EN_INVESTIGACION → CERRADO, y CERRADO → EN_INVESTIGACION al reabrir', () => {
    expect(transicion('REPORTADO', 'iniciar_investigacion')).toMatchObject({ ok: true, desde: 'REPORTADO', hacia: 'EN_INVESTIGACION' })
    expect(transicion('EN_INVESTIGACION', 'cerrar')).toMatchObject({ ok: true, desde: 'EN_INVESTIGACION', hacia: 'CERRADO' })
    expect(transicion('CERRADO', 'reabrir')).toMatchObject({ ok: true, desde: 'CERRADO', hacia: 'EN_INVESTIGACION' })
  })

  it('no se cierra un reporte sin investigar', () => {
    const t = transicion('REPORTADO', 'cerrar')
    expect(t.ok).toBe(false)
    expect(t.motivo).toMatch(/iniciar la investigación/)
  })

  it('las acciones fuera de orden se rechazan con su motivo', () => {
    expect(transicion('EN_INVESTIGACION', 'iniciar_investigacion')).toMatchObject({ ok: false, motivo: 'La investigación ya se había iniciado' })
    expect(transicion('CERRADO', 'cerrar')).toMatchObject({ ok: false, motivo: 'El incidente ya está cerrado' })
    expect(transicion('REPORTADO', 'reabrir').ok).toBe(false)
    expect(transicion('EN_INVESTIGACION', 'reabrir').ok).toBe(false)
  })
})

describe('plazo de investigación (15 días, Res. 1401)', () => {
  it('el límite es el evento más 15 días calendario, cruzando meses', () => {
    expect(fechaLimiteInvestigacion('2026-09-25')).toBe('2026-10-10')
    expect(fechaLimiteInvestigacion('2026-12-20')).toBe('2027-01-04')
  })

  it('cuenta los días restantes y marca vencido al pasar el límite', () => {
    expect(plazoInvestigacion({ estado: 'REPORTADO', fecha: '2026-10-01' }, HOY)).toEqual({ limite: '2026-10-16', dias_restantes: 6, vencido: false })
    expect(plazoInvestigacion({ estado: 'EN_INVESTIGACION', fecha: '2026-09-25' }, HOY)).toMatchObject({ dias_restantes: 0, vencido: false })
    expect(plazoInvestigacion({ estado: 'EN_INVESTIGACION', fecha: '2026-09-20' }, HOY)).toMatchObject({ dias_restantes: -5, vencido: true })
  })

  it('un incidente cerrado no tiene plazo corriendo', () => {
    expect(plazoInvestigacion({ estado: 'CERRADO', fecha: '2026-01-01' }, HOY)).toMatchObject({ dias_restantes: null, vencido: false })
  })
})

describe('recordatorio', () => {
  it('sale el día 15 (último día del plazo) y después, mientras no se cierre', () => {
    expect(requiereRecordatorio({ estado: 'REPORTADO', fecha: '2026-09-26' }, HOY)).toBe(false) // 14 días
    expect(requiereRecordatorio({ estado: 'REPORTADO', fecha: '2026-09-25' }, HOY)).toBe(true) // 15 días
    expect(requiereRecordatorio({ estado: 'EN_INVESTIGACION', fecha: '2026-08-01' }, HOY)).toBe(true)
  })
  it('no sale para un incidente cerrado, aunque se haya cerrado tarde', () => {
    expect(requiereRecordatorio({ estado: 'CERRADO', fecha: '2026-08-01' }, HOY)).toBe(false)
  })
})

describe('coherencia del reporte', () => {
  const base = { tipo: 'ACCIDENTE_TRANSITO' as const, severidad: 'SOLO_DANOS' as const, heridos: 0, fallecidos: 0, fecha: HOY }

  it('un accidente con solo daños y sin víctimas es válido', () => {
    expect(erroresDeGravedad(base, HOY)).toEqual([])
  })
  it('un accidente necesita gravedad', () => {
    expect(erroresDeGravedad({ ...base, severidad: null }, HOY)).toContain('Indica la gravedad del accidente')
  })
  it('un casi-accidente no lleva gravedad ni lesionados', () => {
    expect(erroresDeGravedad({ ...base, tipo: 'CASI_ACCIDENTE', severidad: null }, HOY)).toEqual([])
    expect(erroresDeGravedad({ ...base, tipo: 'CASI_ACCIDENTE' }, HOY).length).toBeGreaterThan(0)
    expect(erroresDeGravedad({ ...base, tipo: 'CASI_ACCIDENTE', severidad: null, heridos: 1 }, HOY).length).toBeGreaterThan(0)
  })
  it('un incidente con lesionados es en realidad un accidente', () => {
    expect(erroresDeGravedad({ ...base, tipo: 'INCIDENTE', severidad: 'LESION_LEVE', heridos: 1 }, HOY)).toContain(
      'Si hubo lesionados o fallecidos es un accidente, no un incidente',
    )
    expect(erroresDeGravedad({ ...base, tipo: 'INCIDENTE', severidad: null }, HOY)).toEqual([])
  })
  it('la gravedad y el número de víctimas tienen que cuadrar', () => {
    expect(erroresDeGravedad({ ...base, severidad: 'LESION_GRAVE', heridos: 0 }, HOY)).toContain('La gravedad dice que hubo lesionados: indica cuántos')
    expect(erroresDeGravedad({ ...base, severidad: 'FATALIDAD', fallecidos: 0 }, HOY)).toContain('La gravedad dice fatalidad: indica cuántos fallecidos')
    expect(erroresDeGravedad({ ...base, heridos: 2 }, HOY)).toContain('Hay lesionados o fallecidos: la gravedad no puede ser «solo daños»')
  })
  it('la fecha del evento no puede ser futura', () => {
    expect(erroresDeGravedad({ ...base, fecha: '2026-10-11' }, HOY)).toContain('La fecha del evento no puede ser futura')
  })
})

describe('a quién se avisa', () => {
  it('HSEQ y administración siempre; talento humano solo si hubo lesionados', () => {
    expect(areasAviso({ severidad: 'SOLO_DANOS', heridos: 0, fallecidos: 0 })).toEqual(['hseq', 'administracion'])
    expect(areasAviso({ severidad: null, heridos: 0, fallecidos: 0 })).toEqual(['hseq', 'administracion'])
    expect(areasAviso({ severidad: 'LESION_LEVE', heridos: 1, fallecidos: 0 })).toContain('talento_humano')
    expect(areasAviso({ severidad: 'FATALIDAD', heridos: 0, fallecidos: 1 })).toContain('talento_humano')
  })
})

describe('qué falta para cerrar', () => {
  const completa: DatosInvestigacion = {
    fecha_investigacion: '2026-10-05',
    equipo_investigador: [{ nombre: 'Coordinadora HSEQ', cargo: 'SST' }],
    actos_inseguros: 'No guardó la distancia de seguimiento',
    condiciones_inseguras: null,
    factores_personales: null,
    factores_trabajo: 'Jornada de 11 horas',
    analisis_porques: ['Frenó tarde', 'Iba cansado'],
    causas_identificadas: 'Fatiga por programación de turnos',
    lecciones_aprendidas: null,
  }
  const cierre = { fecha_cierre: '2026-10-09', responsable_cierre: 'Coordinadora HSEQ' }

  it('con lo mínimo de la Res. 1401 y el cierre fechado, no falta nada', () => {
    expect(faltantesParaCerrar('2026-10-01', completa, cierre, HOY)).toEqual([])
  })

  it('enumera todo lo que falta, no solo lo primero', () => {
    const vacia: DatosInvestigacion = {
      ...completa,
      fecha_investigacion: null,
      equipo_investigador: [{ nombre: '  ' }],
      actos_inseguros: null,
      factores_trabajo: '',
      causas_identificadas: null,
    }
    const faltan = faltantesParaCerrar('2026-10-01', vacia, { fecha_cierre: null, responsable_cierre: null }, HOY)
    expect(faltan).toEqual([
      'Fecha de la investigación',
      'Equipo investigador (al menos una persona)',
      'Causas inmediatas (actos o condiciones inseguras)',
      'Causas básicas (factores personales o del trabajo)',
      'Causa raíz (conclusión del análisis)',
      'Fecha de cierre',
      'Responsable del cierre',
    ])
  })

  it('rechaza fechas de cierre fuera de orden', () => {
    expect(faltantesParaCerrar('2026-10-01', completa, { ...cierre, fecha_cierre: '2026-10-12' }, HOY)).toContain('La fecha de cierre no puede ser futura')
    expect(faltantesParaCerrar('2026-10-01', completa, { ...cierre, fecha_cierre: '2026-10-03' }, HOY)).toContain(
      'La fecha de cierre es anterior a la de la investigación',
    )
  })
})

describe('indicadores y radicado', () => {
  it('la serie mensual incluye los meses sin eventos', () => {
    const serie = serieMensual(
      [
        { fecha: '2026-08-03', tipo: 'ACCIDENTE_TRANSITO' },
        { fecha: '2026-08-20', tipo: 'CASI_ACCIDENTE' },
        { fecha: '2026-10-01', tipo: 'INCIDENTE' },
      ],
      '2026-07',
      '2026-10',
    )
    expect(serie.map((p) => p.mes)).toEqual(['2026-07', '2026-08', '2026-09', '2026-10'])
    expect(serie[1]).toMatchObject({ ACCIDENTE_TRANSITO: 1, CASI_ACCIDENTE: 1, total: 2 })
    expect(serie[2].total).toBe(0)
  })
  it('la ventana de 12 meses cruza el año', () => {
    expect(mesInicioVentana('2026-10-10', 12)).toBe('2025-11')
    expect(mesInicioVentana('2026-03-01', 3)).toBe('2026-01')
  })
  it('días sin accidentes: desde el último; null si nunca hubo', () => {
    expect(diasSinAccidentes('2026-09-30', HOY)).toBe(10)
    expect(diasSinAccidentes(null, HOY)).toBeNull()
  })
  it('el radicado se escribe y se lee igual', () => {
    expect(codigoIncidente(7)).toBe('INC-0007')
    expect(consecutivoDeTexto('INC-0007')).toBe(7)
    expect(consecutivoDeTexto('inc 12')).toBe(12)
    expect(consecutivoDeTexto('ABC123')).toBeNull()
  })
})
