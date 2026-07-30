import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { EmailService } from '../../services/email.service'
import { CrearRegistroInput } from './dias-laborados.schema'
import { EditarSegmentoInput, EditarRegistroInput, GuardarRegistrosMasivosInput } from './dias-laborados-admin.schema'
import { getIO } from '../../sockets'

const TOKEN_VALIDITY_DAYS = 30

export const DiasLaboradosService = {

  // ─────────────────────────────────────────────
  // AUTH: Solicitar acceso por cédula → envía email
  // ─────────────────────────────────────────────
  async solicitarAcceso(numero_identificacion: string) {
    // 1. Buscar conductor
    const conductor = await prisma.conductores.findUnique({
      where: { numero_identificacion },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        estado: true
      }
    })

    if (!conductor) {
      throw { statusCode: 404, message: 'No se encontró un conductor con ese número de identificación' }
    }

    if (!conductor.email) {
      throw { statusCode: 400, message: 'El conductor no tiene un correo electrónico registrado. Contacta al administrador.' }
    }

    // 2. Generar JWT
    const expiresAt = new Date()
    expiresAt.setDate(expiresAt.getDate() + TOKEN_VALIDITY_DAYS)

    const jwtToken = jwt.sign(
      {
        sub: conductor.id,
        cedula: numero_identificacion,
        nombre: `${conductor.nombre} ${conductor.apellido}`,
        tipo: 'conductor_dias_laborados'
      },
      env.JWT_SECRET,
      { expiresIn: `${TOKEN_VALIDITY_DAYS}d` }
    )

    // 3. Guardar token en BD
    await prisma.conductor_token.create({
      data: {
        id: randomUUID(),
        conductor_id: conductor.id,
        token: jwtToken,
        expires_at: expiresAt
      }
    })

    // 4. Enviar email
    await EmailService.sendMagicLink({
      to: conductor.email,
      conductorNombre: conductor.nombre,
      conductorApellido: conductor.apellido,
      token: jwtToken
    })

    // Ocultar parcialmente el email para la respuesta
    const emailParts = conductor.email.split('@')
    const hidden = emailParts[0].slice(0, 3) + '***@' + emailParts[1]

    return {
      message: 'Se ha enviado un enlace de acceso a tu correo electrónico',
      email: hidden
    }
  },

  // ─────────────────────────────────────────────
  // AUTH: Verificar token (magic link callback)
  // ─────────────────────────────────────────────
  async verificarToken(token: string) {
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as any

      if (payload.tipo !== 'conductor_dias_laborados') {
        throw { statusCode: 401, message: 'Token inválido' }
      }

      // Verificar token en BD
      const tokenRecord = await prisma.conductor_token.findUnique({
        where: { token },
        include: {
          conductor: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              email: true,
              estado: true
            }
          }
        }
      })

      if (!tokenRecord || tokenRecord.expires_at < new Date()) {
        throw { statusCode: 401, message: 'Token expirado o inválido' }
      }

      return {
        token,
        conductor: tokenRecord.conductor,
        expires_at: tokenRecord.expires_at
      }
    } catch (err: any) {
      if (err.statusCode) throw err
      throw { statusCode: 401, message: 'Token inválido o expirado' }
    }
  },

  // ─────────────────────────────────────────────
  // REGISTROS: Crear o actualizar un día
  //
  // La tabla padre `registro_dia_laboral` SOLO guarda:
  //   - tipo (LABORADO / DISPONIBLE / DESCANSO / MANTENIMIENTO)
  //   - fecha
  //   - observaciones
  //
  // Todo lo demás (cliente, vehículo, horarios, horas) vive en
  // `registro_dia_laboral_segmento` (la tabla pivote).
  // Para LABORADO se inserta directamente con createMany de TODOS los tramos.
  // Para otros tipos, no se crean segmentos.
  // ─────────────────────────────────────────────
  async upsertRegistro(conductorId: string, data: CrearRegistroInput) {
    const fecha = new Date(data.fecha + 'T00:00:00.000Z')

    // No permitir fechas futuras
    const hoy = new Date()
    hoy.setHours(0, 0, 0, 0)
    const fechaCheck = new Date(data.fecha + 'T00:00:00.000Z')
    if (fechaCheck > hoy) {
      throw { statusCode: 400, message: 'No puedes registrar días futuros' }
    }

    const segmentos = data.segmentos ?? []

    const registro = await prisma.$transaction(async (tx) => {
      // 1) Upsert del padre (solo tipo + observaciones)
      const reg = await tx.registro_dia_laboral.upsert({
        where: {
          conductor_id_fecha: {
            conductor_id: conductorId,
            fecha
          }
        },
        update: {
          tipo: data.tipo,
          observaciones: data.observaciones || null
        },
        create: {
          id: randomUUID(),
          conductor_id: conductorId,
          fecha,
          tipo: data.tipo,
          observaciones: data.observaciones || null
        }
      })

      // 2) Reemplazar segmentos (idempotente): borrar existentes y re-insertar todos
      //    Para LABORADO se exige al menos 1 segmento.
      if (data.tipo === 'LABORADO') {
        await tx.registro_dia_laboral_segmento.deleteMany({
          where: { registro_dia_id: reg.id }
        })

        if (segmentos.length > 0) {
          await tx.registro_dia_laboral_segmento.createMany({
            data: segmentos.map((seg, idx) => ({
              id: randomUUID(),
              registro_dia_id: reg.id,
              cliente_id: seg.cliente_id || null,
              cliente_nombre: seg.cliente_nombre || null,
              vehiculo_id: seg.vehiculo_id || null,
              vehiculo_placa: seg.vehiculo_placa,
              hora_inicio: seg.hora_inicio,
              hora_fin: seg.hora_fin,
              horas_conducidas: Number(seg.horas_conducidas) || 0,
              km_inicial: seg.km_inicial != null ? Number(seg.km_inicial) : null,
              km_final: seg.km_final != null ? Number(seg.km_final) : null,
              pernocte: seg.pernocte === true,
              orden: idx + 1,
              observaciones: seg.observaciones || null
            }))
          });
        }
      } else {
        // Para tipos distintos a LABORADO, los segmentos no aplican: limpiar
        await tx.registro_dia_laboral_segmento.deleteMany({
          where: { registro_dia_id: reg.id }
        })
      }

      return reg
    })

    // Devolver el registro con sus segmentos (puede ser [] para tipos != LABORADO)
    return this.getRegistroConSegmentos(registro.id)
  },

  // Helper: obtener registro con sus segmentos
  async getRegistroConSegmentos(registroId: string) {
    const registro = await prisma.registro_dia_laboral.findUnique({
      where: { id: registroId }
    })
    if (!registro) return null

    // SIEMPRE devolver los segmentos, incluso para tipos != LABORADO (será [])
    const segmentos = await prisma.registro_dia_laboral_segmento.findMany({
      where: { registro_dia_id: registroId },
      orderBy: { orden: 'asc' }
    })

    return { ...registro, segmentos }
  },

  // ─────────────────────────────────────────────
  // REGISTROS: Listar por mes
  // ─────────────────────────────────────────────
  async listarRegistros(conductorId: string, mes?: string, desde?: string, hasta?: string) {
    const where: any = { conductor_id: conductorId }

    if (mes) {
      const [year, month] = mes.split('-').map(Number)
      const start = new Date(year, month - 1, 1)
      const end = new Date(year, month, 0, 23, 59, 59)
      where.fecha = { gte: start, lte: end }
    } else if (desde && hasta) {
      where.fecha = {
        gte: new Date(desde + 'T00:00:00.000Z'),
        lte: new Date(hasta + 'T23:59:59.999Z')
      }
    }

    const registros = await prisma.registro_dia_laboral.findMany({
      where,
      orderBy: { fecha: 'asc' }
    })

    // Incluir segmentos en una sola consulta
    const ids = registros.filter(r => r.tipo === 'LABORADO').map(r => r.id)
    if (ids.length === 0) return registros

    const segmentos = await prisma.registro_dia_laboral_segmento.findMany({
      where: { registro_dia_id: { in: ids } },
      orderBy: { orden: 'asc' }
    })

    const map = new Map<string, any[]>()
    for (const s of segmentos) {
      if (!map.has(s.registro_dia_id)) map.set(s.registro_dia_id, [])
      map.get(s.registro_dia_id)!.push(s)
    }
    return registros.map(r => ({ ...r, segmentos: map.get(r.id) || [] }))
  },

  // ─────────────────────────────────────────────
  // CALENDARIO: registros de TODOS los conductores en un mes
  //   con conteo de segmentos para badge
  // ─────────────────────────────────────────────
  async calendar(opts: { mes: number; anio: number; conductor_id?: string }) {
    const { mes, anio, conductor_id } = opts
    const start = new Date(anio, mes - 1, 1)
    const end = new Date(anio, mes, 0, 23, 59, 59, 999)

    const where: any = { fecha: { gte: start, lte: end }, deleted_at: null }
    if (conductor_id) where.conductor_id = conductor_id

    const registros = await prisma.registro_dia_laboral.findMany({
      where,
      orderBy: { fecha: 'asc' },
      include: {
        conductor: {
          select: { id: true, nombre: true, apellido: true, numero_identificacion: true }
        }
      }
    })

    // Traer segmentos agrupados por registro (para el aside del calendario)
    const ids = registros.map(r => r.id)
    const segmentos = ids.length === 0
      ? []
      : await prisma.registro_dia_laboral_segmento.findMany({
          where: {
            registro_dia_id: { in: ids },
            deleted_at: null
          },
          orderBy: { orden: 'asc' }
        })

    const segMap = new Map<string, any[]>()
    for (const s of segmentos) {
      if (!segMap.has(s.registro_dia_id)) segMap.set(s.registro_dia_id, [])
      segMap.get(s.registro_dia_id)!.push(s)
    }

    const data = registros.map(r => ({
      id: r.id,
      fecha: r.fecha,
      tipo: r.tipo,
      observaciones: r.observaciones,
      created_at: r.created_at,
      updated_at: r.updated_at,
      segmentos_count: segMap.get(r.id)?.length || 0,
      segmentos: segMap.get(r.id) || [],
      conductor: r.conductor
    }))

    return {
      registros: data,
      total: data.length,
      stats: {
        total: data.length,
        laborados: data.filter(r => r.tipo === 'LABORADO').length,
        disponibles: data.filter(r => r.tipo === 'DISPONIBLE').length,
        descansos: data.filter(r => r.tipo === 'DESCANSO').length,
        mantenimiento: data.filter(r => r.tipo === 'MANTENIMIENTO').length
      }
    }
  },

  // ─────────────────────────────────────────────
  // REGISTROS: Eliminar un día
  // ─────────────────────────────────────────────
  async eliminarRegistro(conductorId: string, fecha: string) {
    const fechaDate = new Date(fecha + 'T00:00:00.000Z')

    const registro = await prisma.registro_dia_laboral.findUnique({
      where: {
        conductor_id_fecha: {
          conductor_id: conductorId,
          fecha: fechaDate
        }
      }
    })

    if (!registro) {
      throw { statusCode: 404, message: 'Registro no encontrado' }
    }

    await prisma.registro_dia_laboral.delete({
      where: { id: registro.id }
    })

    return { message: 'Registro eliminado exitosamente' }
  },

  // ─────────────────────────────────────────────
  // DATOS: Clientes (sin paginación, para select)
  // ─────────────────────────────────────────────
  async listarClientes() {
    return prisma.clientes.findMany({
      where: { deletedAt: null, oculto: false },
      select: {
        id: true,
        nombre: true,
        nit: true,
        tipo: true
      },
      orderBy: { nombre: 'asc' }
    })
  },

  // ─────────────────────────────────────────────
  // DATOS: Vehículos/Placas (sin paginación, para select)
  // ─────────────────────────────────────────────
  async listarVehiculos() {
    return prisma.vehiculos.findMany({
      where: { oculto: false, deleted_at: null },
      select: {
        id: true,
        placa: true,
        marca: true,
        linea: true,
        modelo: true,
        estado: true,
        conductor_id: true
      },
      orderBy: { placa: 'asc' }
    })
  },

  // ─────────────────────────────────────────────
  // ADMIN: Guardado MASIVO de recorridos de un conductor
  // para un mes completo, en una sola llamada.
  //
  // Caso de uso: el operador recibe una planilla con 30 días de
  // un conductor. En lugar de registrar 30 veces, arma "patrones"
  // (uno por cada conjunto de días del mismo tipo) y les asigna
  // fechas. El backend expande cada (patrón × fecha) en 1 registro
  // y, si el patrón es LABORADO o DISPONIBLE, 1 segmento.
  //
  // Cada patrón puede ser de tipo:
  //   - LABORADO      → con vehículo, cliente, horario, km, etc.
  //   - DISPONIBLE    → solo horario de disponibilidad + pernocte
  //   - DESCANSO      → solo observaciones
  //   - MANTENIMIENTO → solo observaciones
  //
  // Los días del mes que NO estén en ningún patrón simplemente no se
  // tocan (no se crea ningún registro). Esto evita el problema del
  // feature anterior "diasNoAsignados" que auto-marcaba como descanso
  // los días que el operador no había tocado explícitamente.
  //
  // Comportamiento:
  //   - Reemplaza cualquier registro existente SOLO en las fechas tocadas.
  //   - Emite un evento socket para refrescar pestañas abiertas.
  //   - Devuelve un resumen con conteos y los IDs generados.
  // ─────────────────────────────────────────────
  async guardarRegistrosMasivos(input: GuardarRegistrosMasivosInput) {
    const { conductor_id, mes, anio, patrones } = input

    // 1) Validar que el conductor exista (y no esté eliminado)
    const conductor = await prisma.conductores.findUnique({
      where: { id: conductor_id },
      select: { id: true, nombre: true, apellido: true, deleted_at: true }
    })
    if (!conductor || conductor.deleted_at) {
      throw { statusCode: 404, message: 'Conductor no encontrado' }
    }

    // 2) Construir universo de fechas a tocar
    const universo = new Set<string>()
    for (const p of patrones) {
      for (const f of p.fechas) universo.add(f)
    }

    // 3) Transacción: borrar existentes y crear nuevos
    const fechasDate = Array.from(universo).map(
      (f) => new Date(f + 'T00:00:00.000Z')
    )

    const resultado = await prisma.$transaction(async (tx) => {
      // 3.1) Borrar existentes (cascada borra segmentos + bonos)
      if (fechasDate.length > 0) {
        await tx.registro_dia_laboral.deleteMany({
          where: {
            conductor_id,
            fecha: { in: fechasDate }
          }
        })
      }

      const registrosCreados: Array<{
        id: string
        fecha: string
        tipo: string
      }> = []

      // 3.2) Crear registros expandiendo cada patrón
      for (const p of patrones) {
        const tipoPatron = (p.tipo ?? 'LABORADO') as
          | 'LABORADO' | 'DISPONIBLE' | 'DESCANSO' | 'MANTENIMIENTO'
        const llevaSegmento = tipoPatron === 'LABORADO' || tipoPatron === 'DISPONIBLE'

        for (const fechaStr of p.fechas) {
          const fecha = new Date(fechaStr + 'T00:00:00.000Z')
          const registro = await tx.registro_dia_laboral.create({
            data: {
              id: randomUUID(),
              // Prisma 5: usar la RELACIÓN (no solo el FK) para
              // consistencia con el patrón del segmento.
              conductor: { connect: { id: conductor_id } },
              fecha,
              tipo: tipoPatron,
              observaciones: p.observaciones || null
            }
          })

          // Solo LABORADO y DISPONIBLE llevan segmento.
          // DESCANSO y MANTENIMIENTO solo tienen el registro padre.
          if (llevaSegmento && p.segmento) {
            const seg = p.segmento
            await tx.registro_dia_laboral_segmento.create({
              data: {
                id: randomUUID(),
                // Prisma 5: usar las RELACIONES (no solo los FKs) para
                // vincular al registro padre, al cliente y al vehículo.
                registro_dia: { connect: { id: registro.id } },
                ...(seg.cliente_id
                  ? { cliente: { connect: { id: seg.cliente_id } } }
                  : {}),
                cliente_nombre: seg.cliente_nombre || null,
                ...(seg.vehiculo_id
                  ? { vehiculo: { connect: { id: seg.vehiculo_id } } }
                  : {}),
                vehiculo_placa: seg.vehiculo_placa || null,
                hora_inicio: seg.hora_inicio || null,
                hora_fin: seg.hora_fin || null,
                horas_conducidas: seg.horas_conducidas != null
                  ? Number(seg.horas_conducidas)
                  : 0,
                km_inicial: seg.km_inicial != null ? Number(seg.km_inicial) : null,
                km_final: seg.km_final != null ? Number(seg.km_final) : null,
                pernocte: seg.pernocte === true,
                orden: 1,
                observaciones: seg.observaciones || null
              }
            })
          }

          registrosCreados.push({
            id: registro.id,
            fecha: fechaStr,
            tipo: tipoPatron
          })
        }
      }

      return registrosCreados
    }, {
      timeout: 30_000
    })

    // 4) Emitir evento socket para refrescar pestañas abiertas
    try {
      const io = getIO()
      io.emit('dias-laborados:registro-actualizado', {
        conductor_id,
        conductor_nombre: conductor.nombre,
        conductor_apellido: conductor.apellido,
        fecha: `${anio}-${String(mes).padStart(2, '0')}-01`,
        tipo: 'MASIVO',
        segmentos_count: resultado.filter((r) => r.tipo === 'LABORADO').length,
        timestamp: new Date().toISOString()
      })
    } catch {
      // socket opcional
    }

    return {
      message: 'Recorridos guardados',
      resumen: {
        conductor_id,
        conductor_nombre: `${conductor.nombre} ${conductor.apellido}`,
        mes,
        anio,
        patrones_procesados: patrones.length,
        registros_laborado_creados: resultado.filter((r) => r.tipo === 'LABORADO').length,
        registros_descanso_creados: resultado.filter((r) => r.tipo === 'DESCANSO').length,
        registros_mantenimiento_creados: resultado.filter(
          (r) => r.tipo === 'MANTENIMIENTO'
        ).length,
        registros_disponible_creados: resultado.filter((r) => r.tipo === 'DISPONIBLE').length,
        total_creados: resultado.length
      },
      ids: resultado
    }
  },

  // ─────────────────────────────────────────────
  // ADMIN: Editar un segmento (tramo) específico
  // Solo los campos de detalle del tramo. No toca el
  // registro_dia padre (fecha, tipo, conductor).
  // ─────────────────────────────────────────────
  async editarSegmento(segmentoId: string, input: EditarSegmentoInput) {
    const existing = await prisma.registro_dia_laboral_segmento.findUnique({
      where: { id: segmentoId }
    })

    if (!existing) {
      throw { statusCode: 404, message: 'Segmento no encontrado' }
    }

    if (existing.deleted_at) {
      throw { statusCode: 410, message: 'El segmento fue eliminado y no puede editarse' }
    }

    // Si se envían km_final/km_inicial, validar coherencia.
    const kmIni = input.km_inicial !== undefined ? input.km_inicial : existing.km_inicial
    const kmFin = input.km_final !== undefined ? input.km_final : existing.km_final
    if (kmIni != null && kmFin != null && kmFin < kmIni) {
      throw { statusCode: 400, message: 'km_final debe ser mayor o igual a km_inicial' }
    }

    // Si se envían ambos horarios, validar hora_fin > hora_inicio.
    if (input.hora_inicio && input.hora_fin) {
      const [h1, m1] = input.hora_inicio.split(':').map(Number)
      const [h2, m2] = input.hora_fin.split(':').map(Number)
      if (h2 * 60 + m2 <= h1 * 60 + m1) {
        throw { statusCode: 400, message: 'hora_fin debe ser posterior a hora_inicio' }
      }
    }

    const updated = await prisma.registro_dia_laboral_segmento.update({
      where: { id: segmentoId },
      data: {
        // Prisma 5: usar RELACIONES (no FKs directos) para cliente/vehículo.
        ...(input.cliente_id !== undefined
          ? {
              cliente: input.cliente_id
                ? { connect: { id: input.cliente_id } }
                : { disconnect: true }
            }
          : {}),
        cliente_nombre: input.cliente_nombre !== undefined ? input.cliente_nombre : undefined,
        ...(input.vehiculo_id !== undefined
          ? {
              vehiculo: input.vehiculo_id
                ? { connect: { id: input.vehiculo_id } }
                : { disconnect: true }
            }
          : {}),
        vehiculo_placa: input.vehiculo_placa !== undefined ? input.vehiculo_placa : undefined,
        hora_inicio: input.hora_inicio !== undefined ? input.hora_inicio : undefined,
        hora_fin: input.hora_fin !== undefined ? input.hora_fin : undefined,
        inicio_dia_siguiente:
          input.inicio_dia_siguiente !== undefined ? input.inicio_dia_siguiente : undefined,
        fin_dia_siguiente:
          input.fin_dia_siguiente !== undefined ? input.fin_dia_siguiente : undefined,
        horas_conducidas:
          input.horas_conducidas !== undefined && input.horas_conducidas !== null
            ? Number(input.horas_conducidas)
            : undefined,
        km_inicial: input.km_inicial !== undefined ? input.km_inicial : undefined,
        km_final: input.km_final !== undefined ? input.km_final : undefined,
        pernocte: input.pernocte !== undefined ? input.pernocte : undefined,
        observaciones:
          input.observaciones !== undefined ? input.observaciones : undefined
      }
    })

    // Emitir evento socket para refrescar pestañas abiertas
    try {
      const io = getIO()
      const registro = await prisma.registro_dia_laboral.findUnique({
        where: { id: updated.registro_dia_id },
        include: { conductor: { select: { nombre: true, apellido: true } } }
      })
      if (registro) {
        io.emit('dias-laborados:registro-actualizado', {
          conductor_id: registro.conductor_id,
          conductor_nombre: registro.conductor.nombre,
          conductor_apellido: registro.conductor.apellido,
          fecha: registro.fecha,
          tipo: registro.tipo,
          segmentos_count: 1,
          timestamp: new Date().toISOString()
        })
      }
    } catch {
      // socket opcional
    }

    return updated
  },

  // ─────────────────────────────────────────────
  // ADMIN: Soft delete de un segmento
  // Marca `deleted_at` con la fecha actual. NO borra
  // físicamente. La query de `calendar` filtra
  // `deleted_at: null` por lo que el segmento deja
  // de aparecer en el canvas inmediatamente.
  // ─────────────────────────────────────────────
  async softDeleteSegmento(segmentoId: string) {
    const existing = await prisma.registro_dia_laboral_segmento.findUnique({
      where: { id: segmentoId }
    })

    if (!existing) {
      throw { statusCode: 404, message: 'Segmento no encontrado' }
    }

    if (existing.deleted_at) {
      // Idempotente: ya estaba borrado, devolvemos OK.
      return { message: 'Segmento ya estaba eliminado', id: segmentoId }
    }

    const updated = await prisma.registro_dia_laboral_segmento.update({
      where: { id: segmentoId },
      data: { deleted_at: new Date() }
    })

    // Emitir evento socket
    try {
      const io = getIO()
      const registro = await prisma.registro_dia_laboral.findUnique({
        where: { id: existing.registro_dia_id },
        include: { conductor: { select: { nombre: true, apellido: true } } }
      })
      if (registro) {
        io.emit('dias-laborados:registro-actualizado', {
          conductor_id: registro.conductor_id,
          conductor_nombre: registro.conductor.nombre,
          conductor_apellido: registro.conductor.apellido,
          fecha: registro.fecha,
          tipo: registro.tipo,
          segmentos_count: 0,
          eliminado: true,
          timestamp: new Date().toISOString()
        })
      }
    } catch {
      // socket opcional
    }

    return { message: 'Segmento eliminado (soft delete)', id: updated.id }
  },

  // ─────────────────────────────────────────────
  // ADMIN: Editar metadata de un registro (día)
  // Puede actualizar tipo + observaciones, y opcionalmente
  // recibir un `segmento` que se crea/actualiza.
  // Lógica de segmentos:
  //   • Si `tipo` final es LABORADO o DISPONIBLE y llega `segmento`:
  //       - si hay segmentos activos → actualiza el primero, soft-elimina el resto
  //       - si no hay segmentos activos → crea uno nuevo
  //   • Si `tipo` final es DESCANSO o MANTENIMIENTO:
  //       - se soft-eliminan todos los segmentos activos
  //       - se ignora el `segmento` del body aunque llegue
  // ─────────────────────────────────────────────
  async editarRegistro(registroId: string, input: EditarRegistroInput) {
    const existing = await prisma.registro_dia_laboral.findUnique({
      where: { id: registroId },
      include: {
        segmentos: { where: { deleted_at: null }, orderBy: { orden: 'asc' } }
      }
    })

    if (!existing) {
      throw { statusCode: 404, message: 'Registro no encontrado' }
    }

    if (existing.deleted_at) {
      throw { statusCode: 410, message: 'El registro fue eliminado y no puede editarse' }
    }

    const tipoFinal = input.tipo ?? existing.tipo
    const requiereSegmento = tipoFinal === 'LABORADO' || tipoFinal === 'DISPONIBLE'

    const updated = await prisma.$transaction(async (tx) => {
      // 1) Actualizar metadata del registro
      const regActualizado = await tx.registro_dia_laboral.update({
        where: { id: registroId },
        data: {
          tipo: input.tipo !== undefined ? input.tipo : undefined,
          observaciones: input.observaciones !== undefined ? input.observaciones : undefined
        }
      })

      // 2) Gestionar segmentos según el tipo final
      if (requiereSegmento && input.segmento) {
        const seg = input.segmento
        if (existing.segmentos.length > 0) {
          // Actualizar el primero, soft-eliminar el resto
          const primero = existing.segmentos[0]
          await tx.registro_dia_laboral_segmento.update({
            where: { id: primero.id },
            data: {
              // Prisma 5: usar RELACIONES (no FKs directos) para cliente/vehículo.
              ...(seg.cliente_id !== undefined
                ? {
                    cliente: seg.cliente_id
                      ? { connect: { id: seg.cliente_id } }
                      : { disconnect: true }
                  }
                : {}),
              cliente_nombre: seg.cliente_nombre !== undefined ? seg.cliente_nombre : undefined,
              ...(seg.vehiculo_id !== undefined
                ? {
                    vehiculo: seg.vehiculo_id
                      ? { connect: { id: seg.vehiculo_id } }
                      : { disconnect: true }
                  }
                : {}),
              vehiculo_placa: seg.vehiculo_placa !== undefined ? seg.vehiculo_placa : undefined,
              hora_inicio: seg.hora_inicio !== undefined ? seg.hora_inicio : undefined,
              hora_fin: seg.hora_fin !== undefined ? seg.hora_fin : undefined,
              inicio_dia_siguiente:
                seg.inicio_dia_siguiente !== undefined ? seg.inicio_dia_siguiente : undefined,
              fin_dia_siguiente:
                seg.fin_dia_siguiente !== undefined ? seg.fin_dia_siguiente : undefined,
              horas_conducidas:
                seg.horas_conducidas !== undefined && seg.horas_conducidas !== null
                  ? Number(seg.horas_conducidas)
                  : undefined,
              km_inicial: seg.km_inicial !== undefined ? seg.km_inicial : undefined,
              km_final: seg.km_final !== undefined ? seg.km_final : undefined,
              pernocte: seg.pernocte !== undefined ? seg.pernocte : undefined,
              observaciones: seg.observaciones !== undefined ? seg.observaciones : undefined
            }
          })
          if (existing.segmentos.length > 1) {
            const idsResto = existing.segmentos.slice(1).map((s) => s.id)
            await tx.registro_dia_laboral_segmento.updateMany({
              where: { id: { in: idsResto } },
              data: { deleted_at: new Date() }
            })
          }
        } else {
          // Crear el primer segmento
          await tx.registro_dia_laboral_segmento.create({
            data: {
              id: randomUUID(),
              registro_dia: { connect: { id: registroId } },
              // Prisma 5: usar RELACIONES (no FKs directos) para cliente/vehículo.
              ...(seg.cliente_id
                ? { cliente: { connect: { id: seg.cliente_id } } }
                : {}),
              cliente_nombre: seg.cliente_nombre || null,
              ...(seg.vehiculo_id
                ? { vehiculo: { connect: { id: seg.vehiculo_id } } }
                : {}),
              vehiculo_placa: seg.vehiculo_placa || null,
              hora_inicio: seg.hora_inicio || null,
              hora_fin: seg.hora_fin || null,
              inicio_dia_siguiente: seg.inicio_dia_siguiente === true,
              fin_dia_siguiente: seg.fin_dia_siguiente === true,
              horas_conducidas: seg.horas_conducidas != null ? Number(seg.horas_conducidas) : 0,
              km_inicial: seg.km_inicial != null ? Number(seg.km_inicial) : null,
              km_final: seg.km_final != null ? Number(seg.km_final) : null,
              pernocte: seg.pernocte === true,
              orden: 1,
              observaciones: seg.observaciones || null
            }
          })
        }
      } else if (!requiereSegmento && existing.segmentos.length > 0) {
        // El tipo final es DESCANSO/MANTENIMIENTO: limpiar segmentos
        const ids = existing.segmentos.map((s) => s.id)
        await tx.registro_dia_laboral_segmento.updateMany({
          where: { id: { in: ids } },
          data: { deleted_at: new Date() }
        })
      }

      return regActualizado
    })

    // Emitir evento socket
    try {
      const io = getIO()
      const conductor = await prisma.conductores.findUnique({
        where: { id: updated.conductor_id },
        select: { nombre: true, apellido: true }
      })
      if (conductor) {
        io.emit('dias-laborados:registro-actualizado', {
          conductor_id: updated.conductor_id,
          conductor_nombre: conductor.nombre,
          conductor_apellido: conductor.apellido,
          fecha: updated.fecha,
          tipo: updated.tipo,
          segmentos_count: requiereSegmento ? 1 : 0,
          timestamp: new Date().toISOString()
        })
      }
    } catch {
      // socket opcional
    }

    return updated
  },

  // ─────────────────────────────────────────────
  // ADMIN: Soft delete de un registro (día completo)
  // Marca `deleted_at` en el padre. Cubre el caso de
  // días DESCANSO / MANTENIMIENTO que no tienen segmentos.
  // Si el día tiene segmentos, también los marca como
  // eliminados para mantener consistencia (la query de
  // `calendar` ya filtra `deleted_at: null` en el padre
  // y en cada segmento, así que con marcar el padre es
  // suficiente; pero por seguridad cascada también).
  // ─────────────────────────────────────────────
  async softDeleteRegistro(registroId: string) {
    const existing = await prisma.registro_dia_laboral.findUnique({
      where: { id: registroId },
      include: { segmentos: { where: { deleted_at: null } } }
    })

    if (!existing) {
      throw { statusCode: 404, message: 'Registro no encontrado' }
    }

    if (existing.deleted_at) {
      return { message: 'Registro ya estaba eliminado', id: registroId }
    }

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      // 1) Marcar el padre
      await tx.registro_dia_laboral.update({
        where: { id: registroId },
        data: { deleted_at: now }
      })
      // 2) Cascada a los segmentos activos (defensa en profundidad)
      if (existing.segmentos.length > 0) {
        await tx.registro_dia_laboral_segmento.updateMany({
          where: { registro_dia_id: registroId, deleted_at: null },
          data: { deleted_at: now }
        })
      }
    })

    // Emitir evento socket
    try {
      const io = getIO()
      const conductor = await prisma.conductores.findUnique({
        where: { id: existing.conductor_id },
        select: { nombre: true, apellido: true }
      })
      if (conductor) {
        io.emit('dias-laborados:registro-actualizado', {
          conductor_id: existing.conductor_id,
          conductor_nombre: conductor.nombre,
          conductor_apellido: conductor.apellido,
          fecha: existing.fecha,
          tipo: existing.tipo,
          segmentos_count: 0,
          eliminado: true,
          timestamp: new Date().toISOString()
        })
      }
    } catch {
      // socket opcional
    }

    return { message: 'Registro eliminado (soft delete)', id: registroId }
  }
}
