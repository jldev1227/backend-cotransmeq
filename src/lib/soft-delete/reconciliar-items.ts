/**
 * Reconciliación de los ítems de una liquidación de servicios.
 *
 * SUSTITUYE A `deleteMany` + `createMany`
 *
 * La edición y el autoguardado borraban TODOS los ítems y los recreaban. Eso
 * tenía dos consecuencias, y ninguna daba error:
 *
 *   1. Cada guardado destruía los ítems anteriores. Al eliminar la liquidación,
 *      la cascada se llevaba los que quedaban, y restaurarla devolvía una
 *      cabecera vacía.
 *   2. Un payload vacío —una pestaña que se cierra antes de hidratar, una
 *      respuesta que llega tarde, un fallo de red a medio cargar— borraba
 *      todos los ítems y no creaba ninguno.
 *
 * Aquí no se borra nada físicamente: se actualiza lo que sigue, se crea lo
 * nuevo, y lo que el cliente ya no manda se marca con `deleted_at`. Si un ítem
 * reaparece, se restaura en vez de duplicarse.
 *
 * CORRELACIÓN
 *
 * Por `id` primero y por `client_key` después. Nunca por posición: `orden`
 * cambia en cuanto alguien arrastra una fila, y emparejar por índice de array
 * mezclaría los datos de dos ítems distintos sin que nada fallara.
 *
 * Las filas anteriores a esta migración no tienen `client_key`; se
 * correlacionan por `id`, que es lo que el frontend ya manda para lo guardado.
 */

import type { Prisma } from '@prisma/client'

/** Lo que el cliente manda por cada ítem. */
export interface ItemEntrante {
  /** Id de servidor. Presente en los ítems que ya estaban guardados. */
  id?: string | null
  /** Identificador que pone el cliente a las filas nuevas. */
  client_key?: string | null
  [campo: string]: unknown
}

export interface ResultadoReconciliacion {
  actualizados: number
  creados: number
  eliminados: number
  restaurados: number
}

/** Error de dominio: la operación pedida no puede aplicarse. */
export class ReconciliacionVacia extends Error {
  readonly codigo = 'ITEMS_VACIOS_SOSPECHOSOS'
  constructor(mensaje: string) {
    super(mensaje)
    this.name = 'ReconciliacionVacia'
  }
}

export interface OpcionesReconciliacion {
  /**
   * Rechaza vaciar por completo una liquidación que tenía ítems.
   *
   * El autoguardado lo activa: un payload vacío casi nunca es «el usuario
   * borró todas las filas», es un estado a medio hidratar o una respuesta que
   * llegó tarde. Vaciar de verdad es una acción deliberada y pasa por la
   * edición explícita, que lo desactiva.
   */
  rechazarVaciadoTotal?: boolean
}

/**
 * Deja los ítems de `liquidacionId` igual a `entrantes`, sin borrar nada.
 *
 * Se ejecuta DENTRO de una transacción que abre quien llama: los ítems y los
 * totales de la cabecera tienen que cuadrar siempre, y si el guardado falla a
 * medias no debe quedar ni una cosa ni la otra.
 */
export async function reconciliarItems(
  tx: Prisma.TransactionClient,
  liquidacionId: string,
  entrantes: ItemEntrante[],
  opciones: OpcionesReconciliacion = {},
): Promise<ResultadoReconciliacion> {
  const existentes = await tx.liquidacion_servicio_item.findMany({
    where: { liquidacion_id: liquidacionId },
    select: { id: true, client_key: true, deleted_at: true },
  })

  const activos = existentes.filter((e) => e.deleted_at === null)

  /**
   * Guardia contra el vaciado accidental.
   *
   * Se comprueba ANTES de tocar nada: si el cliente no manda ítems y había,
   * se rechaza la operación entera en vez de aplicarla a medias.
   */
  if (opciones.rechazarVaciadoTotal && entrantes.length === 0 && activos.length > 0) {
    throw new ReconciliacionVacia(
      `El autoguardado llegó sin ítems y la liquidación tiene ${activos.length}. ` +
        `No se aplica: casi siempre es un estado a medio cargar, no un borrado real.`,
    )
  }

  const porId = new Map(existentes.map((e) => [e.id, e]))
  const porClientKey = new Map(
    existentes.filter((e) => e.client_key).map((e) => [e.client_key as string, e]),
  )

  const vistos = new Set<string>()
  let actualizados = 0
  let creados = 0
  let restaurados = 0

  for (const [posicion, entrante] of entrantes.entries()) {
    const { id, client_key, ...campos } = entrante

    /// Por id, y si no por client_key. La posición NO participa.
    const existente =
      (id ? porId.get(id) : undefined) ??
      (client_key ? porClientKey.get(client_key) : undefined)

    if (existente) {
      vistos.add(existente.id)
      const revive = existente.deleted_at !== null

      await tx.liquidacion_servicio_item.update({
        where: { id: existente.id },
        data: {
          ...(campos as Prisma.liquidacion_servicio_itemUncheckedUpdateInput),
          orden: posicion,
          /// Si el ítem estaba marcado y vuelve a llegar, se restaura en vez de
          /// crear un duplicado que dejaría dos filas con los mismos datos.
          ...(revive ? { deleted_at: null } : {}),
          ...(client_key && !existente.client_key ? { client_key } : {}),
        },
      })

      if (revive) restaurados++
      else actualizados++
      continue
    }

    const creado = await tx.liquidacion_servicio_item.create({
      data: {
        ...(campos as Prisma.liquidacion_servicio_itemUncheckedCreateInput),
        liquidacion_id: liquidacionId,
        orden: posicion,
        client_key: client_key ?? null,
      },
      select: { id: true },
    })
    vistos.add(creado.id)
    creados++
  }

  /// Lo que estaba activo y ya no llega: se marca, no se borra. Es lo que
  /// permite que restaurar la liquidación lo devuelva todo.
  const retirados = activos.filter((a) => !vistos.has(a.id)).map((a) => a.id)

  let eliminados = 0
  if (retirados.length > 0) {
    const r = await tx.liquidacion_servicio_item.updateMany({
      where: { id: { in: retirados } },
      data: { deleted_at: new Date() },
    })
    eliminados = r.count
  }

  return { actualizados, creados, eliminados, restaurados }
}

/**
 * Suma los ítems ACTIVOS de una liquidación.
 *
 * Los totales de la cabecera se calculan solo con `deleted_at IS NULL`: incluir
 * los eliminados dejaría un total que no cuadra con ninguna de las filas que el
 * usuario ve, y esa diferencia aparecería en la facturación.
 */
export async function totalesDeItemsActivos(
  tx: Prisma.TransactionClient,
  liquidacionId: string,
): Promise<{ subtotal: number; cantidad: number }> {
  const agregado = await tx.liquidacion_servicio_item.aggregate({
    where: { liquidacion_id: liquidacionId, deleted_at: null },
    _sum: { valor_final: true },
    _count: { _all: true },
  })

  return {
    subtotal: Number(agregado._sum.valor_final ?? 0),
    cantidad: agregado._count._all,
  }
}
