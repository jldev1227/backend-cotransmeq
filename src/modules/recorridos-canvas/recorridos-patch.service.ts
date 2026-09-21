import { randomUUID } from 'crypto'
import { prisma } from '../../config/prisma'
import { checkAccess, type Area } from '../../config/permissions'
import { obtenerPermisosRutas } from '../../services/permisos-rutas.service'
import { retirarDiaLaboral } from '../../lib/soft-delete/dia-laboral'
import {
  CAMPOS_SEGMENTO,
  CAMPOS_DIA,
  PREFIJO_BONO,
  ValorInvalido,
  aBooleano,
  aTexto,
  normalizar,
  validarCoherencia,
  exigirNoVacio,
  exigirDentroDelCorte,
  exigirNoFutura,
  hoyISO,
  clasificarFilaNueva,
  type FilaNuevaEntrada,
} from './recorridos-reglas'
import { RecorridosCanvasService } from './recorridos-canvas.service'
import type { FilaRecorrido } from './recorridos-canvas.types'

/**
 * Edición celda a celda del canvas de recorridos.
 *
 * Todo lo que se puede escribir está en `CAMPOS_SEGMENTO` / `CAMPOS_DIA`, más
 * el pseudo-campo `bono:<config_id>`. Es una lista BLANCA a propósito: una
 * celda sin entrada aquí no se puede escribir, así que la hoja puede crecer sin
 * que nadie tenga que acordarse de ampliar una lista negra.
 *
 * PERMISOS. Los sockets no pasan por `requirePermission`, así que el chequeo de
 * área se hace aquí. Sin esto, cualquier usuario autenticado podría emitir un
 * `sheet:patch` y reescribir recorridos, porque el módulo `conductores` es
 * `general: true` y el gateway solo comprueba identidad.
 */


export class PatchRecorridoError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'CAMPO_NO_EDITABLE'
      | 'VALOR_INVALIDO'
      | 'NO_ENCONTRADO'
      | 'SIN_PERMISO'
      | 'REGLA_NEGOCIO',
  ) {
    super(message)
    this.name = 'PatchRecorridoError'
  }
}

export class ConflictoVersionRecorrido extends Error {
  readonly code = 'VERSION_CONFLICT'
  constructor(
    readonly entityId: string,
    readonly serverRow: Record<string, unknown> | null,
  ) {
    super('La fila cambió mientras la editabas')
    this.name = 'ConflictoVersionRecorrido'
  }
}

export interface ResultadoPatchRecorrido {
  version: number
  /**
   * Campos que el servidor derivó y el cliente debe repintar.
   *
   * Incluye el propio campo cuando el valor guardado no es el tecleado: «7:30»
   * se guarda como «07:30» y «6 horas» como 6. Sin el eco, la celda se quedaba
   * con el texto crudo hasta la siguiente recarga, y el formato numérico de la
   * columna de horas no se aplicaba a una cadena.
   */
  derivados: Record<string, unknown>
  /**
   * Otras filas del canvas que cambiaron con este patch y hay que repintar
   * con los mismos `derivados`. Solo lo llena mover la FECHA: la fecha es del
   * día, y los demás recorridos de esa jornada se mueven con ella.
   */
  afectados?: string[]
}

export class RecorridosPatchService {
  /**
   * ¿Puede este actor escribir en el canvas?
   *
   * Se resuelve con el mismo `checkAccess` que usa `requirePermission`, para
   * que la regla viva en un único sitio y el socket no pueda quedar más
   * permisivo que la API REST.
   */
  static async puedeEditar(actor: {
    id: string
    area?: string | string[] | null
    role?: string | null
  }): Promise<boolean> {
    const areas = (!actor.area
      ? []
      : Array.isArray(actor.area)
        ? actor.area
        : [actor.area]) as Area[]
    const override = await obtenerPermisosRutas(actor.id)
    const { level } = checkAccess(actor.role ?? null, areas, 'recorridos', override)
    return level === 'full'
  }

  /**
   * ¿Puede además marcar bonos?
   *
   * `bonos-planilla` es un permiso INDIVIDUAL guardado en el JSON `permisos`
   * del usuario, independiente del área, y el JWT del socket no siempre lo
   * trae, así que se lee de la base.
   */
  static async puedeMarcarBonos(actorId: string): Promise<boolean> {
    const u = await prisma.usuarios.findUnique({
      where: { id: actorId },
      select: { permisos: true },
    })
    const permisos = (u?.permisos as Record<string, boolean> | null) ?? {}
    return permisos['bonos-planilla'] === true
  }

  /**
   * Traduce un fallo de reglas en el error que el gateway sabe mapear.
   *
   * `recorridos-reglas` no conoce `PatchRecorridoError` a propósito —es un
   * módulo puro, sin dependencias del transporte—, así que la conversión se
   * hace aquí, en la frontera.
   */
  private static conReglas<T>(fn: () => T): T {
    try {
      return fn()
    } catch (e) {
      if (e instanceof ValorInvalido) throw new PatchRecorridoError(e.message, e.code)
      throw e
    }
  }

  static async aplicar(opts: {
    tipoFila: 'segmento' | 'dia'
    entityId: string
    campo: string
    valor: unknown
    baseVersion: number | null
    actor: { id: string; area?: string | string[] | null; role?: string | null }
  }): Promise<ResultadoPatchRecorrido> {
    const { tipoFila, entityId, campo, valor, baseVersion, actor } = opts

    if (!(await this.puedeEditar(actor))) {
      throw new PatchRecorridoError(
        'Solo Administración y Operaciones pueden modificar recorridos. Tu acceso es de consulta.',
        'SIN_PERMISO',
      )
    }

    if (campo.startsWith(PREFIJO_BONO)) {
      return this.aplicarBono({
        tipoFila,
        entityId,
        configId: campo.slice(PREFIJO_BONO.length),
        valor,
        baseVersion,
        actor,
      })
    }

    return tipoFila === 'segmento'
      ? this.aplicarSegmento({ segmentoId: entityId, campo, valor, baseVersion })
      : this.aplicarDia({ registroDiaId: entityId, campo, valor, baseVersion })
  }

  // ── Segmento (el recorrido) ──────────────────────────────────────────────

  private static async aplicarSegmento(opts: {
    segmentoId: string
    campo: string
    valor: unknown
    baseVersion: number | null
  }): Promise<ResultadoPatchRecorrido> {
    const { segmentoId, campo, valor, baseVersion } = opts
    const coercion = CAMPOS_SEGMENTO[campo]
    if (!coercion) {
      throw new PatchRecorridoError(
        `El campo "${campo}" no es editable en una fila de recorrido.`,
        'CAMPO_NO_EDITABLE',
      )
    }

    const actual = await prisma.registro_dia_laboral_segmento.findFirst({
      where: { id: segmentoId, deleted_at: null },
      select: {
        id: true,
        version: true,
        hora_inicio: true,
        hora_fin: true,
        pernocte: true,
        km_inicial: true,
        km_final: true,
      },
    })
    if (!actual) {
      throw new PatchRecorridoError('El recorrido ya no existe o fue eliminado.', 'NO_ENCONTRADO')
    }

    const data: Record<string, unknown> = {}
    const derivados: Record<string, unknown> = {}

    // Antes de resolver nada: vaciar una placa o un horario no es una edición
    // válida, y en cotransmeq además viola un NOT NULL.
    this.conReglas(() => exigirNoVacio(campo, valor))

    if (campo === 'fecha') {
      return this.moverDia({
        tipoFila: 'segmento',
        entityId: segmentoId,
        fecha: this.conReglas(() => normalizar(campo, valor, coercion)) as string,
        baseVersion,
      })
    }

    if (campo === 'cliente_nombre') {
      const { id, nombre } = await this.resolverCliente(valor)
      data.cliente_id = id
      data.cliente_nombre = nombre
      derivados.cliente_id = id
      derivados.cliente_nombre = nombre
    } else if (campo === 'vehiculo_placa') {
      const { id, placa } = await this.resolverVehiculo(valor)
      data.vehiculo_id = id
      data.vehiculo_placa = placa
      derivados.vehiculo_id = id
      derivados.vehiculo_placa = placa
    } else {
      data[campo] = this.conReglas(() => normalizar(campo, valor, coercion))
      if (data[campo] !== valor) derivados[campo] = data[campo]
    }

    // Se valida contra la fila RESULTANTE (lo que ya había más lo que se está
    // escribiendo), no solo contra el valor nuevo: cambiar la hora de fin puede
    // ser válido o no según la de inicio que ya estaba guardada.
    this.conReglas(() =>
      validarCoherencia({
        hora_inicio: (data.hora_inicio as string | null) ?? actual.hora_inicio,
        hora_fin: (data.hora_fin as string | null) ?? actual.hora_fin,
        pernocte: (data.pernocte as boolean | undefined) ?? actual.pernocte,
        km_inicial: (data.km_inicial as number | null | undefined) ?? actual.km_inicial,
        km_final: (data.km_final as number | null | undefined) ?? actual.km_final,
      }),
    )

    // `updateMany` y no `update`: `update` por id no admite condicionar por
    // versión, y sin esa condición no hay compare-and-swap.
    const gano = await prisma.registro_dia_laboral_segmento.updateMany({
      where: { id: segmentoId, ...(baseVersion != null ? { version: baseVersion } : {}) },
      data: { ...data, version: { increment: 1 }, updated_at: new Date() } as never,
    })

    if (gano.count === 0) {
      throw new ConflictoVersionRecorrido(segmentoId, await this.filaSegmento(segmentoId))
    }

    const fresco = await this.filaSegmento(segmentoId)
    return { version: Number(fresco?.version ?? 0), derivados }
  }

  // ── Día sin recorridos ───────────────────────────────────────────────────

  private static async aplicarDia(opts: {
    registroDiaId: string
    campo: string
    valor: unknown
    baseVersion: number | null
  }): Promise<ResultadoPatchRecorrido> {
    const { registroDiaId, campo, valor, baseVersion } = opts
    const coercion = CAMPOS_DIA[campo]
    if (!coercion) {
      throw new PatchRecorridoError(
        `El campo "${campo}" no es editable en una fila de día.`,
        'CAMPO_NO_EDITABLE',
      )
    }

    const existe = await prisma.registro_dia_laboral.findFirst({
      where: { id: registroDiaId, deleted_at: null },
      select: { id: true },
    })
    if (!existe) {
      throw new PatchRecorridoError('El día ya no existe o fue eliminado.', 'NO_ENCONTRADO')
    }

    if (campo === 'fecha') {
      return this.moverDia({
        tipoFila: 'dia',
        entityId: registroDiaId,
        fecha: this.conReglas(() => normalizar(campo, valor, coercion)) as string,
        baseVersion,
      })
    }

    // `tipo_dia` es el nombre de la columna en el canvas; en la tabla es `tipo`.
    const columna = campo === 'tipo_dia' ? 'tipo' : campo
    const normalizado = this.conReglas(() => normalizar(campo, valor, coercion))
    const data: Record<string, unknown> = { [columna]: normalizado }
    const derivados: Record<string, unknown> = normalizado !== valor ? { [campo]: normalizado } : {}

    const gano = await prisma.registro_dia_laboral.updateMany({
      where: { id: registroDiaId, ...(baseVersion != null ? { version: baseVersion } : {}) },
      data: { ...data, version: { increment: 1 }, updated_at: new Date() } as never,
    })
    if (gano.count === 0) {
      throw new ConflictoVersionRecorrido(registroDiaId, await this.filaDia(registroDiaId))
    }

    const fresco = await this.filaDia(registroDiaId)
    return { version: Number(fresco?.version ?? 0), derivados }
  }

  // ── Fecha: mover el día ──────────────────────────────────────────────────

  /**
   * Cambia la FECHA de un día. Se mueve la jornada entera —todos sus tramos y
   * sus bonos van con ella—, porque la fecha es del día y no del tramo.
   *
   * El destino tiene que estar libre: `(conductor_id, fecha)` es único y la
   * unicidad incluye los días retirados, que conservan su fecha para poder
   * revivirlos. Un destino ocupado, vivo o retirado, se rechaza con la
   * instrucción de qué hacer en vez de fundir dos días a ciegas.
   *
   * El CAS se hace sobre la ENTIDAD de la fila editada (el segmento o el día),
   * que es la versión que el cliente conoce; la versión del padre se sube
   * aparte para que los demás clientes con ese día abierto detecten el cambio.
   */
  private static async moverDia(opts: {
    tipoFila: 'segmento' | 'dia'
    entityId: string
    fecha: string
    baseVersion: number | null
  }): Promise<ResultadoPatchRecorrido> {
    const { tipoFila, entityId, fecha, baseVersion } = opts

    this.conReglas(() => exigirNoFutura(fecha, hoyISO()))

    const registroDiaId = tipoFila === 'segmento' ? await this.diaDeSegmento(entityId) : entityId
    const dia = await prisma.registro_dia_laboral.findFirst({
      where: { id: registroDiaId, deleted_at: null },
      select: {
        id: true,
        conductor_id: true,
        fecha: true,
        segmentos: { where: { deleted_at: null }, select: { id: true } },
      },
    })
    if (!dia) {
      throw new PatchRecorridoError('El día ya no existe o fue eliminado.', 'NO_ENCONTRADO')
    }

    const fechaActual = dia.fecha.toISOString().slice(0, 10)
    if (fechaActual === fecha) {
      const fresco = tipoFila === 'segmento' ? await this.filaSegmento(entityId) : await this.filaDia(entityId)
      return { version: Number(fresco?.version ?? 0), derivados: {} }
    }

    const ocupado = await prisma.registro_dia_laboral.findUnique({
      where: { conductor_id_fecha: { conductor_id: dia.conductor_id, fecha: this.aDate(fecha) } },
      select: { id: true, deleted_at: true },
    })
    if (ocupado) {
      throw new PatchRecorridoError(
        ocupado.deleted_at
          ? `El ${fecha} tiene un registro retirado de este conductor. Inserta una fila nueva con esa ` +
              `fecha (la revive) y elimina esta, en vez de moverla.`
          : `Este conductor ya tiene una fila el ${fecha}. Edita esa fila, o elimínala antes de mover esta.`,
        'REGLA_NEGOCIO',
      )
    }

    const version = await prisma.$transaction(async (tx) => {
      const gano =
        tipoFila === 'segmento'
          ? await tx.registro_dia_laboral_segmento.updateMany({
              where: { id: entityId, ...(baseVersion != null ? { version: baseVersion } : {}) },
              data: { version: { increment: 1 }, updated_at: new Date() } as never,
            })
          : await tx.registro_dia_laboral.updateMany({
              where: { id: entityId, ...(baseVersion != null ? { version: baseVersion } : {}) },
              data: { version: { increment: 1 }, updated_at: new Date() } as never,
            })
      if (gano.count === 0) return null

      await tx.registro_dia_laboral.update({
        where: { id: registroDiaId },
        data: {
          fecha: this.aDate(fecha),
          updated_at: new Date(),
          // El padre también sube de versión cuando la fila editada es un
          // tramo: las filas de día de otros clientes versionan por el padre.
          ...(tipoFila === 'segmento' ? { version: { increment: 1 } } : {}),
        } as never,
      })

      const fresco =
        tipoFila === 'segmento'
          ? await tx.registro_dia_laboral_segmento.findUnique({
              where: { id: entityId },
              select: { version: true },
            })
          : await tx.registro_dia_laboral.findUnique({
              where: { id: entityId },
              select: { version: true },
            })
      return fresco?.version ?? 0
    })

    if (version == null) {
      const serverRow =
        tipoFila === 'segmento' ? await this.filaSegmento(entityId) : await this.filaDia(entityId)
      throw new ConflictoVersionRecorrido(entityId, serverRow)
    }

    // Los otros tramos de la jornada se movieron con ella: el canvas los
    // repinta con la misma fecha. La propia fila no va en la lista.
    const afectados = dia.segmentos.map((s) => s.id).filter((id) => id !== entityId)
    return { version, derivados: { fecha }, afectados }
  }

  // ── Filas nuevas y retiradas ─────────────────────────────────────────────

  /**
   * Da de alta una fila insertada en el canvas.
   *
   * Es el mismo modelo que el guardado del portal del conductor —un día por
   * `(conductor, fecha)` que se REVIVE si estaba retirado, y un segmento por
   * recorrido—, pero de una fila en una: el canvas no reemplaza el día entero,
   * añade un tramo o un día donde no lo había.
   *
   * Devuelve la fila tal y como la pintaría el libro, para vincularla a la
   * fila insertada sin recargar. `recargar` avisa de que el cambio va más allá
   * de esa fila: un día DISPONIBLE que recibe su primer recorrido pasa a
   * LABORADO y su antigua fila de día ya no existe.
   */
  static async crearFila(opts: {
    conductorId: string
    corte: { desde: string; hasta: string }
    entrada: FilaNuevaEntrada & { bonos?: string[] }
    actor: { id: string; area?: string | string[] | null; role?: string | null }
  }): Promise<{ fila: FilaRecorrido; recargar: boolean }> {
    const { conductorId, corte, entrada, actor } = opts

    if (!(await this.puedeEditar(actor))) {
      throw new PatchRecorridoError(
        'Solo Administración y Operaciones pueden modificar recorridos. Tu acceso es de consulta.',
        'SIN_PERMISO',
      )
    }

    const conductor = await prisma.conductores.findFirst({
      where: { id: conductorId },
      select: { id: true },
    })
    if (!conductor) throw new PatchRecorridoError('El conductor no existe.', 'NO_ENCONTRADO')

    const fila = this.conReglas(() => clasificarFilaNueva(entrada))
    this.conReglas(() => exigirDentroDelCorte(fila.fecha, corte))
    this.conReglas(() => exigirNoFutura(fila.fecha, hoyISO()))

    const bonosPedidos = [...new Set((entrada.bonos ?? []).map(String).filter(Boolean))]
    if (bonosPedidos.length && !(await this.puedeMarcarBonos(actor.id))) {
      throw new PatchRecorridoError(
        'No tienes el permiso individual "bonos-planilla" para marcar bonos en la fila nueva.',
        'SIN_PERMISO',
      )
    }

    const vehiculo = fila.vehiculo_placa ? await this.resolverVehiculo(fila.vehiculo_placa) : null
    const cliente =
      fila.clase === 'recorrido' && fila.cliente_nombre
        ? await this.resolverCliente(fila.cliente_nombre)
        : null

    const fechaDate = this.aDate(fila.fecha)
    const ahora = new Date()

    const resultado = await prisma.$transaction(async (tx) => {
      const existente = await tx.registro_dia_laboral.findUnique({
        where: { conductor_id_fecha: { conductor_id: conductorId, fecha: fechaDate } },
        select: {
          id: true,
          tipo: true,
          deleted_at: true,
          segmentos: { where: { deleted_at: null }, select: { id: true, orden: true } },
        },
      })

      let recargar = false
      let registroDiaId: string

      if (existente && !existente.deleted_at) {
        if (fila.clase === 'dia') {
          throw new PatchRecorridoError(
            `Este conductor ya tiene una fila el ${fila.fecha}. Edita esa fila en vez de insertar otra; ` +
              `si quieres añadir un recorrido ese día, escribe placa y horario en la fila nueva.`,
            'REGLA_NEGOCIO',
          )
        }
        registroDiaId = existente.id
        if (existente.tipo !== 'LABORADO') {
          // Un día sin recorridos que recibe el primero: su fila de día
          // desaparece del libro y en su lugar queda el recorrido.
          await tx.registro_dia_laboral.update({
            where: { id: existente.id },
            data: { tipo: 'LABORADO', mantenimiento_vehiculo_id: null, mantenimiento_vehiculo_placa: null, version: { increment: 1 }, updated_at: ahora } as never,
          })
          recargar = true
        }
      } else if (existente) {
        // Retirado: se REVIVE con lo tecleado, como hace el portal. Sus tramos y
        // bonos retirados siguen retirados; solo vuelve el padre.
        registroDiaId = existente.id
        await tx.registro_dia_laboral.update({
          where: { id: existente.id },
          data: {
            deleted_at: null,
            tipo: fila.clase === 'recorrido' ? 'LABORADO' : fila.tipo_dia,
            observaciones: fila.clase === 'dia' ? fila.observaciones : null,
            pernocte: fila.clase === 'dia' ? fila.pernocte : false,
            mantenimiento_vehiculo_id: fila.clase === 'dia' && fila.tipo_dia === 'MANTENIMIENTO' ? vehiculo?.id : null,
            mantenimiento_vehiculo_placa: fila.clase === 'dia' && fila.tipo_dia === 'MANTENIMIENTO' ? vehiculo?.placa : null,
            version: { increment: 1 },
            updated_at: ahora,
          } as never,
        })
      } else {
        const creado = await tx.registro_dia_laboral.create({
          data: {
            id: randomUUID(),
            conductor_id: conductorId,
            fecha: fechaDate,
            tipo: fila.clase === 'recorrido' ? 'LABORADO' : fila.tipo_dia,
            observaciones: fila.clase === 'dia' ? fila.observaciones : null,
            pernocte: fila.clase === 'dia' ? fila.pernocte : false,
            mantenimiento_vehiculo_id: fila.clase === 'dia' && fila.tipo_dia === 'MANTENIMIENTO' ? vehiculo?.id ?? null : null,
            mantenimiento_vehiculo_placa: fila.clase === 'dia' && fila.tipo_dia === 'MANTENIMIENTO' ? vehiculo?.placa ?? null : null,
          } as never,
          select: { id: true },
        })
        registroDiaId = creado.id
      }

      let segmentoId: string | null = null
      if (fila.clase === 'recorrido') {
        const orden =
          (existente && !existente.deleted_at
            ? Math.max(0, ...existente.segmentos.map((s) => s.orden))
            : 0) + 1
        const seg = await tx.registro_dia_laboral_segmento.create({
          data: {
            id: randomUUID(),
            registro_dia_id: registroDiaId,
            cliente_id: cliente?.id ?? null,
            cliente_nombre: cliente?.nombre ?? null,
            vehiculo_id: vehiculo?.id ?? null,
            vehiculo_placa: vehiculo?.placa ?? fila.vehiculo_placa,
            hora_inicio: fila.hora_inicio,
            hora_fin: fila.hora_fin,
            horas_conducidas: fila.horas_conducidas,
            km_inicial: fila.km_inicial,
            km_final: fila.km_final,
            pernocte: fila.pernocte,
            orden,
            observaciones: fila.observaciones,
          } as never,
          select: { id: true },
        })
        segmentoId = seg.id
      }

      if (bonosPedidos.length) {
        const configs = await tx.configuraciones_liquidacion.findMany({
          where: { id: { in: bonosPedidos }, activo: true, deleted_at: null },
          select: { id: true, valor: true },
        })
        for (const c of configs) {
          await tx.registro_dia_laboral_bono.create({
            data: {
              registro_dia_id: registroDiaId,
              segmento_id: segmentoId,
              config_liquidacion_id: c.id,
              valor: c.valor,
              creado_por_id: actor.id,
            },
          })
        }
      }

      return { registroDiaId, segmentoId, recargar }
    })

    const construida = await RecorridosCanvasService.construirFila(
      resultado.segmentoId
        ? { tipoFila: 'segmento', entityId: resultado.segmentoId }
        : { tipoFila: 'dia', entityId: resultado.registroDiaId },
    )
    if (!construida) {
      throw new PatchRecorridoError('La fila se guardó pero no se pudo releer.', 'NO_ENCONTRADO')
    }
    return { fila: construida, recargar: resultado.recargar }
  }

  /**
   * Retira una fila eliminada en el canvas (soft delete).
   *
   * Un recorrido se retira con sus bonos. Si era el ÚLTIMO recorrido de un día
   * LABORADO, se retira también el día: dejarlo sería un día laborado sin
   * trabajo, que en la siguiente recarga aparecería como una fila fantasma que
   * el usuario ya había borrado.
   */
  static async eliminarFila(opts: {
    tipoFila: 'segmento' | 'dia'
    entityId: string
    baseVersion: number | null
    actor: { id: string; area?: string | string[] | null; role?: string | null }
  }): Promise<{ eliminado: 'segmento' | 'dia'; registro_dia_id: string }> {
    const { tipoFila, entityId, baseVersion, actor } = opts

    if (!(await this.puedeEditar(actor))) {
      throw new PatchRecorridoError(
        'Solo Administración y Operaciones pueden modificar recorridos. Tu acceso es de consulta.',
        'SIN_PERMISO',
      )
    }

    if (tipoFila === 'dia') {
      const dia = await prisma.registro_dia_laboral.findFirst({
        where: { id: entityId, deleted_at: null },
        select: { id: true, version: true },
      })
      if (!dia) throw new PatchRecorridoError('El día ya no existe o fue eliminado.', 'NO_ENCONTRADO')
      if (baseVersion != null && dia.version !== baseVersion) {
        throw new ConflictoVersionRecorrido(entityId, await this.filaDia(entityId))
      }
      await retirarDiaLaboral(entityId)
      return { eliminado: 'dia', registro_dia_id: entityId }
    }

    const seg = await prisma.registro_dia_laboral_segmento.findFirst({
      where: { id: entityId, deleted_at: null },
      select: {
        id: true,
        version: true,
        registro_dia_id: true,
        registro_dia: {
          select: { tipo: true, segmentos: { where: { deleted_at: null }, select: { id: true } } },
        },
      },
    })
    if (!seg) throw new PatchRecorridoError('El recorrido ya no existe o fue eliminado.', 'NO_ENCONTRADO')
    if (baseVersion != null && seg.version !== baseVersion) {
      throw new ConflictoVersionRecorrido(entityId, await this.filaSegmento(entityId))
    }

    const eraElUltimo = seg.registro_dia.segmentos.every((s) => s.id === entityId)
    if (eraElUltimo && seg.registro_dia.tipo === 'LABORADO') {
      await retirarDiaLaboral(seg.registro_dia_id)
      return { eliminado: 'dia', registro_dia_id: seg.registro_dia_id }
    }

    const ahora = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.registro_dia_laboral_bono.updateMany({
        where: { segmento_id: entityId, deleted_at: null },
        data: { deleted_at: ahora },
      })
      await tx.registro_dia_laboral_segmento.updateMany({
        where: { id: entityId, deleted_at: null },
        data: { deleted_at: ahora, updated_at: ahora },
      })
    })
    return { eliminado: 'segmento', registro_dia_id: seg.registro_dia_id }
  }

  /** `YYYY-MM-DD` → `Date` UTC a medianoche, que es como se guarda `@db.Date`. */
  private static aDate(fecha: string): Date {
    return new Date(`${fecha}T00:00:00.000Z`)
  }

  // ── Bonos ────────────────────────────────────────────────────────────────

  /**
   * Marca o desmarca un bono.
   *
   * No hay `UPDATE` de un bono: marcar CREA la fila y desmarcar la soft-borra.
   * La versión que protege la operación es la de la fila del canvas (segmento o
   * día), no la del bono: así dos usuarios marcando casillas distintas de la
   * misma fila no se pisan en silencio.
   */
  private static async aplicarBono(opts: {
    tipoFila: 'segmento' | 'dia'
    entityId: string
    configId: string
    valor: unknown
    baseVersion: number | null
    actor: { id: string }
  }): Promise<ResultadoPatchRecorrido> {
    const { tipoFila, entityId, configId, valor, baseVersion, actor } = opts

    if (!(await this.puedeMarcarBonos(actor.id))) {
      throw new PatchRecorridoError(
        'No tienes el permiso individual "bonos-planilla". Solicita a un administrador que lo ' +
          'habilite en tu usuario desde la página de Usuarios.',
        'SIN_PERMISO',
      )
    }

    const marcar = aBooleano(valor)

    const config = await prisma.configuraciones_liquidacion.findFirst({
      where: { id: configId, activo: true, deleted_at: null },
      select: { id: true, valor: true, nombre: true },
    })
    if (!config) {
      throw new PatchRecorridoError(
        'Ese bono ya no está activo en la configuración de liquidación.',
        'NO_ENCONTRADO',
      )
    }

    const registroDiaId =
      tipoFila === 'segmento' ? await this.diaDeSegmento(entityId) : entityId
    const segmentoId = tipoFila === 'segmento' ? entityId : null

    const version = await prisma.$transaction(async (tx) => {
      // El CAS va primero: si la fila cambió, no se toca el bono.
      const gano =
        tipoFila === 'segmento'
          ? await tx.registro_dia_laboral_segmento.updateMany({
              where: { id: entityId, ...(baseVersion != null ? { version: baseVersion } : {}) },
              data: { version: { increment: 1 }, updated_at: new Date() } as never,
            })
          : await tx.registro_dia_laboral.updateMany({
              where: { id: entityId, ...(baseVersion != null ? { version: baseVersion } : {}) },
              data: { version: { increment: 1 }, updated_at: new Date() } as never,
            })

      if (gano.count === 0) return null

      if (marcar) {
        const yaEsta = await tx.registro_dia_laboral_bono.findFirst({
          where: {
            registro_dia_id: registroDiaId,
            segmento_id: segmentoId,
            config_liquidacion_id: configId,
            deleted_at: null,
          },
          select: { id: true },
        })
        if (!yaEsta) {
          await tx.registro_dia_laboral_bono.create({
            data: {
              registro_dia_id: registroDiaId,
              segmento_id: segmentoId,
              config_liquidacion_id: configId,
              // Snapshot informativo. El valor que se paga se lee siempre en
              // vivo de la configuración, así que este campo no es la fuente
              // de cálculo.
              valor: config.valor,
              creado_por_id: actor.id,
            },
          })
        }
      } else {
        await tx.registro_dia_laboral_bono.updateMany({
          where: {
            registro_dia_id: registroDiaId,
            segmento_id: segmentoId,
            config_liquidacion_id: configId,
            deleted_at: null,
          },
          data: { deleted_at: new Date() },
        })
      }

      const fresco =
        tipoFila === 'segmento'
          ? await tx.registro_dia_laboral_segmento.findUnique({
              where: { id: entityId },
              select: { version: true },
            })
          : await tx.registro_dia_laboral.findUnique({
              where: { id: entityId },
              select: { version: true },
            })
      return fresco?.version ?? 0
    })

    if (version == null) {
      const serverRow =
        tipoFila === 'segmento'
          ? await this.filaSegmento(entityId)
          : await this.filaDia(entityId)
      throw new ConflictoVersionRecorrido(entityId, serverRow)
    }

    return { version, derivados: { [`bono:${configId}`]: marcar } }
  }

  // ── Auxiliares ───────────────────────────────────────────────────────────

  private static async diaDeSegmento(segmentoId: string): Promise<string> {
    const s = await prisma.registro_dia_laboral_segmento.findFirst({
      where: { id: segmentoId, deleted_at: null },
      select: { registro_dia_id: true },
    })
    if (!s) {
      throw new PatchRecorridoError('El recorrido ya no existe o fue eliminado.', 'NO_ENCONTRADO')
    }
    return s.registro_dia_id
  }

  private static filaSegmento(id: string) {
    return prisma.registro_dia_laboral_segmento.findUnique({
      where: { id },
      select: {
        version: true,
        cliente_nombre: true,
        vehiculo_placa: true,
        hora_inicio: true,
        hora_fin: true,
        horas_conducidas: true,
        km_inicial: true,
        km_final: true,
        pernocte: true,
        observaciones: true,
      },
    })
  }

  private static filaDia(id: string) {
    return prisma.registro_dia_laboral.findUnique({
      where: { id },
      select: { version: true, tipo: true, observaciones: true, pernocte: true },
    })
  }

  /**
   * Texto de la celda → cliente.
   *
   * El usuario teclea un nombre, no un UUID. Se busca por igualdad
   * insensible a mayúsculas y, si no hay match exacto, se rechaza en vez de
   * adivinar: elegir el primer parecido acabaría asignando servicios al
   * cliente equivocado sin que nadie lo note.
   */
  private static async resolverCliente(valor: unknown) {
    const texto = aTexto(valor)
    if (!texto) return { id: null, nombre: null }

    const exactos = await prisma.clientes.findMany({
      where: { nombre: { equals: texto, mode: 'insensitive' }, deletedAt: null },
      select: { id: true, nombre: true },
      take: 2,
    })
    if (exactos.length === 1) return { id: exactos[0].id, nombre: exactos[0].nombre }
    if (exactos.length > 1) {
      throw new PatchRecorridoError(
        `Hay más de un cliente llamado "${texto}". Corrige el nombre para que sea inequívoco.`,
        'VALOR_INVALIDO',
      )
    }
    throw new PatchRecorridoError(
      `No existe un cliente llamado "${texto}". Revisa el nombre o créalo primero.`,
      'VALOR_INVALIDO',
    )
  }

  /** Texto de la celda → vehículo, por placa. */
  private static async resolverVehiculo(valor: unknown) {
    const texto = aTexto(valor)
    if (!texto) return { id: null, placa: null }

    const placa = texto.toUpperCase().replace(/\s+/g, '')
    const v = await prisma.vehiculos.findFirst({
      where: { placa: { equals: placa, mode: 'insensitive' }, deleted_at: null },
      select: { id: true, placa: true },
    })
    if (!v) {
      throw new PatchRecorridoError(
        `No existe un vehículo con placa "${placa}". Regístralo en Flota antes de usarlo en un recorrido.`,
        'VALOR_INVALIDO',
      )
    }
    return { id: v.id, placa: v.placa }
  }

}
