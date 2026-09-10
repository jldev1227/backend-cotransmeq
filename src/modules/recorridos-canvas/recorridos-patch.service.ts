import { prisma } from '../../config/prisma'
import { checkAccess, type Area } from '../../config/permissions'
import { obtenerPermisosRutas } from '../../services/permisos-rutas.service'
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
} from './recorridos-reglas'

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
  /** Campos que el servidor derivó y el cliente debe repintar. */
  derivados: Record<string, unknown>
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

    // `tipo_dia` es el nombre de la columna en el canvas; en la tabla es `tipo`.
    const columna = campo === 'tipo_dia' ? 'tipo' : campo
    const data: Record<string, unknown> = {
      [columna]: this.conReglas(() => normalizar(campo, valor, coercion)),
    }

    const gano = await prisma.registro_dia_laboral.updateMany({
      where: { id: registroDiaId, ...(baseVersion != null ? { version: baseVersion } : {}) },
      data: { ...data, version: { increment: 1 }, updated_at: new Date() } as never,
    })
    if (gano.count === 0) {
      throw new ConflictoVersionRecorrido(registroDiaId, await this.filaDia(registroDiaId))
    }

    const fresco = await this.filaDia(registroDiaId)
    return { version: Number(fresco?.version ?? 0), derivados: {} }
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
      select: { version: true, tipo: true, observaciones: true },
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
        `No existe un vehículo con placa "${placa}".`,
        'VALOR_INVALIDO',
      )
    }
    return { id: v.id, placa: v.placa }
  }

}
