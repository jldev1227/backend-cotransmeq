import { prisma } from '../../config/prisma'

export interface CausaAccionInput {
  orden: number
  analisis_causa: string
  descripcion_plan_accion?: string
  fecha_limite_implementacion?: Date | string
  responsable_ejecucion?: string
  fecha_seguimiento?: Date | string
  estado_seguimiento?: 'En Proceso' | 'Cumplida' | 'Vencida'
  descripcion_observaciones?: string
}

export interface CreateAccionCorrectivaInput {
  accion_numero: string
  lugar_sede?: string
  proceso_origen_hallazgo?: string
  componente_elemento_referencia?: string
  fuente_genero_hallazgo?: string
  marco_legal_normativo?: string
  fecha_identificacion_hallazgo?: Date | string
  descripcion_hallazgo?: string
  tipo_hallazgo_detectado?: string
  variable_categoria_analisis?: string
  correccion_solucion_inmediata?: string
  fecha_implementacion?: Date | string
  valoracion_riesgo?: 'ALTO' | 'MEDIO' | 'BAJO'
  requiere_actualizar_matriz?: boolean
  tipo_accion_ejecutar?: 'CORRECTIVA' | 'PREVENTIVA' | 'MEJORA'
  causas?: CausaAccionInput[] // Array de causas con su seguimiento
  fecha_evaluacion_eficacia?: Date | string
  criterio_evaluacion_eficacia?: string
  analisis_evidencias_cierre?: string
  evaluacion_cierre_eficaz?: 'EFICAZ' | 'NO EFICAZ'
  soporte_cierre_eficaz?: string
  fecha_cierre_definitivo?: Date | string
  responsable_cierre?: string
  creado_por_id?: string
}

export interface UpdateAccionCorrectivaInput extends Partial<CreateAccionCorrectivaInput> {}

export interface FiltrosAccionesCorrectivas {
  tipo_accion_ejecutar?: string
  estado_seguimiento?: string
  valoracion_riesgo?: string
  fecha_desde?: Date | string
  fecha_hasta?: Date | string
  busqueda?: string
  page?: number
  limit?: number
}

export class AccionesCorrectivasService {
  // Crear nueva acción correctiva/preventiva
  async crear(data: CreateAccionCorrectivaInput) {
    // Validar que no exista el número de acción
    const existente = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { accion_numero: data.accion_numero }
    })

    if (existente) {
      throw new Error(`Ya existe una acción con el número ${data.accion_numero}`)
    }

    // Separar causas del resto de datos
    const { causas, ...datosAccion } = data

    // Convertir fechas string a Date
    const fechasConvertidas = this.convertirFechas(datosAccion)

    // Crear acción con sus causas
    return await prisma.acciones_correctivas_preventivas.create({
      data: {
        ...fechasConvertidas,
        causas: causas
          ? {
              create: causas.map((causa) => ({
                ...this.convertirFechasCausa(causa)
              }))
            }
          : undefined,
        created_at: new Date(),
        updated_at: new Date()
      },
      include: {
        causas: {
          orderBy: { orden: 'asc' }
        },
        usuarios: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        }
      }
    })
  }

  // Listar acciones con filtros y paginación
  async listar(filtros: FiltrosAccionesCorrectivas = {}) {
    const {
      tipo_accion_ejecutar,
      estado_seguimiento,
      valoracion_riesgo,
      fecha_desde,
      fecha_hasta,
      busqueda,
      page = 1,
      limit = 20
    } = filtros

    const where: any = {}

    // Filtros específicos
    if (tipo_accion_ejecutar) {
      where.tipo_accion_ejecutar = tipo_accion_ejecutar
    }

    if (estado_seguimiento) {
      where.causas = {
        some: {
          estado_seguimiento
        }
      }
    }

    if (valoracion_riesgo) {
      where.valoracion_riesgo = valoracion_riesgo
    }

    // Filtro de rango de fechas
    if (fecha_desde || fecha_hasta) {
      where.fecha_identificacion_hallazgo = {}
      if (fecha_desde) {
        where.fecha_identificacion_hallazgo.gte = new Date(fecha_desde)
      }
      if (fecha_hasta) {
        where.fecha_identificacion_hallazgo.lte = new Date(fecha_hasta)
      }
    }

    // Búsqueda general
    if (busqueda) {
      where.OR = [
        { accion_numero: { contains: busqueda, mode: 'insensitive' } },
        { descripcion_hallazgo: { contains: busqueda, mode: 'insensitive' } },
        { lugar_sede: { contains: busqueda, mode: 'insensitive' } },
        {
          causas: {
            some: {
              responsable_ejecucion: { contains: busqueda, mode: 'insensitive' }
            }
          }
        }
      ]
    }

    // Paginación
    const skip = (page - 1) * limit

    const [acciones, total] = await Promise.all([
      prisma.acciones_correctivas_preventivas.findMany({
        where,
        include: {
          causas: {
            orderBy: { orden: 'asc' }
          },
          usuarios: {
            select: {
              id: true,
              nombre: true,
              correo: true
            }
          }
        },
        orderBy: {
          fecha_identificacion_hallazgo: 'desc'
        },
        skip,
        take: limit
      }),
      prisma.acciones_correctivas_preventivas.count({ where })
    ])

    return {
      acciones,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }

  // Obtener acción por ID
  async obtenerPorId(id: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { id },
      include: {
        causas: {
          orderBy: { orden: 'asc' }
        },
        usuarios: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        }
      }
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    return accion
  }

  // Obtener acción por número
  async obtenerPorNumero(accion_numero: string) {
    const accion = await prisma.acciones_correctivas_preventivas.findUnique({
      where: { accion_numero },
      include: {
        causas: {
          orderBy: { orden: 'asc' }
        },
        usuarios: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        }
      }
    })

    if (!accion) {
      throw new Error('Acción no encontrada')
    }

    return accion
  }

  // Actualizar acción
  async actualizar(id: string, data: UpdateAccionCorrectivaInput) {
    // Verificar que existe
    await this.obtenerPorId(id)

    // Si se intenta cambiar el número, validar que no exista
    if (data.accion_numero) {
      const existente = await prisma.acciones_correctivas_preventivas.findFirst({
        where: {
          accion_numero: data.accion_numero,
          id: { not: id }
        }
      })

      if (existente) {
        throw new Error(`Ya existe una acción con el número ${data.accion_numero}`)
      }
    }

    // Separar causas del resto de datos
    const { causas, ...datosAccion } = data

    // Convertir fechas
    const fechasConvertidas = this.convertirFechas(datosAccion)

    // Si hay causas, actualizar/crear/eliminar según corresponda
    const causasUpdate =
      causas !== undefined
        ? {
            deleteMany: {}, // Eliminar todas las causas existentes
            create: causas.map((causa) => this.convertirFechasCausa(causa))
          }
        : undefined

    return await prisma.acciones_correctivas_preventivas.update({
      where: { id },
      data: {
        ...fechasConvertidas,
        ...(causasUpdate && { causas: causasUpdate }),
        updated_at: new Date()
      },
      include: {
        causas: {
          orderBy: { orden: 'asc' }
        },
        usuarios: {
          select: {
            id: true,
            nombre: true,
            correo: true
          }
        }
      }
    })
  }

  // Eliminar acción
  async eliminar(id: string) {
    await this.obtenerPorId(id)

    return await prisma.acciones_correctivas_preventivas.delete({
      where: { id }
    })
  }

  // Estadísticas generales
  async obtenerEstadisticas() {
    const [total, porTipo, porRiesgo, causasPorEstado, proximasVencer] = await Promise.all([
      // Total de acciones
      prisma.acciones_correctivas_preventivas.count(),

      // Por tipo de acción
      prisma.acciones_correctivas_preventivas.groupBy({
        by: ['tipo_accion_ejecutar'],
        _count: true
      }),

      // Por valoración de riesgo
      prisma.acciones_correctivas_preventivas.groupBy({
        by: ['valoracion_riesgo'],
        _count: true
      }),

      // Causas por estado de seguimiento
      prisma.causas_accion_correctiva.groupBy({
        by: ['estado_seguimiento'],
        _count: true
      }),

      // Próximas a vencer (30 días) - causas con fecha límite próxima
      prisma.causas_accion_correctiva.count({
        where: {
          fecha_limite_implementacion: {
            gte: new Date(),
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
          },
          estado_seguimiento: { not: 'Cumplida' }
        }
      })
    ])

    return {
      total,
      por_tipo: porTipo,
      por_riesgo: porRiesgo,
      causas_por_estado: causasPorEstado,
      proximas_vencer: proximasVencer
    }
  }

  // Helper: Convertir fechas string a Date
  private convertirFechas(data: any) {
    const resultado = { ...data }
    const camposFecha = [
      'fecha_identificacion_hallazgo',
      'fecha_implementacion',
      'fecha_evaluacion_eficacia',
      'fecha_cierre_definitivo'
    ]

    camposFecha.forEach((campo) => {
      if (resultado[campo] && typeof resultado[campo] === 'string') {
        resultado[campo] = new Date(resultado[campo])
      }
    })

    return resultado
  }

  // Helper: Convertir fechas de causas
  private convertirFechasCausa(causa: CausaAccionInput) {
    const resultado: any = { ...causa }
    const camposFecha = ['fecha_limite_implementacion', 'fecha_seguimiento']

    camposFecha.forEach((campo) => {
      if (resultado[campo] && typeof resultado[campo] === 'string') {
        resultado[campo] = new Date(resultado[campo])
      }
    })

    return resultado
  }
}
