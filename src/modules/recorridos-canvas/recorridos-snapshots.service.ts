import { prisma } from '../../config/prisma'
import {
  reservarVersionSnapshot,
  hashSnapshotPayload,
  inicioVentanaAntirrebote,
} from '../../utils/snapshot-version'
import { RecorridosCanvasService } from './recorridos-canvas.service'
import type { FilaRecorrido, RecorridosPeriodoDTO } from './recorridos-canvas.types'
import { emitSheetReverted } from '../../sockets/sheet.gateway'
import { corteDeMes } from './corte-periodo'

/**
 * Versionado del canvas de recorridos.
 *
 * Lo que se captura y lo que se revierte es el PERIODO entero, no la hoja de un
 * conductor: los bonos se cuentan por mes y placa cruzando a todas las hojas,
 * así que revertir una sola dejaría esos conteos descuadrados frente al resumen
 * que imprime el PDF.
 */

export type OrigenSnapshot = 'manual' | 'auto' | 'revert'

/** Tope de hojas al capturar. Alto: un snapshot no lo abre un navegador. */
const MAX_HOJAS_SNAPSHOT = 1000

export class RecorridosSnapshotsService {
  /**
   * Captura una versión del periodo.
   *
   * Devuelve `null` cuando no hacía falta capturar (no es un error: el
   * controller lo traduce a `{ sinCambios: true }`). Dos frenos, y el orden
   * importa: el antirrebote va ANTES de construir el payload, porque
   * construirlo son decenas de queries.
   */
  static async capturar(opts: {
    anio: number
    mes: number
    origen?: OrigenSnapshot
    usuarioId?: string | null
    revertidoDeId?: string | null
  }) {
    const { anio, mes, origen = 'manual', usuarioId = null, revertidoDeId = null } = opts

    if (origen === 'auto') {
      const reciente = await prisma.recorridos_periodo_snapshot.findFirst({
        where: {
          anio,
          mes,
          origen: 'auto',
          created_at: { gte: inicioVentanaAntirrebote() },
        },
        select: { id: true },
      })
      if (reciente) return null
    }

    // El snapshot se identifica por el mes en que CIERRA el corte, así que se
    // captura siempre el corte canónico 21→20 de ese mes. Si se guardara el
    // corte que el usuario tenga en pantalla, dos capturas del mismo periodo
    // con rangos distintos se compararían entre sí y el diff sería basura.
    const dto = await RecorridosCanvasService.construirPeriodo({
      corte: corteDeMes(anio, mes),
      maxHojas: MAX_HOJAS_SNAPSHOT,
    })
    const payload = this.payloadDesdeDTO(dto)
    const hash = hashSnapshotPayload(payload)

    if (origen === 'auto') {
      const ultimo = await prisma.recorridos_periodo_snapshot.findFirst({
        where: { anio, mes, rama: 'main' },
        orderBy: { version: 'desc' },
        select: { payload: true },
      })
      if (ultimo && hashSnapshotPayload(ultimo.payload) === hash) return null
    }

    return reservarVersionSnapshot({
      scope: `snapshot:recorridos:${anio}-${mes}`,
      ultimaVersion: async (tx) => {
        const ultimo = await tx.recorridos_periodo_snapshot.findFirst({
          where: { anio, mes },
          orderBy: { version: 'desc' },
          select: { version: true },
        })
        return ultimo?.version ?? null
      },
      insertar: (tx, version) =>
        tx.recorridos_periodo_snapshot.create({
          data: {
            anio,
            mes,
            version,
            origen,
            usuario_id: usuarioId,
            revertido_de_id: revertidoDeId,
            payload: payload as never,
          },
          select: {
            id: true,
            anio: true,
            mes: true,
            version: true,
            origen: true,
            created_at: true,
            usuario_id: true,
          },
        }),
    })
  }

  /**
   * El payload guardado.
   *
   * Se quedan los datos y se van los rótulos: `etiqueta` y `avisos` son
   * presentación y se recalculan al restaurar. `bonos` sí entra porque el valor
   * unitario de un bono puede cambiar dentro del año, y sin él un snapshot
   * viejo no se podría leer con las cifras que tenía entonces.
   */
  private static payloadDesdeDTO(dto: RecorridosPeriodoDTO) {
    return {
      anio: dto.anio,
      mes: dto.mes,
      bonos: dto.bonos,
      hojas: dto.hojas.map((h) => ({
        conductor_id: h.conductor_id,
        nombre: h.nombre,
        apellido: h.apellido,
        filas: h.filas,
      })),
      meta: { capturado_en: new Date().toISOString() },
    }
  }

  static listar(anio: number, mes: number) {
    return prisma.recorridos_periodo_snapshot.findMany({
      where: { anio, mes },
      orderBy: { version: 'desc' },
      take: 100,
      select: {
        id: true,
        anio: true,
        mes: true,
        rama: true,
        version: true,
        origen: true,
        revertido_de_id: true,
        usuario_id: true,
        created_at: true,
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
    })
  }

  static obtener(id: string) {
    return prisma.recorridos_periodo_snapshot.findUnique({ where: { id } })
  }

  /**
   * Diferencias contra otra versión.
   *
   * Deliberadamente parcial: con decenas de conductores y cientos de tramos, un
   * diff exhaustivo no se lee. Se comparan los campos que alguien edita a mano
   * y el conjunto de bonos marcados.
   */
  static async diff(id: string, contraId?: string | null) {
    const actual = await this.obtener(id)
    if (!actual) throw new Error('Snapshot no encontrado')

    const previo = contraId
      ? await this.obtener(contraId)
      : await prisma.recorridos_periodo_snapshot.findFirst({
          where: { anio: actual.anio, mes: actual.mes, version: { lt: actual.version } },
          orderBy: { version: 'desc' },
        })

    if (!previo) return { cambios: [], truncado: false, contra: null }

    const indice = (p: any) => {
      const m = new Map<string, FilaRecorrido>()
      for (const h of p?.hojas ?? []) {
        for (const f of h.filas ?? []) m.set(f.segmento_id ?? `dia:${f.registro_dia_id}`, f)
      }
      return m
    }

    const antes = indice(previo.payload)
    const ahora = indice(actual.payload)

    /**
     * `config_id` → nombre del bono.
     *
     * El diff sin esto listaba UUIDs («da192f4f-1552-…»), que no le dicen nada
     * a quien está revisando qué cambió. Los nombres salen del payload del
     * propio snapshot y no de la configuración vigente: si un bono se renombró
     * después, el diff debe seguir diciendo cómo se llamaba entonces.
     */
    const nombreBono = new Map<string, string>()
    for (const p of [previo.payload, actual.payload] as any[]) {
      for (const b of p?.bonos ?? []) nombreBono.set(b.config_id, b.nombre)
    }
    const comoNombres = (ids: string[]) => ids.map((id) => nombreBono.get(id) ?? id)
    const CAMPOS: Array<keyof FilaRecorrido> = [
      'fecha', 'tipo_dia', 'cliente_nombre', 'vehiculo_placa',
      'hora_inicio', 'hora_fin', 'horas_conducidas', 'km_inicial',
      'km_final', 'pernocte', 'observaciones',
    ]

    const cambios: Array<Record<string, unknown>> = []
    const TOPE = 200

    for (const [clave, filaAhora] of ahora) {
      const filaAntes = antes.get(clave)
      if (!filaAntes) {
        cambios.push({ clave, tipo: 'alta', fecha: filaAhora.fecha })
        continue
      }
      for (const campo of CAMPOS) {
        if (filaAntes[campo] !== filaAhora[campo]) {
          cambios.push({
            clave,
            fecha: filaAhora.fecha,
            campo,
            antes: filaAntes[campo],
            ahora: filaAhora[campo],
          })
        }
      }
      const bonosAntes = Object.entries(filaAntes.bonos ?? {}).filter(([, v]) => v).map(([k]) => k)
      const bonosAhora = Object.entries(filaAhora.bonos ?? {}).filter(([, v]) => v).map(([k]) => k)
      if (bonosAntes.sort().join(',') !== bonosAhora.sort().join(',')) {
        cambios.push({
          clave,
          fecha: filaAhora.fecha,
          campo: 'bonos',
          antes: comoNombres(bonosAntes),
          ahora: comoNombres(bonosAhora),
        })
      }
      if (cambios.length >= TOPE) break
    }
    for (const [clave, filaAntes] of antes) {
      if (cambios.length >= TOPE) break
      if (!ahora.has(clave)) cambios.push({ clave, tipo: 'baja', fecha: filaAntes.fecha })
    }

    return {
      contra: { id: previo.id, version: previo.version },
      cambios: cambios.slice(0, TOPE),
      truncado: cambios.length >= TOPE,
    }
  }

  /**
   * Restaura el periodo al contenido de un snapshot.
   *
   * Una transacción POR HOJA y no una global: con decenas de conductores, un
   * fallo en el último revertiría los anteriores sin decir cuál falló.
   */
  static async revertir(opts: {
    id: string
    usuarioId?: string | null
    actor: { id: string; name: string }
  }) {
    const { id, usuarioId = null, actor } = opts
    const snap = await this.obtener(id)
    if (!snap) throw new Error('Snapshot no encontrado')

    const payload = snap.payload as any
    const hojas: Array<{ conductor_id: string; filas: FilaRecorrido[] }> = payload?.hojas ?? []

    let filasRestauradas = 0
    const fallidas: Array<{ conductor_id: string; error: string }> = []

    for (const hoja of hojas) {
      try {
        await prisma.$transaction(async (tx) => {
          for (const f of hoja.filas) {
            if (f.tipo_fila === 'segmento' && f.segmento_id) {
              await tx.registro_dia_laboral_segmento.updateMany({
                where: { id: f.segmento_id, deleted_at: null },
                data: {
                  cliente_id: f.cliente_id,
                  cliente_nombre: f.cliente_nombre,
                  vehiculo_id: f.vehiculo_id,
                  vehiculo_placa: f.vehiculo_placa,
                  hora_inicio: f.hora_inicio,
                  hora_fin: f.hora_fin,
                  inicio_dia_siguiente: f.inicio_dia_siguiente,
                  fin_dia_siguiente: f.fin_dia_siguiente,
                  horas_conducidas: f.horas_conducidas,
                  km_inicial: f.km_inicial,
                  km_final: f.km_final,
                  pernocte: f.pernocte,
                  observaciones: f.observaciones,
                  // La reversión es una escritura más: sube la versión para que
                  // cualquier patch en vuelo con la versión vieja choque.
                  version: { increment: 1 },
                  updated_at: new Date(),
                } as never,
              })
            } else {
              await tx.registro_dia_laboral.updateMany({
                where: { id: f.registro_dia_id, deleted_at: null },
                data: {
                  tipo: f.tipo_dia,
                  observaciones: f.observaciones,
                  version: { increment: 1 },
                  updated_at: new Date(),
                } as never,
              })
            }
            await this.restaurarBonos(tx, f, actor.id)
            filasRestauradas++
          }
        })
      } catch (e: any) {
        fallidas.push({ conductor_id: hoja.conductor_id, error: e?.message ?? String(e) })
      }
    }

    // Que la propia reversión sea deshacible.
    const nuevo = await this.capturar({
      anio: snap.anio,
      mes: snap.mes,
      origen: 'revert',
      usuarioId,
      revertidoDeId: snap.id,
    })

    // Bumpea el epoch: los patches en vuelo con el epoch viejo se rechazan en
    // vez de reintroducir datos de antes de revertir.
    emitSheetReverted({
      scope: 'recorridos',
      anio: snap.anio,
      mes: snap.mes,
      version: snap.version,
      by: actor,
    })

    return { filasRestauradas, fallidas, snapshot: nuevo }
  }

  /** Deja los bonos de una fila exactamente como los tenía el snapshot. */
  private static async restaurarBonos(tx: any, f: FilaRecorrido, actorId: string) {
    const deseados = Object.entries(f.bonos ?? {})
      .filter(([, marcado]) => marcado)
      .map(([configId]) => configId)

    const where = {
      registro_dia_id: f.registro_dia_id,
      segmento_id: f.segmento_id,
      deleted_at: null,
    }

    const actuales: Array<{ id: string; config_liquidacion_id: string }> =
      await tx.registro_dia_laboral_bono.findMany({
        where,
        select: { id: true, config_liquidacion_id: true },
      })
    const actualesIds = new Set(actuales.map((b) => b.config_liquidacion_id))

    const sobran = actuales.filter((b) => !deseados.includes(b.config_liquidacion_id))
    if (sobran.length) {
      await tx.registro_dia_laboral_bono.updateMany({
        where: { id: { in: sobran.map((b) => b.id) } },
        data: { deleted_at: new Date() },
      })
    }

    for (const configId of deseados) {
      if (actualesIds.has(configId)) continue
      const cfg = await tx.configuraciones_liquidacion.findUnique({
        where: { id: configId },
        select: { valor: true },
      })
      // Un bono cuya config se borró no se puede recrear: la FK es RESTRICT.
      if (!cfg) continue
      await tx.registro_dia_laboral_bono.create({
        data: {
          registro_dia_id: f.registro_dia_id,
          segmento_id: f.segmento_id,
          config_liquidacion_id: configId,
          valor: cfg.valor,
          creado_por_id: actorId,
        },
      })
    }
  }

  /** Captura automática de todos los periodos con actividad reciente. */
  static async capturarHorario() {
    const ahora = new Date()
    const periodos = [
      { anio: ahora.getFullYear(), mes: ahora.getMonth() + 1 },
      // El mes anterior sigue editándose durante los primeros días del
      // siguiente, mientras se cierra la planilla.
      ...(ahora.getDate() <= 10
        ? [
            ahora.getMonth() === 0
              ? { anio: ahora.getFullYear() - 1, mes: 12 }
              : { anio: ahora.getFullYear(), mes: ahora.getMonth() },
          ]
        : []),
    ]

    let capturados = 0
    for (const p of periodos) {
      try {
        const s = await this.capturar({ ...p, origen: 'auto' })
        if (s) capturados++
      } catch (e) {
        console.warn('[recorridos-snapshots] fallo capturando', p, e)
      }
    }
    return { capturados, periodos }
  }
}
