import { prisma } from '../../config/prisma'
import { CreateServicioInput, UpdateServicioInput, CambiarEstadoInput, AsignarPlanillaInput, BuscarServiciosInput } from './servicios.schema'
import { getS3SignedUrl } from '../../config/aws'
import { RecargosService } from '../recargos/recargos.service'
import { randomUUID } from 'crypto'
import { aplicarEfectosColaterales, ServicioEstado } from './servicios.estados'

/**
 * Obtener fotos de conductores en batch (1 sola query para todos).
 * Retorna un Map<conductor_id, ruta_archivo>
 */
async function obtenerFotosConductoresBatch(
  conductorIds: string[]
): Promise<Map<string, string>> {
  const fotoMap = new Map<string, string>()
  if (conductorIds.length === 0) return fotoMap

  try {
    // 1. Traer conductores (para fallback)
    const conductores = await prisma.conductores.findMany({
      where: {
        id: { in: conductorIds },
      },
      select: {
        id: true,
        foto_url: true,
      },
    })

    // Inicializar mapa con fallback
    for (const c of conductores) {
      if (c.id) {
        fotoMap.set(c.id, c.foto_url || '')
      }
    }

    // 2. Traer fotos de perfil (más recientes primero)
    const fotos = await prisma.documento.findMany({
      where: {
        conductor_id: { in: conductorIds },
        categoria: 'FOTO_PERFIL',
        estado: 'vigente',
      },
      select: {
        conductor_id: true,
        ruta_archivo: true,
        created_at: true,
      },
      orderBy: {
        created_at: 'desc',
      },
    })

    // 3. Sobrescribir con la foto más reciente si existe
    for (const foto of fotos) {
      if (
        foto.conductor_id &&
        foto.ruta_archivo &&
        fotoMap.get(foto.conductor_id) === ''
      ) {
        fotoMap.set(foto.conductor_id, foto.ruta_archivo)
      }
    }
  } catch (error) {
    console.error(
      'Error obteniendo fotos de conductores en batch:',
      error
    )
  }

  return fotoMap
}

/**
 * Transformar un array de servicios en batch (eficiente: 1 query de fotos + URLs firmadas en paralelo).
 */
async function transformarServiciosBatch(servicios: any[]): Promise<any[]> {
  if (!servicios || servicios.length === 0) return []

  // 1. Recolectar IDs de conductores únicos
  const conductorIds = [...new Set(
    servicios
      .map(s => s.conductores?.id)
      .filter((id): id is string => !!id)
  )]

  // 2. Una sola query para obtener todas las fotos
  const fotoMap = await obtenerFotosConductoresBatch(conductorIds)

  // 3. Generar URLs firmadas en paralelo (sin queries a DB)
  const signedUrlMap = new Map<string, string>()
  const urlEntries = Array.from(fotoMap.entries())
  if (urlEntries.length > 0) {
    const signedUrls = await Promise.all(
      urlEntries.map(([_, ruta]) => getS3SignedUrl(ruta, 3600).catch(() => null))
    )
    urlEntries.forEach(([conductorId], i) => {
      if (signedUrls[i]) {
        signedUrlMap.set(conductorId, signedUrls[i]!)
      }
    })
  }

  // 4. Transformar cada servicio (sin queries adicionales)
  return servicios.map(servicio => transformarServicioSync(servicio, signedUrlMap))
}

/**
 * Transformar un servicio individual con un mapa de fotos pre-cargadas (sin queries).
 */
function transformarServicioSync(servicio: any, signedUrlMap?: Map<string, string>) {
  if (!servicio) return null

  const servicioPlano = JSON.parse(JSON.stringify(servicio))

  let conductor = servicioPlano.conductores || null
  const cliente = servicioPlano.clientes || null
  const vehiculo = servicioPlano.vehiculos || null
  const origen = servicioPlano.municipios_servicio_origen_idTomunicipios || null
  const destino = servicioPlano.municipios_servicio_destino_idTomunicipios || null

  // Asignar foto firmada si está pre-cargada
  if (conductor && conductor.id) {
    conductor.foto_signed_url = signedUrlMap?.get(conductor.id) || null
  }

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

/**
 * Helper para transformar un servicio individual (para endpoints que devuelven 1 solo servicio).
 * Hace 1 query de foto + 1 URL firmada.
 */
async function transformarServicio(servicio: any) {
  if (!servicio) {
    return null
  }
  
  const servicioPlano = JSON.parse(JSON.stringify(servicio))
  
  let conductor = servicioPlano.conductores || null
  const cliente = servicioPlano.clientes || null
  const vehiculo = servicioPlano.vehiculos || null
  const origen = servicioPlano.municipios_servicio_origen_idTomunicipios || null
  const destino = servicioPlano.municipios_servicio_destino_idTomunicipios || null
  
  // Si hay conductor, obtener su foto desde la tabla documento
  if (conductor && conductor.id) {
    try {
      const fotoDocumento = await prisma.documento.findFirst({
        where: {
          conductor_id: conductor.id,
          categoria: 'FOTO_PERFIL',
          estado: 'vigente'
        },
        select: { ruta_archivo: true },
        orderBy: { created_at: 'desc' }
      })
      
      if (fotoDocumento && fotoDocumento.ruta_archivo) {
        conductor.foto_signed_url = await getS3SignedUrl(fotoDocumento.ruta_archivo, 3600)
      } else {
        conductor.foto_signed_url = null
      }
    } catch (error) {
      console.error('Error obteniendo foto del conductor:', error)
      conductor.foto_signed_url = null
    }
  }
  
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
    const estadoInicial: ServicioEstado = (data.estado as ServicioEstado) || 'solicitado'

    const servicio = await prisma.$transaction(async (tx) => {
      const created = await tx.servicio.create({
        data: {
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          cliente_id: data.cliente_id,
          origen_id: data.origen_id,
          destino_id: data.destino_id,
          origen_especifico: data.origen_especifico || '',
          destino_especifico: data.destino_especifico || '',
          estado: estadoInicial as any,
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

      // Aplicar efectos colaterales: si el servicio se crea en planificado o en_curso
      // y trae conductor/vehículo asignados, marcarlos como programado/servicio.
      if (estadoInicial !== 'solicitado' && estadoInicial !== 'pendiente' && estadoInicial !== 'cancelado') {
        await aplicarEfectosColaterales({
          servicioId: created.id,
          estadoAnterior: 'solicitado',
          estadoNuevo: estadoInicial,
          conductorIdAnterior: null,
          conductorIdNuevo: created.conductor_id,
          vehiculoIdAnterior: null,
          vehiculoIdNuevo: created.vehiculo_id,
          tx
        })
      }

      return created
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
    
    return (await transformarServiciosBatch([servicio]))[0] || null
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
        },
        recargos_planillas: {
          select: {
            id: true,
            numero_planilla: true,
            mes: true,
            a_o: true,
            total_dias_laborados: true,
            total_horas_trabajadas: true,
            estado: true,
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
            numero_dias_servicio: true,
            dias_laborales_planillas: {
              where: { deleted_at: null },
              orderBy: { dia: 'asc' },
              select: {
                dia: true,
                kilometraje_inicial: true,
                kilometraje_final: true
              }
            }
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

    // Transformar los datos en batch (1 sola query de fotos para todos los conductores)
    const serviciosTransformados = await transformarServiciosBatch(servicios)

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
    
    return (await transformarServiciosBatch([servicio]))[0] || null
  },

  async update(id: string, data: UpdateServicioInput, userId?: string) {
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

    const servicio = await prisma.$transaction(async (tx) => {
      // Obtener estado anterior con sus recursos asignados
      const anterior = await tx.servicio.findUnique({
        where: { id },
        select: {
          estado: true,
          conductor_id: true,
          vehiculo_id: true
        }
      })

      if (!anterior) {
        throw new Error('Servicio no encontrado')
      }

      const estadoAnterior = anterior.estado as ServicioEstado
      const estadoNuevo: ServicioEstado = (data.estado as ServicioEstado) || estadoAnterior

      const updated = await tx.servicio.update({
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

      // Aplicar efectos colaterales si cambió el estado o los recursos
      const cambioEstado = estadoAnterior !== estadoNuevo
      const cambioConductor = anterior.conductor_id !== updated.conductor_id
      const cambioVehiculo = anterior.vehiculo_id !== updated.vehiculo_id

      if (cambioEstado || cambioConductor || cambioVehiculo) {
        await aplicarEfectosColaterales({
          servicioId: id,
          estadoAnterior,
          estadoNuevo,
          conductorIdAnterior: anterior.conductor_id,
          conductorIdNuevo: updated.conductor_id,
          vehiculoIdAnterior: anterior.vehiculo_id,
          vehiculoIdNuevo: updated.vehiculo_id,
          tx
        })
      }

      return updated
    })
    
    // Auto-crear recargo si se cumplen las condiciones
    // 1. Tiene fecha de realización
    // 2. Tiene conductor asignado
    // 3. Tiene vehículo asignado
    // 4. Aún no tiene recargo asociado
    if (data.fecha_realizacion && servicio.conductor_id && servicio.vehiculo_id) {
      try {
        // Verificar si ya existe un recargo para este servicio
        const recargoExistente = await prisma.recargos_planillas.findFirst({
          where: {
            servicio_id: servicio.id,
            deleted_at: null
          }
        })
        
        if (!recargoExistente) {
          const fechaRealizacion = new Date(data.fecha_realizacion)
          const mes = fechaRealizacion.getMonth() + 1
          const año = fechaRealizacion.getFullYear()
          
          console.log('🔄 [AUTO-RECARGO UPDATE] Creando recargo automático al editar servicio:', {
            servicio_id: servicio.id,
            numero_planilla: servicio.numero_planilla,
            mes,
            año,
            conductor_id: servicio.conductor_id,
            vehiculo_id: servicio.vehiculo_id
          })
          
          await RecargosService.create({
            conductor_id: servicio.conductor_id,
            vehiculo_id: servicio.vehiculo_id,
            empresa_id: servicio.cliente_id,
            numero_planilla: servicio.numero_planilla || undefined,
            mes,
            año,
            servicio_id: servicio.id,
            observaciones: `Recargo creado automáticamente al editar servicio ${servicio.numero_planilla || servicio.id}`,
            dias_laborales: []
          }, userId)
          
          console.log('✅ [AUTO-RECARGO UPDATE] Recargo creado exitosamente')
        } else {
          console.log('ℹ️ [AUTO-RECARGO UPDATE] El servicio ya tiene un recargo asociado')
          
          // Si el recargo existe, actualizar sus campos si cambiaron
          const camposActualizados: any = {}
          let huboActualizacion = false
          
          if (data.conductor_id && recargoExistente.conductor_id !== servicio.conductor_id) {
            camposActualizados.conductor_id = servicio.conductor_id
            huboActualizacion = true
            console.log('📝 [AUTO-RECARGO UPDATE] Actualizando conductor en recargo')
          }
          
          if (data.vehiculo_id && recargoExistente.vehiculo_id !== servicio.vehiculo_id) {
            camposActualizados.vehiculo_id = servicio.vehiculo_id
            huboActualizacion = true
            console.log('📝 [AUTO-RECARGO UPDATE] Actualizando vehículo en recargo')
          }
          
          if (data.cliente_id && recargoExistente.empresa_id !== servicio.cliente_id) {
            camposActualizados.empresa_id = servicio.cliente_id
            huboActualizacion = true
            console.log('📝 [AUTO-RECARGO UPDATE] Actualizando empresa en recargo')
          }
          
          // Si cambió la fecha de realización, actualizar mes y año
          if (data.fecha_realizacion) {
            const fechaRealizacion = new Date(data.fecha_realizacion)
            const nuevoMes = fechaRealizacion.getMonth() + 1
            const nuevoAño = fechaRealizacion.getFullYear()
            
            if (recargoExistente.mes !== nuevoMes || recargoExistente.a_o !== nuevoAño) {
              camposActualizados.mes = nuevoMes
              camposActualizados.a_o = nuevoAño
              huboActualizacion = true
              console.log('📝 [AUTO-RECARGO UPDATE] Actualizando mes/año en recargo')
            }
          }
          
          if (huboActualizacion) {
            // Agregar campos de auditoría
            camposActualizados.actualizado_por_id = userId
            camposActualizados.version = { increment: 1 }
            
            await prisma.recargos_planillas.update({
              where: { id: recargoExistente.id },
              data: camposActualizados
            })
            
            console.log('✅ [AUTO-RECARGO UPDATE] Recargo actualizado exitosamente:', {
              recargo_id: recargoExistente.id,
              campos_actualizados: Object.keys(camposActualizados).filter(k => k !== 'actualizado_por_id' && k !== 'version')
            })
          }
        }
      } catch (error) {
        console.error('❌ [AUTO-RECARGO UPDATE] Error en auto-recargo:', error)
        // No lanzar error para no interrumpir la actualización del servicio
      }
    }
    
    return (await transformarServiciosBatch([servicio]))[0] || null
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

    const servicio = await prisma.$transaction(async (tx) => {
      const anterior = await tx.servicio.findUnique({
        where: { id },
        select: { estado: true, conductor_id: true, vehiculo_id: true }
      })

      if (!anterior) {
        throw new Error('Servicio no encontrado')
      }

      const estadoAnterior = anterior.estado as ServicioEstado
      const estadoNuevo = data.estado as ServicioEstado

      // Para transición a cancelado desde planilla_asignada o liquidado: bloquear
      // La FSM ya valida esto, pero queremos un error claro para el cliente
      if (estadoAnterior === estadoNuevo) {
        // No-op, no aplicar efectos
        const current = await tx.servicio.findUnique({
          where: { id },
          include: {
            conductores: true,
            vehiculos: true,
            clientes: true,
            municipios_servicio_origen_idTomunicipios: true,
            municipios_servicio_destino_idTomunicipios: true
          }
        })
        return current
      }

      const updated = await tx.servicio.update({
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

      await aplicarEfectosColaterales({
        servicioId: id,
        estadoAnterior,
        estadoNuevo,
        conductorIdAnterior: anterior.conductor_id,
        conductorIdNuevo: updated.conductor_id,
        vehiculoIdAnterior: anterior.vehiculo_id,
        vehiculoIdNuevo: updated.vehiculo_id,
        tx
      })

      return updated
    })
    
    return (await transformarServiciosBatch([servicio]))[0] || null
  },

  async cancelar(id: string, observaciones?: string) {
    const servicio = await prisma.$transaction(async (tx) => {
      const anterior = await tx.servicio.findUnique({
        where: { id },
        select: { estado: true, conductor_id: true, vehiculo_id: true }
      })

      if (!anterior) {
        throw new Error('Servicio no encontrado')
      }

      const estadoAnterior = anterior.estado as ServicioEstado
      const estadoNuevo: ServicioEstado = 'cancelado'

      const updated = await tx.servicio.update({
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

      await aplicarEfectosColaterales({
        servicioId: id,
        estadoAnterior,
        estadoNuevo,
        conductorIdAnterior: anterior.conductor_id,
        conductorIdNuevo: updated.conductor_id,
        vehiculoIdAnterior: anterior.vehiculo_id,
        vehiculoIdNuevo: updated.vehiculo_id,
        tx
      })

      return updated
    })
    
    return (await transformarServiciosBatch([servicio]))[0] || null
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
    
    return (await transformarServiciosBatch([servicio]))[0] || null
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

    const serviciosTransformados = await transformarServiciosBatch(servicios)

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
      oculto: false
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
        tipo_identificacion: true,
        numero_identificacion: true,
        telefono: true,
        estado: true
      },
      orderBy: [
        { nombre: 'asc' },
        { apellido: 'asc' }
      ]
    })

    return conductores
  },

  async obtenerVehiculos(search?: string) {
    const where: any = {
      deleted_at: null,
      oculto: false
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
      }
    })

    return vehiculos
  },

  async obtenerClientes(search?: string) {
    const where: any = {
      deletedAt: null,
      oculto: false
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
      }
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

  /**
   * Obtener servicios para vista de calendario, filtrados por mes/año y campo de fecha.
   * Devuelve los servicios completos con relaciones, sin paginar (el mes limita el rango).
   */
  async calendar(filters: {
    mes: number
    anio: number
    campo_fecha: 'fecha_solicitud' | 'fecha_realizacion' | 'fecha_finalizacion'
    estado?: string
    conductor_id?: string
    vehiculo_id?: string
    cliente_id?: string
  }) {
    const { mes, anio, campo_fecha, estado, conductor_id, vehiculo_id, cliente_id } = filters

    // Rango del mes completo: [inicio del mes 00:00, inicio del mes siguiente 00:00)
    const fechaInicio = new Date(Date.UTC(anio, mes - 1, 1, 0, 0, 0, 0))
    const fechaFin = new Date(Date.UTC(anio, mes, 1, 0, 0, 0, 0))

    const where: any = {
      [campo_fecha]: {
        gte: fechaInicio,
        lt: fechaFin
      }
    }

    if (estado) where.estado = estado
    if (conductor_id) where.conductor_id = conductor_id
    if (vehiculo_id) where.vehiculo_id = vehiculo_id
    if (cliente_id) where.cliente_id = cliente_id

    const servicios = await prisma.servicio.findMany({
      where,
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
        [campo_fecha]: 'asc'
      }
    })

    const serviciosTransformados = await transformarServiciosBatch(servicios)

    return {
      servicios: serviciosTransformados,
      total: serviciosTransformados.length,
      mes,
      anio,
      campo_fecha,
      rango: {
        desde: fechaInicio.toISOString(),
        hasta: new Date(fechaFin.getTime() - 1).toISOString()
      }
    }
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
    return (await transformarServiciosBatch([servicio]))[0] || null
  }
}
