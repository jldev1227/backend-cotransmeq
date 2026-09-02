/**
 * Catálogo de operadoras.
 *
 * Sustituye al `liquidacion_servicio.operadora` de texto libre. La regla que
 * gobierna todo este módulo es que el `codigo` va SIEMPRE normalizado
 * (mayúsculas, sin espacios sobrantes): es la clave con la que casan el
 * backfill del SQL, el seed y las altas de aquí. Si una de las tres normaliza
 * distinto, el backfill deja liquidaciones huérfanas y las altas duplican
 * códigos que solo difieren en un espacio.
 */

import { prisma } from '../../config/prisma'

/**
 * La misma normalización que `upper(btrim(...))` del SQL y que el seed.
 * Vive aquí y se importa, en vez de repetirse: repetirla es como divergen.
 */
export function normalizarCodigo(valor: string): string {
  return String(valor ?? '').trim().toUpperCase()
}

export interface DatosOperadora {
  codigo?: string
  nombre?: string
  activo?: boolean
  orden?: number
}

export const OperadorasService = {
  async listar(incluirInactivas = false) {
    return prisma.operadoras.findMany({
      where: incluirInactivas ? {} : { activo: true },
      orderBy: [{ orden: 'asc' }, { codigo: 'asc' }],
    })
  },

  async obtenerPorId(id: string) {
    const operadora = await prisma.operadoras.findUnique({ where: { id } })
    if (!operadora) throw new Error('Operadora no encontrada')
    return operadora
  },

  async crear(data: DatosOperadora) {
    const codigo = normalizarCodigo(data.codigo ?? '')
    if (!codigo) throw new Error('El código es obligatorio')

    const yaExiste = await prisma.operadoras.findUnique({ where: { codigo } })
    if (yaExiste) {
      /// Se distingue del error genérico para que el controlador pueda
      /// responder 409 y la interfaz decir cuál choca.
      const e: any = new Error(`Ya existe una operadora con el código ${codigo}`)
      e.codigoDuplicado = codigo
      throw e
    }

    return prisma.operadoras.create({
      data: {
        codigo,
        nombre: (data.nombre ?? '').trim() || codigo,
        activo: data.activo ?? true,
        orden: data.orden ?? 0,
      },
    })
  },

  async actualizar(id: string, data: DatosOperadora) {
    await this.obtenerPorId(id)

    /// El `codigo` se puede corregir, pero con la misma comprobación de choque
    /// que el alta: es la clave del backfill y de las liquidaciones ya escritas.
    const cambios: Record<string, unknown> = {}
    if (data.codigo !== undefined) {
      const codigo = normalizarCodigo(data.codigo)
      if (!codigo) throw new Error('El código no puede quedar vacío')
      const otra = await prisma.operadoras.findUnique({ where: { codigo } })
      if (otra && otra.id !== id) {
        const e: any = new Error(`Ya existe una operadora con el código ${codigo}`)
        e.codigoDuplicado = codigo
        throw e
      }
      cambios.codigo = codigo
    }
    if (data.nombre !== undefined) cambios.nombre = data.nombre.trim()
    if (data.activo !== undefined) cambios.activo = data.activo
    if (data.orden !== undefined) cambios.orden = data.orden

    return prisma.operadoras.update({ where: { id }, data: cambios })
  },

  /**
   * Borra la operadora, o la retira si ya está en uso.
   *
   * La FK es `ON DELETE RESTRICT` a propósito: una operadora con liquidaciones
   * no se borra nunca, porque vaciar ese dato en las liquidaciones históricas
   * sería perder a quién se le atribuyó el servicio. Retirarla la saca del
   * <select> y deja intactas las que ya la referencian.
   *
   * Se devuelve QUÉ se hizo para que la interfaz no diga «eliminada» cuando en
   * realidad la desactivó.
   */
  async eliminar(id: string) {
    await this.obtenerPorId(id)
    const enUso = await prisma.liquidacion_servicio.count({ where: { operadora_id: id } })

    if (enUso > 0) {
      const operadora = await prisma.operadoras.update({
        where: { id },
        data: { activo: false },
      })
      return { accion: 'desactivada' as const, liquidaciones: enUso, operadora }
    }

    await prisma.operadoras.delete({ where: { id } })
    return { accion: 'eliminada' as const, liquidaciones: 0 }
  },
}
