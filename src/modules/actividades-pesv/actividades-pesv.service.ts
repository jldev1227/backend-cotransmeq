import { prisma } from '../../config/prisma'

export const ActividadesPesvService = {

  /** Listar actividades con filtros y paginación */
  async listar(page = 1, limit = 50, filters: {
    anio?: number
    estado?: string
    prioridad?: string
    frecuencia?: string
    responsable_ejecucion_id?: string
    search?: string
  } = {}) {
    const skip = (page - 1) * limit
    const where: any = { deleted_at: null }

    if (filters.anio) where.anio = filters.anio
    if (filters.estado) where.estado = filters.estado
    if (filters.prioridad) where.prioridad = filters.prioridad
    if (filters.frecuencia) where.frecuencia = filters.frecuencia
    if (filters.responsable_ejecucion_id) where.responsable_ejecucion_id = filters.responsable_ejecucion_id
    if (filters.search) {
      where.OR = [
        { actividad: { contains: filters.search, mode: 'insensitive' } },
        { unidad_programa: { contains: filters.search, mode: 'insensitive' } },
        { responsable_planeacion: { contains: filters.search, mode: 'insensitive' } },
      ]
    }

    const [actividades, total] = await Promise.all([
      prisma.actividades_pesv.findMany({
        where,
        orderBy: [{ numero: 'asc' }],
        skip,
        take: limit,
        include: {
          responsable_ejecucion: { select: { id: true, nombre: true, correo: true, cargo: true } },
          creado_por: { select: { id: true, nombre: true } },
          actualizado_por: { select: { id: true, nombre: true } },
        },
      }),
      prisma.actividades_pesv.count({ where }),
    ])

    return {
      actividades,
      total,
      totalPages: Math.ceil(total / limit),
      page,
    }
  },

  /** Obtener por ID */
  async obtenerPorId(id: string) {
    const actividad = await prisma.actividades_pesv.findUnique({
      where: { id },
      include: {
        responsable_ejecucion: { select: { id: true, nombre: true, correo: true, cargo: true } },
        creado_por: { select: { id: true, nombre: true } },
        actualizado_por: { select: { id: true, nombre: true } },
      },
    })
    if (!actividad || actividad.deleted_at) throw new Error('Actividad no encontrada')
    return actividad
  },

  /** Crear actividad */
  async crear(data: {
    numero: number
    unidad_programa: string
    actividad: string
    alcance?: string
    recursos?: string
    responsable_planeacion?: string
    metodo_seguimiento?: string
    frecuencia?: string
    fecha_limite?: string
    responsable_ejecucion_id?: string
    estado?: string
    prioridad?: string
    fecha_ejecucion?: string
    observacion?: string
    anio?: number
  }, userId?: string) {
    return await prisma.actividades_pesv.create({
      data: {
        numero: data.numero,
        unidad_programa: data.unidad_programa,
        actividad: data.actividad,
        alcance: data.alcance,
        recursos: data.recursos,
        responsable_planeacion: data.responsable_planeacion,
        metodo_seguimiento: data.metodo_seguimiento,
        frecuencia: (data.frecuencia || 'ANUAL') as any,
        fecha_limite: data.fecha_limite ? new Date(data.fecha_limite) : null,
        responsable_ejecucion_id: data.responsable_ejecucion_id || null,
        estado: (data.estado || 'PENDIENTE') as any,
        prioridad: (data.prioridad || 'BAJA') as any,
        fecha_ejecucion: data.fecha_ejecucion ? new Date(data.fecha_ejecucion) : null,
        observacion: data.observacion,
        anio: data.anio || new Date().getFullYear(),
        creado_por_id: userId || null,
        actualizado_por_id: userId || null,
      } as any,
      include: {
        responsable_ejecucion: { select: { id: true, nombre: true, correo: true, cargo: true } },
        creado_por: { select: { id: true, nombre: true } },
      },
    })
  },

  /** Actualizar actividad */
  async actualizar(id: string, data: any, userId?: string) {
    const existing = await prisma.actividades_pesv.findUnique({ where: { id } })
    if (!existing || existing.deleted_at) throw new Error('Actividad no encontrada')

    const updateData: any = { actualizado_por_id: userId }

    const fields = [
      'numero', 'unidad_programa', 'actividad', 'alcance', 'recursos',
      'responsable_planeacion', 'metodo_seguimiento', 'frecuencia',
      'responsable_ejecucion_id', 'estado', 'prioridad',
      'observacion', 'anio',
    ]
    for (const f of fields) {
      if (data[f] !== undefined) updateData[f] = data[f]
    }
    if (data.fecha_limite !== undefined) updateData.fecha_limite = data.fecha_limite ? new Date(data.fecha_limite) : null
    if (data.fecha_ejecucion !== undefined) updateData.fecha_ejecucion = data.fecha_ejecucion ? new Date(data.fecha_ejecucion) : null

    return await prisma.actividades_pesv.update({
      where: { id },
      data: updateData,
      include: {
        responsable_ejecucion: { select: { id: true, nombre: true, correo: true, cargo: true } },
        creado_por: { select: { id: true, nombre: true } },
        actualizado_por: { select: { id: true, nombre: true } },
      },
    })
  },

  /** Soft delete */
  async eliminar(id: string, userId?: string) {
    const existing = await prisma.actividades_pesv.findUnique({ where: { id } })
    if (!existing || existing.deleted_at) throw new Error('Actividad no encontrada')

    return await prisma.actividades_pesv.update({
      where: { id },
      data: { deleted_at: new Date(), actualizado_por_id: userId },
    })
  },

  /** Estadísticas */
  async estadisticas(anio?: number) {
    const where: any = { deleted_at: null }
    if (anio) where.anio = anio

    const [total, porEstado, porPrioridad] = await Promise.all([
      prisma.actividades_pesv.count({ where }),
      prisma.actividades_pesv.groupBy({
        by: ['estado'],
        where,
        _count: { id: true },
      }),
      prisma.actividades_pesv.groupBy({
        by: ['prioridad'],
        where,
        _count: { id: true },
      }),
    ])

    return {
      total,
      porEstado: porEstado.reduce((acc: any, e: any) => { acc[e.estado] = e._count.id; return acc }, {}),
      porPrioridad: porPrioridad.reduce((acc: any, e: any) => { acc[e.prioridad] = e._count.id; return acc }, {}),
    }
  },

  /** Obtener siguiente número */
  async siguienteNumero(anio?: number) {
    const where: any = { deleted_at: null }
    if (anio) where.anio = anio
    const last = await prisma.actividades_pesv.findFirst({
      where,
      orderBy: { numero: 'desc' },
      select: { numero: true },
    })
    return (last?.numero || 0) + 1
  },
}
