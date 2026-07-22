import { prisma } from '../../config/prisma'

// ── Tipos ──
export interface CreateSalidaNCInput {
  // Sección 1
  fecha_deteccion: string | Date
  fecha_evento: string | Date
  detectado_por: string
  area_proceso: string
  tipo_deteccion: TipoDeteccion
  tipo_deteccion_otro?: string
  vehiculo_placa?: string
  ruta_trayecto?: string
  turno_horario?: string
  conductor_nombre?: string
  conductor_cedula?: string
  cliente_contrato?: string
  servicio_afectado?: string

  // Sección 2
  descripcion_nc: string
  clasificacion_nc: ClasificacionNC
  tipo_salida_nc: TipoSalidaNC
  tipo_salida_nc_otro?: string

  // Sección 3: Tratamiento aplicado (ISO 8.7.1 a-d / 8.7.2 b-c)
  tratamiento_seleccionado?: TratamientoSNC
  descripcion_accion_tomada?: string
  responsable_accion?: string
  fecha_implementacion?: string | Date
  autoridad_disposicion?: string

  // Sección 4: Concesión formal del cliente (ISO 8.7.1 d / 8.7.2 c)
  concesion_solicitada?: boolean
  condiciones_concesion?: string
  concesion_cliente_nombre?: string
  concesion_cliente_fecha?: string | Date
  concesion_medio?: MedioAutorizacion

  // Sección 5: Verificación de conformidad post-corrección (ISO 8.7.1 párrafo final)
  metodo_verificacion?: MetodoVerificacion
  metodo_verificacion_otro?: string
  resultado_verificacion?: string
  cumple_requisitos?: boolean
  responsable_verificacion?: string
  fecha_verificacion?: string | Date
  firma_verificacion?: string

  // Relaciones opcionales
  conductor_id?: string
  vehiculo_id?: string
  cliente_id?: string

  // Metadata
  estado?: EstadoSNC
  observaciones?: string
  creado_por_id?: string
}

export interface UpdateSalidaNCInput extends Partial<CreateSalidaNCInput> {}

export interface FiltrosSalidasNC {
  clasificacion_nc?: string
  tipo_deteccion?: string
  tipo_salida_nc?: string
  estado?: string
  fecha_desde?: string | Date
  fecha_hasta?: string | Date
  busqueda?: string
  page?: number
  limit?: number
  sortBy?: string
  sortOrder?: 'asc' | 'desc'
}

export type ClasificacionNC = 'CRITICA' | 'MAYOR' | 'MENOR'
export type TipoDeteccion = 'DURANTE_SERVICIO' | 'POST_SERVICIO' | 'AUDITORIA_INTERVENTORIA' | 'REPORTE_CLIENTE' | 'OTRO'
export type TipoSalidaNC =
  | 'GPS_SISTEMA_TECNOLOGICO'
  | 'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO'
  | 'VEHICULO_DIFERENTE_SIN_APROBACION'
  | 'FALLA_MECANICA_ELECTRICA'
  | 'DOCUMENTACION_VENCIDA_INCOMPLETA'
  | 'CONDUCTOR_NO_APTO_INFRACCION_VIAL'
  | 'QUEJA_CLIENTE'
  | 'HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE'
  | 'PERSONAL_NO_AUTORIZADO_TRANSPORTADO'
  | 'OTRO'
export type EstadoSNC = 'ABIERTA' | 'EN_TRATAMIENTO' | 'CERRADA'
export type TratamientoSNC = 'CORRECCION' | 'CONTENCION' | 'SUSPENSION' | 'CONCESION'
export type MedioAutorizacion = 'ESCRITO' | 'CORREO' | 'ACTA'
export type MetodoVerificacion = 'REVISION_DOCUMENTAL' | 'VERIFICACION_OPERATIVA_CAMPO' | 'CONFIRMACION_GPS_PLATAFORMA' | 'CONFIRMACION_CLIENTE_INTERVENTOR' | 'OTRO'

export class SalidasNCService {
  // ── Crear ──
  async crear(data: CreateSalidaNCInput) {
    return await prisma.salidas_no_conformes.create({
      data: {
        fecha_deteccion: new Date(data.fecha_deteccion),
        fecha_evento: new Date(data.fecha_evento),
        detectado_por: data.detectado_por,
        area_proceso: data.area_proceso,
        tipo_deteccion: data.tipo_deteccion as any,
        tipo_deteccion_otro: data.tipo_deteccion_otro,
        vehiculo_placa: data.vehiculo_placa,
        ruta_trayecto: data.ruta_trayecto,
        turno_horario: data.turno_horario,
        conductor_nombre: data.conductor_nombre,
        conductor_cedula: data.conductor_cedula,
        cliente_contrato: data.cliente_contrato,
        servicio_afectado: data.servicio_afectado,
        descripcion_nc: data.descripcion_nc,
        clasificacion_nc: data.clasificacion_nc as any,
        tipo_salida_nc: data.tipo_salida_nc as any,
        tipo_salida_nc_otro: data.tipo_salida_nc_otro,
        tratamiento_seleccionado: data.tratamiento_seleccionado as any,
        descripcion_accion_tomada: data.descripcion_accion_tomada,
        responsable_accion: data.responsable_accion,
        fecha_implementacion: data.fecha_implementacion ? new Date(data.fecha_implementacion as string) : undefined,
        autoridad_disposicion: data.autoridad_disposicion,
        concesion_solicitada: data.concesion_solicitada,
        condiciones_concesion: data.condiciones_concesion,
        concesion_cliente_nombre: data.concesion_cliente_nombre,
        concesion_cliente_fecha: data.concesion_cliente_fecha ? new Date(data.concesion_cliente_fecha as string) : undefined,
        concesion_medio: data.concesion_medio as any,
        metodo_verificacion: data.metodo_verificacion as any,
        metodo_verificacion_otro: data.metodo_verificacion_otro,
        resultado_verificacion: data.resultado_verificacion,
        cumple_requisitos: data.cumple_requisitos,
        responsable_verificacion: data.responsable_verificacion,
        fecha_verificacion: data.fecha_verificacion ? new Date(data.fecha_verificacion as string) : undefined,
        firma_verificacion: data.firma_verificacion,
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        cliente_id: data.cliente_id,
        estado: (data.cumple_requisitos ? 'CERRADA' : 'ABIERTA') as any,
        observaciones: data.observaciones,
        creado_por_id: data.creado_por_id,
      },
      include: {
        conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true, correo: true } },
      }
    })
  }

  // ── Listar con filtros ──
  async listar(filtros: FiltrosSalidasNC) {
    const page = Number(filtros.page) || 1
    const limit = Number(filtros.limit) || 10
    const skip = (page - 1) * limit

    const where: any = {}

    if (filtros.clasificacion_nc) where.clasificacion_nc = filtros.clasificacion_nc
    if (filtros.tipo_deteccion) where.tipo_deteccion = filtros.tipo_deteccion
    if (filtros.tipo_salida_nc) where.tipo_salida_nc = filtros.tipo_salida_nc
    if (filtros.estado) where.estado = filtros.estado

    if (filtros.fecha_desde || filtros.fecha_hasta) {
      where.fecha_deteccion = {}
      if (filtros.fecha_desde) where.fecha_deteccion.gte = new Date(filtros.fecha_desde as string)
      if (filtros.fecha_hasta) where.fecha_deteccion.lte = new Date(filtros.fecha_hasta as string)
    }

    if (filtros.busqueda) {
      where.OR = [
        { detectado_por: { contains: filtros.busqueda, mode: 'insensitive' } },
        { conductor_nombre: { contains: filtros.busqueda, mode: 'insensitive' } },
        { descripcion_nc: { contains: filtros.busqueda, mode: 'insensitive' } },
        { area_proceso: { contains: filtros.busqueda, mode: 'insensitive' } },
        { vehiculo_placa: { contains: filtros.busqueda, mode: 'insensitive' } },
        { ruta_trayecto: { contains: filtros.busqueda, mode: 'insensitive' } },
      ]
    }

    // Ordenamiento
    const sortBy = filtros.sortBy || 'numero_snc'
    const sortOrder = filtros.sortOrder || 'desc'
    const orderBy: any = { [sortBy]: sortOrder }

    const [salidas, total] = await Promise.all([
      prisma.salidas_no_conformes.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
          vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
          cliente: { select: { id: true, nombre: true, nit: true } },
          creado_por: { select: { id: true, nombre: true, correo: true } },
        }
      }),
      prisma.salidas_no_conformes.count({ where })
    ])

    return {
      salidas,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    }
  }

  // ── Obtener por ID ──
  async obtenerPorId(id: string) {
    const salida = await prisma.salidas_no_conformes.findUnique({
      where: { id },
      include: {
        conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true, correo: true } },
      }
    })

    if (!salida) throw new Error('Salida no conforme no encontrada')
    return salida
  }

  // ── Actualizar ──
  async actualizar(id: string, data: UpdateSalidaNCInput) {
    await this.obtenerPorId(id) // Verificar que existe

    const updateData: any = { ...data, estado: (data.cumple_requisitos ? 'CERRADA' : 'ABIERTA') as any,}

    // Convertir fechas si vienen como string
    if (data.fecha_deteccion) updateData.fecha_deteccion = new Date(data.fecha_deteccion as string)
    if (data.fecha_evento) updateData.fecha_evento = new Date(data.fecha_evento as string)
    if (data.fecha_implementacion) updateData.fecha_implementacion = new Date(data.fecha_implementacion as string)
    if (data.concesion_cliente_fecha) updateData.concesion_cliente_fecha = new Date(data.concesion_cliente_fecha as string)
    if (data.fecha_verificacion) updateData.fecha_verificacion = new Date(data.fecha_verificacion as string)

    return await prisma.salidas_no_conformes.update({
      where: { id },
      data: updateData,
      include: {
        conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true, correo: true } },
      }
    })
  }

  // ── Eliminar ──
  async eliminar(id: string) {
    await this.obtenerPorId(id)
    await prisma.salidas_no_conformes.delete({ where: { id } })
    return { message: 'Salida no conforme eliminada exitosamente' }
  }

  // ── Estadísticas ──
  async estadisticas() {
    const [total, porClasificacion, porEstado, porTipoDeteccion] = await Promise.all([
      prisma.salidas_no_conformes.count(),
      prisma.salidas_no_conformes.groupBy({
        by: ['clasificacion_nc'],
        _count: true,
      }),
      prisma.salidas_no_conformes.groupBy({
        by: ['estado'],
        _count: true,
      }),
      prisma.salidas_no_conformes.groupBy({
        by: ['tipo_deteccion'],
        _count: true,
      }),
    ])

    return {
      total,
      porClasificacion: porClasificacion.map(r => ({ clasificacion: r.clasificacion_nc, count: r._count })),
      porEstado: porEstado.map(r => ({ estado: r.estado, count: r._count })),
      porTipoDeteccion: porTipoDeteccion.map(r => ({ tipo: r.tipo_deteccion, count: r._count })),
    }
  }

  // ── Siguiente número SNC ──
  async siguienteNumero() {
    const ultima = await prisma.salidas_no_conformes.findFirst({
      orderBy: { numero_snc: 'desc' },
      select: { numero_snc: true }
    })
    return (ultima?.numero_snc || 0) + 1
  }
}
