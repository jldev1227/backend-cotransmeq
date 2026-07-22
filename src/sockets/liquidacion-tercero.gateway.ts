import { Server as IOServer, Socket } from 'socket.io'
import { prisma } from '../config/prisma'
import { getIo } from './index'

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

    socket.on('join-room', async ({ table, id, user }: { table: string; id: string; user: { id: string; name: string } }) => {
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

    socket.on('row:save', async ({ table, id, changes, user }: { table: string; id: string; changes: Record<string, any>; user: { id: string; name: string } }) => {
      console.log(`[lt-collab] row:save received table=${table} id=${id} user=${user?.name}`)
      try {
        // Use the cierre ID as the room key regardless of which child table
        // is being saved, so the frontend (which joined the cierre room)
        // receives the save-success event.
        const cierreId = id
        const roomKey = getRoomKey('liquidacion-tercero-final', cierreId)

        if (table === 'liquidacion-tercero-final') {
          // Update scalar fields on the cierre
          const updateData: Record<string, any> = {
            updated_at: new Date(),
            actualizado_por_id: user.id,
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
            updatedAt: new Date().toISOString(),
          }
          io.to(roomKey).emit('row:updated', updatedPayload)
          // Broadcast global: notifica a cualquier cliente (p.ej. la página
          // de historial) que NO está en la room del cierre específico, para
          // que refresque la fila afectada.
          io.emit('row:updated:global', updatedPayload)

          io.to(roomKey).emit('save-success', { id, table })
          console.log(`[lt-collab] save-success emitted for table=${table} id=${id}`)
        }

        if (table === 'liquidacion-tercero-final-concepto') {
          // Save concepto changes — replace all conceptos for this cierre
          const conceptos = changes.conceptos
          console.log(`[lt-collab] saving conceptos: count=${Array.isArray(conceptos) ? conceptos.length : 'not-array'}`)

          if (Array.isArray(conceptos)) {
            // Deduplicar IMPUESTO: solo puede existir 1 fila por concepto de
            // impuesto (RETENCION_ICA, AVISOS_TABLEROS, etc.). Si el frontend
            // envía varias (por bug histórico o race condition), conservar la
            // última. Los LABORALES/GASTOS_OPERATIVOS pueden tener varias filas
            // (un registro por conductor/fila de planilla), así que NO se
            // dedupican.
            const conceptosDeduplicados: any[] = []
            const seenImpuesto = new Set<string>()
            for (let i = conceptos.length - 1; i >= 0; i--) {
              const c = conceptos[i]
              if (c.tipo === 'IMPUESTO') {
                if (seenImpuesto.has(c.concepto)) continue
                seenImpuesto.add(c.concepto)
              }
              conceptosDeduplicados.unshift(c)
            }

            const dataRows = conceptosDeduplicados.map((c: any) => ({
              liquidacion_tercero_final_id: cierreId,
              tipo: c.tipo,
              concepto: c.concepto,
              conductor_id: c.conductor_id || null,
              dias: c.dias ? String(c.dias) : null,
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
                console.log(`[lt-collab] deleting old conceptos for cierreId=${cierreId}`)
                await tx.liquidacion_tercero_final_concepto.deleteMany({
                  where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
                })

                if (dataRows.length > 0) {
                  console.log(`[lt-collab] creating ${dataRows.length} new conceptos`)
                  await tx.liquidacion_tercero_final_concepto.createMany({
                    data: dataRows,
                  })
                }

                // Recalcular totales en la cabecera para que el historial
                // y los snapshots reflejen los valores correctos.
                const toNum = (v: any) => Number(v) || 0
                const costos = dataRows.filter((r: any) => r.tipo === 'COSTO_LABORAL').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)
                const gastos = dataRows.filter((r: any) => r.tipo === 'GASTO_OPERATIVO').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)
                const impuestos = dataRows.filter((r: any) => r.tipo === 'IMPUESTO').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)
                const anticipos = dataRows.filter((r: any) => r.tipo === 'ANTICIPO').reduce((s: number, r: any) => s + toNum(r.valor_total), 0)
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
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            io.to(roomKey).emit('save-success', { id: cierreId, table })
            console.log(`[lt-collab] save-success emitted for conceptos table=${table} id=${cierreId}`)
          }
        }

        if (table === 'liquidacion-tercero-final-adicionales') {
          // Update adicionales JSONB field
          const adicionales = changes.adicionales

          if (Array.isArray(adicionales)) {
            await prisma.liquidacion_tercero_final.update({
              where: { id },
              data: {
                adicionales: adicionales,
                updated_at: new Date(),
                actualizado_por_id: user.id,
              },
            })

            const io = getIo()
            const updatedPayload = {
              id,
              changes: { adicionales },
              updatedBy: user.name,
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            io.to(roomKey).emit('save-success', { id, table })
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
              updatedAt: new Date().toISOString(),
            }
            io.to(roomKey).emit('row:updated', updatedPayload)
            io.emit('row:updated:global', updatedPayload)

            io.to(roomKey).emit('save-success', { id, table })
            console.log(`[lt-collab] save-success emitted for propietario-overrides table=${table} id=${id}`)
          }
        }
      } catch (err: any) {
        console.error(`[lt-collab] save error:`, err.message)
        console.error(`[lt-collab] save error stack:`, err.stack)
        const io = getIo()
        io.to(socket.id).emit('save-error', {
          table,
          id,
          error: err.message,
        })
      }
    })

    socket.on('typing:start', ({ table, id, field, user }: { table: string; id: string; field: string; user: { id: string; name: string } }) => {
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

    socket.on('typing:stop', ({ table, id, field, user }: { table: string; id: string; field: string; user: { id: string; name: string } }) => {
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

    socket.on('field:focus', ({ table, id, field, user }: { table: string; id: string; field: string; user: { id: string; name: string } }) => {
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
