import { prisma } from '../../config/prisma'
import { CreateServicioInput, UpdateServicioInput, CambiarEstadoInput, AsignarPlanillaInput, BuscarServiciosInput } from './servicios.schema'
import { getS3SignedUrl } from '../../config/aws'
import { RecargosService } from '../recargos/recargos.service'
import { randomUUID } from 'crypto'

// Helper para transformar servicios al formato esperado por el frontend
async function transformarServicio(servicio: any) {
  if (!servicio) return null
  
  // Convertir a JSON y parsear de nuevo para limpiar propiedades no enumerables de Prisma
  const servicioPlano = JSON.parse(JSON.stringify(servicio))
  
  // Extraer las relaciones con nombres simplificados
  let conductor = servicioPlano.conductores || null
  const cliente = servicioPlano.clientes || null
  const vehiculo = servicioPlano.vehiculos || null
  
  // Preservar TODAS las propiedades de los municipios (incluyendo latitud y longitud)
  const origen = servicioPlano.municipios_servicio_origen_idTomunicipios || null
  const destino = servicioPlano.municipios_servicio_destino_idTomunicipios || null
  
  console.log('🔄 [TRANSFORM] Transformando servicio:', {
    servicio_id: servicioPlano.id,
    origen_municipio: origen ? {
      nombre: origen.nombre_municipio,
      lat: origen.latitud,
      lng: origen.longitud
    } : null,
    destino_municipio: destino ? {
      nombre: destino.nombre_municipio,
      lat: destino.latitud,
      lng: destino.longitud
    } : null
  })
  
  // Si hay conductor, obtener su foto desde la tabla documento
  if (conductor && conductor.id) {
    try {
      // Primero intentar con foto_url directa del conductor
      if (conductor.foto_url) {
        console.log('🖼️ [TRANSFORM] Generando URL firmada para foto_url:', conductor.foto_url)
        conductor.foto_signed_url = await getS3SignedUrl(conductor.foto_url, 3600) // URL válida por 1 hora
        console.log('✅ [TRANSFORM] URL firmada generada:', conductor.foto_signed_url)
      } else {
        // Si no hay foto_url, buscar foto de perfil en la tabla documento
        const fotoDocumento = await prisma.documento.findFirst({
          where: {
            conductor_id: conductor.id,
            categoria: 'FOTO_PERFIL',
            estado: 'vigente'
          },
          select: {
            ruta_archivo: true
          },
          orderBy: {
            created_at: 'desc' // La más reciente
          }
        })
        
        if (fotoDocumento && fotoDocumento.ruta_archivo) {
          console.log('🖼️ [TRANSFORM] Generando URL firmada desde documento:', fotoDocumento.ruta_archivo)
          // Generar URL firmada desde S3
          conductor.foto_signed_url = await getS3SignedUrl(fotoDocumento.ruta_archivo, 3600) // URL válida por 1 hora
          console.log('✅ [TRANSFORM] URL firmada generada desde documento:', conductor.foto_signed_url)
        } else {
          conductor.foto_signed_url = null
        }
      }
    } catch (error) {
      console.error('❌ [TRANSFORM] Error obteniendo foto del conductor:', error)
      conductor.foto_signed_url = null
    }
  }
  
  // Eliminar las propiedades de relaciones originales
  delete servicioPlano.conductores
  delete servicioPlano.clientes
  delete servicioPlano.vehiculos
  delete servicioPlano.municipios_servicio_origen_idTomunicipios
  delete servicioPlano.municipios_servicio_destino_idTomunicipios
  
  return {
    ...servicioPlano,
    conductor,
    cliente,
    vehiculo,
    origen,
    destino
  }
}

// Helper para normalizar el propósito del servicio al formato de Prisma
function normalizarProposito(proposito: string | undefined): any {
  if (!proposito) return 'personal'; // valor por defecto
  // Convertir "personal y herramienta" a "personal_y_herramienta" para Prisma
  if (proposito === 'personal y herramienta') {
    return 'personal_y_herramienta';
  }
  return proposito;
}

export const ServiciosService = {
  async create(data: CreateServicioInput, userId?: string) {
    const servicio = await prisma.servicio.create({
      data: {
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        cliente_id: data.cliente_id,
        origen_id: data.origen_id,
        destino_id: data.destino_id,
        origen_especifico: data.origen_especifico || '',
        destino_especifico: data.destino_especifico || '',
        estado: data.estado as any,
        proposito_servicio: normalizarProposito(data.proposito_servicio) as any,
        fecha_solicitud: new Date(data.fecha_solicitud),
      fecha_realizacion: data.fecha_realizacion ? new Date(data.fecha_realizacion) : undefined,
      fecha_finalizacion: data.fecha_finalizacion ? new Date(data.fecha_finalizacion) : undefined,
      origen_latitud: data.origen_latitud,
      origen_longitud: data.origen_longitud,
      destino_latitud: data.destino_latitud,
      destino_longitud: data.destino_longitud,
      valor: data.valor ?? 0,
      numero_planilla: data.numero_planilla,
      observaciones: data.observaciones,
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
            estado: true,
            foto_url: true,
            numero_identificacion: true
          }
        },
        vehiculos: {
          select: {
            id: true,
            placa: true,
            marca: true,
            modelo: true,
            estado: true
          }
        },
        clientes: {
          select: {
            id: true,
            nombre: true,
            nit: true,
            telefono: true
          }
        },
        municipios_servicio_origen_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true,
            latitud: true,
            longitud: true
          }
        },
        municipios_servicio_destino_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true,
            latitud: true,
            longitud: true
          }
        }
      }
    })
    
    // Auto-crear recargo si hay fecha de realización
    if (data.fecha_realizacion) {
      try {
        const fechaRealizacion = new Date(data.fecha_realizacion)
        const mes = fechaRealizacion.getMonth() + 1 // 0-indexed, necesitamos 1-12
        const año = fechaRealizacion.getFullYear()
        
        console.log('🔄 [AUTO-RECARGO] Creando recargo automático para servicio:', {
          servicio_id: servicio.id,
          numero_planilla: data.numero_planilla,
          mes,
          año,
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id
        })
        
        await RecargosService.create({
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          empresa_id: data.cliente_id, // Cliente del servicio como empresa del recargo
          numero_planilla: data.numero_planilla || undefined,
          mes,
          año,
          servicio_id: servicio.id,
          observaciones: `Recargo creado automáticamente desde servicio ${data.numero_planilla || servicio.id}`,
          dias_laborales: [] // Se llenará después en el modal de recargos
        }, userId)
        
        console.log('✅ [AUTO-RECARGO] Recargo creado exitosamente')
      } catch (error) {
        console.error('❌ [AUTO-RECARGO] Error creando recargo automático:', error)
        // No lanzar error para no interrumpir la creación del servicio
      }
    }
    
    return await transformarServicio(servicio)
  },

  async list(
    page: number = 1,
    limit: number = 20,
    filters?: {
      estado?: string
      search?: string
      conductor_id?: string
      vehiculo_id?: string
      cliente_id?: string
      fecha_desde?: string
      fecha_hasta?: string
      campo_fecha?: 'fecha_solicitud' | 'fecha_realizacion' | 'created_at' | 'fecha_finalizacion'
      orderBy?: string
      orderDirection?: 'asc' | 'desc'
    }
  ) {
    const skip = (page - 1) * limit
    
    // Construir filtros dinámicos
    const where: any = {}
    
    if (filters?.estado) {
      where.estado = filters.estado
    }
    
    if (filters?.conductor_id) {
      where.conductor_id = filters.conductor_id
    }
    
    if (filters?.vehiculo_id) {
      where.vehiculo_id = filters.vehiculo_id
    }
    
    if (filters?.cliente_id) {
      where.cliente_id = filters.cliente_id
    }
    
    // Filtro de rango de fechas - permite especificar el campo
    if (filters?.fecha_desde || filters?.fecha_hasta) {
      const campoFecha = filters.campo_fecha || 'fecha_solicitud' // Por defecto fecha_solicitud
      const rangoFecha: any = {}
      
      if (filters.fecha_desde) {
        // Parsear la fecha desde el inicio del día
        const fechaDesde = new Date(filters.fecha_desde)
        fechaDesde.setUTCHours(0, 0, 0, 0)
        rangoFecha.gte = fechaDesde
      }
      if (filters.fecha_hasta) {
        // Parsear la fecha hasta el final del día
        const fechaHasta = new Date(filters.fecha_hasta)
        fechaHasta.setUTCHours(23, 59, 59, 999)
        rangoFecha.lte = fechaHasta
      }
      
      where[campoFecha] = rangoFecha
      console.log(`📅 Filtro de fechas aplicado:`, {
        campoFecha,
        filters_recibidos: { fecha_desde: filters.fecha_desde, fecha_hasta: filters.fecha_hasta, campo_fecha: filters.campo_fecha },
        rangoFecha,
        where_completo: JSON.stringify(where, null, 2)
      })
    }
    
    if (filters?.search) {
      // Búsqueda global en todos los campos relevantes
      where.OR = [
        // Campos directos del servicio
        { origen_especifico: { contains: filters.search, mode: 'insensitive' } },
        { destino_especifico: { contains: filters.search, mode: 'insensitive' } },
        { estado: { contains: filters.search, mode: 'insensitive' } },
        
        // Cliente (siempre presente)
        { clientes: { nombre: { contains: filters.search, mode: 'insensitive' } } },
        { clientes: { nit: { contains: filters.search, mode: 'insensitive' } } },
        
        // Conductor (puede ser null - Prisma maneja automáticamente)
        { conductores: { nombre: { contains: filters.search, mode: 'insensitive' } } },
        { conductores: { apellido: { contains: filters.search, mode: 'insensitive' } } },
        
        // Vehículo (puede ser null - Prisma maneja automáticamente)
        { vehiculos: { placa: { contains: filters.search, mode: 'insensitive' } } },
        
        // Municipios de origen y destino (siempre presentes)
        { municipios_servicio_origen_idTomunicipios: { nombre_municipio: { contains: filters.search, mode: 'insensitive' } } },
        { municipios_servicio_origen_idTomunicipios: { nombre_departamento: { contains: filters.search, mode: 'insensitive' } } },
        { municipios_servicio_destino_idTomunicipios: { nombre_municipio: { contains: filters.search, mode: 'insensitive' } } },
        { municipios_servicio_destino_idTomunicipios: { nombre_departamento: { contains: filters.search, mode: 'insensitive' } } }
      ]
      
      console.log('🔍 Búsqueda aplicada en múltiples campos:', filters.search)
    }
    
    // Construir ordenamiento
    const orderBy: any = {}
    if (filters?.orderBy) {
      const field = filters.orderBy
      const direction = filters.orderDirection || 'desc'
      
      if (field === 'cliente') {
        orderBy.clientes = { nombre: direction }
      } else if (field === 'conductor') {
        orderBy.conductores = { nombre: direction }
      } else {
        orderBy[field] = direction
      }
    } else {
      orderBy.created_at = 'desc'
    }
    
    console.log('🔍 Query Prisma - where:', JSON.stringify(where, null, 2))
    console.log('🔍 Query Prisma - orderBy:', JSON.stringify(orderBy, null, 2))
    
    // Obtener servicios
    const servicios = await prisma.servicio.findMany({
      where,
      skip,
      take: limit,
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
            estado: true,
            foto_url: true,
            numero_identificacion: true
          }
        },
        vehiculos: {
          select: {
            id: true,
            placa: true,
            marca: true,
            modelo: true
          }
        },
        clientes: {
          select: {
            id: true,
            nombre: true,
            nit: true
          }
        },
        municipios_servicio_origen_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true
          }
        },
        municipios_servicio_destino_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true
          }
        }
      },
      orderBy
    })
    
    // Para el count, si hay búsqueda con relaciones, obtenemos todos y contamos
    // De lo contrario, usamos count directo
    let total: number
    if (filters?.search) {
      // Cuando hay búsqueda en relaciones, hacemos findMany sin paginación y contamos
      const allMatching = await prisma.servicio.findMany({
        where,
        select: { id: true }
      })
      total = allMatching.length
    } else {
      // Sin búsqueda o solo filtros simples, podemos usar count
      total = await prisma.servicio.count({ where })
    }

    // Calcular stats basadas en los filtros actuales
    let stats: any
    try {
      // Obtener conteos por estado con los mismos filtros aplicados
      const estadosCounts = await prisma.servicio.groupBy({
        by: ['estado'],
        where, // Aplicar los mismos filtros
        _count: {
          id: true
        }
      })
      
      // Construir objeto de stats
      stats = {
        total,
        solicitado: 0,
        en_curso: 0,
        planificado: 0,
        realizado: 0,
        cancelado: 0,
        liquidado: 0
      }
      
      // Mapear los resultados
      estadosCounts.forEach((item) => {
        const estado = item.estado?.toLowerCase()
        const count = item._count.id
        
        if (estado === 'solicitado') stats.solicitado = count
        else if (estado === 'en_curso' || estado === 'en curso') stats.en_curso = count
        else if (estado === 'planificado') stats.planificado = count
        else if (estado === 'realizado') stats.realizado = count
        else if (estado === 'cancelado') stats.cancelado = count
        else if (estado === 'liquidado') stats.liquidado = count
      })
      
      console.log('📊 Stats calculadas con filtros:', stats)
    } catch (error) {
      console.error('❌ Error calculando stats con filtros:', error)
      // Si falla el groupBy (por ejemplo con relaciones complejas), calcular manualmente
      stats = {
        total,
        solicitado: 0,
        en_curso: 0,
        planificado: 0,
        realizado: 0,
        cancelado: 0,
        liquidado: 0
      }
    }

    // Transformar los datos para que coincidan con el frontend
    const serviciosTransformados = await Promise.all(servicios.map(s => transformarServicio(s)))

    return {
      servicios: serviciosTransformados,
      stats, // Incluir stats en la respuesta
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  },

  async getStats() {
    // Obtener conteo total
    const total = await prisma.servicio.count()
    
    // Obtener conteos por estado usando groupBy
    const estadosCounts = await prisma.servicio.groupBy({
      by: ['estado'],
      _count: {
        id: true
      }
    })
    
    // Construir objeto de stats
    const stats = {
      total,
      solicitado: 0,
      en_curso: 0,
      planificado: 0,
      realizado: 0,
      cancelado: 0,
      liquidado: 0
    }
    
    // Mapear los resultados
    estadosCounts.forEach((item) => {
      const estado = item.estado?.toLowerCase()
      const count = item._count.id
      
      if (estado === 'solicitado') stats.solicitado = count
      else if (estado === 'en_curso' || estado === 'en curso') stats.en_curso = count
      else if (estado === 'planificado') stats.planificado = count
      else if (estado === 'realizado') stats.realizado = count
      else if (estado === 'cancelado') stats.cancelado = count
      else if (estado === 'liquidado') stats.liquidado = count
    })
    
    return stats
  },

  async findById(id: string) {
    const servicio = await prisma.servicio.findUnique({
      where: { id },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
            email: true,
            estado: true,
            tipo_identificacion: true,
            numero_identificacion: true,
            foto_url: true
          }
        },
        vehiculos: {
          select: {
            id: true,
            placa: true,
            marca: true,
            modelo: true,
            color: true,
            estado: true,
            clase_vehiculo: true,
            linea: true
          }
        },
        clientes: {
          select: {
            id: true,
            nombre: true,
            nit: true,
            telefono: true,
            direccion: true,
            representante: true
          }
        },
        municipios_servicio_origen_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true,
            latitud: true,
            longitud: true
          }
        },
        municipios_servicio_destino_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true,
            latitud: true,
            longitud: true
          }
        },
        recargos_planillas: {
          select: {
            id: true,
            numero_planilla: true,
            mes: true,
            a_o: true,
            observaciones: true,
            estado_conductor: true,
            via_trocha: true,
            via_afirmado: true,
            via_mixto: true,
            via_pavimentada: true,
            riesgo_desniveles: true,
            riesgo_deslizamientos: true,
            riesgo_sin_senalizacion: true,
            riesgo_animales: true,
            riesgo_peatones: true,
            riesgo_trafico_alto: true,
            fuente_consulta: true,
            calificacion_servicio: true,
            tiempo_disponibilidad_horas: true,
            duracion_trayecto_horas: true,
            numero_dias_servicio: true
          }
        }
      }
    })
    
    return await transformarServicio(servicio)
  },

  async update(id: string, data: UpdateServicioInput) {
    const updateData: any = { ...data }
    
    if (data.fecha_solicitud) {
      updateData.fecha_solicitud = new Date(data.fecha_solicitud)
    }
    if (data.fecha_realizacion) {
      updateData.fecha_realizacion = new Date(data.fecha_realizacion)
    }
    if (data.fecha_finalizacion) {
      updateData.fecha_finalizacion = new Date(data.fecha_finalizacion)
    }
    
    // Normalizar propósito del servicio
    if (data.proposito_servicio) {
      updateData.proposito_servicio = normalizarProposito(data.proposito_servicio)
    }

    // Obtener el servicio actual antes de actualizar
    const servicioActual = await prisma.servicio.findUnique({
      where: { id },
      include: {
        recargos_planillas: {
          where: {
            deleted_at: null
          },
          select: {
            id: true
          }
        }
      }
    })

    if (!servicioActual) {
      throw new Error('Servicio no encontrado')
    }

    const servicio = await prisma.servicio.update({
      where: { id },
      data: updateData,
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            telefono: true,
            foto_url: true,
            numero_identificacion: true
          }
        },
        vehiculos: {
          select: {
            id: true,
            placa: true,
            marca: true,
            modelo: true
          }
        },
        clientes: {
          select: {
            id: true,
            nombre: true,
            nit: true
          }
        },
        municipios_servicio_origen_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true
          }
        },
        municipios_servicio_destino_idTomunicipios: {
          select: {
            id: true,
            nombre_municipio: true,
            nombre_departamento: true,
            codigo_municipio: true
          }
        }
      }
    })
    
    // Verificar si se agregó conductor y/o vehículo, y si hay fecha de realización
    const conductorAgregado = !servicioActual.conductor_id && data.conductor_id
    const vehiculoAgregado = !servicioActual.vehiculo_id && data.vehiculo_id
    const tieneFechaRealizacion = data.fecha_realizacion || servicioActual.fecha_realizacion
    const noTieneRecargos = servicioActual.recargos_planillas.length === 0

    // Si se agregó conductor o vehículo, hay fecha de realización, y no tiene recargos, crear recargo automáticamente
    if ((conductorAgregado || vehiculoAgregado) && tieneFechaRealizacion && noTieneRecargos) {
      try {
        const fechaRealizacion = data.fecha_realizacion 
          ? new Date(data.fecha_realizacion) 
          : new Date(servicioActual.fecha_realizacion!)
        
        const mes = fechaRealizacion.getMonth() + 1
        const año = fechaRealizacion.getFullYear()
        
        console.log('🔄 [AUTO-RECARGO-UPDATE] Creando recargo automático al actualizar servicio:', {
          servicio_id: servicio.id,
          conductor_agregado: conductorAgregado,
          vehiculo_agregado: vehiculoAgregado,
          conductor_id: data.conductor_id || servicioActual.conductor_id,
          vehiculo_id: data.vehiculo_id || servicioActual.vehiculo_id,
          numero_planilla: data.numero_planilla || servicioActual.numero_planilla,
          mes,
          año
        })
        
        await RecargosService.create({
          conductor_id: data.conductor_id || servicioActual.conductor_id,
          vehiculo_id: data.vehiculo_id || servicioActual.vehiculo_id,
          empresa_id: servicio.cliente_id,
          numero_planilla: data.numero_planilla || servicioActual.numero_planilla || undefined,
          mes,
          año,
          servicio_id: servicio.id,
          observaciones: `Recargo creado automáticamente al agregar ${conductorAgregado && vehiculoAgregado ? 'conductor y vehículo' : conductorAgregado ? 'conductor' : 'vehículo'} al servicio ${data.numero_planilla || servicioActual.numero_planilla || servicio.id}`,
          dias_laborales: []
        })
        
        console.log('✅ [AUTO-RECARGO-UPDATE] Recargo creado exitosamente')
      } catch (error) {
        console.error('❌ [AUTO-RECARGO-UPDATE] Error creando recargo automático:', error)
        // No lanzar error para no interrumpir la actualización del servicio
      }
    }
    
    return await transformarServicio(servicio)
  },

  async delete(id: string) {
    // Primero, soft delete de los recargos asociados
    await prisma.recargos_planillas.updateMany({
      where: { 
        servicio_id: id,
        deleted_at: null // Solo los que no han sido eliminados
      },
      data: {
        deleted_at: new Date()
      }
    })
    
    // Luego, eliminar el servicio (hard delete por ahora)
    return prisma.servicio.delete({
      where: { id }
    })
  },

  async cambiarEstado(id: string, data: CambiarEstadoInput) {
    const updateData: any = {
      estado: data.estado
    }

    if (data.observaciones) {
      updateData.observaciones = data.observaciones
    }

    // Si se marca como realizado, agregar fecha de finalización
    if (data.estado === 'realizado') {
      updateData.fecha_finalizacion = new Date()
    }

    // Si se marca como en curso, agregar fecha de realización
    if (data.estado === 'en_curso') {
      updateData.fecha_realizacion = new Date()
    }

    const servicio = await prisma.servicio.update({
      where: { id },
      data: updateData,
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        municipios_servicio_origen_idTomunicipios: true,
        municipios_servicio_destino_idTomunicipios: true
      }
    })
    
    return await transformarServicio(servicio)
  },

  async cancelar(id: string, observaciones?: string) {
    const servicio = await prisma.servicio.update({
      where: { id },
      data: {
        estado: 'cancelado',
        observaciones: observaciones || 'Servicio cancelado',
        fecha_finalizacion: new Date()
      },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        municipios_servicio_origen_idTomunicipios: true,
        municipios_servicio_destino_idTomunicipios: true
      }
    })
    
    return await transformarServicio(servicio)
  },

  async asignarNumeroPlanilla(id: string, data: AsignarPlanillaInput) {
    const servicio = await prisma.servicio.update({
      where: { id },
      data: {
        numero_planilla: data.numero_planilla
      },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        municipios_servicio_origen_idTomunicipios: true,
        municipios_servicio_destino_idTomunicipios: true
      }
    })
    
    return await transformarServicio(servicio)
  },

  async buscar(filters: BuscarServiciosInput) {
    const { page = 1, limit = 20, ...searchFilters } = filters
    const skip = (page - 1) * limit

    const where: any = {}

    if (searchFilters.estado) {
      where.estado = searchFilters.estado
    }

    if (searchFilters.conductor_id) {
      where.conductor_id = searchFilters.conductor_id
    }

    if (searchFilters.vehiculo_id) {
      where.vehiculo_id = searchFilters.vehiculo_id
    }

    if (searchFilters.cliente_id) {
      where.cliente_id = searchFilters.cliente_id
    }

    if (searchFilters.proposito_servicio) {
      where.proposito_servicio = searchFilters.proposito_servicio
    }

    if (searchFilters.fecha_desde || searchFilters.fecha_hasta) {
      where.fecha_solicitud = {}
      if (searchFilters.fecha_desde) {
        where.fecha_solicitud.gte = new Date(searchFilters.fecha_desde)
      }
      if (searchFilters.fecha_hasta) {
        where.fecha_solicitud.lte = new Date(searchFilters.fecha_hasta)
      }
    }

    const [servicios, total] = await Promise.all([
      prisma.servicio.findMany({
        where,
        skip,
        take: limit,
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              telefono: true,
              foto_url: true,
              numero_identificacion: true
            }
          },
          vehiculos: {
            select: {
              id: true,
              placa: true,
              marca: true,
              modelo: true
            }
          },
          clientes: {
            select: {
              id: true,
              nombre: true,
              nit: true
            }
          },
          municipios_servicio_origen_idTomunicipios: {
            select: {
              id: true,
              nombre_municipio: true,
              nombre_departamento: true,
              codigo_municipio: true
            }
          },
          municipios_servicio_destino_idTomunicipios: {
            select: {
              id: true,
              nombre_municipio: true,
              nombre_departamento: true,
              codigo_municipio: true
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      }),
      prisma.servicio.count({ where })
    ])

    const serviciosTransformados = servicios.map(transformarServicio)

    return {
      servicios: serviciosTransformados,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: searchFilters
    }
  },

  // Métodos para obtener listas para filtros
  async obtenerConductores(search?: string) {
    const where: any = {
      estado: {
        in: ['ACTIVO', 'disponible', 'servicio']
      }
    }

    if (search && search.trim()) {
      where.OR = [
        { nombre: { contains: search.trim(), mode: 'insensitive' } },
        { apellido: { contains: search.trim(), mode: 'insensitive' } },
        { telefono: { contains: search.trim() } }
      ]
    }

    const conductores = await prisma.conductores.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        apellido: true,
        telefono: true,
        estado: true
      },
      orderBy: [
        { nombre: 'asc' },
        { apellido: 'asc' }
      ],
      take: 100 // Limitar a 100 resultados
    })

    return conductores
  },

  async obtenerVehiculos(search?: string) {
    const where: any = {
      estado: 'DISPONIBLE' // Solo vehículos disponibles
    }

    if (search && search.trim()) {
      where.OR = [
        { placa: { contains: search.trim(), mode: 'insensitive' } },
        { marca: { contains: search.trim(), mode: 'insensitive' } },
        { modelo: { contains: search.trim(), mode: 'insensitive' } }
      ]
    }

    const vehiculos = await prisma.vehiculos.findMany({
      where,
      select: {
        id: true,
        placa: true,
        marca: true,
        modelo: true,
        estado: true
      },
      orderBy: {
        placa: 'asc'
      },
      take: 100 // Limitar a 100 resultados
    })

    return vehiculos
  },

  async obtenerClientes(search?: string) {
    const where: any = {
      deletedAt: null // Solo clientes activos
    }

    if (search && search.trim()) {
      where.OR = [
        { nombre: { contains: search.trim(), mode: 'insensitive' } },
        { nit: { contains: search.trim() } }
      ]
    }

    const clientes = await prisma.clientes.findMany({
      where,
      select: {
        id: true,
        nombre: true,
        nit: true
      },
      orderBy: {
        nombre: 'asc'
      },
      take: 100 // Limitar a 100 resultados
    })

    return clientes
  },

  // Métodos para compartir servicios públicamente
  async generarShareToken(id: string) {
    const servicio = await prisma.servicio.findUnique({
      where: { id },
      select: { id: true, share_token: true, share_token_expires_at: true }
    })
    if (!servicio) throw new Error('Servicio no encontrado')
    if (servicio.share_token) {
      const expiresAt = servicio.share_token_expires_at
      if (!expiresAt || new Date(expiresAt) > new Date()) {
        return { share_token: servicio.share_token, expires_at: expiresAt, servicio_id: id }
      }
    }
    const crypto = await import('crypto')
    const token = crypto.randomBytes(32).toString('hex')
    await prisma.servicio.update({ where: { id }, data: { share_token: token, share_token_expires_at: null }})
    return { share_token: token, expires_at: null, servicio_id: id }
  },

  async revocarShareToken(token: string) {
    const servicio = await prisma.servicio.findUnique({ where: { share_token: token }})
    if (!servicio) throw new Error('Token no encontrado')
    await prisma.servicio.update({ where: { id: servicio.id }, data: { share_token: null, share_token_expires_at: null }})
    return true
  },

  async obtenerPorShareToken(token: string) {
    const servicio = await prisma.servicio.findUnique({ 
      where: { share_token: token }, 
      include: { 
        conductores: { 
          select: { 
            id: true, 
            nombre: true, 
            apellido: true, 
            telefono: true, 
            foto_url: true,
            numero_identificacion: true
          }
        }, 
        vehiculos: { 
          select: { 
            id: true, 
            placa: true, 
            marca: true, 
            modelo: true, 
            linea: true,
            color: true,
            clase_vehiculo: true
          }
        }, 
        clientes: { 
          select: { 
            id: true, 
            nombre: true, 
            nit: true, 
            telefono: true,
            direccion: true,
            representante: true
          }
        }, 
        municipios_servicio_origen_idTomunicipios: { 
          select: { 
            id: true, 
            nombre_municipio: true, 
            nombre_departamento: true, 
            latitud: true, 
            longitud: true 
          }
        }, 
        municipios_servicio_destino_idTomunicipios: { 
          select: { 
            id: true, 
            nombre_municipio: true, 
            nombre_departamento: true, 
            latitud: true, 
            longitud: true 
          }
        }
      }
    })
    if (!servicio) throw new Error('Enlace inválido o expirado')
    if (servicio.share_token_expires_at && new Date(servicio.share_token_expires_at) < new Date()) throw new Error('Este enlace ha expirado')
    return await transformarServicio(servicio)
  }
}
