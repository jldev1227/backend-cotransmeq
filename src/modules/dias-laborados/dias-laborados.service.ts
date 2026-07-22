import { randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { EmailService } from '../../services/email.service'
import { CrearRegistroInput } from './dias-laborados.schema'

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

    const where: any = { fecha: { gte: start, lte: end } }
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
          where: { registro_dia_id: { in: ids } },
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
  }
}
