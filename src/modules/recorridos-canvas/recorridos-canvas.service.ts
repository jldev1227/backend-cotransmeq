import { prisma } from '../../config/prisma'
import { periodoDeCorte, etiquetaCorte, type Corte } from './corte-periodo'
import {
  BonoColumna,
  FilaRecorrido,
  HojaRecorridos,
  RecorridosPeriodoDTO,
  etiquetaPeriodo,
  nombresUnicos,
} from './recorridos-canvas.types'

/**
 * Construye el libro de recorridos de un periodo.
 *
 * El mes es natural (1 al último día), no el corte 21-20 de la nómina: aquí se
 * está mirando la operación, y el usuario filtra por «agosto» esperando agosto.
 */
export class RecorridosCanvasService {
  /**
   * Columnas de bono visibles para un año.
   *
   * La regla de `bono_config_visual` es «default true»: una config activa sin
   * fila en la pivote se pinta, y solo desaparece cuando alguien la oculta
   * explícitamente. Se resuelve aquí y no en el cliente para que el PDF, el
   * XLSX y el canvas usen exactamente la misma lista.
   */
  static async columnasBono(anio: number): Promise<BonoColumna[]> {
    const [configs, visuales] = await Promise.all([
      prisma.configuraciones_liquidacion.findMany({
        where: { anio, activo: true, deleted_at: null },
        select: { id: true, nombre: true, valor: true, anio: true, tipo: true },
        // Desempate explícito: `nombre` puede repetirse entre años y sin un
        // segundo criterio Postgres puede devolver dos ordenaciones distintas
        // para la misma consulta, lo que haría que el snapshot detecte cambios
        // que no existen.
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      prisma.bono_config_visual.findMany({
        where: { anio },
        select: { config_liquidacion_id: true, visible: true },
      }),
    ])

    const oculto = new Set(
      visuales.filter((v) => !v.visible).map((v) => v.config_liquidacion_id),
    )

    return configs
      .filter((c) => !oculto.has(c.id))
      // Solo los importes fijos son marcables por recorrido. Un PORCENTAJE
      // (salud, pensión) no es un bono que se otorgue por tramo, y ofrecerlo
      // como casilla invitaría a marcarlo.
      .filter((c) => c.tipo === 'VALOR_NUMERICO')
      .map((c) => ({
        config_id: c.id,
        nombre: c.nombre,
        valor: Number(c.valor),
        anio: c.anio ?? anio,
      }))
  }

  /**
   * Construye el libro de un CORTE.
   *
   * El corte no es un mes natural: por defecto va del 21 de un mes al 20 del
   * siguiente, que es como se liquida la planilla. `anio`/`mes` del DTO son los
   * del mes en que CIERRA, y solo se usan para el room de socket y para
   * identificar los snapshots; el filtro de datos son las dos fechas.
   */
  static async construirPeriodo(opts: {
    corte: Corte
    conductorIds?: string[]
    maxHojas: number
  }): Promise<RecorridosPeriodoDTO> {
    const { corte, conductorIds, maxHojas } = opts
    const { anio, mes } = periodoDeCorte(corte)
    const avisos: string[] = []

    // `fecha` es `@db.Date`. Se construyen en UTC y el rango es medio-abierto
    // por arriba (`< hasta + 1 día`) para que el último día del corte entre
    // entero, sin depender de la zona horaria del proceso.
    const [a1, m1, d1] = corte.desde.split('-').map(Number)
    const [a2, m2, d2] = corte.hasta.split('-').map(Number)
    const desde = new Date(Date.UTC(a1, m1 - 1, d1))
    const hasta = new Date(Date.UTC(a2, m2 - 1, d2 + 1))

    const bonos = await this.columnasBono(anio)
    const bonosVisibles = new Set(bonos.map((b) => b.config_id))
    if (bonos.length === 0) {
      avisos.push(
        `No hay bonos visibles configurados para ${anio}. El canvas se abre sin columnas de bono; ` +
          `revisa la configuración de bonos.`,
      )
    }

    const registros = await prisma.registro_dia_laboral.findMany({
      where: {
        fecha: { gte: desde, lt: hasta },
        deleted_at: null,
        ...(conductorIds?.length ? { conductor_id: { in: conductorIds } } : {}),
      },
      select: {
        id: true,
        conductor_id: true,
        fecha: true,
        tipo: true,
        observaciones: true,
        version: true,
        mantenimiento_vehiculo_id: true,
        mantenimiento_vehiculo_placa: true,
        conductor: {
          select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
        },
        segmentos: {
          where: { deleted_at: null },
          select: {
            id: true,
            cliente_id: true,
            cliente_nombre: true,
            vehiculo_id: true,
            vehiculo_placa: true,
            hora_inicio: true,
            hora_fin: true,
            inicio_dia_siguiente: true,
            fin_dia_siguiente: true,
            horas_conducidas: true,
            km_inicial: true,
            km_final: true,
            pernocte: true,
            orden: true,
            observaciones: true,
            version: true,
          },
          orderBy: [{ orden: 'asc' }, { id: 'asc' }],
        },
        bonos: {
          where: { deleted_at: null },
          select: { id: true, segmento_id: true, config_liquidacion_id: true },
        },
      },
      // Cronológico ascendente: la fecha más antigua arriba. El desempate por
      // `id` mantiene el orden estable entre consultas.
      orderBy: [{ fecha: 'asc' }, { id: 'asc' }],
    })

    // Agrupa por conductor conservando el orden cronológico de dentro.
    const porConductor = new Map<string, typeof registros>()
    for (const r of registros) {
      const lista = porConductor.get(r.conductor_id)
      if (lista) lista.push(r)
      else porConductor.set(r.conductor_id, [r])
    }

    const conductores = [...porConductor.keys()]
      .map((id) => porConductor.get(id)![0].conductor)
      .filter((c): c is NonNullable<typeof c> => !!c)
      .sort((a, b) =>
        `${a.apellido} ${a.nombre}`.localeCompare(`${b.apellido} ${b.nombre}`, 'es'),
      )

    let elegidos = conductores
    if (elegidos.length > maxHojas) {
      avisos.push(
        `El periodo tiene ${elegidos.length} conductores y el libro se limita a ${maxHojas}. ` +
          `Se muestran los ${maxHojas} primeros por apellido; filtra por conductor para ver el resto.`,
      )
      elegidos = elegidos.slice(0, maxHojas)
    }

    const nombres = nombresUnicos(elegidos)

    const hojas: HojaRecorridos[] = elegidos.map((c) => {
      const dias = porConductor.get(c.id) ?? []
      const filas: FilaRecorrido[] = []

      for (const dia of dias) {
        const fecha = this.fechaISO(dia.fecha)

        // Índice de bonos del día: los de tramo van por `segmento_id`, y los
        // que se otorgaron al día completo (segmento_id null) cuelgan de la
        // fila de día.
        const marcados = new Map<string, Set<string>>()
        for (const b of dia.bonos) {
          if (!bonosVisibles.has(b.config_liquidacion_id)) continue
          const clave = b.segmento_id ?? ''
          const set = marcados.get(clave) ?? new Set<string>()
          set.add(b.config_liquidacion_id)
          marcados.set(clave, set)
        }
        const bonosDe = (clave: string): Record<string, boolean> => {
          const set = marcados.get(clave)
          const salida: Record<string, boolean> = {}
          for (const b of bonos) salida[b.config_id] = set?.has(b.config_id) ?? false
          return salida
        }

        if (dia.segmentos.length === 0) {
          filas.push({
            tipo_fila: 'dia',
            registro_dia_id: dia.id,
            segmento_id: null,
            version: dia.version,
            fecha,
            tipo_dia: dia.tipo,
            orden: 0,
            cliente_id: null,
            cliente_nombre: null,
            // Un día de mantenimiento sí tiene placa, pero vive en el padre:
            // no es un recorrido, así que no hay segmento donde ponerla.
            vehiculo_id: dia.mantenimiento_vehiculo_id,
            vehiculo_placa: dia.mantenimiento_vehiculo_placa,
            hora_inicio: null,
            hora_fin: null,
            inicio_dia_siguiente: false,
            fin_dia_siguiente: false,
            horas_conducidas: 0,
            km_inicial: null,
            km_final: null,
            pernocte: false,
            observaciones: dia.observaciones,
            bonos: bonosDe(''),
          })
          continue
        }

        for (const s of dia.segmentos) {
          filas.push({
            tipo_fila: 'segmento',
            registro_dia_id: dia.id,
            segmento_id: s.id,
            version: s.version,
            fecha,
            tipo_dia: dia.tipo,
            orden: s.orden,
            cliente_id: s.cliente_id,
            cliente_nombre: s.cliente_nombre,
            vehiculo_id: s.vehiculo_id,
            vehiculo_placa: s.vehiculo_placa,
            hora_inicio: s.hora_inicio,
            hora_fin: s.hora_fin,
            inicio_dia_siguiente: s.inicio_dia_siguiente,
            fin_dia_siguiente: s.fin_dia_siguiente,
            horas_conducidas: Number(s.horas_conducidas),
            km_inicial: s.km_inicial,
            km_final: s.km_final,
            pernocte: s.pernocte,
            observaciones: s.observaciones,
            bonos: bonosDe(s.id),
          })
        }
      }

      return {
        conductor_id: c.id,
        nombre: c.nombre,
        apellido: c.apellido,
        numero_identificacion: c.numero_identificacion,
        nombre_hoja: nombres[c.id],
        filas,
      }
    })

    const etiqueta = etiquetaCorte(corte)
    if (hojas.length === 0) {
      avisos.push(`No hay recorridos registrados entre el ${corte.desde} y el ${corte.hasta}.`)
    }

    return {
      anio,
      mes,
      desde: corte.desde,
      hasta: corte.hasta,
      etiqueta,
      bonos,
      hojas,
      avisos,
    }
  }

  /** `Date` → `YYYY-MM-DD` sin pasar por la zona horaria del proceso. */
  private static fechaISO(f: Date): string {
    return f.toISOString().slice(0, 10)
  }
}
