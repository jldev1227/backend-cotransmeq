import { prisma } from '../../config/prisma'
import crypto from 'crypto'
import type { CreateFormularioAsistenciaInput, UpdateFormularioAsistenciaInput, CreateRespuestaAsistenciaInput } from './asistencias.schema'

export class AsistenciasService {
  /**
   * Generar un token único para el formulario
   */
  private static generateToken(): string {
    return crypto.randomBytes(32).toString('hex')
  }

  /**
   * Calcular duración en minutos entre dos horas en formato HH:mm
   */
  private static calcularDuracion(horaInicio?: string, horaFin?: string): number | undefined {
    if (!horaInicio || !horaFin) return undefined

    const [horaIni, minIni] = horaInicio.split(':').map(Number)
    const [horaFinal, minFinal] = horaFin.split(':').map(Number)

    const minutosInicio = horaIni * 60 + minIni
    const minutosFin = horaFinal * 60 + minFinal

    // Si la hora final es menor que la inicial, asumimos que cruza medianoche
    if (minutosFin < minutosInicio) {
      return (24 * 60 - minutosInicio) + minutosFin
    }

    return minutosFin - minutosInicio
  }

  /**
   * Crear un nuevo formulario de asistencia
   */
  static async crear(data: CreateFormularioAsistenciaInput, creadoPorId: string) {
    const token = this.generateToken()
    const duracion = this.calcularDuracion(data.hora_inicio, data.hora_finalizacion)

    const formulario = await prisma.formularios_asistencia.create({
      data: {
        tematica: data.tematica,
        objetivo: data.objetivo,
        fecha: new Date(data.fecha),
        hora_inicio: data.hora_inicio,
        hora_finalizacion: data.hora_finalizacion,
        duracion_minutos: duracion,
        tipo_evento: data.tipo_evento,
        tipo_evento_otro: data.tipo_evento_otro,
        lugar_sede: data.lugar_sede,
        nombre_instructor: data.nombre_instructor,
        observaciones: data.observaciones,
        token,
        creado_por_id: creadoPorId
      },
      include: {
        creado_por: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        },
        _count: {
          select: {
            respuestas: true
          }
        }
      }
    })

    // Serializar fechas a ISO strings
    return {
      ...formulario,
      fecha: formulario.fecha.toISOString(),
      created_at: formulario.created_at.toISOString(),
      updated_at: formulario.updated_at.toISOString()
    }
  }

  /**
   * Obtener todos los formularios de asistencia
   */
  static async obtenerTodos() {
    const formularios = await prisma.formularios_asistencia.findMany({
      include: {
        creado_por: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        },
        _count: {
          select: {
            respuestas: true
          }
        }
      },
      orderBy: {
        fecha: 'desc'
      }
    })

    // Serializar fechas a ISO strings
    return formularios.map(f => ({
      ...f,
      fecha: f.fecha.toISOString(),
      created_at: f.created_at.toISOString(),
      updated_at: f.updated_at.toISOString()
    }))
  }

  /**
   * Obtener un formulario por ID
   */
  static async obtenerPorId(id: string) {
    const formulario = await prisma.formularios_asistencia.findUnique({
      where: { id },
      include: {
        creado_por: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        },
        respuestas: {
          orderBy: {
            created_at: 'desc'
          }
        },
        _count: {
          select: {
            respuestas: true
          }
        }
      }
    })

    if (!formulario) return null

    // Serializar fechas a ISO strings
    return {
      ...formulario,
      fecha: formulario.fecha.toISOString(),
      created_at: formulario.created_at.toISOString(),
      updated_at: formulario.updated_at.toISOString(),
      respuestas: formulario.respuestas.map(r => ({
        ...r,
        created_at: r.created_at.toISOString()
      }))
    }
  }

  /**
   * Obtener un formulario por token (público)
   */
  static async obtenerPorToken(token: string) {
    const formulario = await prisma.formularios_asistencia.findUnique({
      where: { token }
    })

    if (!formulario) return null

    // Devolver todos los campos necesarios para mostrar en el formulario público
    return {
      id: String(formulario.id),
      token: String(token),
      tematica: String(formulario.tematica),
      objetivo: formulario.objetivo ? String(formulario.objetivo) : null,
      fecha: formulario.fecha.toISOString(),
      hora_inicio: formulario.hora_inicio,
      hora_finalizacion: formulario.hora_finalizacion,
      duracion_minutos: formulario.duracion_minutos,
      tipo_evento: formulario.tipo_evento,
      tipo_evento_otro: formulario.tipo_evento_otro,
      lugar_sede: formulario.lugar_sede,
      nombre_instructor: formulario.nombre_instructor,
      activo: Boolean(formulario.activo),
      created_at: formulario.created_at.toISOString()
    }
  }

  /**
   * Actualizar un formulario de asistencia
   */
  static async actualizar(id: string, data: UpdateFormularioAsistenciaInput) {
    // Calcular duración si se proporcionan ambas horas
    let duracion: number | undefined
    if (data.hora_inicio && data.hora_finalizacion) {
      duracion = this.calcularDuracion(data.hora_inicio, data.hora_finalizacion)
    }

    const formulario = await prisma.formularios_asistencia.update({
      where: { id },
      data: {
        ...(data.tematica && { tematica: data.tematica }),
        ...(data.objetivo !== undefined && { objetivo: data.objetivo }),
        ...(data.fecha && { fecha: new Date(data.fecha) }),
        ...(data.hora_inicio !== undefined && { hora_inicio: data.hora_inicio }),
        ...(data.hora_finalizacion !== undefined && { hora_finalizacion: data.hora_finalizacion }),
        ...(duracion !== undefined && { duracion_minutos: duracion }),
        ...(data.tipo_evento && { tipo_evento: data.tipo_evento }),
        ...(data.tipo_evento_otro !== undefined && { tipo_evento_otro: data.tipo_evento_otro }),
        ...(data.lugar_sede !== undefined && { lugar_sede: data.lugar_sede }),
        ...(data.nombre_instructor !== undefined && { nombre_instructor: data.nombre_instructor }),
        ...(data.observaciones !== undefined && { observaciones: data.observaciones }),
        ...(data.activo !== undefined && { activo: data.activo })
      },
      include: {
        creado_por: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        },
        _count: {
          select: {
            respuestas: true
          }
        }
      }
    })

    return {
      ...formulario,
      fecha: formulario.fecha.toISOString(),
      created_at: formulario.created_at.toISOString(),
      updated_at: formulario.updated_at.toISOString()
    }
  }

  /**
   * Eliminar un formulario de asistencia (y todas sus respuestas por CASCADE)
   */
  static async eliminar(id: string) {
    await prisma.formularios_asistencia.delete({
      where: { id }
    })
  }

  /**
   * Verificar si un dispositivo ya respondió este formulario
   */
  static async verificarRespuestaExistente(formularioId: string, deviceFingerprint: string) {
    console.log('🔎 [Service] Verificando respuesta existente')
    console.log(`   FormularioId: ${formularioId}`)
    console.log(`   DeviceFingerprint: ${deviceFingerprint}`)
    
    const respuestaExistente = await prisma.respuestas_asistencia.findUnique({
      where: {
        formulario_id_device_fingerprint: {
          formulario_id: formularioId,
          device_fingerprint: deviceFingerprint
        }
      }
    })

    console.log(`   Resultado: ${respuestaExistente ? '✅ ENCONTRADA' : '❌ NO ENCONTRADA'}`)
    if (respuestaExistente) {
      console.log(`   ID Respuesta: ${respuestaExistente.id}`)
      console.log(`   Nombre: ${respuestaExistente.nombre_completo}`)
      console.log(`   Fingerprint en DB: ${respuestaExistente.device_fingerprint}`)
      console.log(`   Coincide: ${respuestaExistente.device_fingerprint === deviceFingerprint ? '✅ SÍ' : '❌ NO'}`)
    }

    return respuestaExistente
  }

  /**
   * Crear una respuesta de asistencia (público)
   */
  static async crearRespuesta(
    formularioId: string,
    data: CreateRespuestaAsistenciaInput,
    ipAddress: string,
    userAgent: string
  ) {
    // Verificar que el formulario existe y está activo
    const formulario = await prisma.formularios_asistencia.findUnique({
      where: { id: formularioId }
    })

    if (!formulario) {
      throw new Error('Formulario no encontrado')
    }

    if (!formulario.activo) {
      throw new Error('Este formulario ya no está disponible')
    }

    // Verificar si ya existe una respuesta de este dispositivo
    const respuestaExistente = await this.verificarRespuestaExistente(
      formularioId,
      data.device_fingerprint
    )

    if (respuestaExistente) {
      throw new Error('Ya has enviado una respuesta para este formulario')
    }

    // Crear la respuesta
    const respuesta = await prisma.respuestas_asistencia.create({
      data: {
        formulario_id: formularioId,
        nombre_completo: data.nombre_completo,
        numero_documento: data.numero_documento,
        cargo: data.cargo,
        numero_telefono: data.numero_telefono,
        firma: data.firma,
        ip_address: ipAddress,
        user_agent: userAgent,
        device_fingerprint: data.device_fingerprint
      }
    })

    return respuesta
  }

  /**
   * Obtener respuestas de un formulario
   */
  static async obtenerRespuestas(formularioId: string) {
    const respuestas = await prisma.respuestas_asistencia.findMany({
      where: { formulario_id: formularioId },
      orderBy: {
        created_at: 'desc'
      }
    })

    return respuestas
  }

  /**
   * Obtener mi respuesta (por device fingerprint)
   */
  static async obtenerMiRespuesta(formularioId: string, deviceFingerprint: string) {
    const respuesta = await this.verificarRespuestaExistente(formularioId, deviceFingerprint)
    return respuesta
  }

  /**
   * Exportar respuestas a Excel
   */
  static async exportarRespuestas(formularioId: string) {
    const formulario = await prisma.formularios_asistencia.findUnique({
      where: { id: formularioId },
      include: {
        respuestas: {
          orderBy: {
            created_at: 'asc'
          }
        }
      }
    })

    if (!formulario) {
      throw new Error('Formulario no encontrado')
    }

    return {
      formulario: {
        tematica: formulario.tematica,
        objetivo: formulario.objetivo,
        fecha: formulario.fecha.toISOString(),
        hora_inicio: formulario.hora_inicio,
        hora_finalizacion: formulario.hora_finalizacion,
        duracion_minutos: formulario.duracion_minutos,
        tipo_evento: formulario.tipo_evento,
        tipo_evento_otro: formulario.tipo_evento_otro,
        lugar_sede: formulario.lugar_sede,
        nombre_instructor: formulario.nombre_instructor,
        observaciones: formulario.observaciones
      },
      respuestas: formulario.respuestas.map(r => ({
        nombre_completo: r.nombre_completo,
        numero_documento: r.numero_documento,
        cargo: r.cargo,
        numero_telefono: r.numero_telefono,
        fecha_respuesta: r.created_at.toISOString(),
        firma: r.firma // Incluir la firma en Base64
      }))
    }
  }
}
