import { prisma } from '../../config/prisma'

export interface PesvFilters {
  mes?: number
  anio?: number
}

export interface ChartItem {
  label: string
  value: number
  id?: string
}

export interface PesvDashboardData {
  kpis: {
    totalConductores: number
    totalVehiculos: number
    totalServicios: number
    totalServiciosRealizados: number
    totalExcesos: number
    totalPreoperacionales: number
    porcentajePreoperacional: number
  }
  charts: {
    vehiculosMasDiasTrabajados: ChartItem[]
    conductoresMasDiasTrabajados: ChartItem[]
    clientesMasDiasTrabajados: ChartItem[]
    vehiculosMasPreoperacionales: ChartItem[]
    excesosVelocidadPorConductor: ChartItem[]
  }
}

export class PesvService {

  /**
   * Get PESV dashboard data with chart-oriented aggregations
   */
  static async getDashboard(filters: PesvFilters): Promise<PesvDashboardData> {
    const { mes, anio } = filters

    const currentDate = new Date()
    const filterMes = mes || (currentDate.getMonth() + 1)
    const filterAnio = anio || currentDate.getFullYear()

    // Build date range for the month
    const startDate = new Date(filterAnio, filterMes - 1, 1)
    const endDate = new Date(filterAnio, filterMes, 0, 23, 59, 59) // last day of month
    const diasMes = new Date(filterAnio, filterMes, 0).getDate()
    const diasLaborablesAprox = Math.round(diasMes * 5 / 7)

    // --- KPIs ---
    // Conductores y vehículos únicos con presencia en el mes (basado en días laborales planillas)
    const [
      conductoresDelMes,
      vehiculosDelMes,
      totalServiciosMes,
      totalServiciosRealizados,
      totalExcesosMes,
      totalPreopMes,
    ] = await Promise.all([
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT rp.conductor_id) as count
        FROM dias_laborales_planillas dlp
        JOIN recargos_planillas rp ON dlp.recargo_planilla_id = rp.id
        WHERE dlp.deleted_at IS NULL
          AND rp.deleted_at IS NULL
          AND rp.mes = ${filterMes}
          AND rp.año = ${filterAnio}
      `,
      prisma.$queryRaw<[{ count: bigint }]>`
        SELECT COUNT(DISTINCT rp.vehiculo_id) as count
        FROM dias_laborales_planillas dlp
        JOIN recargos_planillas rp ON dlp.recargo_planilla_id = rp.id
        WHERE dlp.deleted_at IS NULL
          AND rp.deleted_at IS NULL
          AND rp.mes = ${filterMes}
          AND rp.año = ${filterAnio}
      `,
      prisma.servicio.count({
        where: {
          fecha_solicitud: { gte: startDate, lte: endDate },
          estado: { not: 'cancelado' },
        }
      }),
      prisma.servicio.count({
        where: {
          fecha_solicitud: { gte: startDate, lte: endDate },
          estado: 'realizado',
        }
      }),
      prisma.excesos_velocidad.aggregate({
        _sum: { cantidad: true },
        where: {
          mes: filterMes,
          anio: filterAnio,
        }
      }),
      prisma.preoperacionales.count({
        where: {
          fecha: { gte: startDate, lte: endDate },
          realizado: true,
        }
      }),
    ])

    const totalConductores = Number(conductoresDelMes[0]?.count || 0)
    const totalVehiculos = Number(vehiculosDelMes[0]?.count || 0)

    // --- CHART DATA (based on dias_laborales_planillas for accuracy) ---
    // One query to get all day records for the period, with conductor, vehiculo, and empresa info
    const diasLaboralesRaw = await prisma.dias_laborales_planillas.findMany({
      where: {
        deleted_at: null,
        recargos_planillas: {
          mes: filterMes,
          a_o: filterAnio,
          deleted_at: null,
        },
      },
      select: {
        recargos_planillas: {
          select: {
            conductor_id: true,
            vehiculo_id: true,
            empresa_id: true,
          },
        },
      },
    })

    // Aggregate counts per conductor, vehiculo, cliente
    const diasPorConductor = new Map<string, number>()
    const diasPorVehiculo = new Map<string, number>()
    const diasPorCliente = new Map<string, number>()

    diasLaboralesRaw.forEach(d => {
      const { conductor_id, vehiculo_id, empresa_id } = d.recargos_planillas
      diasPorConductor.set(conductor_id, (diasPorConductor.get(conductor_id) || 0) + 1)
      diasPorVehiculo.set(vehiculo_id, (diasPorVehiculo.get(vehiculo_id) || 0) + 1)
      diasPorCliente.set(empresa_id, (diasPorCliente.get(empresa_id) || 0) + 1)
    })

    // Sort and take top 10 for each
    const topConductores = Array.from(diasPorConductor.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const topVehiculos = Array.from(diasPorVehiculo.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)
    const topClientes = Array.from(diasPorCliente.entries()).sort((a, b) => b[1] - a[1]).slice(0, 10)

    // Fetch names in parallel
    const allConductorIds = topConductores.map(([id]) => id)
    const allVehiculoIds = topVehiculos.map(([id]) => id)
    const allClienteIds = topClientes.map(([id]) => id)

    const [conductoresInfo, vehiculosInfo, clientesInfo] = await Promise.all([
      allConductorIds.length > 0
        ? prisma.conductores.findMany({ where: { id: { in: allConductorIds } }, select: { id: true, nombre: true, apellido: true } })
        : [],
      allVehiculoIds.length > 0
        ? prisma.vehiculos.findMany({ where: { id: { in: allVehiculoIds } }, select: { id: true, placa: true } })
        : [],
      allClienteIds.length > 0
        ? prisma.clientes.findMany({ where: { id: { in: allClienteIds } }, select: { id: true, nombre: true } })
        : [],
    ])

    const conductorNameMap = new Map<string, string>()
    conductoresInfo.forEach(c => conductorNameMap.set(c.id, `${c.nombre} ${c.apellido}`))
    const vehiculoPlacaMap = new Map<string, string>()
    vehiculosInfo.forEach(v => vehiculoPlacaMap.set(v.id, v.placa))
    const clienteNameMap = new Map<string, string>()
    clientesInfo.forEach(c => clienteNameMap.set(c.id, c.nombre))

    // 1. Top vehículos por días trabajados
    const vehiculosMasDiasTrabajados: ChartItem[] = topVehiculos.map(([id, count]) => ({
      label: vehiculoPlacaMap.get(id) || 'N/A',
      value: count,
      id,
    }))

    // 2. Top conductores por días trabajados
    const conductoresMasDiasTrabajados: ChartItem[] = topConductores.map(([id, count]) => ({
      label: conductorNameMap.get(id) || 'N/A',
      value: count,
      id,
    }))

    // 3. Top clientes por días trabajados
    const clientesMasDiasTrabajados: ChartItem[] = topClientes.map(([id, count]) => ({
      label: clienteNameMap.get(id) || 'N/A',
      value: count,
      id,
    }))

    // 4. Top 10 vehicles by preoperacionales count
    const preopsByVehiculo = await prisma.preoperacionales.groupBy({
      by: ['vehiculo_id'],
      where: {
        fecha: { gte: startDate, lte: endDate },
        realizado: true,
      },
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    })

    const preopVehiculoIds = preopsByVehiculo.map(p => p.vehiculo_id)
    const preopVehiculosInfo = preopVehiculoIds.length > 0 ? await prisma.vehiculos.findMany({
      where: { id: { in: preopVehiculoIds } },
      select: { id: true, placa: true },
    }) : []
    const preopVehiculoMap = new Map(preopVehiculosInfo.map(v => [v.id, v.placa]))

    const vehiculosMasPreoperacionales: ChartItem[] = preopsByVehiculo.map(p => ({
      label: preopVehiculoMap.get(p.vehiculo_id) || p.vehiculo_id,
      value: p._count.id,
      id: p.vehiculo_id,
    }))

    // 5. Excesos de velocidad by conductor (top 10)
    const excesosByConductor = await prisma.excesos_velocidad.groupBy({
      by: ['conductor_id'],
      where: {
        mes: filterMes,
        anio: filterAnio,
      },
      _sum: { cantidad: true },
      orderBy: { _sum: { cantidad: 'desc' } },
      take: 10,
    })

    const excConductorIds = excesosByConductor.map(e => e.conductor_id)
    const excConductoresInfo = excConductorIds.length > 0 ? await prisma.conductores.findMany({
      where: { id: { in: excConductorIds } },
      select: { id: true, nombre: true, apellido: true },
    }) : []
    const excConductorMap = new Map(excConductoresInfo.map(c => [c.id, `${c.nombre} ${c.apellido}`]))

    const excesosVelocidadPorConductor: ChartItem[] = excesosByConductor.map(e => ({
      label: excConductorMap.get(e.conductor_id) || 'N/A',
      value: Number(e._sum.cantidad || 0),
      id: e.conductor_id,
    }))

    // Calculate preoperational percentage
    const porcentajePreop = totalVehiculos > 0
      ? Math.round((totalPreopMes / (totalVehiculos * diasLaborablesAprox)) * 100)
      : 0

    return {
      kpis: {
        totalConductores,
        totalVehiculos,
        totalServicios: totalServiciosMes,
        totalServiciosRealizados,
        totalExcesos: Number(totalExcesosMes._sum.cantidad || 0),
        totalPreoperacionales: totalPreopMes,
        porcentajePreoperacional: Math.min(porcentajePreop, 100),
      },
      charts: {
        vehiculosMasDiasTrabajados,
        conductoresMasDiasTrabajados,
        clientesMasDiasTrabajados,
        vehiculosMasPreoperacionales,
        excesosVelocidadPorConductor,
      },
    }
  }

  // ==================== REGISTROS DIARIOS (TABLA PESV) ====================

  static async getRegistrosDiarios(filters: { mes: number; anio: number; conductor_id?: string; vehiculo_id?: string; cliente_id?: string }) {
    const { mes, anio, conductor_id, vehiculo_id, cliente_id } = filters

    const whereRecargo: any = {
      mes,
      a_o: anio,
      deleted_at: null,
    }
    if (conductor_id) whereRecargo.conductor_id = conductor_id
    if (vehiculo_id) whereRecargo.vehiculo_id = vehiculo_id
    if (cliente_id) whereRecargo.empresa_id = cliente_id

    const registros = await prisma.dias_laborales_planillas.findMany({
      where: {
        deleted_at: null,
        recargos_planillas: whereRecargo,
      },
      select: {
        id: true,
        dia: true,
        hora_inicio: true,
        hora_fin: true,
        total_horas: true,
        disponibilidad: true,
        horas_sueno: true,
        excesos_velocidad_dia: true,
        preoperacional_realizado: true,
        siniestros: true,
        siniestros_detalle: true,
        pernocte: true,
        observaciones: true,
        recargos_planillas: {
          select: {
            id: true,
            conductor_id: true,
            vehiculo_id: true,
            empresa_id: true,
            servicio_id: true,
            tiempo_disponibilidad_horas: true,
            conductores: {
              select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
            },
            vehiculos: {
              select: { id: true, placa: true },
            },
            clientes: {
              select: { id: true, nombre: true },
            },
            servicio: {
              select: {
                id: true,
                origen_especifico: true,
                destino_especifico: true,
                municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
                municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true } },
              },
            },
          },
        },
      },
      orderBy: [
        { recargos_planillas: { conductores: { nombre: 'asc' } } },
        { dia: 'asc' },
      ],
    })

    // Count servicios per conductor per day
    const startDate = new Date(anio, mes - 1, 1)
    const endDate = new Date(anio, mes, 0, 23, 59, 59)

    const serviciosCounts = await prisma.$queryRaw<{ conductor_id: string; dia: number; count: bigint }[]>`
      SELECT 
        rp.conductor_id,
        dlp.dia,
        COUNT(DISTINCT rp.servicio_id) as count
      FROM dias_laborales_planillas dlp
      JOIN recargos_planillas rp ON dlp.recargo_planilla_id = rp.id
      WHERE dlp.deleted_at IS NULL
        AND rp.deleted_at IS NULL
        AND rp.mes = ${mes}
        AND rp.año = ${anio}
        AND rp.servicio_id IS NOT NULL
      GROUP BY rp.conductor_id, dlp.dia
    `

    const serviciosMap = new Map<string, number>()
    serviciosCounts.forEach(s => {
      serviciosMap.set(`${s.conductor_id}-${s.dia}`, Number(s.count))
    })

    // Format the response
    return registros.map(r => {
      const rp = r.recargos_planillas
      const servicioKey = `${rp.conductor_id}-${r.dia}`
      return {
        id: r.id,
        dia: r.dia,
        fecha: `${anio}-${String(mes).padStart(2, '0')}-${String(r.dia).padStart(2, '0')}`,
        conductor: {
          id: rp.conductor_id,
          nombre: `${rp.conductores.nombre} ${rp.conductores.apellido}`,
          numero_identificacion: rp.conductores.numero_identificacion,
        },
        vehiculo: {
          id: rp.vehiculo_id,
          placa: rp.vehiculos.placa,
        },
        cliente: {
          id: rp.empresa_id,
          nombre: rp.clientes.nombre,
        },
        origen: rp.servicio
          ? (rp.servicio.municipios_servicio_origen_idTomunicipios.nombre_municipio + (rp.servicio.origen_especifico ? ` - ${rp.servicio.origen_especifico}` : ''))
          : null,
        destino: rp.servicio
          ? (rp.servicio.municipios_servicio_destino_idTomunicipios.nombre_municipio + (rp.servicio.destino_especifico ? ` - ${rp.servicio.destino_especifico}` : ''))
          : null,
        num_servicios: serviciosMap.get(servicioKey) || 0,
        tiempo_conduccion: Number(r.total_horas || 0),
        tiempo_disponibilidad: Number(rp.tiempo_disponibilidad_horas || 0),
        horas_sueno: r.horas_sueno !== null ? Number(r.horas_sueno) : null,
        excesos_velocidad_dia: r.excesos_velocidad_dia || 0,
        preoperacional_realizado: r.preoperacional_realizado || false,
        siniestros: r.siniestros || 0,
        siniestros_detalle: r.siniestros_detalle,
        pernocte: r.pernocte,
        observaciones: r.observaciones,
      }
    })
  }

  static async updateRegistroDiaPesv(id: string, data: {
    horas_sueno?: number | null
    excesos_velocidad_dia?: number
    preoperacional_realizado?: boolean
    siniestros?: number
    siniestros_detalle?: string | null
  }) {
    return prisma.dias_laborales_planillas.update({
      where: { id },
      data: {
        horas_sueno: data.horas_sueno !== undefined ? data.horas_sueno : undefined,
        excesos_velocidad_dia: data.excesos_velocidad_dia !== undefined ? data.excesos_velocidad_dia : undefined,
        preoperacional_realizado: data.preoperacional_realizado !== undefined ? data.preoperacional_realizado : undefined,
        siniestros: data.siniestros !== undefined ? data.siniestros : undefined,
        siniestros_detalle: data.siniestros_detalle !== undefined ? data.siniestros_detalle : undefined,
        updated_at: new Date(),
      },
    })
  }

  // ==================== EXCESOS VELOCIDAD CRUD ====================

  static async getExcesos(filters: { conductor_id?: string; vehiculo_id?: string; mes?: number; anio?: number }) {
    const where: any = {}
    if (filters.conductor_id) where.conductor_id = filters.conductor_id
    if (filters.vehiculo_id) where.vehiculo_id = filters.vehiculo_id
    if (filters.mes) where.mes = filters.mes
    if (filters.anio) where.anio = filters.anio

    return prisma.excesos_velocidad.findMany({
      where,
      include: {
        conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
        vehiculo: { select: { id: true, placa: true, marca: true, modelo: true } },
      },
      orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
    })
  }

  static async upsertExceso(data: {
    conductor_id: string
    vehiculo_id: string
    mes: number
    anio: number
    cantidad: number
    observaciones?: string
  }) {
    return prisma.excesos_velocidad.upsert({
      where: {
        conductor_id_vehiculo_id_mes_anio: {
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          mes: data.mes,
          anio: data.anio,
        }
      },
      update: {
        cantidad: data.cantidad,
        observaciones: data.observaciones || null,
      },
      create: {
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        mes: data.mes,
        anio: data.anio,
        cantidad: data.cantidad,
        observaciones: data.observaciones || null,
      },
    })
  }

  static async deleteExceso(id: string) {
    return prisma.excesos_velocidad.delete({ where: { id } })
  }

  // ==================== PREOPERACIONALES CRUD ====================

  static async getPreoperacionales(filters: {
    conductor_id?: string
    vehiculo_id?: string
    fecha_desde?: string
    fecha_hasta?: string
    mes?: number
    anio?: number
  }) {
    const where: any = {}
    if (filters.conductor_id) where.conductor_id = filters.conductor_id
    if (filters.vehiculo_id) where.vehiculo_id = filters.vehiculo_id

    if (filters.mes && filters.anio) {
      const startDate = new Date(filters.anio, filters.mes - 1, 1)
      const endDate = new Date(filters.anio, filters.mes, 0)
      where.fecha = { gte: startDate, lte: endDate }
    } else {
      if (filters.fecha_desde) where.fecha = { ...where.fecha, gte: new Date(filters.fecha_desde) }
      if (filters.fecha_hasta) where.fecha = { ...where.fecha, lte: new Date(filters.fecha_hasta) }
    }

    return prisma.preoperacionales.findMany({
      where,
      include: {
        conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
        vehiculo: { select: { id: true, placa: true } },
      },
      orderBy: { fecha: 'desc' },
    })
  }

  static async upsertPreoperacional(data: {
    conductor_id: string
    vehiculo_id: string
    fecha: string // ISO date string
    realizado: boolean
    observaciones?: string
  }) {
    const fechaDate = new Date(data.fecha)
    return prisma.preoperacionales.upsert({
      where: {
        conductor_id_vehiculo_id_fecha: {
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          fecha: fechaDate,
        }
      },
      update: {
        realizado: data.realizado,
        observaciones: data.observaciones || null,
      },
      create: {
        conductor_id: data.conductor_id,
        vehiculo_id: data.vehiculo_id,
        fecha: fechaDate,
        realizado: data.realizado,
        observaciones: data.observaciones || null,
      },
    })
  }

  static async deletePreoperacional(id: string) {
    return prisma.preoperacionales.delete({ where: { id } })
  }

  // ==================== OPTIONS (for dropdowns) ====================

  static async getFilterOptions() {
    const [conductores, vehiculos, clientes, municipios] = await Promise.all([
      prisma.conductores.findMany({
        where: { estado: 'activo', oculto: false },
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
        orderBy: { nombre: 'asc' },
      }),
      prisma.vehiculos.findMany({
        where: { deleted_at: null, oculto: false },
        select: { id: true, placa: true, marca: true, modelo: true },
        orderBy: { placa: 'asc' },
      }),
      prisma.clientes.findMany({
        where: { deletedAt: null },
        select: { id: true, nombre: true },
        orderBy: { nombre: 'asc' },
      }),
      prisma.municipios.findMany({
        select: { id: true, nombre_municipio: true },
        orderBy: { nombre_municipio: 'asc' },
      }),
    ])

    return { conductores, vehiculos, clientes, municipios }
  }
}
