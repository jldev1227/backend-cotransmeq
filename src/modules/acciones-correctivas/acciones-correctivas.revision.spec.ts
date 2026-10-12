/**
 * Revisión de acciones correctivas y conteos del tablero.
 *
 * Puras: se fija `hoy` (y `ahora`) en cada caso para que el resultado no
 * dependa del día en que corra la suite. Las reglas son las de
 * `dashboard-utils.ts` del front; si un caso de aquí cambia, el detalle de la
 * acción (que sigue calculando en el cliente) dirá otra cosa que el tablero.
 */
import { describe, expect, it } from 'vitest'
import {
  diasEntre,
  fechaMasRecienteActividad,
  hoyBogota,
  isoFecha,
  resumenRevision,
  resumirListado,
  sumarDias,
  type FilaListado,
} from './acciones-correctivas.revision'

const HOY = '2026-10-10'
/** Columnas `@db.Date`: Prisma las da como medianoche UTC. */
const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`)

describe('fechas', () => {
  it('una @db.Date conserva su día aunque el servidor esté al oeste de UTC', () => {
    expect(isoFecha(d('2026-06-04'))).toBe('2026-06-04')
    expect(isoFecha('2026-06-04T00:00:00.000Z')).toBe('2026-06-04')
    expect(isoFecha(null)).toBeNull()
    expect(isoFecha('  ')).toBeNull()
  })

  it('hoy es el día de Bogotá, no el de UTC', () => {
    // 2026-10-11 02:00 UTC = 2026-10-10 21:00 en Bogotá (UTC-5).
    expect(hoyBogota(new Date('2026-10-11T02:00:00Z'))).toBe('2026-10-10')
    expect(hoyBogota(new Date('2026-10-11T05:00:00Z'))).toBe('2026-10-11')
  })

  it('suma días cruzando mes y año, y cuenta días enteros', () => {
    expect(sumarDias('2026-12-25', 15)).toBe('2027-01-09')
    expect(sumarDias('2026-02-20', 15)).toBe('2026-03-07')
    expect(diasEntre('2026-10-10', '2026-10-25')).toBe(15)
    expect(diasEntre('2026-10-10', '2026-10-01')).toBe(-9)
    expect(diasEntre('', '2026-10-01')).toBe(0)
  })
})

describe('fechaMasRecienteActividad', () => {
  it('toma la más reciente entre causas, corrección y campos de la acción', () => {
    expect(
      fechaMasRecienteActividad({
        causas: [{ fecha_seguimiento: d('2026-09-01') }, { fecha_seguimiento: null }],
        seguimientos_correccion: [{ fecha_seguimiento: d('2026-09-20') }],
        fecha_seguimiento: d('2026-08-30'),
        fecha_implementacion: d('2026-09-05'),
        fecha_identificacion_hallazgo: d('2026-10-01'),
      }),
    ).toBe('2026-09-20')
  })

  it('la identificación del hallazgo solo cuenta si no hubo ninguna actividad', () => {
    expect(fechaMasRecienteActividad({ fecha_identificacion_hallazgo: d('2026-01-22') })).toBe('2026-01-22')
    expect(fechaMasRecienteActividad({})).toBeNull()
  })
})

describe('resumenRevision', () => {
  it('cerrada si está CUMPLIDA o tiene cierre eficaz con fecha', () => {
    expect(resumenRevision({ estado_global: 'CUMPLIDA' }, HOY).estado).toBe('cerrada')
    expect(
      resumenRevision(
        { estado_global: 'EN_PROCESO', evaluacion_cierre_eficaz: 'EFICAZ', fecha_cierre_definitivo: d('2026-06-03') },
        HOY,
      ).estado,
    ).toBe('cerrada')
    // Eficaz pero sin fecha de cierre: sigue abierta.
    expect(
      resumenRevision(
        { estado_global: 'EN_PROCESO', evaluacion_cierre_eficaz: 'EFICAZ', fecha_implementacion: d('2026-10-05') },
        HOY,
      ).estado,
    ).toBe('al-dia')
  })

  it('clasifica por los días que faltan para la revisión (actividad + 15)', () => {
    const con = (iso: string) => resumenRevision({ estado_global: 'EN_PROCESO', fecha_implementacion: d(iso) }, HOY)
    expect(con('2026-09-24')).toMatchObject({ estado: 'vencida', diasHasta: -1, proximaFecha: '2026-10-09' })
    expect(con('2026-09-25')).toMatchObject({ estado: 'hoy', diasHasta: 0 })
    expect(con('2026-10-02')).toMatchObject({ estado: 'proxima', diasHasta: 7 })
    expect(con('2026-10-03')).toMatchObject({ estado: 'al-dia', diasHasta: 8, ultimaFecha: '2026-10-03' })
  })

  it('sin ninguna fecha: sin actividad', () => {
    expect(resumenRevision({ estado_global: 'EN_PROCESO' }, HOY)).toEqual({
      ultimaFecha: null,
      proximaFecha: null,
      diasHasta: null,
      estado: 'sin-actividad',
    })
  })
})

describe('resumirListado', () => {
  const fila = (id: string, extra: Partial<FilaListado>): FilaListado => ({
    id,
    accion_numero: id.toUpperCase(),
    responsable_ejecucion: null,
    estado_global: 'EN_PROCESO',
    tipo_accion_ejecutar: 'CORRECTIVA',
    ...extra,
  })
  const AHORA = new Date('2026-10-10T15:00:00Z').getTime()

  // a: en proceso, revisión vencida hace 20 días · b: vencida (estado), revisión
  // próxima · c: cumplida (cerrada) · d: en proceso sin actividad · e: en
  // proceso, revisión hoy, fecha límite en 3 días.
  const filas: FilaListado[] = [
    fila('a', {
      fecha_implementacion: d('2026-09-05'),
      causas: [
        { estado_seguimiento: 'En Proceso', fecha_seguimiento: null },
        { estado_seguimiento: 'Vencida', fecha_seguimiento: null },
      ],
    }),
    fila('b', { estado_global: 'VENCIDA', tipo_accion_ejecutar: 'MEJORA', fecha_implementacion: d('2026-10-01') }),
    fila('c', { estado_global: 'CUMPLIDA', tipo_accion_ejecutar: null, causas: [{ estado_seguimiento: 'Cumplida' }] }),
    fila('d', {}),
    fila('e', {
      fecha_implementacion: d('2026-09-25'),
      fecha_limite_cierre_accion: d('2026-10-13'),
    }),
  ]

  it('sin facetas: todo es resultado', () => {
    const { ids, resumen } = resumirListado(filas, {}, { hoy: HOY, ahora: AHORA })
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(resumen.total_estados).toBe(5)
    expect(resumen.por_estado).toEqual({ EN_PROCESO: 3, VENCIDA: 1, CUMPLIDA: 1, REPLANTEADA: 0 })
    expect(resumen.proximas_vencer).toBe(1)
    expect(resumen.causas).toEqual({ total: 3, en_proceso: 1, vencida: 1, cumplida: 1 })
    expect(resumen.por_tipo).toEqual({ CORRECTIVA: 3, MEJORA: 1, 'Sin tipo': 1 })
    // Vencidas: la más atrasada primero; «hoy» (0) después de -20.
    expect(resumen.revisiones.vencidas.map((r) => [r.id, r.estado, r.diasHasta])).toEqual([
      ['a', 'vencida', -20],
      ['e', 'hoy', 0],
    ])
    // Próximas: las sin actividad al final.
    expect(resumen.revisiones.proximas.map((r) => r.id)).toEqual(['b', 'd'])
    expect(resumen.revisiones.proximas[0]).toEqual({
      id: 'b',
      accion_numero: 'B',
      responsable_ejecucion: null,
      ultimaFecha: '2026-10-01',
      proximaFecha: '2026-10-16',
      diasHasta: 6,
      estado: 'proxima',
    })
  })

  it('con estado: los conteos de estado no se filtran por él; las revisiones sí', () => {
    const { ids, resumen } = resumirListado(filas, { estado_global: 'EN_PROCESO' }, { hoy: HOY, ahora: AHORA })
    expect(ids).toEqual(['a', 'd', 'e'])
    expect(resumen.total_estados).toBe(5)
    expect(resumen.por_estado.VENCIDA).toBe(1)
    expect(resumen.revisiones.vencidas.map((r) => r.id)).toEqual(['a', 'e'])
    expect(resumen.revisiones.proximas.map((r) => r.id)).toEqual(['d'])
    expect(resumen.por_tipo).toEqual({ CORRECTIVA: 3 })
    expect(resumen.causas.total).toBe(2)
  })

  it('con revisión: las revisiones no se filtran por ella; los estados sí', () => {
    const { ids, resumen } = resumirListado(filas, { revision: 'vencidas' }, { hoy: HOY, ahora: AHORA })
    expect(ids).toEqual(['a', 'e'])
    expect(resumen.total_estados).toBe(2)
    expect(resumen.por_estado).toEqual({ EN_PROCESO: 2, VENCIDA: 0, CUMPLIDA: 0, REPLANTEADA: 0 })
    expect(resumen.revisiones.proximas.map((r) => r.id)).toEqual(['b', 'd'])
    expect(resumen.proximas_vencer).toBe(1)
  })

  it('estado y revisión a la vez: el resultado cumple los dos', () => {
    const { ids, resumen } = resumirListado(
      filas,
      { estado_global: 'VENCIDA', revision: 'proximas' },
      { hoy: HOY, ahora: AHORA },
    )
    expect(ids).toEqual(['b'])
    // Estados: los que cumplen la revisión «próximas» (b y d).
    expect(resumen.por_estado).toEqual({ EN_PROCESO: 1, VENCIDA: 1, CUMPLIDA: 0, REPLANTEADA: 0 })
    // Revisiones: las de estado VENCIDA (solo b).
    expect(resumen.revisiones.vencidas).toEqual([])
    expect(resumen.revisiones.proximas.map((r) => r.id)).toEqual(['b'])
  })

  it('una cerrada no entra en ningún panel ni pasa el filtro de revisión', () => {
    const { ids } = resumirListado(filas, { revision: 'proximas' }, { hoy: HOY, ahora: AHORA })
    expect(ids).not.toContain('c')
  })
})
