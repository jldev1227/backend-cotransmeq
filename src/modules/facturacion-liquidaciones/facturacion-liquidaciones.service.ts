import { prisma } from '../../config/prisma'

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface CrearFacturaInput {
  numero_factura: string
  liquidacion_ids: string[]
  observaciones?: string
}

export interface FiltrosFacturas {
  page?: number
  limit?: number
  busqueda?: string
  estado?: 'ACTIVA' | 'ANULADA' | ''
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const FacturacionLiquidacionesService = {

  async crear(data: CrearFacturaInput, userId: string) {
    const { numero_factura, liquidacion_ids, observaciones } = data

    if (!numero_factura || !numero_factura.trim()) {
      throw new Error('El número de factura es obligatorio')
    }
    if (!liquidacion_ids || liquidacion_ids.length === 0) {
      throw new Error('Debe seleccionar al menos una liquidación')
    }

    // Verificar que el número de factura no exista (entre no eliminadas)
    const existe = await prisma.factura_liquidacion_servicio.findFirst({
      where: { numero_factura: numero_factura.trim(), deleted_at: null }
    })
    if (existe) {
      throw new Error(`Ya existe una factura con el número "${numero_factura.trim()}"`)
    }

    // Verificar que todas las liquidaciones existan y estén en estado LIQUIDADA o APROBADA
    const liquidaciones = await prisma.liquidacion_servicio.findMany({
      where: { id: { in: liquidacion_ids } },
      select: { id: true, consecutivo: true, estado: true, total: true }
    })

    if (liquidaciones.length !== liquidacion_ids.length) {
      throw new Error('Algunas liquidaciones no fueron encontradas')
    }

    const noFacturables = liquidaciones.filter(l => !['LIQUIDADA', 'APROBADA'].includes(l.estado))
    if (noFacturables.length > 0) {
      const consecutivos = noFacturables.map(l => l.consecutivo).join(', ')
      throw new Error(`Las siguientes liquidaciones no están en estado para facturar: ${consecutivos}`)
    }

    // Ya facturadas?
    const yaFacturadas = await prisma.factura_liquidacion_item.findMany({
      where: {
        liquidacion_id: { in: liquidacion_ids },
        factura: { estado: 'ACTIVA' }
      },
      include: {
        liquidacion: { select: { consecutivo: true } },
        factura: { select: { numero_factura: true } }
      }
    })
    if (yaFacturadas.length > 0) {
      const detalles = yaFacturadas.map(f => `${f.liquidacion.consecutivo} (Factura: ${f.factura.numero_factura})`).join(', ')
      throw new Error(`Las siguientes liquidaciones ya están facturadas: ${detalles}`)
    }

    // Calcular valor total
    const valorTotal = liquidaciones.reduce((sum, l) => sum + Number(l.total), 0)

    // Crear factura + items + cambiar estado en transacción
    const factura = await prisma.$transaction(async (tx) => {
      const fac = await tx.factura_liquidacion_servicio.create({
        data: {
          numero_factura: numero_factura.trim(),
          observaciones: observaciones || null,
          valor_total: valorTotal,
          facturado_por_id: userId,
          items: {
            create: liquidaciones.map(l => ({
              liquidacion_id: l.id,
              valor_liquidacion: Number(l.total),
            }))
          }
        },
        include: {
          facturado_por: { select: { id: true, nombre: true, correo: true } },
          items: {
            include: {
              liquidacion: {
                select: {
                  id: true,
                  consecutivo: true,
                  total: true,
                  cliente: { select: { id: true, nombre: true, nit: true } }
                }
              }
            }
          }
        }
      })

      // Cambiar estado de las liquidaciones a FACTURADA
      await tx.liquidacion_servicio.updateMany({
        where: { id: { in: liquidacion_ids } },
        data: { estado: 'FACTURADA', fecha_facturacion: new Date() }
      })

      // Registrar historial para cada liquidación
      await tx.historial_estado_liquidacion.createMany({
        data: liquidaciones.map(l => ({
          liquidacion_id: l.id,
          estado_anterior: l.estado,
          estado_nuevo: 'FACTURADA',
          usuario_id: userId,
        }))
      })

      return fac
    })

    return {
      ...factura,
      valor_total: Number(factura.valor_total),
      items: factura.items.map(i => ({
        ...i,
        valor_liquidacion: Number(i.valor_liquidacion),
        liquidacion: i.liquidacion ? {
          ...i.liquidacion,
          total: Number(i.liquidacion.total)
        } : null
      }))
    }
  },

  async listar(filtros: FiltrosFacturas) {
    const page = Number(filtros.page) || 1
    const limit = Number(filtros.limit) || 15
    const skip = (page - 1) * limit

    const where: any = { deleted_at: null }
    if (filtros.estado) {
      where.estado = filtros.estado
    }
    if (filtros.busqueda) {
      where.OR = [
        { numero_factura: { contains: filtros.busqueda, mode: 'insensitive' } },
        { items: { some: { liquidacion: { consecutivo: { contains: filtros.busqueda, mode: 'insensitive' } } } } },
        { items: { some: { liquidacion: { cliente: { nombre: { contains: filtros.busqueda, mode: 'insensitive' } } } } } },
      ]
    }

    const [facturas, total] = await Promise.all([
      prisma.factura_liquidacion_servicio.findMany({
        where,
        include: {
          facturado_por: { select: { id: true, nombre: true, correo: true } },
          anulado_por: { select: { id: true, nombre: true, correo: true } },
          _count: { select: { items: true } },
          items: {
            include: {
              liquidacion: {
                select: {
                  id: true,
                  consecutivo: true,
                  total: true,
                  mes: true,
                  anio: true,
                  cliente: { select: { id: true, nombre: true, nit: true } }
                }
              }
            }
          }
        },
        orderBy: { created_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.factura_liquidacion_servicio.count({ where }),
    ])

    return {
      facturas: facturas.map(f => ({
        ...f,
        valor_total: Number(f.valor_total),
        total_liquidaciones: f._count.items,
        items: f.items.map(i => ({
          ...i,
          valor_liquidacion: Number(i.valor_liquidacion),
          liquidacion: i.liquidacion ? {
            ...i.liquidacion,
            total: Number(i.liquidacion.total)
          } : null
        }))
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
    }
  },

  async obtenerPorId(id: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      include: {
        facturado_por: { select: { id: true, nombre: true, correo: true } },
        anulado_por: { select: { id: true, nombre: true, correo: true } },
        items: {
          include: {
            liquidacion: {
              include: {
                cliente: { select: { id: true, nombre: true, nit: true } },
                creado_por: { select: { id: true, nombre: true } },
              }
            }
          }
        }
      }
    })

    if (!factura) throw new Error('Factura no encontrada')

    return {
      ...factura,
      valor_total: Number(factura.valor_total),
      items: factura.items.map(i => ({
        ...i,
        valor_liquidacion: Number(i.valor_liquidacion),
        liquidacion: i.liquidacion ? {
          ...i.liquidacion,
          total: Number(i.liquidacion.total),
          valor_servicios: Number(i.liquidacion.valor_servicios),
          valor_recargos: Number(i.liquidacion.valor_recargos),
          subtotal: Number(i.liquidacion.subtotal),
          valor_iva: Number(i.liquidacion.valor_iva),
        } : null
      }))
    }
  },

  async anular(id: string, userId: string, motivo: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      include: {
        items: { select: { liquidacion_id: true } }
      }
    })

    if (!factura) throw new Error('Factura no encontrada')
    if (factura.estado === 'ANULADA') throw new Error('La factura ya está anulada')

    const liquidacionIds = factura.items.map(i => i.liquidacion_id)

    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.factura_liquidacion_servicio.update({
        where: { id },
        data: {
          estado: 'ANULADA',
          anulado_por_id: userId,
          motivo_anulacion: motivo || 'Anulada por usuario',
          fecha_anulacion: new Date(),
        },
        include: {
          facturado_por: { select: { id: true, nombre: true, correo: true } },
          anulado_por: { select: { id: true, nombre: true, correo: true } },
          items: {
            include: {
              liquidacion: {
                select: {
                  id: true,
                  consecutivo: true,
                  total: true,
                  cliente: { select: { id: true, nombre: true, nit: true } }
                }
              }
            }
          }
        }
      })

      // Revertir liquidaciones a LIQUIDADA
      await tx.liquidacion_servicio.updateMany({
        where: { id: { in: liquidacionIds }, estado: 'FACTURADA' },
        data: { estado: 'LIQUIDADA', fecha_facturacion: null }
      })

      // Registrar historial para cada liquidación revertida
      await tx.historial_estado_liquidacion.createMany({
        data: liquidacionIds.map(lid => ({
          liquidacion_id: lid,
          estado_anterior: 'FACTURADA',
          estado_nuevo: 'LIQUIDADA',
          usuario_id: userId,
          motivo: motivo || 'Factura anulada',
        }))
      })

      return updated
    })

    return {
      ...result,
      valor_total: Number(result.valor_total),
      items: result.items.map(i => ({
        ...i,
        valor_liquidacion: Number(i.valor_liquidacion),
        liquidacion: i.liquidacion ? {
          ...i.liquidacion,
          total: Number(i.liquidacion.total)
        } : null
      }))
    }
  },

  async obtenerFacturasDeLiquidaciones(liquidacionIds: string[]) {
    const items = await prisma.factura_liquidacion_item.findMany({
      where: {
        liquidacion_id: { in: liquidacionIds },
        factura: { estado: 'ACTIVA' }
      },
      select: {
        liquidacion_id: true,
        factura: {
          select: { id: true, numero_factura: true }
        }
      }
    })
    const map: Record<string, { factura_id: string; numero_factura: string }> = {}
    for (const item of items) {
      map[item.liquidacion_id] = {
        factura_id: item.factura.id,
        numero_factura: item.factura.numero_factura
      }
    }
    return map
  },

  /**
   * Soft delete de una factura ANULADA.
   */
  async eliminar(id: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      select: { id: true, estado: true, numero_factura: true, deleted_at: true }
    })

    if (!factura) throw new Error('Factura no encontrada')
    if (factura.deleted_at) throw new Error('Esta factura ya fue eliminada')
    if (factura.estado === 'ACTIVA') {
      throw new Error('No se puede eliminar una factura activa. Anúlela primero.')
    }

    await prisma.factura_liquidacion_servicio.update({
      where: { id },
      data: { deleted_at: new Date() },
    })

    return { message: `Factura ${factura.numero_factura} eliminada exitosamente` }
  },

  async restaurar(id: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      select: { id: true, numero_factura: true, deleted_at: true }
    })

    if (!factura) throw new Error('Factura no encontrada')
    if (!factura.deleted_at) throw new Error('Esta factura no está eliminada')

    await prisma.factura_liquidacion_servicio.update({
      where: { id },
      data: { deleted_at: null },
    })

    return { message: `Factura ${factura.numero_factura} restaurada exitosamente` }
  },

  async listarEliminadas(filtros: FiltrosFacturas) {
    const page = Number(filtros.page) || 1
    const limit = Number(filtros.limit) || 15
    const skip = (page - 1) * limit

    const where: any = { deleted_at: { not: null } }
    if (filtros.busqueda) {
      where.OR = [
        { numero_factura: { contains: filtros.busqueda, mode: 'insensitive' } },
      ]
    }

    const [facturas, total] = await Promise.all([
      prisma.factura_liquidacion_servicio.findMany({
        where,
        include: {
          facturado_por: { select: { id: true, nombre: true, correo: true } },
          anulado_por: { select: { id: true, nombre: true, correo: true } },
          _count: { select: { items: true } },
        },
        orderBy: { deleted_at: 'desc' },
        skip,
        take: limit,
      }),
      prisma.factura_liquidacion_servicio.count({ where }),
    ])

    return {
      facturas: facturas.map(f => ({
        ...f,
        valor_total: Number(f.valor_total),
        total_liquidaciones: f._count.items,
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
    }
  },
}
