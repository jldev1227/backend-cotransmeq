/**
 * Gateway de los canvas ANUALES (libro de 12 hojas, una por mes).
 *
 * Namespace propio `sheet:*`, deliberadamente separado de los eventos
 * `row:*` del gateway de cierres finales: aquel sigue sirviendo al canvas
 * individual, que está fuera del alcance de esta migración.
 *
 * PROTOCOLO
 *   C→S  sheet:join   { scope, anio, mes }
 *   C→S  sheet:leave  { scope, anio }
 *   C→S  sheet:active { scope, anio, mes }      (en qué mes está el usuario)
 *   C→S  sheet:patch  { scope, anio, mes, entity_type, entity_id, field,
 *                       value, base_version, epoch, request_id }
 *
 *   S→emisor  sheet:patch:ack      { request_id, entity_id, field, version, row }
 *   S→emisor  sheet:patch:conflict { request_id, entity_id, field, server_row }
 *   S→emisor  sheet:patch:error    { request_id, error }
 *   S→resto   sheet:patch:applied  { ...datos, by }   ← socket.to(), EXCLUYE al emisor
 *   S→todos   sheet:presence       { room, users }
 *
 * Room por AÑO (`sheet:${scope}:${anio}`), no por mes: la presencia es a
 * nivel de libro y así los avatares pueden indicar en qué mes está cada uno.
 *
 * CONCURRENCIA
 * `base_version` convierte cada patch en un compare-and-swap. Si el UPDATE no
 * afecta filas, otro usuario escribió antes y se responde `conflict` con el
 * valor actual del servidor, para que el cliente repinte en vez de perder el
 * dato.
 *
 * `epoch` protege las reversiones de snapshot (fase siguiente): una
 * reversión incrementa el epoch del periodo y todo patch en vuelo con el
 * epoch viejo se rechaza, en vez de reintroducir datos de antes de revertir.
 */

import { Server as IOServer, Socket } from 'socket.io'
import { getIo } from './index'
import { resolveActor, type SocketUser } from './auth'
import {
  LiquidacionesTercerosAdicionalesService,
  ConflictoVersionError,
} from '../modules/liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.service'
import { sheetRoomKey, SHEET_SCOPES, requiereMes, type SheetScope } from './sheet-rooms'
import {
  NominaPatchService,
  PatchNominaError,
  ConflictoVersionNomina,
} from '../modules/nomina-canvas/nomina-patch.service'
import { CanvasAnotacionesService } from '../modules/canvas-anotaciones/canvas-anotaciones.service'

/// Tipos de ancla de una anotación. Ver el docblock de `zona-libre.ts` en el
/// front: `fila` es distancia CON SIGNO al final del bloque estructurado y
/// `top` es fila absoluta de la cabecera, que no se desplaza.
const ANCLAS_VALIDAS: ReadonlySet<string> = new Set(['fila', 'item', 'clave', 'top'])
import {
  CierreFinalCeldasService,
  ConflictoVersionConcepto,
} from '../modules/liquidaciones-terceros-descuentos/cierre-final-celdas.service'

export type { SheetScope } from './sheet-rooms'
export { sheetRoomKey } from './sheet-rooms'

interface SheetUserInfo {
  userId: string
  userName: string
  mes: number | null
  /**
   * Hoja concreta que el usuario está mirando. Solo lo usan los canvas de
   * PERIODO (cierres finales), donde una hoja es una placa y saber quién
   * está en cuál es lo que hace útil la presencia.
   */
  sheetId: string | null
  joinedAt: string
}

interface SheetRoom {
  scope: SheetScope
  anio: number
  /** `null` en los scopes anuales, cuyo room es el año entero. */
  mes: number | null
  users: Map<string, SheetUserInfo>
}

const rooms = new Map<string, SheetRoom>()

/**
 * Epoch por (scope, anio, mes). Se incrementa al revertir un snapshot.
 * En memoria a propósito: es un guard de sesión, no un dato de negocio. Si el
 * proceso reinicia, todos los clientes reconectan y releen de todas formas.
 */
const epochs = new Map<string, number>()

function epochKey(scope: SheetScope, anio: number, mes: number): string {
  return `${scope}:${anio}:${mes}`
}

export function getEpoch(scope: SheetScope, anio: number, mes: number): number {
  return epochs.get(epochKey(scope, anio, mes)) ?? 0
}

/** Invalida los patches en vuelo de un periodo. Lo usa el revert de snapshots. */
export function bumpEpoch(scope: SheetScope, anio: number, mes: number): number {
  const k = epochKey(scope, anio, mes)
  const next = (epochs.get(k) ?? 0) + 1
  epochs.set(k, next)
  return next
}

function broadcastPresence(roomKey: string): void {
  const room = rooms.get(roomKey)
  if (!room) return
  const users = Array.from(room.users.values()).map((u) => ({
    id: u.userId,
    name: u.userName,
    mes: u.mes,
    sheetId: u.sheetId,
    joinedAt: u.joinedAt,
  }))
  getIo().to(roomKey).emit('sheet:presence', { room: roomKey, users })
}

function esScope(v: any): v is SheetScope {
  return SHEET_SCOPES.includes(v)
}

function anioValido(v: any): boolean {
  const n = Number(v)
  return Number.isInteger(n) && n >= 2000 && n <= 2100
}

function mesValido(v: any): boolean {
  const n = Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 12
}

export function registerSheetGateway(io: IOServer): void {
  io.on('connection', (socket: Socket) => {
    socket.on('sheet:join', ({ scope, anio, mes, sheet_id, user }: any) => {
      if (!esScope(scope) || !anioValido(anio)) return
      // Los scopes de PERIODO exigen mes; los anuales lo ignoran.
      if (requiereMes(scope) && !mesValido(mes)) return
      const actor = resolveActor(socket, user)
      if (!actor) return

      const mesNum = mesValido(mes) ? Number(mes) : null
      const roomKey = sheetRoomKey(scope, Number(anio), mesNum)
      socket.join(roomKey)

      if (!rooms.has(roomKey)) {
        rooms.set(roomKey, {
          scope,
          anio: Number(anio),
          mes: requiereMes(scope) ? mesNum : null,
          users: new Map(),
        })
      }
      rooms.get(roomKey)!.users.set(socket.id, {
        userId: actor.id,
        userName: actor.name,
        mes: mesNum,
        sheetId: typeof sheet_id === 'string' ? sheet_id : null,
        joinedAt: new Date().toISOString(),
      })

      broadcastPresence(roomKey)
      console.log(`[sheet] ${actor.name} entró a ${roomKey}`)
    })

    socket.on('sheet:leave', ({ scope, anio, mes }: any) => {
      if (!esScope(scope) || !anioValido(anio)) return
      if (requiereMes(scope) && !mesValido(mes)) return
      const roomKey = sheetRoomKey(scope, Number(anio), mesValido(mes) ? Number(mes) : null)
      socket.leave(roomKey)
      const room = rooms.get(roomKey)
      if (!room) return
      room.users.delete(socket.id)
      if (room.users.size === 0) rooms.delete(roomKey)
      else broadcastPresence(roomKey)
    })

    /// El usuario cambió de hoja. Solo actualiza presencia.
    ///
    /// En los canvas anuales la hoja ES el mes; en los de periodo el mes es
    /// fijo y lo que cambia es `sheet_id` (la placa).
    socket.on('sheet:active', ({ scope, anio, mes, sheet_id }: any) => {
      if (!esScope(scope) || !anioValido(anio) || !mesValido(mes)) return
      const roomKey = sheetRoomKey(scope, Number(anio), Number(mes))
      const info = rooms.get(roomKey)?.users.get(socket.id)
      if (!info) return
      info.mes = Number(mes)
      if (typeof sheet_id === 'string') info.sheetId = sheet_id
      broadcastPresence(roomKey)
    })

    socket.on('sheet:patch', async (payload: any) => {
      const requestId = payload?.request_id
      const responder = (evento: string, data: any) =>
        socket.emit(evento, { request_id: requestId, ...data })

      try {
        const { scope, anio, mes, entity_type, entity_id, field, value, base_version, epoch } =
          payload ?? {}

        if (!esScope(scope) || !anioValido(anio) || !mesValido(mes)) {
          return responder('sheet:patch:error', { error: 'scope/anio/mes inválidos' })
        }
        const actor = resolveActor(socket, payload?.user)
        if (!actor) {
          return responder('sheet:patch:error', { error: 'no autenticado' })
        }
        if (!entity_id || typeof field !== 'string') {
          return responder('sheet:patch:error', { error: 'entity_id y field son obligatorios' })
        }
        if (!Number.isInteger(Number(base_version))) {
          return responder('sheet:patch:error', { error: 'base_version obligatorio' })
        }

        // Guard de epoch: si alguien revirtió un snapshot de este periodo
        // mientras el patch iba en vuelo, aplicarlo reintroduciría un valor
        // de antes de la reversión.
        const epochActual = getEpoch(scope, Number(anio), Number(mes))
        if (epoch != null && Number(epoch) !== epochActual) {
          return responder('sheet:patch:conflict', {
            entity_id,
            field,
            reason: 'epoch',
            epoch: epochActual,
            server_row: null,
          })
        }

        // ── Anotación libre ───────────────────────────────────────────
        // Celda FUERA del bloque estructurado: no toca ninguna tabla de
        // negocio, solo la capa de anotaciones. Se resuelve antes del
        // despacho por scope porque funciona igual en los cuatro canvas.
        //
        // El `entity_id` viaja como
        // `<sheet_key>|<ancla_tipo>|<ancla_ref>|<offset>|<columna>`.
        //
        // La posición casi nunca es absoluta: es la distancia CON SIGNO al
        // final de la tabla de items (`fila`), el id del item al que la celda
        // está atada (`item`), o el nombre con que el builder la declara
        // (`clave`). Así lo escrito sobrevive a que la tabla crezca o se
        // reordene. La excepción es `top` —la cabecera por encima de la tabla,
        // que no se desplaza nunca— y ahí sí se guarda la fila absoluta.
        // El separador es `|` y no `:` porque el `ancla_ref` es un UUID, que no
        // contiene `|`.
        if (entity_type === 'anotacion') {
          const partes = String(entity_id).split('|')
          if (partes.length !== 5) {
            return responder('sheet:patch:error', {
              error:
                'entity_id de anotación debe ser <sheet_key>|<ancla_tipo>|<ancla_ref>|<offset>|<columna>',
            })
          }
          const [sheetKey, anclaTipo, anclaRef, offsetStr, colStr] = partes
          const offsetFila = Number(offsetStr)
          const columna = Number(colStr)
          if (!Number.isInteger(offsetFila) || !Number.isInteger(columna)) {
            return responder('sheet:patch:error', { error: 'offset/columna inválidos' })
          }
          if (!ANCLAS_VALIDAS.has(anclaTipo)) {
            return responder('sheet:patch:error', { error: 'ancla_tipo inválido' })
          }

          const res = await CanvasAnotacionesService.guardar({
            scope,
            anio: Number(anio),
            mes: Number(mes),
            sheet_key: sheetKey,
            ancla_tipo: anclaTipo,
            ancla_ref: anclaRef,
            offset_fila: offsetFila,
            columna,
            // `''` se guarda como null: vaciar la celda es borrar la nota.
            valor: value == null || value === '' ? null : String(value),
            base_version: Number(base_version),
            user_id: actor.id,
          })

          if (res.conflicto || !res.fila) {
            return responder('sheet:patch:conflict', {
              entity_id,
              field,
              reason: 'version',
              epoch: epochActual,
              server_row: null,
            })
          }

          responder('sheet:patch:ack', {
            entity_id,
            field,
            version: res.fila.version,
            row: res.fila,
          })

          socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
            scope,
            anio: Number(anio),
            mes: Number(mes),
            entity_type: 'anotacion',
            entity_id,
            field,
            value: res.fila.valor,
            version: res.fila.version,
            row: res.fila,
            epoch: epochActual,
            by: { id: actor.id, name: actor.name },
          })
          return
        }

        if (scope === 'adicionales') {
          const row = await LiquidacionesTercerosAdicionalesService.actualizarCampo({
            id: String(entity_id),
            field,
            value,
            base_version: Number(base_version),
            user_id: actor.id,
          })

          responder('sheet:patch:ack', {
            entity_id,
            field,
            version: row.version,
            row,
          })

          // `socket.to(...)` EXCLUYE al emisor. El gateway viejo usaba
          // `io.to(...)`, así que cada cliente recibía el eco de su propio
          // guardado y tenía que filtrarlo comparando ids en el cliente.
          socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
            scope,
            anio: Number(anio),
            mes: Number(mes),
            entity_type: entity_type ?? 'adicional',
            entity_id,
            field,
            value,
            version: row.version,
            row,
            epoch: epochActual,
            by: { id: actor.id, name: actor.name },
          })
          return
        }

        if (scope === 'cierres-finales') {
          if (!payload?.cierre_id) {
            return responder('sheet:patch:error', { error: 'cierre_id obligatorio' })
          }
          const tipo = entity_type ?? 'concepto'

          // ── Flags del pivote (aplica_impuestos / excluido) ──
          // Contrato distinto al de concepto: no hay `version` en
          // `liquidacion_tercero_final_item`, así que no hay
          // compare-and-swap. Para un booleano es asumible porque el servidor
          // difunde el estado resultante y los clientes convergen en él.
          if (tipo === 'item') {
            const res = await CierreFinalCeldasService.actualizarCampoItem({
              pivoteId: String(entity_id),
              field,
              value,
              user_id: actor.id,
            })

            responder('sheet:patch:ack', {
              entity_id,
              field,
              // Sin versión real: se devuelve la que mandó el cliente para
              // que no se quede con `undefined` y descarte el siguiente
              // cambio de esa misma fila.
              version: Number(base_version) || 1,
              rows: res.rows,
              items: res.items,
              totales: res.totales,
            })

            socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
              scope,
              anio: Number(anio),
              mes: Number(mes),
              cierre_id: payload.cierre_id,
              entity_type: 'item',
              entity_id,
              field,
              value,
              version: Number(base_version) || 1,
              rows: res.rows,
              items: res.items,
              totales: res.totales,
              epoch: epochActual,
              by: { id: actor.id, name: actor.name },
            })
            return
          }

          // ── Adicionales del cierre ──
          // En la hoja viven DENTRO de la tabla de items, para que un solo
          // `=SUM()` los totalice con las liquidaciones de servicio. En la
          // base son otra tabla, con su propio compare-and-swap, y editarlos
          // cascadea: entran en la base imponible, así que mueven los
          // impuestos y con ellos TOTAL DESCUENTOS y TOTAL A PAGAR.
          //
          // Antes esta rama no existía y se caía en el rechazo de abajo: las
          // celdas de adicional del canvas de cierres estaban bindeadas contra
          // un camino muerto y respondían «no soportado».
          if (tipo === 'adicional') {
            const res = await CierreFinalCeldasService.actualizarCampoAdicional({
              id: String(entity_id),
              field,
              value,
              base_version: Number(base_version),
              user_id: actor.id,
            })

            responder('sheet:patch:ack', {
              entity_id,
              field,
              version: res.version,
              rows: res.rows,
              row: res.adicional,
              totales: res.totales,
            })

            socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
              scope,
              anio: Number(anio),
              mes: Number(mes),
              cierre_id: payload.cierre_id,
              entity_type: 'adicional',
              entity_id,
              field,
              value,
              version: res.version,
              rows: res.rows,
              row: res.adicional,
              totales: res.totales,
              epoch: epochActual,
              by: { id: actor.id, name: actor.name },
            })
            return
          }

          if (tipo !== 'concepto') {
            return responder('sheet:patch:error', {
              error: `entity_type "${entity_type}" no soportado en cierres-finales`,
            })
          }

          const res = await CierreFinalCeldasService.actualizarCampoConcepto({
            id: String(entity_id),
            field,
            value,
            base_version: Number(base_version),
            user_id: actor.id,
          })

          // `rows` en PLURAL: editar los días de un salario cascadea a las
          // prestaciones y seguridad social de ese conductor, a DOTACION, a
          // EXAMEN_MEDICO y a GASTOS_DIVERSOS. Mandar solo la fila editada
          // dejaría el resto de la hoja con números viejos.
          responder('sheet:patch:ack', {
            entity_id,
            field,
            version: res.version,
            rows: res.rows,
            totales: res.totales,
          })

          socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
            scope,
            anio: Number(anio),
            mes: Number(mes),
            cierre_id: payload.cierre_id,
            entity_type: 'concepto',
            entity_id,
            field,
            value,
            version: res.version,
            rows: res.rows,
            totales: res.totales,
            epoch: epochActual,
            by: { id: actor.id, name: actor.name },
          })
          return
        }

        // ── Ingresos: la columna INCLUIR ──────────────────────────────
        //
        // RETRANSMISIÓN, NO ESCRITURA. Marcar INCLUIR mueve un servicio a la
        // hoja de ADICIONALES, y quien lo marca ya está guardando el mes
        // entero por HTTP (`guardar` reemplaza filas y conceptos en bloque).
        // Persistirlo también aquí sería una segunda escritura compitiendo
        // con ese reemplazo, y la última en llegar borraría a la otra.
        //
        // Lo que falta sin esto es solo la INMEDIATEZ: el resto de la sala no
        // ve aparecer el adicional hasta que recarga. Eso es lo que se
        // reenvía, con el mismo sobre que el resto de patches para que el
        // cliente no tenga que distinguir dos protocolos.
        if (scope === 'ingresos') {
          if (entity_type !== 'fila' || field !== 'incluir_adicional') {
            return responder('sheet:patch:error', {
              error: `en "ingresos" solo se retransmite fila.incluir_adicional`,
            })
          }
          responder('sheet:patch:ack', { entity_id, field, version: 0 })
          socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
            scope,
            anio: Number(anio),
            mes: Number(mes),
            entity_type: 'fila',
            entity_id,
            field,
            value: value === true,
            version: 0,
            epoch: epochActual,
            by: { id: actor.id, name: actor.name },
          })
          return
        }

        // NÓMINA. Solo se editan los campos que una persona teclea en el
        // desprendible; los recargos y las horas son derivados de las
        // planillas y el servicio los rechaza con lista blanca. Después de
        // cada cambio se recalculan los totales y se persisten, así que el
        // `applied` lleva ya las cifras buenas y el resto de la sala no
        // tiene que recalcular por su cuenta.
        if (scope === 'nomina') {
          if (entity_type !== 'liquidacion') {
            return responder('sheet:patch:error', {
              error: `en "nomina" solo se editan celdas de entity_type "liquidacion"`,
            })
          }

          const resultado = await NominaPatchService.aplicar({
            liquidacionId: String(entity_id),
            campo: String(field),
            valor: value,
            baseVersion: base_version == null ? null : Number(base_version),
            actorId: actor.id,
          })

          responder('sheet:patch:ack', {
            entity_id,
            field,
            version: resultado.version,
            totales: resultado.totales,
          })
          socket.to(sheetRoomKey(scope, Number(anio), Number(mes))).emit('sheet:patch:applied', {
            scope,
            anio: Number(anio),
            mes: Number(mes),
            entity_type: 'liquidacion',
            entity_id,
            field,
            value,
            version: resultado.version,
            totales: resultado.totales,
            epoch: epochActual,
            by: { id: actor.id, name: actor.name },
          })
          return
        }

        // TODO(ocasional): el PATCH por celda del ocasional entra cuando el
        // canvas deje de guardar la hoja completa. Hasta entonces persiste
        // por HTTP (`guardar-borrador`) con debounce por mes.
        return responder('sheet:patch:error', {
          error: `scope "${scope}" aún no soporta patch por celda`,
        })
      } catch (e: any) {
        if (e instanceof ConflictoVersionConcepto) {
          return responder('sheet:patch:conflict', {
            entity_id: e.entityId,
            field: payload?.field,
            reason: 'version',
            server_row: e.serverRow,
          })
        }
        if (e instanceof ConflictoVersionNomina) {
          return responder('sheet:patch:conflict', {
            entity_id: e.entityId,
            field: payload?.field,
            reason: 'version',
            server_row: e.serverRow,
          })
        }
        if (e instanceof PatchNominaError) {
          // Campo no editable, valor inválido o hoja bloqueada: es culpa del
          // cambio, no del servidor, y el mensaje ya está redactado para que
          // el usuario lo lea tal cual.
          return responder('sheet:patch:error', { error: e.message, code: e.code })
        }
        if (e instanceof ConflictoVersionError) {
          return responder('sheet:patch:conflict', {
            entity_id: e.entityId,
            field: payload?.field,
            reason: 'version',
            server_row: e.serverRow,
          })
        }
        console.error('[sheet] patch error:', e)
        return responder('sheet:patch:error', { error: e?.message || 'Error al aplicar el cambio' })
      }
    })

    socket.on('disconnect', () => {
      for (const [roomKey, room] of rooms.entries()) {
        if (!room.users.delete(socket.id)) continue
        if (room.users.size === 0) rooms.delete(roomKey)
        else broadcastPresence(roomKey)
      }
    })
  })
}

/**
 * Avisa a TODO el room —emisor incluido— de que un periodo fue revertido.
 *
 * Única excepción a "excluir al emisor": una reversión cambia la geometría de
 * la hoja (filas añadidas o borradas), así que todos, también quien revirtió,
 * tienen que reconstruirla.
 */
export function emitSheetReverted(params: {
  scope: SheetScope
  anio: number
  mes: number
  version: number
  by: Pick<SocketUser, 'id' | 'name'>
}): void {
  const { scope, anio, mes, version, by } = params
  const epoch = bumpEpoch(scope, anio, mes)
  try {
    getIo().to(sheetRoomKey(scope, anio, mes)).emit('sheet:reverted', {
      scope,
      anio,
      mes,
      version,
      epoch,
      by,
    })
  } catch (e) {
    console.warn('[sheet] emitSheetReverted falló:', e)
  }
}

/**
 * Anuncia una HOJA NUEVA en el libro de un periodo.
 *
 * Lo emite el job de generación de borradores. Va a todo el room, emisor
 * incluido: quien lanzó la generación también quiere ver aparecer las
 * hojas. El cliente calcula la posición alfabética con `posicionDeInsercion`
 * y la inserta sin remontar.
 */
export function emitSheetAdded(params: {
  scope: SheetScope
  anio: number
  mes: number
  cierre: Record<string, any>
  by: Pick<SocketUser, 'id' | 'name'>
}): void {
  const { scope, anio, mes, cierre, by } = params
  try {
    getIo().to(sheetRoomKey(scope, anio, mes)).emit('sheet:sheet-added', {
      scope,
      anio,
      mes,
      cierre,
      by,
    })
  } catch (e) {
    console.warn('[sheet] emitSheetAdded falló:', e)
  }
}

/**
 * Anuncia un cambio de ESTADO de un cierre.
 *
 * Es obligatorio reaccionar a esto en el cliente bloqueando la hoja: el
 * servidor rechaza los patches sobre cierres que ya no son BORRADOR, así
 * que si la hoja sigue editable el usuario teclea y recibe un error por
 * cada celda.
 */
export function emitSheetEstadoChanged(params: {
  anio: number
  mes: number
  cierreId: string
  estado: string
  version: number
  by: Pick<SocketUser, 'id' | 'name'>
}): void {
  const { anio, mes, cierreId, estado, version, by } = params
  try {
    getIo()
      .to(sheetRoomKey('cierres-finales', anio, mes))
      .emit('sheet:estado-changed', {
        scope: 'cierres-finales',
        anio,
        mes,
        cierre_id: cierreId,
        estado,
        version,
        by,
      })
  } catch (e) {
    console.warn('[sheet] emitSheetEstadoChanged falló:', e)
  }
}

/**
 * Anuncia que cambió el COLOR de una pestaña.
 *
 * Va aparte de `sheet:estado-changed` a propósito: un cambio de color no
 * altera lo que se puede editar, así que el cliente lo aplica con
 * `setTabColor` sin remontar ni recalcular nada. Meterlo en el evento de
 * estado obligaría a los clientes a distinguir cuál de las dos cosas cambió.
 */
export function emitSheetColorChanged(params: {
  anio: number
  mes: number
  cierreId: string
  color: string | null
  by: Pick<SocketUser, 'id' | 'name'>
}): void {
  const { anio, mes, cierreId, color, by } = params
  try {
    getIo()
      .to(sheetRoomKey('cierres-finales', anio, mes))
      .emit('sheet:hoja-color', {
        scope: 'cierres-finales',
        anio,
        mes,
        cierre_id: cierreId,
        color,
        by,
      })
  } catch (e) {
    console.warn('[sheet] emitSheetColorChanged falló:', e)
  }
}

/**
 * Pide releer una hoja concreta.
 *
 * Para cambios que alteran la GEOMETRÍA (altas o bajas de filas) y que por
 * tanto no se pueden aplicar como patch de celda.
 */
export function emitSheetInvalidate(params: {
  scope: SheetScope
  anio: number
  mes: number
  cierreId?: string | null
  accion?: string
}): void {
  const { scope, anio, mes, cierreId, accion } = params
  try {
    getIo().to(sheetRoomKey(scope, anio, mes)).emit('sheet:invalidate', {
      scope,
      anio,
      mes,
      cierre_id: cierreId ?? null,
      accion: accion ?? 'reload',
    })
  } catch (e) {
    console.warn('[sheet] emitSheetInvalidate falló:', e)
  }
}
