import { prisma } from '../../config/prisma'
import type {
  CreateInduccionVisitanteInput,
  UpdateInduccionVisitanteInput,
  FiltrosInduccionInput,
  TemasInformados
} from './inducciones.schema'
import { TEMAS_LABELS, SEDE_LABELS } from './inducciones.schema'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Serializa todas las fechas de un registro de inducción */
function serializarInduccion(ind: any) {
  return {
    ...ind,
    fecha: ind.fecha instanceof Date ? ind.fecha.toISOString() : ind.fecha,
    created_at: ind.created_at instanceof Date ? ind.created_at.toISOString() : ind.created_at,
    updated_at: ind.updated_at instanceof Date ? ind.updated_at.toISOString() : ind.updated_at
  }
}

/** Porcentaje de temas marcados como "sí" */
function calcularPorcentajeConformidad(temas: TemasInformados): number {
  const total = Object.keys(temas).length
  const confirmados = Object.values(temas).filter(Boolean).length
  return total > 0 ? Math.round((confirmados / total) * 100) : 0
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class InduccionesService {
  /**
   * Crear un nuevo registro de inducción/reinducción de visitante
   */
  static async crear(data: CreateInduccionVisitanteInput, creadoPorId: string | null) {
    const porcentaje_conformidad = calcularPorcentajeConformidad(data.temas_informados)

    const induccion = await prisma.inducciones_visitantes.create({
      data: {
        sede: data.sede,
        fecha: new Date(data.fecha),

        // Visitante
        visitante_nombre: data.visitante_nombre,
        visitante_cargo: data.visitante_cargo,
        visitante_cedula: data.visitante_cedula,
        visitante_entidad: data.visitante_entidad,
        visitante_firma: data.visitante_firma,

        // Temas (JSON)
        temas_informados: data.temas_informados,
        porcentaje_conformidad,

        // Responsable (opcionales)
        ...(data.responsable_nombre && { responsable_nombre: data.responsable_nombre }),
        ...(data.responsable_cargo  && { responsable_cargo:  data.responsable_cargo  }),
        ...(data.responsable_cedula && { responsable_cedula: data.responsable_cedula }),
        ...(data.responsable_firma  && { responsable_firma:  data.responsable_firma  }),

        ...(data.observaciones && { observaciones: data.observaciones }),

        // creado_por solo si hay usuario autenticado
        ...(creadoPorId ? { creado_por_id: creadoPorId } : {})
      }
    })

    return serializarInduccion(induccion)
  }

  /**
   * Obtener todas las inducciones con filtros opcionales y paginación
   */
  static async obtenerTodos(filtros: FiltrosInduccionInput) {
    const { sede, fecha_desde, fecha_hasta, visitante_nombre, visitante_entidad, page, limit } = filtros
    const skip = (page - 1) * limit

    const where: any = {}

    if (sede) where.sede = sede
    if (visitante_nombre) {
      where.visitante_nombre = { contains: visitante_nombre, mode: 'insensitive' }
    }
    if (visitante_entidad) {
      where.visitante_entidad = { contains: visitante_entidad, mode: 'insensitive' }
    }
    if (fecha_desde || fecha_hasta) {
      where.fecha = {}
      if (fecha_desde) where.fecha.gte = new Date(fecha_desde)
      if (fecha_hasta) where.fecha.lte = new Date(fecha_hasta)
    }

    const [inducciones, total] = await Promise.all([
      prisma.inducciones_visitantes.findMany({
        where,
        include: {
          creado_por: {
            select: { id: true, nombre: true, correo: true }
          }
        },
        orderBy: { fecha: 'desc' },
        skip,
        take: limit
      }),
      prisma.inducciones_visitantes.count({ where })
    ])

    return {
      data: inducciones.map(serializarInduccion),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit)
      }
    }
  }

  /**
   * Obtener una inducción por ID
   */
  static async obtenerPorId(id: string) {
    const induccion = await prisma.inducciones_visitantes.findUnique({
      where: { id },
      include: {
        creado_por: {
          select: { id: true, nombre: true, correo: true }
        }
      }
    })

    if (!induccion) return null
    return serializarInduccion(induccion)
  }

  /**
   * Actualizar una inducción
   */
  static async actualizar(id: string, data: UpdateInduccionVisitanteInput) {
    // Obtener la inducción actual para recalcular conformidad si cambian temas
    let porcentaje_conformidad: number | undefined
    if (data.temas_informados) {
      const actual = await prisma.inducciones_visitantes.findUnique({ where: { id } })
      if (actual) {
        const temasActualizados = {
          ...(actual.temas_informados as TemasInformados),
          ...data.temas_informados
        }
        porcentaje_conformidad = calcularPorcentajeConformidad(temasActualizados)
      }
    }

    const induccion = await prisma.inducciones_visitantes.update({
      where: { id },
      data: {
        ...(data.sede && { sede: data.sede }),
        ...(data.fecha && { fecha: new Date(data.fecha) }),
        ...(data.visitante_nombre && { visitante_nombre: data.visitante_nombre }),
        ...(data.visitante_cargo && { visitante_cargo: data.visitante_cargo }),
        ...(data.visitante_cedula && { visitante_cedula: data.visitante_cedula }),
        ...(data.visitante_entidad && { visitante_entidad: data.visitante_entidad }),
        ...(data.visitante_firma !== undefined && { visitante_firma: data.visitante_firma }),
        ...(data.temas_informados && { temas_informados: data.temas_informados }),
        ...(porcentaje_conformidad !== undefined && { porcentaje_conformidad }),
        ...(data.responsable_nombre && { responsable_nombre: data.responsable_nombre }),
        ...(data.responsable_cargo && { responsable_cargo: data.responsable_cargo }),
        ...(data.responsable_cedula && { responsable_cedula: data.responsable_cedula }),
        ...(data.responsable_firma !== undefined && { responsable_firma: data.responsable_firma }),
        ...(data.observaciones !== undefined && { observaciones: data.observaciones })
      },
      include: {
        creado_por: {
          select: { id: true, nombre: true, correo: true }
        }
      }
    })

    return serializarInduccion(induccion)
  }

  /**
   * Eliminar una inducción
   */
  static async eliminar(id: string) {
    await prisma.inducciones_visitantes.delete({ where: { id } })
  }

  /**
   * Obtener estadísticas de inducciones
   */
  static async obtenerEstadisticas() {
    const [total, porSede, ultimoMes] = await Promise.all([
      prisma.inducciones_visitantes.count(),
      prisma.inducciones_visitantes.groupBy({
        by: ['sede'],
        _count: { _all: true }
      }),
      prisma.inducciones_visitantes.count({
        where: {
          fecha: {
            gte: new Date(new Date().setDate(new Date().getDate() - 30))
          }
        }
      })
    ])

    const promedio = await prisma.inducciones_visitantes.aggregate({
      _avg: { porcentaje_conformidad: true }
    })

    return {
      total,
      ultimo_mes: ultimoMes,
      promedio_conformidad: Math.round(promedio._avg.porcentaje_conformidad ?? 0),
      por_sede: porSede.map(s => ({
        sede: s.sede,
        cantidad: s._count._all
      }))
    }
  }

  /**
   * Preparar datos para exportación (Excel / PDF)
   */
  static async exportarDatos(id: string) {
    const induccion = await prisma.inducciones_visitantes.findUnique({ where: { id } })
    if (!induccion) throw new Error('Inducción no encontrada')

    const temas = induccion.temas_informados as TemasInformados

    return {
      codigo: 'HSEQ-FR-66',
      version: '1',
      fecha_documento: new Date(induccion.fecha).toLocaleDateString('es-CO'),
      sede: SEDE_LABELS[induccion.sede as keyof typeof SEDE_LABELS] ?? induccion.sede,
      visitante: {
        nombre: induccion.visitante_nombre,
        cargo: induccion.visitante_cargo,
        cedula: induccion.visitante_cedula,
        entidad: induccion.visitante_entidad,
        firma: induccion.visitante_firma
      },
      responsable: {
        nombre: induccion.responsable_nombre,
        cargo: induccion.responsable_cargo,
        cedula: induccion.responsable_cedula,
        firma: induccion.responsable_firma
      },
      temas: Object.entries(TEMAS_LABELS).map(([key, label]) => ({
        key,
        label,
        confirmado: temas[key as keyof TemasInformados] ?? false
      })),
      porcentaje_conformidad: induccion.porcentaje_conformidad,
      observaciones: induccion.observaciones,
      created_at: induccion.created_at.toISOString()
    }
  }
}