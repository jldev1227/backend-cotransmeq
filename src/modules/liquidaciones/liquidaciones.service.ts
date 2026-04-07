import { prisma } from '../../config/prisma'
import { randomUUID } from 'crypto'

/**
 * Parsea el campo `fechas` de cada pernote.
 * En la BD se almacena como String JSON (ej: '["2026-03-10","2026-03-11"]')
 * pero el frontend espera string[].
 */
function parsePernotesFechas(pernotes: any[]): any[] {
  if (!pernotes || !Array.isArray(pernotes)) return []
  return pernotes.map(p => ({
    ...p,
    fechas: (() => {
      if (Array.isArray(p.fechas)) return p.fechas
      if (typeof p.fechas === 'string') {
        try {
          const parsed = JSON.parse(p.fechas)
          return Array.isArray(parsed) ? parsed : []
        } catch {
          return []
        }
      }
      return []
    })(),
    valor: Number(p.valor || 0),
    cantidad: Number(p.cantidad || 0)
  }))
}

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
        // Parsear pernotes.fechas de JSON string a array
        pernotes: parsePernotesFechas(liq.pernotes),
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
        ajuste_parex_recargos_completos: (liq as any).ajuste_parex_recargos_completos ?? false,
        dias_ajuste_deducciones: (liq as any).dias_ajuste_deducciones ?? null,
        disponibilidad: Number((liq as any).disponibilidad ?? 0),
        conceptos_adicionales: liq.conceptos_adicionales ?? [],
        // total_devengado = neto + deducciones (sueldo_total ya es sueldoBruto - deducciones)
        total_devengado: Number(liq.sueldo_total) +
          Number(liq.salud) +
          Number(liq.pension) +
          Number(liq.total_anticipos),
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
      // Parsear pernotes.fechas de JSON string a array
      pernotes: parsePernotesFechas(liquidacion.pernotes),
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
      ajuste_parex_recargos_completos: (liquidacion as any).ajuste_parex_recargos_completos ?? false,
      dias_ajuste_deducciones: (liquidacion as any).dias_ajuste_deducciones ?? null,
      disponibilidad: Number((liquidacion as any).disponibilidad ?? 0),
      conceptos_adicionales: liquidacion.conceptos_adicionales ?? [],
      // total_devengado = neto + deducciones (sueldo_total ya es sueldoBruto - deducciones)
      total_devengado: Number(liquidacion.sueldo_total) +
        Number(liquidacion.salud) +
        Number(liquidacion.pension) +
        Number(liquidacion.total_anticipos),
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
        estado: data.estado || 'Pendiente',
        ...(data.estado === 'Liquidado' ? {
          liquidado_por_id: userId,
          fecha_liquidacion: now
        } : {}),
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
                porcentaje_propietario: recargo.porcentaje_propietario ?? null,
                es_automatico: false,
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

    // Recargos calculados desde planillas (recargos_preview)
    if (data.recargos_preview && data.recargos_preview.length > 0) {
      for (const grupo of data.recargos_preview) {
        if (!grupo.empresa_id) continue
        await prisma.recargos.create({
          data: {
            id: randomUUID(),
            empresa_id: grupo.empresa_id,
            valor: grupo.valor || 0,
            pag_cliente: grupo.pag_cliente || false,
            porcentaje_propietario: grupo.porcentaje_propietario ?? null,
            es_automatico: true,
            mes: grupo.mes || '',
            vehiculo_id: grupo.vehiculo_id || null,
            liquidacion_id: id,
            created_at: now,
            updated_at: now
          }
        })
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
        // Estado de la liquidación
        ...(data.estado ? {
          estado: data.estado,
          ...(data.estado === 'Liquidado' ? {
            liquidado_por_id: userId,
            fecha_liquidacion: now
          } : {
            liquidado_por_id: null,
            fecha_liquidacion: null
          })
        } : {}),
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

    // Actualizar detalles de vehículos (bonificaciones, mantenimientos, pernotes, recargos)
    if (data.detalles_vehiculos) {
      // Eliminar registros anteriores
      await prisma.bonificaciones.deleteMany({ where: { liquidacion_id: id } })
      await prisma.mantenimientos.deleteMany({ where: { liquidacion_id: id } })
      await prisma.pernotes.deleteMany({ where: { liquidacion_id: id } })
      await prisma.recargos.deleteMany({ where: { liquidacion_id: id } })

      // Actualizar totales
      await prisma.liquidaciones.update({
        where: { id },
        data: {
          total_bonificaciones: data.total_bonificaciones ?? 0,
          total_pernotes: data.total_pernotes ?? 0,
          total_recargos: data.total_recargos ?? 0,
          updated_at: now
        }
      })

      // Re-crear detalles por vehículo
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
                porcentaje_propietario: recargo.porcentaje_propietario ?? null,
                es_automatico: false,
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

      // Recargos calculados desde planillas (recargos_preview)
      if (data.recargos_preview && data.recargos_preview.length > 0) {
        for (const grupo of data.recargos_preview) {
          if (!grupo.empresa_id) continue
          await prisma.recargos.create({
            data: {
              id: randomUUID(),
              empresa_id: grupo.empresa_id,
              valor: grupo.valor || 0,
              pag_cliente: grupo.pag_cliente || false,
              porcentaje_propietario: grupo.porcentaje_propietario ?? null,
              es_automatico: true,
              mes: grupo.mes || '',
              vehiculo_id: grupo.vehiculo_id || null,
              liquidacion_id: id,
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
  async obtenerConfiguraciones(anio?: number) {
    const where: any = { activo: true }
    if (anio) where.anio = anio

    const configuraciones = await prisma.configuraciones_liquidacion.findMany({
      where,
      orderBy: [{ anio: 'desc' }, { nombre: 'asc' }]
    })

    return configuraciones.map(config => ({
      ...config,
      valor: Number(config.valor)
    }))
  },

  // Obtener años disponibles en configuraciones
  async obtenerAniosConfiguraciones() {
    const result = await prisma.configuraciones_liquidacion.findMany({
      where: { activo: true },
      select: { anio: true },
      distinct: ['anio'],
      orderBy: { anio: 'desc' }
    })
    return result.map(r => r.anio)
  },

  // Actualizar una configuración
  async actualizarConfiguracion(id: string, data: { nombre?: string; valor?: number; tipo?: string }) {
    const config = await prisma.configuraciones_liquidacion.findUnique({ where: { id } })
    if (!config) throw new Error('Configuración no encontrada')

    const updateData: any = { updated_at: new Date() }
    if (data.nombre !== undefined) updateData.nombre = data.nombre
    if (data.valor !== undefined) updateData.valor = data.valor
    if (data.tipo !== undefined) updateData.tipo = data.tipo as any

    const updated = await prisma.configuraciones_liquidacion.update({
      where: { id },
      data: updateData
    })

    return { ...updated, valor: Number(updated.valor) }
  },

  // Crear nueva configuración
  async crearConfiguracion(data: { nombre: string; valor: number; tipo: string; anio: number }) {
    const { randomUUID } = await import('crypto')
    const created = await prisma.configuraciones_liquidacion.create({
      data: {
        id: randomUUID(),
        nombre: data.nombre,
        valor: data.valor,
        tipo: data.tipo as any,
        anio: data.anio,
        activo: true,
        created_at: new Date(),
        updated_at: new Date()
      }
    })

    return { ...created, valor: Number(created.valor) }
  },

  // Duplicar configuraciones de un año a otro
  async duplicarConfiguracionesAnio(anioOrigen: number, anioDestino: number) {
    const existentes = await prisma.configuraciones_liquidacion.count({
      where: { anio: anioDestino, activo: true }
    })
    if (existentes > 0) throw new Error(`Ya existen configuraciones para el año ${anioDestino}`)

    const originales = await prisma.configuraciones_liquidacion.findMany({
      where: { anio: anioOrigen, activo: true }
    })
    if (originales.length === 0) throw new Error(`No se encontraron configuraciones para el año ${anioOrigen}`)

    const { randomUUID } = await import('crypto')
    const nuevas = []
    for (const config of originales) {
      const nueva = await prisma.configuraciones_liquidacion.create({
        data: {
          id: randomUUID(),
          nombre: config.nombre,
          valor: config.valor,
          tipo: config.tipo,
          anio: anioDestino,
          activo: true,
          created_at: new Date(),
          updated_at: new Date()
        }
      })
      nuevas.push({ ...nueva, valor: Number(nueva.valor) })
    }

    return nuevas
  },

  // Eliminar (soft delete) una configuración
  async eliminarConfiguracion(id: string) {
    const config = await prisma.configuraciones_liquidacion.findUnique({ where: { id } })
    if (!config) throw new Error('Configuración no encontrada')

    await prisma.configuraciones_liquidacion.update({
      where: { id },
      data: { activo: false, deleted_at: new Date(), updated_at: new Date() }
    })

    return { success: true, message: 'Configuración eliminada correctamente' }
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
  },

  // Preview de recargos para un conductor en un período
  async previewRecargos(conductor_id: string, periodo_inicio: string, periodo_fin: string) {
    // Parsear el período para obtener los meses involucrados
    const fechaInicio = new Date(periodo_inicio + 'T00:00:00Z')
    const fechaFin = new Date(periodo_fin + 'T00:00:00Z')

    // Generar lista de meses/años que abarca el período
    const mesesPeriodo: Array<{ mes: number; año: number }> = []
    const current = new Date(Date.UTC(fechaInicio.getUTCFullYear(), fechaInicio.getUTCMonth(), 1))
    const lastMonth = new Date(Date.UTC(fechaFin.getUTCFullYear(), fechaFin.getUTCMonth(), 1))
    while (current <= lastMonth) {
      mesesPeriodo.push({
        mes: current.getUTCMonth() + 1,
        año: current.getUTCFullYear()
      })
      current.setUTCMonth(current.getUTCMonth() + 1)
    }

    console.log('📋 [PREVIEW] Conductor:', conductor_id)
    console.log('📋 [PREVIEW] Período:', periodo_inicio, '->', periodo_fin)
    console.log('📋 [PREVIEW] Meses a buscar:', mesesPeriodo)

    // Obtener configuración salarial activa (la más reciente vigente)
    const configSalarial = await prisma.configuraciones_salarios.findFirst({
      where: {
        activo: true,
        vigencia_desde: { lte: fechaFin },
        OR: [
          { vigencia_hasta: null },
          { vigencia_hasta: { gte: fechaInicio } }
        ]
      },
      orderBy: { vigencia_desde: 'desc' }
    })

    console.log('📋 [PREVIEW] Config salarial:', configSalarial ? {
      id: configSalarial.id,
      valor_hora: Number(configSalarial.valor_hora_trabajador),
      sede: configSalarial.sede
    } : 'NO ENCONTRADA')

    // Calcular valor hora en vivo con máxima precisión (como Excel: salario / horas_mes)
    // NO usar valor_hora_trabajador almacenado porque está redondeado
    const valorHoraBase = configSalarial
      ? Number(configSalarial.salario_basico) / configSalarial.horas_mensuales_base
      : 0
    const pagaFestivos = configSalarial?.paga_dias_festivos ?? false
    const porcentajeFestivos = configSalarial ? Number(configSalarial.porcentaje_festivos) : 75

    // Buscar todas las planillas del conductor en los meses del período
    const whereConditions = mesesPeriodo.map(mp => ({
      mes: mp.mes,
      a_o: mp.año
    }))

    console.log('📋 [PREVIEW] WHERE conditions para planillas:', JSON.stringify(whereConditions))

    const planillas = await prisma.recargos_planillas.findMany({
      where: {
        conductor_id,
        deleted_at: null,
        OR: whereConditions
      },
      include: {
        vehiculos: {
          select: { id: true, placa: true, marca: true, modelo: true }
        },
        clientes: {
          select: { id: true, nombre: true }
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: 'asc' },
          include: {
            detalles_recargos_dias: {
              where: { deleted_at: null, activo: true },
              include: {
                tipos_recargos: {
                  select: {
                    id: true,
                    codigo: true,
                    nombre: true,
                    porcentaje: true,
                    es_hora_extra: true,
                    adicional: true,
                    categoria: true
                  }
                }
              }
            }
          }
        }
      },
      orderBy: [{ a_o: 'asc' }, { mes: 'asc' }]
    })

    console.log('📋 [PREVIEW] Planillas encontradas:', planillas.length)
    planillas.forEach(p => {
      console.log(`  → Planilla ${p.id}: mes=${p.mes}, año=${p.a_o}, vehículo=${(p.vehiculos as any)?.placa}, empresa=${(p.clientes as any)?.nombre}, días=${p.dias_laborales_planillas?.length}`)
    })

    // Filtrar solo los días que caen dentro del período
    const diaInicio = fechaInicio.getUTCDate()
    const mesInicio = fechaInicio.getUTCMonth() + 1
    const añoInicio = fechaInicio.getUTCFullYear()
    const diaFin = fechaFin.getUTCDate()
    const mesFin = fechaFin.getUTCMonth() + 1
    const añoFin = fechaFin.getUTCFullYear()

    // Construir el desglose detallado
    let totalGeneralRecargos = 0
    let totalDiasTrabajados = 0
    let totalHorasTrabajadas = 0

    // Resumen por tipo de recargo
    const resumenTipos: Record<string, {
      codigo: string
      nombre: string
      porcentaje: number
      es_hora_extra: boolean
      adicional: boolean
      totalHoras: number
      valorHoraBase: number
      valorTotal: number
    }> = {}

    const planillasDetalle = planillas.map(planilla => {
      const mesPlanilla = planilla.mes
      const añoPlanilla = planilla.a_o

      // Filtrar días dentro del rango del período
      const diasFiltrados = planilla.dias_laborales_planillas.filter(dia => {
        const fechaDia = new Date(Date.UTC(añoPlanilla, mesPlanilla - 1, dia.dia))
        return fechaDia >= fechaInicio && fechaDia <= fechaFin
      })

      let totalRecargoPlanilla = 0

      const diasDetalle = diasFiltrados.map(dia => {
        const fechaDia = new Date(Date.UTC(añoPlanilla, mesPlanilla - 1, dia.dia))
        const nombreDia = fechaDia.toLocaleDateString('es-CO', { weekday: 'short', timeZone: 'UTC' })
        const fechaFormateada = fechaDia.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })

        // Determinar tipo de día
        let tipoDia = 'Normal'
        if (dia.es_festivo) tipoDia = 'Festivo'
        else if (dia.es_domingo) tipoDia = 'Domingo'

        // Días disponibles no suman al total de horas/días trabajados ni a recargos
        if (!dia.disponibilidad) {
          totalHorasTrabajadas += Number(dia.total_horas)
          totalDiasTrabajados++
        }

        // Calcular detalles de recargos con valores monetarios
        // Si es día disponible, no calcular valores de recargos
        const recargosDetalle = dia.disponibilidad ? [] : dia.detalles_recargos_dias.map(detalle => {
          const tipo = detalle.tipos_recargos
          const horas = Number(detalle.horas)
          const porcentaje = Number(tipo.porcentaje)

          // Horas extras o adicionales (RD, RNDF): valor_hora_base + (valor_hora_base * porcentaje / 100)
          // Recargos simples (RN): valor_hora_base * (porcentaje / 100)
          let valorCalculado = 0
          let valorHoraCalc = 0
          if (tipo.es_hora_extra || tipo.adicional) {
            // Hora extra o adicional = hora base + (hora base × porcentaje / 100)
            valorHoraCalc = valorHoraBase + (valorHoraBase * porcentaje / 100)
          } else {
            // Recargo simple (solo porcentaje sobre base)
            valorHoraCalc = valorHoraBase * porcentaje / 100
          }
          valorCalculado = horas * valorHoraCalc

          totalRecargoPlanilla += valorCalculado

          // Acumular en resumen por tipo
          if (!resumenTipos[tipo.codigo]) {
            resumenTipos[tipo.codigo] = {
              codigo: tipo.codigo,
              nombre: tipo.nombre,
              porcentaje,
              es_hora_extra: tipo.es_hora_extra,
              adicional: tipo.adicional,
              totalHoras: 0,
              valorHoraBase: valorHoraBase,
              valorTotal: 0
            }
          }
          resumenTipos[tipo.codigo].totalHoras += horas
          resumenTipos[tipo.codigo].valorTotal += valorCalculado

          return {
            tipo_codigo: tipo.codigo,
            tipo_nombre: tipo.nombre,
            es_hora_extra: tipo.es_hora_extra,
            adicional: tipo.adicional,
            porcentaje,
            horas,
            valor_hora_base: Math.round(valorHoraBase),
            valor_hora_calculada: Math.round(valorHoraCalc),
            valor_total: Math.round(valorCalculado)
          }
        })

        const totalDia = recargosDetalle.reduce((sum, r) => sum + r.valor_total, 0)

        return {
          dia: dia.dia,
          fecha: fechaFormateada,
          nombre_dia: nombreDia,
          tipo_dia: tipoDia,
          es_festivo: dia.es_festivo,
          es_domingo: dia.es_domingo,
          disponibilidad: dia.disponibilidad,
          hora_inicio: Number(dia.hora_inicio),
          hora_fin: Number(dia.hora_fin),
          total_horas: Number(dia.total_horas),
          recargos: recargosDetalle,
          total_valor_dia: totalDia
        }
      })

      // Calcular total_valor de la planilla estilo Excel:
      // Acumular horas por tipo de recargo, luego totalHoras × tasa (sin truncar intermedios)
      const horasPorTipoPlanilla: Record<string, { horas: number, valorHoraCalc: number }> = {}
      for (const dia of diasDetalle) {
        for (const rec of dia.recargos) {
          if (!horasPorTipoPlanilla[rec.tipo_codigo]) {
            horasPorTipoPlanilla[rec.tipo_codigo] = { horas: 0, valorHoraCalc: 0 }
          }
          horasPorTipoPlanilla[rec.tipo_codigo].horas += rec.horas
          // Recalcular tasa con precisión completa
          const porcentaje = rec.porcentaje
          if (rec.es_hora_extra || rec.adicional) {
            horasPorTipoPlanilla[rec.tipo_codigo].valorHoraCalc = valorHoraBase + (valorHoraBase * porcentaje / 100)
          } else {
            horasPorTipoPlanilla[rec.tipo_codigo].valorHoraCalc = valorHoraBase * porcentaje / 100
          }
        }
      }
      let totalRecargoPlanillaRaw = 0
      for (const key of Object.keys(horasPorTipoPlanilla)) {
        const { horas, valorHoraCalc } = horasPorTipoPlanilla[key]
        totalRecargoPlanillaRaw += horas * valorHoraCalc  // Sin redondear por tipo
      }
      // Redondear el total de la planilla una sola vez (como Excel)
      const totalRecargoPlanillaFinal = Math.round(totalRecargoPlanillaRaw)

      totalGeneralRecargos += totalRecargoPlanillaFinal

      // Calcular festivos por planilla
      let planillaFestivos = 0
      if (pagaFestivos) {
        const diasFestivosP = diasDetalle.filter(d => !d.disponibilidad && (d.es_festivo || d.es_domingo)).length
        planillaFestivos = Math.round(diasFestivosP * valorHoraBase * (porcentajeFestivos / 100) * 10)
      }

      return {
        planilla_id: planilla.id,
        numero_planilla: planilla.numero_planilla,
        vehiculo: planilla.vehiculos,
        empresa: planilla.clientes,
        mes: mesPlanilla,
        año: añoPlanilla,
        total_dias: diasDetalle.filter(d => !d.disponibilidad).length,
        total_horas: diasDetalle.filter(d => !d.disponibilidad).reduce((sum, d) => sum + d.total_horas, 0),
        total_valor: totalRecargoPlanillaFinal,
        total_festivos: planillaFestivos,
        configuracion_salarial: configSalarial ? {
          id: configSalarial.id,
          salario_basico: Number(configSalarial.salario_basico),
          valor_hora_trabajador: valorHoraBase,
          horas_mensuales_base: configSalarial.horas_mensuales_base,
          paga_dias_festivos: pagaFestivos,
          porcentaje_festivos: porcentajeFestivos
        } : null,
        dias: diasDetalle
      }
    })

    // Días festivos (si aplica pago festivos) - excluir días disponibles
    let totalFestivos = 0
    if (pagaFestivos) {
      const diasFestivos = planillasDetalle.reduce((count, p) =>
        count + p.dias.filter(d => !d.disponibilidad && (d.es_festivo || d.es_domingo)).length, 0
      )
      totalFestivos = diasFestivos * valorHoraBase * (porcentajeFestivos / 100) * 10 // 10 horas base festivo
    }

    return {
      conductor_id,
      periodo: { inicio: periodo_inicio, fin: periodo_fin },
      configuracion_salarial: configSalarial ? {
        id: configSalarial.id,
        salario_basico: Number(configSalarial.salario_basico),
        valor_hora_trabajador: valorHoraBase,
        horas_mensuales_base: configSalarial.horas_mensuales_base,
        sede: configSalarial.sede,
        paga_dias_festivos: pagaFestivos,
        porcentaje_festivos: porcentajeFestivos
      } : null,
      resumen: {
        total_planillas: planillasDetalle.length,
        total_dias_trabajados: totalDiasTrabajados,
        total_horas_trabajadas: Math.round(totalHorasTrabajadas * 10) / 10,
        total_recargos: Math.round(totalGeneralRecargos),
        total_festivos: Math.round(totalFestivos),
        total_general: Math.round(totalGeneralRecargos + totalFestivos)
      },
      resumen_tipos: Object.values(resumenTipos).map(t => {
        // Recalcular valorTotal estilo Excel: totalHoras × tasa (con precisión completa)
        let valorHoraCalc = 0
        if (t.es_hora_extra || t.adicional) {
          valorHoraCalc = t.valorHoraBase + (t.valorHoraBase * t.porcentaje / 100)
        } else {
          valorHoraCalc = t.valorHoraBase * t.porcentaje / 100
        }
        return {
          ...t,
          totalHoras: Math.round(t.totalHoras * 100) / 100,
          valorTotal: Math.round(t.totalHoras * valorHoraCalc)
        }
      }),
      planillas: planillasDetalle
    }
  }
}
