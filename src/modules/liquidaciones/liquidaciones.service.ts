import { prisma } from '../../config/prisma'
import { randomUUID } from 'crypto'

export const LiquidacionesService = {
  // Obtener todas las liquidaciones
  async obtenerTodas(filters?: {
    conductor_id?: string
    estado?: string
    search?: string
    page?: number
    limit?: number
    sortBy?: string
    sortOrder?: string
    nomina_month?: string // formato: YYYY-MM
  }) {
    const page = filters?.page || 1
    const limit = filters?.limit || 20
    const skip = (page - 1) * limit

    const where: any = {}

    if (filters?.conductor_id) {
      where.conductor_id = filters.conductor_id
    }

    if (filters?.estado) {
      where.estado = filters.estado
    }

    if (filters?.search) {
      where.OR = [
        {
          conductores: {
            nombre: { contains: filters.search, mode: 'insensitive' }
          }
        },
        {
          conductores: {
            apellido: { contains: filters.search, mode: 'insensitive' }
          }
        },
        {
          conductores: {
            numero_identificacion: { contains: filters.search, mode: 'insensitive' }
          }
        }
      ]
    }

    // Filtro por mes de nómina (periodo_end contiene el año-mes)
    if (filters?.nomina_month) {
      where.periodo_end = {
        startsWith: filters.nomina_month
      }
    }

    // Determinar ordenamiento
    let orderBy: any = { periodo_end: 'desc' }
    const sortOrder = filters?.sortOrder === 'asc' ? 'asc' : 'desc'

    if (filters?.sortBy) {
      switch (filters.sortBy) {
        case 'periodo':
          orderBy = { periodo_end: sortOrder }
          break
        case 'conductor':
          orderBy = { conductores: { nombre: sortOrder } }
          break
        case 'monto':
          orderBy = { sueldo_total: sortOrder }
          break
        case 'estado':
          orderBy = { estado: sortOrder }
          break
        default:
          orderBy = { periodo_end: 'desc' }
      }
    }

    const [liquidaciones, total, totalPendientes, montoTotalAgg] = await Promise.all([
      prisma.liquidaciones.findMany({
        where,
        include: {
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true,
              email: true,
              telefono: true,
              cargo: true,
              salario_base: true,
              sede_trabajo: true
            }
          },
          liquidacion_vehiculo: {
            include: {
              vehiculos: {
                select: {
                  id: true,
                  placa: true,
                  marca: true,
                  modelo: true,
                  clase_vehiculo: true
                }
              }
            }
          },
          bonificaciones: true,
          pernotes: {
            include: {
              clientes: {
                select: {
                  id: true,
                  nombre: true
                }
              }
            }
          },
          recargos: {
            include: {
              clientes: {
                select: {
                  id: true,
                  nombre: true
                }
              }
            }
          },
          mantenimientos: true,
          anticipos: true
        },
        orderBy,
        skip,
        take: limit
      }),
      prisma.liquidaciones.count({ where }),
      prisma.liquidaciones.count({ where: { ...where, estado: 'Pendiente' } }),
      prisma.liquidaciones.aggregate({
        where,
        _sum: { sueldo_total: true }
      })
    ])

    // Transformar los datos para el frontend
    const liquidacionesTransformadas = liquidaciones.map(liq => {
      const conductor = liq.conductores
      const vehiculos = liq.liquidacion_vehiculo.map(lv => lv.vehiculos)

      return {
        ...liq,
        periodo_inicio: liq.periodo_start,
        periodo_fin: liq.periodo_end,
        conductor: conductor ? {
          id: conductor.id,
          nombre: `${conductor.nombre} ${conductor.apellido}`,
          cedula: conductor.numero_identificacion,
          email: conductor.email,
          telefono: conductor.telefono,
          cargo: conductor.cargo,
          salario_base: conductor.salario_base
        } : null,
        vehiculos,
        salario_devengado: Number(liq.salario_devengado),
        sueldo_total: Number(liq.sueldo_total),
        salud: Number(liq.salud),
        pension: Number(liq.pension),
        cesantias: Number(liq.cesantias),
        interes_cesantias: Number(liq.interes_cesantias),
        auxilio_transporte: Number(liq.auxilio_transporte),
        total_bonificaciones: Number(liq.total_bonificaciones),
        total_pernotes: Number(liq.total_pernotes),
        total_recargos: Number(liq.total_recargos),
        total_anticipos: Number(liq.total_anticipos),
        total_vacaciones: Number(liq.total_vacaciones),
        valor_incapacidad: Number(liq.valor_incapacidad),
        ajuste_salarial: Number(liq.ajuste_salarial),
        ajuste_parex: Number(liq.ajuste_parex),
        total_devengado: Number(liq.salario_devengado) +
          Number(liq.total_bonificaciones) +
          Number(liq.total_pernotes) +
          Number(liq.total_recargos) +
          Number(liq.auxilio_transporte) +
          Number(liq.cesantias) +
          Number(liq.interes_cesantias) +
          Number(liq.total_vacaciones) +
          Number(liq.ajuste_salarial) +
          Number(liq.ajuste_parex),
        total_deducido: Number(liq.salud) +
          Number(liq.pension) +
          Number(liq.total_anticipos),
        neto_pagado: Number(liq.sueldo_total)
      }
    })

    return {
      liquidaciones: liquidacionesTransformadas,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1
      },
      stats: {
        totalRegistros: total,
        totalPendientes,
        montoTotal: Number(montoTotalAgg._sum.sueldo_total || 0)
      }
    }
  },

  // Obtener una liquidación por ID
  async obtenerPorId(id: string) {
    const liquidacion = await prisma.liquidaciones.findUnique({
      where: { id },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
            email: true,
            telefono: true,
            cargo: true,
            salario_base: true,
            sede_trabajo: true
          }
        },
        liquidacion_vehiculo: {
          include: {
            vehiculos: {
              select: {
                id: true,
                placa: true,
                marca: true,
                modelo: true,
                clase_vehiculo: true
              }
            }
          }
        },
        bonificaciones: true,
        pernotes: {
          include: {
            clientes: {
              select: { id: true, nombre: true }
            }
          }
        },
        recargos: {
          include: {
            clientes: {
              select: { id: true, nombre: true }
            }
          }
        },
        mantenimientos: true,
        anticipos: true,
        firmas_desprendibles: true,
        users_liquidaciones_creado_por_idTousers: {
          select: { id: true, nombre: true, correo: true }
        },
        users_liquidaciones_actualizado_por_idTousers: {
          select: { id: true, nombre: true, correo: true }
        },
        users_liquidaciones_liquidado_por_idTousers: {
          select: { id: true, nombre: true, correo: true }
        }
      }
    })

    if (!liquidacion) {
      throw new Error('Liquidación no encontrada')
    }

    const conductor = liquidacion.conductores
    const vehiculos = liquidacion.liquidacion_vehiculo.map(lv => lv.vehiculos)

    const creado_por = liquidacion.users_liquidaciones_creado_por_idTousers
    const actualizado_por = liquidacion.users_liquidaciones_actualizado_por_idTousers
    const liquidado_por = liquidacion.users_liquidaciones_liquidado_por_idTousers

    return {
      ...liquidacion,
      periodo_inicio: liquidacion.periodo_start,
      periodo_fin: liquidacion.periodo_end,
      conductor: conductor ? {
        id: conductor.id,
        nombre: `${conductor.nombre} ${conductor.apellido}`,
        cedula: conductor.numero_identificacion,
        email: conductor.email,
        telefono: conductor.telefono,
        cargo: conductor.cargo,
        salario_base: conductor.salario_base
      } : null,
      creado_por: creado_por ? { id: creado_por.id, nombre: creado_por.nombre, email: creado_por.correo } : null,
      actualizado_por: actualizado_por ? { id: actualizado_por.id, nombre: actualizado_por.nombre, email: actualizado_por.correo } : null,
      liquidado_por: liquidado_por ? { id: liquidado_por.id, nombre: liquidado_por.nombre, email: liquidado_por.correo } : null,
      vehiculos,
      salario_devengado: Number(liquidacion.salario_devengado),
      sueldo_total: Number(liquidacion.sueldo_total),
      salud: Number(liquidacion.salud),
      pension: Number(liquidacion.pension),
      cesantias: Number(liquidacion.cesantias),
      interes_cesantias: Number(liquidacion.interes_cesantias),
      auxilio_transporte: Number(liquidacion.auxilio_transporte),
      total_bonificaciones: Number(liquidacion.total_bonificaciones),
      total_pernotes: Number(liquidacion.total_pernotes),
      total_recargos: Number(liquidacion.total_recargos),
      total_anticipos: Number(liquidacion.total_anticipos),
      total_vacaciones: Number(liquidacion.total_vacaciones),
      valor_incapacidad: Number(liquidacion.valor_incapacidad),
      ajuste_salarial: Number(liquidacion.ajuste_salarial),
      ajuste_parex: Number(liquidacion.ajuste_parex),
      total_devengado: Number(liquidacion.salario_devengado) +
        Number(liquidacion.total_bonificaciones) +
        Number(liquidacion.total_pernotes) +
        Number(liquidacion.total_recargos) +
        Number(liquidacion.auxilio_transporte) +
        Number(liquidacion.cesantias) +
        Number(liquidacion.interes_cesantias) +
        Number(liquidacion.total_vacaciones) +
        Number(liquidacion.ajuste_salarial) +
        Number(liquidacion.ajuste_parex),
      total_deducido: Number(liquidacion.salud) +
        Number(liquidacion.pension) +
        Number(liquidacion.total_anticipos),
      neto_pagado: Number(liquidacion.sueldo_total)
    }
  },

  // Crear una nueva liquidación
  async crear(data: any, userId: string) {
    const id = randomUUID()
    const now = new Date()

    const liquidacion = await prisma.liquidaciones.create({
      data: {
        id,
        conductor_id: data.conductor_id,
        periodo_start: data.periodo_inicio,
        periodo_end: data.periodo_fin,
        dias_laborados: data.dias_laborados || 0,
        dias_laborados_villanueva: data.dias_laborados_villanueva || 0,
        dias_laborados_anual: data.dias_laborados_anual || 0,
        salario_devengado: data.salario_base || 0,
        sueldo_total: data.sueldo_total || 0,
        salud: data.no_descontar_salud ? 0 : (data.salud || 0),
        pension: data.no_descontar_pension ? 0 : (data.pension || 0),
        cesantias: data.cesantias || 0,
        interes_cesantias: data.interes_cesantias || 0,
        auxilio_transporte: data.descontar_transporte ? 0 : (data.auxilio_transporte || 0),
        total_bonificaciones: data.total_bonificaciones || 0,
        total_pernotes: data.total_pernotes || 0,
        total_recargos: data.total_recargos || 0,
        total_anticipos: data.total_anticipos || 0,
        total_vacaciones: data.total_vacaciones || 0,
        valor_incapacidad: data.valor_incapacidad || 0,
        ajuste_salarial: data.ajuste_valor || 0,
        ajuste_salarial_por_dia: data.ajuste_por_dia_flag || false,
        ajuste_parex: data.ajuste_parex ? (data.ajuste_parex_valor || 0) : 0,
        periodo_start_vacaciones: data.periodo_vacaciones_inicio || null,
        periodo_end_vacaciones: data.periodo_vacaciones_fin || null,
        periodo_start_incapacidad: data.periodo_incapacidad_inicio || null,
        periodo_end_incapacidad: data.periodo_incapacidad_fin || null,
        conceptos_adicionales: data.conceptos_adicionales || null,
        observaciones: data.observaciones || null,
        creado_por_id: userId,
        created_at: now,
        updated_at: now
      }
    })

    // Crear relaciones con vehículos
    if (data.vehiculos && data.vehiculos.length > 0) {
      await prisma.liquidacion_vehiculo.createMany({
        data: data.vehiculos.map((vehiculoId: string) => ({
          liquidacion_id: id,
          vehiculo_id: vehiculoId,
          created_at: now,
          updated_at: now
        }))
      })
    }

    // Crear bonificaciones, mantenimientos, pernotes, recargos por vehículo
    if (data.detalles_vehiculos) {
      for (const detalle of data.detalles_vehiculos) {
        const vehiculoId = detalle.vehiculo?.value

        if (detalle.bonos && detalle.bonos.length > 0) {
          for (const bono of detalle.bonos) {
            await prisma.bonificaciones.create({
              data: {
                id: randomUUID(),
                name: bono.name,
                values: JSON.stringify(bono.values || []),
                value: bono.value || 0,
                vehiculo_id: vehiculoId,
                liquidacion_id: id,
                creado_por_id: userId,
                created_at: now,
                updated_at: now
              }
            })
          }
        }

        if (detalle.mantenimientos && detalle.mantenimientos.length > 0) {
          for (const mant of detalle.mantenimientos) {
            await prisma.mantenimientos.create({
              data: {
                id: randomUUID(),
                values: JSON.stringify(mant.values || []),
                value: mant.value || 0,
                vehiculo_id: vehiculoId,
                liquidacion_id: id,
                created_at: now,
                updated_at: now
              }
            })
          }
        }

        if (detalle.pernotes && detalle.pernotes.length > 0) {
          for (const pernote of detalle.pernotes) {
            if (!pernote.empresa_id) continue
            await prisma.pernotes.create({
              data: {
                id: randomUUID(),
                empresa_id: pernote.empresa_id,
                cantidad: pernote.cantidad || 0,
                valor: pernote.valor || 0,
                fechas: JSON.stringify(pernote.fechas || []),
                vehiculo_id: vehiculoId,
                liquidacion_id: id,
                creado_por_id: userId,
                created_at: now,
                updated_at: now
              }
            })
          }
        }

        if (detalle.recargos && detalle.recargos.length > 0) {
          for (const recargo of detalle.recargos) {
            if (!recargo.empresa_id) continue
            await prisma.recargos.create({
              data: {
                id: randomUUID(),
                empresa_id: recargo.empresa_id,
                valor: recargo.valor || 0,
                pag_cliente: recargo.pag_cliente || false,
                mes: recargo.mes || '',
                vehiculo_id: vehiculoId,
                liquidacion_id: id,
                created_at: now,
                updated_at: now
              }
            })
          }
        }
      }
    }

    // Crear anticipos
    if (data.anticipos && data.anticipos.length > 0) {
      for (const anticipo of data.anticipos) {
        await prisma.anticipos.create({
          data: {
            id: randomUUID(),
            valor: anticipo.valor || 0,
            fecha: new Date(anticipo.fecha),
            concepto: anticipo.concepto || null,
            conductor_id: data.conductor_id,
            liquidacion_id: id,
            creado_por_id: userId,
            created_at: now,
            updated_at: now
          }
        })
      }
    }

    return await LiquidacionesService.obtenerPorId(id)
  },

  // Actualizar una liquidación
  async actualizar(id: string, data: any, userId: string) {
    const now = new Date()

    const liquidacionExistente = await prisma.liquidaciones.findUnique({
      where: { id }
    })

    if (!liquidacionExistente) {
      throw new Error('Liquidación no encontrada')
    }

    await prisma.liquidaciones.update({
      where: { id },
      data: {
        conductor_id: data.conductor_id,
        periodo_start: data.periodo_inicio,
        periodo_end: data.periodo_fin,
        dias_laborados: data.dias_laborados ?? liquidacionExistente.dias_laborados,
        dias_laborados_villanueva: data.dias_laborados_villanueva ?? liquidacionExistente.dias_laborados_villanueva,
        dias_laborados_anual: data.dias_laborados_anual ?? liquidacionExistente.dias_laborados_anual,
        salario_devengado: data.salario_base ?? Number(liquidacionExistente.salario_devengado),
        sueldo_total: data.sueldo_total ?? Number(liquidacionExistente.sueldo_total),
        salud: data.no_descontar_salud ? 0 : (data.salud ?? Number(liquidacionExistente.salud)),
        pension: data.no_descontar_pension ? 0 : (data.pension ?? Number(liquidacionExistente.pension)),
        cesantias: data.cesantias ?? Number(liquidacionExistente.cesantias),
        interes_cesantias: data.interes_cesantias ?? Number(liquidacionExistente.interes_cesantias),
        auxilio_transporte: data.descontar_transporte ? 0 : (data.auxilio_transporte ?? Number(liquidacionExistente.auxilio_transporte)),
        conceptos_adicionales: data.conceptos_adicionales ?? liquidacionExistente.conceptos_adicionales,
        periodo_start_vacaciones: data.periodo_vacaciones_inicio || null,
        periodo_end_vacaciones: data.periodo_vacaciones_fin || null,
        periodo_start_incapacidad: data.periodo_incapacidad_inicio || null,
        periodo_end_incapacidad: data.periodo_incapacidad_fin || null,
        ajuste_salarial: data.ajuste_valor ?? Number(liquidacionExistente.ajuste_salarial),
        ajuste_salarial_por_dia: data.ajuste_por_dia_flag ?? liquidacionExistente.ajuste_salarial_por_dia,
        observaciones: data.observaciones ?? liquidacionExistente.observaciones,
        actualizado_por_id: userId,
        updated_at: now
      }
    })

    // Actualizar vehículos
    if (data.vehiculos) {
      await prisma.liquidacion_vehiculo.deleteMany({
        where: { liquidacion_id: id }
      })

      if (data.vehiculos.length > 0) {
        await prisma.liquidacion_vehiculo.createMany({
          data: data.vehiculos.map((vehiculoId: string) => ({
            liquidacion_id: id,
            vehiculo_id: vehiculoId,
            created_at: now,
            updated_at: now
          }))
        })
      }
    }

    // Actualizar anticipos
    if (data.anticipos !== undefined) {
      await prisma.anticipos.deleteMany({
        where: { liquidacion_id: id }
      })

      if (data.anticipos.length > 0) {
        for (const anticipo of data.anticipos) {
          await prisma.anticipos.create({
            data: {
              id: anticipo.id || randomUUID(),
              valor: anticipo.valor || 0,
              fecha: new Date(anticipo.fecha),
              concepto: anticipo.concepto || null,
              conductor_id: data.conductor_id,
              liquidacion_id: id,
              creado_por_id: userId,
              created_at: now,
              updated_at: now
            }
          })
        }
      }
    }

    return await LiquidacionesService.obtenerPorId(id)
  },

  // Eliminar una liquidación
  async eliminar(id: string) {
    const liquidacion = await prisma.liquidaciones.findUnique({
      where: { id }
    })

    if (!liquidacion) {
      throw new Error('Liquidación no encontrada')
    }

    await prisma.$transaction([
      prisma.bonificaciones.deleteMany({ where: { liquidacion_id: id } }),
      prisma.mantenimientos.deleteMany({ where: { liquidacion_id: id } }),
      prisma.pernotes.deleteMany({ where: { liquidacion_id: id } }),
      prisma.recargos.deleteMany({ where: { liquidacion_id: id } }),
      prisma.anticipos.deleteMany({ where: { liquidacion_id: id } }),
      prisma.firmas_desprendibles.deleteMany({ where: { liquidacion_id: id } }),
      prisma.liquidacion_vehiculo.deleteMany({ where: { liquidacion_id: id } }),
      prisma.liquidaciones.delete({ where: { id } })
    ])

    return { success: true, message: 'Liquidación eliminada correctamente' }
  },

  // Obtener configuraciones de liquidación
  async obtenerConfiguraciones() {
    const configuraciones = await prisma.configuraciones_liquidacion.findMany({
      where: { activo: true },
      orderBy: { nombre: 'asc' }
    })

    return configuraciones.map(config => ({
      ...config,
      valor: Number(config.valor)
    }))
  },

  // Obtener empresas (clientes)
  async obtenerEmpresas() {
    return await prisma.clientes.findMany({
      where: { oculto: false },
      select: {
        id: true,
        nombre: true,
        nit: true,
        representante: true,
        telefono: true,
        direccion: true
      },
      orderBy: { nombre: 'asc' }
    })
  }
}
