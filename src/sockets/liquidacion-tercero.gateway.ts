import { Server as IOServer, Socket } from 'socket.io'
import { prisma } from '../config/prisma'
import { getIo } from './index'
import { resolveActor } from './auth'

interface UserInfo {
  userId: string
  userName: string
  joinedAt: string
  currentField: string | null
}

interface RoomData {
  table: string
  id: string
  users: Map<string, UserInfo>
}

const rooms = new Map<string, RoomData>()

function getRoomKey(table: string, id: string): string {
  return `row:${table}:${id}`
}

function broadcastPresence(roomKey: string) {
  const room = rooms.get(roomKey)
  if (!room) return

  const users = Array.from(room.users.values()).map(u => ({
    id: u.userId,
    name: u.userName,
    joinedAt: u.joinedAt,
    currentField: u.currentField,
  }))

  const io = getIo()
  io.to(roomKey).emit('presence:update', { room: roomKey, users })
}

export function registerLiquidacionTerceroGateway(io: IOServer) {
  io.on('connection', (socket: Socket) => {
    console.log(`[lt-collab] socket connected: ${socket.id}`)

    // NOTA sobre `user`: en todos estos handlers la identidad se resuelve con
    // `resolveActor(socket, payloadUser)`, que prefiere SIEMPRE la del token
    // verificado en el handshake y solo cae al payload mientras
    // `SOCKET_AUTH_MODE` no sea `enforce`. Hasta ahora se confiaba a ciegas en
    // el `user` que mandaba el cliente, y ese id se persistía tal cual en
    // `actualizado_por_id`: cualquiera podía firmar cambios como otro usuario.
    socket.on('join-room', async ({ table, id, user: payloadUser }: { table: string; id: string; user: { id: string; name: string } }) => {
      const user = resolveActor(socket, payloadUser)
      if (!user) return
      const roomKey = getRoomKey(table, id)
      socket.join(roomKey)

      if (!rooms.has(roomKey)) {
        rooms.set(roomKey, { table, id, users: new Map() })
      }
      const room = rooms.get(roomKey)!
      room.users.set(socket.id, {
        userId: user.id,
        userName: user.name,
        joinedAt: new Date().toISOString(),
        currentField: null,
      })

      broadcastPresence(roomKey)
      console.log(`[lt-collab] ${user.name} joined ${roomKey}`)
    })

    socket.on('leave-room', ({ table, id }: { table: string; id: string }) => {
      const roomKey = getRoomKey(table, id)
      socket.leave(roomKey)

      const room = rooms.get(roomKey)
      if (room) {
        room.users.delete(socket.id)
        if (room.users.size === 0) {
          rooms.delete(roomKey)
        } else {
          broadcastPresence(roomKey)
        }
      }
    })

    socket.on('row:save', async ({ table, id, changes, user: payloadUser, requestId }: { table: string; id: string; changes: Record<string, any>; user: { id: string; name: string }; requestId?: string }) => {
      const user = resolveActor(socket, payloadUser)
      if (!user) {
        socket.emit('save-error', {
          table,
          id,
          requestId: requestId || null,
          error: 'No autenticado',
        })
        return
      }
      console.log(`[lt-collab] row:save received table=${table} id=${id} user=${user.name} requestId=${requestId ?? '-'}`)
      try {
        // El room se arma con el id del CIERRE aunque se esté guardando una
        // tabla hija, porque es a ese room al que se unió el frontend.
        //
        // OJO con la asimetría, que es intencionada:
        //   · `row:updated` va al ROOM (todos deben ver el cambio).
        //   · `save-success` va SOLO AL EMISOR (`socket.emit`). Antes iba al
        //     room entero, así que el ACK de un usuario ponía "Guardado" en
        //     el indicador de todos los demás y disparaba `advanceQueue()` en
        //     clientes que no tenían nada en vuelo.
        const cierreId = id
        const roomKey = getRoomKey('liquidacion-tercero-final', cierreId)

        if (table === 'liquidacion-tercero-final') {
          // Update scalar fields on the cierre
          const updateData: Record<string, any> = {
            updated_at: new Date(),
            // Schema Prisma `liquidacion_tercero_final` define la relación como
            // `usuarios_actualizado_por`, no como `actualizado_por_id` (que era
            // el nombre de un campo que se renombró en una migración previa).
            usuarios_actualizado_por: { connect: { id: user.id } },
          }
          for (const [key, value] of Object.entries(changes)) {
            if (!['id', 'created_at', 'updated_at', 'deleted_at'].includes(key)) {
              updateData[key] = value
            }
          }

          await prisma.liquidacion_tercero_final.update({
            where: { id },
            data: updateData,
          })

          const io = getIo()
          const updatedPayload = {
            id,
            changes,
            updatedBy: user.name,
            updatedById: user.id,
            updatedAt: new Date().toISOString(),
          }
          io.to(roomKey).emit('row:updated', updatedPayload)
          // Broadcast global: notifica a cualquier cliente (p.ej. la página
          // de historial) que NO está en la room del cierre específico, para
          // que refresque la fila afectada.
          io.emit('row:updated:global', updatedPayload)

          socket.emit('save-success', { id, table })
          console.log(`[lt-collab] save-success emitted for table=${table} id=${id}`)
        }

        if (table === 'liquidacion-tercero-final-concepto') {
          // Save concepto changes — replace all conceptos for this cierre
          const conceptos = changes.conceptos
          console.log(`[lt-collab] saving conceptos: count=${Array.isArray(conceptos) ? conceptos.length : 'not-array'}`)

          if (Array.isArray(conceptos)) {
            // Deduplicar por la clave compuesta (tipo, concepto, conductor_id,
            // propietario_id). Conservar la ÚLTIMA ocurrencia de cada clave
            // (la que está más al final del array = última edición del usuario).
            //
            // Esto es CRÍTICO para evitar duplicados por:
            //   - Stale state local del cliente (UUIDs viejos vs nuevos).
            //   - Race conditions en el autosave (múltiples saves concurrentes).
            //   - Multi-propietario: en este modo el backend genera N filas
            //     por cada impuesto (una por copropietario), y dedupar SOLO
            //     por `concepto` perdería N-1 filas por impuesto. La clave
            //     compuesta incluye `propietario_id` para mantenerlas todas.
            //
            // También se mantienen filas legítimas: COSTO_LABORAL puede tener
            // múltiples filas por conductor (si el usuario las agregó
            // manualmente) — en ese caso cada una tiene un `concepto`
            // distinto (SALARIO, AUXILIO_TRANSPORTE, etc.), no son dupes.
            const conceptosDeduplicados: any[] = []
            const seenKey = new Set<string>()
            for (let i = conceptos.length - 1; i >= 0; i--) {
              const c = conceptos[i]
              const key = [
                c.tipo,
                c.concepto,
                c.conductor_id || '',
                c.propietario_id || ''
              ].join('|')
              if (seenKey.has(key)) continue
              seenKey.add(key)
              conceptosDeduplicados.unshift(c)
            }
            console.log(`[lt-collab] conceptos after dedupe: ${conceptos.length} → ${conceptosDeduplicados.length}`)

            const dataRows = conceptosDeduplicados.map((c: any) => ({
              id: c.id,  // Preservar id del frontend para upsert de IMPUESTOS manuales
              liquidacion_tercero_final_id: cierreId,
              tipo: c.tipo,
              concepto: c.concepto,
              conductor_id: c.conductor_id || null,
              // Comprobación contra null y no truthy: un `dias` en CERO es un
              // dato —BONIFICACION sin bonos ese mes, DOTACION sin días— y no
              // lo mismo que NULL, que significa "este concepto no lleva
              // cantidad". Colapsarlo dejaba la cantidad en blanco en el PDF.
              // Mismo criterio que `guardarConceptos` por HTTP.
              dias: c.dias == null ? null : String(c.dias),
              valor_unitario: String(c.valor_unitario || 0),
              porcentaje: c.porcentaje ? String(c.porcentaje) : null,
              valor_total: String(c.valor_total || 0),
              base_calculo: c.base_calculo ? String(c.base_calculo) : null,
              calculado: c.calculado || false,
              observaciones: c.observaciones || null,
              orden: c.orden || 0,
            }))

            await prisma.$transaction(
              async (tx) => {
                // Detectar si el cierre está en modo multi-propietario.
                const cierreModo = await tx.liquidacion_tercero_final.findUnique({
                  where: { id: cierreId },
                  select: { es_multi_propietario: true },
                });
                const soloNoImpuestos = !!cierreModo?.es_multi_propietario;

                if (soloNoImpuestos) {
                  // ── MODO MULTI-PROPIETARIO ───────────────────────────────
                  // Los IMPUESTOS los gestiona el usuario desde la sección de
                  // copropietarios (toggle, %, agregar, eliminar). Para que
                  // las ediciones manuales no se sobreescriban con cada
                  // autosave de non-impuesto, separamos el tratamiento:
                  //   - AUTO IMPUESTOS (calculado = true): se borran. Serán
                  //     regenerados por `recalcularImpuestosPorPropietario`
                  //     que se ejecuta en `guardarPropietarios` (next call).
                  //   - MANUAL IMPUESTOS (calculado = false): upsert preserva
                  //     el id del frontend para que `recalcularImpuestosPorPropietario`
                  //     los reconozca y NO los regenere.
                  console.log(
                    `[lt-collab] multi: delete AUTO impuestos, non-impuesto; upsert manual impuestos`
                  );
                  
                  // 1. Borrar AUTO IMPUESTOS (los regenera recalcular).
                  await tx.liquidacion_tercero_final_concepto.updateMany({
                    where: {
                      liquidacion_tercero_final_id: cierreId,
                      tipo: 'IMPUESTO',
                      deleted_at: null,
                      calculado: true,
                    },
                    data: { deleted_at: new Date() },
                  });
                  
                  // 2. Upsert manual IMPUESTOS del frontend (preserva id).
                  const impuestosRows = dataRows.filter(
                    (r: any) => r.tipo === 'IMPUESTO'
                  );
                  for (const row of impuestosRows) {
                    if (row.id) {
                      await tx.liquidacion_tercero_final_concepto.upsert({
                        where: { id: row.id },
                        create: row,
                        update: row,
                      });
                    } else {
                      await tx.liquidacion_tercero_final_concepto.create({
                        data: row,
                      });
                    }
                  }
                  
                  // 3. Borrar non-impuesto (reemplaza con los del frontend).
                  await tx.liquidacion_tercero_final_concepto.updateMany({
                    where: {
                      liquidacion_tercero_final_id: cierreId,
                      deleted_at: null,
                      tipo: { not: 'IMPUESTO' },
                    },
                    data: { deleted_at: new Date() },
                  });
                  
                  // 4. Crear non-impuesto del frontend.
                  const noImpuestosRows = dataRows.filter(
                    (r: any) => r.tipo !== 'IMPUESTO'
                  );
                  if (noImpuestosRows.length > 0) {
                    await tx.liquidacion_tercero_final_concepto.createMany({
                      data: noImpuestosRows,
                    });
                  }
                } else {
                  // ── MODO SINGLE-PROPIETARIO ──────────────────────────────
                  // Comportamiento legacy: replace all (incluyendo IMPUESTOS).
                  console.log(
                    `[lt-collab] single: deleting all conceptos for cierreId=${cierreId}`
                  );
                  await tx.liquidacion_tercero_final_concepto.updateMany({
                    where: {
                      liquidacion_tercero_final_id: cierreId,
                      deleted_at: null,
                    },
                    data: { deleted_at: new Date() },
                  });

                  if (dataRows.length > 0) {
                    await tx.liquidacion_tercero_final_concepto.createMany({
                      data: dataRows,
                    });
                  }
                }

                // Recalcular totales en la cabecera para que el historial
                // y los snapshots reflejen los valores correctos.
                const toNum = (v: any) => Number(v) || 0
                const costos = dataRows.filter((r: any) => r.tipo === 'COSTO_LABORAL').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)
                const gastos = dataRows.filter((r: any) => r.tipo === 'GASTO_OPERATIVO').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)
                const anticipos = dataRows.filter((r: any) => r.tipo === 'ANTICIPO').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)

                // En multi-modo, los IMPUESTOS los gestiona
                // `recalcularImpuestosPorPropietario` y los суммos desde la BD.
                let impuestos: number;
                if (soloNoImpuestos) {
                  const impsDb = await tx.liquidacion_tercero_final_concepto.findMany({
                    where: {
                      liquidacion_tercero_final_id: cierreId,
                      tipo: 'IMPUESTO',
                      deleted_at: null,
                    },
                    select: { valor_total: true },
                  });
                  impuestos = impsDb.reduce((s: number, r: any) => s + toNum(r.valor_total), 0);
                } else {
                  impuestos = dataRows.filter((r: any) => r.tipo === 'IMPUESTO').reduce((s: number, r: any) => s + toNum(r.valor_total), 0);
                }
                const totalDesc = costos + gastos + impuestos + anticipos

                const cierre = await tx.liquidacion_tercero_final.findUnique({
                  where: { id: cierreId },
                  select: { valor_liquidar: true },
                })
                const valorLiquidar = cierre ? toNum(cierre.valor_liquidar) : 0
                const totalPagar = valorLiquidar - totalDesc

                await tx.liquidacion_tercero_final.update({
                  where: { id: cierreId },
                  data: {
                    total_costos_laborales: costos,
                    total_gastos_operativos: gastos,
                    total_impuestos: impuestos,
                    total_descuentos: totalDesc,
                    total_pagar: totalPagar,
                  },
                })
                console.log(`[lt-collab] totales recalculados: costos=${costos} gastos=${gastos} impuestos=${impuestos} anticipos=${anticipos} totalDesc=${totalDesc} totalPagar=${totalPagar}`)
              },
              { timeout: 20000, maxWait: 10000 }
            )
            console.log(`[lt-collab] conceptos transaction completed successfully`)

            const io = getIo()
            const updatedPayload = {
              id: cierreId,
              changes: { conceptos },
              updatedBy: user.name,
              updatedById: user.id,
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            socket.emit('save-success', { id: cierreId, table })
            console.log(`[lt-collab] save-success emitted for conceptos table=${table} id=${cierreId}`)
          }
        }

        if (table === 'liquidacion-tercero-final-adicionales') {
          // Update adicionales JSONB field
          const adicionales = changes.adicionales

          if (Array.isArray(adicionales)) {
            // ── DOBLE ESCRITURA (puente temporal) ───────────────────────
            // Los adicionales viven ahora en la tabla
            // `liquidacion_tercero_final_adicional`, pero el canvas del
            // cierre final INDIVIDUAL (fuera del alcance de la migración)
            // sigue mandando el array completo por este socket.
            //
            // Mientras convivan los dos caminos hay que escribir en ambos,
            // o el canvas anual de adicionales mostraría datos obsoletos
            // en cuanto alguien editara desde el canvas individual.
            //
            // El array es la fuente de verdad de ESTA rama, así que la
            // tabla se reconstruye para el cierre: soft-delete de lo vivo +
            // insert del array recibido. Es aceptable porque este camino ya
            // era un replace total; el canvas anual, en cambio, usa
            // PATCH por fila y no pasa por aquí.
            //
            // TODO(2026-Q4): migrar el canvas individual a la tabla,
            // eliminar esta doble escritura y dropear la columna JSONB.
            await prisma.$transaction(async (tx) => {
              await tx.liquidacion_tercero_final.update({
                where: { id },
                data: {
                  adicionales: adicionales,
                  updated_at: new Date(),
                  actualizado_por_id: user.id,
                },
              })

              await tx.liquidacion_tercero_final_adicional.updateMany({
                where: { liquidacion_tercero_final_id: id, deleted_at: null },
                data: { deleted_at: new Date(), actualizado_por_id: user.id },
              })

              const cierre = await tx.liquidacion_tercero_final.findUnique({
                where: { id },
                select: { placa: true, tercero_id: true },
              })

              const toNum = (v: any) => {
                const n = Number(v)
                return isNaN(n) ? 0 : n
              }

              await tx.liquidacion_tercero_final_adicional.createMany({
                data: adicionales.map((a: any, idx: number) => {
                  const vUnit = toNum(a?.valor_unitario)
                  const cant = toNum(a?.cantidad) || 1
                  const pct = toNum(a?.porcentaje_admin)
                  const vAdmin = Math.round((vUnit * cant * pct) / 100)
                  return {
                    liquidacion_tercero_final_id: id,
                    orden: idx,
                    cliente: String(a?.cliente || 'TRANSMERALDA'),
                    placa: String(a?.placa || cierre?.placa || ''),
                    tercero_id: a?.tercero_id || cierre?.tercero_id || null,
                    tercero_nombre: a?.tercero_nombre || null,
                    vehiculo_id: a?.vehiculo_id || null,
                    recorrido: a?.recorrido || null,
                    fechas: a?.fechas || null,
                    valor_unitario: vUnit,
                    cantidad: cant,
                    porcentaje_admin: pct,
                    valor_admin: vAdmin,
                    valor_liquidar: vUnit * cant - vAdmin,
                    aplica_impuestos: a?.aplica_impuestos !== false,
                    creado_por_id: user.id,
                    actualizado_por_id: user.id,
                  }
                }),
              })
            })

            const io = getIo()
            const updatedPayload = {
              id,
              changes: { adicionales },
              updatedBy: user.name,
              updatedById: user.id,
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            socket.emit('save-success', { id, table })
            console.log(`[lt-collab] save-success emitted for adicionales table=${table} id=${id}`)
          }
        }

        if (table === 'liquidacion-tercero-final-propietario-overrides') {
          // Update es_propietario_overrides JSONB field
          const overrides = changes.es_propietario_overrides

          if (overrides && typeof overrides === 'object') {
            // Sanitizar: solo booleanos
            const sanitized: Record<string, boolean> = {}
            for (const [k, v] of Object.entries(overrides)) {
              if (typeof v === 'boolean') sanitized[k] = v
            }

            await prisma.liquidacion_tercero_final.update({
              where: { id },
              data: {
                es_propietario_overrides: sanitized,
                updated_at: new Date(),
                actualizado_por_id: user.id,
              },
            })

            const io = getIo()
            const updatedPayload = {
              id,
              changes: { es_propietario_overrides: sanitized },
              updatedBy: user.name,
              updatedById: user.id,
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            socket.emit('save-success', { id, table })
            console.log(`[lt-collab] save-success emitted for propietario-overrides table=${table} id=${id}`)
          }
        }

        if (table === 'liquidacion-tercero-final-propietarios') {
          // Reparto porcentual por copropietarios. El cliente envía el array
          // completo de copropietarios activos; el servicio hace soft-delete
          // de los que ya no están y upsert de los vigentes. Luego recalcula
          // los impuestos prorrateados y los totales del cierre.
          const { LiquidacionesTercerosDescuentosService } = await import(
            '../modules/liquidaciones-terceros-descuentos/liquidaciones-terceros-descuentos.service'
          )
          const propietarios = changes.propietarios

          if (Array.isArray(propietarios)) {
            await LiquidacionesTercerosDescuentosService.guardarPropietarios(id, propietarios)

            const io = getIo()
            const updatedPayload = {
              id,
              changes: { propietarios },
              updatedBy: user.name,
              updatedById: user.id,
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            socket.emit('save-success', { id, table })
            console.log(
              `[lt-collab] save-success emitted for propietarios table=${table} id=${id} count=${propietarios.length}`
            )
          }
        }

        // ─── RAMAS MENSUALES ─────────────────────────────────────
        // Las 4 ramas mensuales usan el MISMO servicio mensual
        // (guardarBorrador) que recibe el payload completo (items +
        // adicionales + conceptos) y aplica upsert idempotente. Para
        // evitar enviar 3 saves por cada edit, el frontend agrupa los
        // 3 tipos en un solo `row:save` con table='liquidacion-tercero-mensual'
        // y un campo `kind` dentro de `changes`. Si en el futuro se
        // quiere granularidad por tabla hija, basta con partir este
        // handler en 3 ramas separadas.
        // NOTA: aquí vivía la rama `table === 'liquidacion-tercero-mensual'`.
        // Era código INALCANZABLE: el cliente emitía
        // `table: 'liquidacion-tercero-ocasional'` (ver `realtimeCollab.ts`),
        // así que la condición nunca se cumplía. Además difundía a
        // `row:liquidacion-tercero-mensual:{id}`, un room en el que no había
        // nadie. Lo que salvaba la funcionalidad era que la página guardaba
        // por HTTP.
        //
        // Su sustituto es el gateway `sheet:*` (`sockets/sheet.gateway.ts`),
        // con patches por celda, versión optimista y room por año.
      } catch (err: any) {
        console.error(`[lt-collab] save error:`, err.message)
        console.error(`[lt-collab] save error stack:`, err.stack)
        // El error va SOLO al emisor. Antes se difundía también a un room
        // (`row:liquidacion-tercero-mensual:{id}`) que ni existía, y aun
        // existiendo habría puesto en rojo el indicador de guardado de todos
        // los usuarios por el fallo de uno.
        socket.emit('save-error', {
          table,
          id,
          requestId: requestId || null,
          error: err.message,
        })
      }
    })

    socket.on('typing:start', ({ table, id, field, user: payloadUser }: { table: string; id: string; field: string; user: { id: string; name: string } }) => {
      const user = resolveActor(socket, payloadUser)
      if (!user) return
      const roomKey = getRoomKey(table, id)
      const room = rooms.get(roomKey)
      if (room) {
        const info = room.users.get(socket.id)
        if (info) {
          info.currentField = field
        }
      }
      const io = getIo()
      io.to(roomKey).emit('typing', {
        field,
        userId: user.id,
        userName: user.name,
      })
    })

    socket.on('typing:stop', ({ table, id, field, user: payloadUser }: { table: string; id: string; field: string; user: { id: string; name: string } }) => {
      const user = resolveActor(socket, payloadUser)
      if (!user) return
      const roomKey = getRoomKey(table, id)
      const room = rooms.get(roomKey)
      if (room) {
        const info = room.users.get(socket.id)
        if (info && info.currentField === field) {
          info.currentField = null
        }
      }
      const io = getIo()
      io.to(roomKey).emit('typing:stop', {
        field,
        userId: user.id,
        userName: user.name,
      })
    })

    socket.on('field:focus', ({ table, id, field, user: payloadUser }: { table: string; id: string; field: string; user: { id: string; name: string } }) => {
      const user = resolveActor(socket, payloadUser)
      if (!user) return
      const roomKey = getRoomKey(table, id)
      const io = getIo()
      io.to(roomKey).emit('focus', {
        field,
        userId: user.id,
        userName: user.name,
      })
    })

    socket.on('disconnect', () => {
      for (const [roomKey, room] of rooms.entries()) {
        if (room.users.has(socket.id)) {
          room.users.delete(socket.id)
          if (room.users.size === 0) {
            rooms.delete(roomKey)
          } else {
            broadcastPresence(roomKey)
          }
        }
      }
      console.log(`[lt-collab] socket disconnected: ${socket.id}`)
    })
  })
}
