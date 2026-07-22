import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";
// import { generatePayslipPdfContent } from "../../lib/pdf/pdfGenerator";
import * as pdfMake from "pdfmake/build/pdfmake";
import * as pdfFonts from "pdfmake/build/vfs_fonts";
import archiver from "archiver";
import { getIO } from "../../sockets";

// Set the fonts for pdfMake
(pdfMake as any).vfs = pdfFonts.vfs;

/**
 * Parsea el campo `fechas` de cada pernote.
 * En la BD se almacena como String JSON (ej: '["2026-03-10","2026-03-11"]')
 * pero el frontend espera string[].
 */
function parsePernotesFechas(pernotes: any[]): any[] {
  if (!pernotes || !Array.isArray(pernotes)) return [];
  return pernotes.map((p) => ({
    ...p,
    fechas: (() => {
      if (Array.isArray(p.fechas)) return p.fechas;
      if (typeof p.fechas === "string") {
        try {
          const parsed = JSON.parse(p.fechas);
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    })(),
    valor: Number(p.valor || 0),
    cantidad: Number(p.cantidad || 0),
  }));
}

export const LiquidacionesService = {
  // Obtener todas las liquidaciones
  async obtenerTodas(filters?: {
    conductor_id?: string;
    estado?: string;
    search?: string;
    page?: number;
    limit?: number;
    noLimit?: boolean;
    sortBy?: string;
    sortOrder?: string;
    nomina_month?: string; // formato: YYYY-MM
  }) {
    const page = filters?.page || 1;

    const noLimit = filters?.noLimit === true;

    const limit = noLimit ? undefined : filters?.limit || 20;
    const skip = noLimit ? undefined : (page - 1) * (limit || 20);

    const where: any = {};

    if (filters?.conductor_id) {
      where.conductor_id = filters.conductor_id;
    }

    if (filters?.estado) {
      where.estado = filters.estado;
    }

    if (filters?.search) {
      where.OR = [
        {
          conductores: {
            nombre: { contains: filters.search, mode: "insensitive" },
          },
        },
        {
          conductores: {
            apellido: { contains: filters.search, mode: "insensitive" },
          },
        },
        {
          conductores: {
            numero_identificacion: {
              contains: filters.search,
              mode: "insensitive",
            },
          },
        },
      ];
    }

    // Filtro por mes de nómina (periodo_end contiene el año-mes)
    if (filters?.nomina_month) {
      // nomina_month viene como "YYYY-MM", periodo_end es VARCHAR
      where.periodo_end = {
        startsWith: filters.nomina_month,
      };
    }

    // Determinar ordenamiento
    let orderBy: any = { periodo_end: "desc" }; // Por defecto: períodos más recientes primero
    const sortOrder = filters?.sortOrder === "asc" ? "asc" : "desc";

    if (filters?.sortBy) {
      switch (filters.sortBy) {
        case "periodo":
          orderBy = { periodo_end: sortOrder };
          break;
        case "conductor":
          orderBy = { conductores: { nombre: sortOrder } };
          break;
        case "monto":
          orderBy = { sueldo_total: sortOrder };
          break;
        case "estado":
          orderBy = { estado: sortOrder };
          break;
        case "firmado":
          orderBy = { firmas_desprendibles: { _count: sortOrder } };
          break;
        default:
          orderBy = { periodo_end: "desc" };
      }
    }

    const [
      liquidaciones,
      total,
      totalPendientes,
      montoTotalAgg,
      totalVisibles,
      totalFirmados,
    ] = await Promise.all([
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
              sede_trabajo: true,
            },
          },
          liquidacion_vehiculo: {
            include: {
              vehiculos: {
                select: {
                  id: true,
                  placa: true,
                  marca: true,
                  modelo: true,
                  clase_vehiculo: true,
                },
              },
            },
          },
          bonificaciones: true,
          pernotes: {
            include: {
              clientes: {
                select: {
                  id: true,
                  nombre: true,
                },
              },
            },
          },
          recargos: {
            include: {
              clientes: {
                select: {
                  id: true,
                  nombre: true,
                },
              },
            },
          },
          mantenimientos: true,
          anticipos: true,
          firmas_desprendibles: {
            select: { id: true },
          },
        },
        orderBy,
        ...(limit !== undefined && { take: limit }),
        ...(skip !== undefined && { skip }),
      }),
      prisma.liquidaciones.count({ where }),
      prisma.liquidaciones.count({ where: { ...where, estado: "Pendiente" } }),
      prisma.liquidaciones.aggregate({
        where,
        _sum: { sueldo_total: true },
      }),
      prisma.liquidaciones.count({
        where: { ...where, desprendible_visible: true },
      }),
      prisma.liquidaciones.count({
        where: {
          ...where,
          firmas_desprendibles: { some: {} },
        },
      }),
    ]);

    // Transformar los datos para el frontend
    const liquidacionesTransformadas = liquidaciones.map((liq) => {
      const conductor = liq.conductores;
      const vehiculos = liq.liquidacion_vehiculo.map((lv) => lv.vehiculos);

      return {
        ...liq,
        // Alias de periodo para el frontend
        periodo_inicio: liq.periodo_start,
        periodo_fin: liq.periodo_end,
        // Parsear pernotes.fechas de JSON string a array
        pernotes: parsePernotesFechas(liq.pernotes),
        conductor: conductor
          ? {
              id: conductor.id,
              nombre: `${conductor.nombre} ${conductor.apellido}`,
              cedula: conductor.numero_identificacion,
              email: conductor.email,
              telefono: conductor.telefono,
              cargo: conductor.cargo,
              salario_base: conductor.salario_base,
            }
          : null,
        vehiculos,
        // Convertir Decimals a number
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
        ajuste_parex_recargos_completos:
          (liq as any).ajuste_parex_recargos_completos ?? false,
        dias_ajuste_deducciones: (liq as any).dias_ajuste_deducciones ?? null,
        disponibilidad: Number((liq as any).disponibilidad ?? 0),
        conceptos_adicionales: liq.conceptos_adicionales ?? [],
        // total_devengado = neto + deducciones (sueldo_total ya es sueldoBruto - deducciones)
        total_devengado:
          Number(liq.sueldo_total) +
          Number(liq.salud) +
          Number(liq.pension) +
          Number(liq.total_anticipos),
        total_deducido:
          Number(liq.salud) + Number(liq.pension) + Number(liq.total_anticipos),
        neto_pagado: Number(liq.sueldo_total),
        firmas_desprendibles: liq.firmas_desprendibles || [],
      };
    });

    return {
      liquidaciones: liquidacionesTransformadas,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
      stats: {
        totalRegistros: total,
        totalPendientes,
        montoTotal: Number(montoTotalAgg._sum.sueldo_total || 0),
        totalVisibles,
        totalFirmados,
      },
    };
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
            sede_trabajo: true,
          },
        },
        liquidacion_vehiculo: {
          include: {
            vehiculos: {
              select: {
                id: true,
                placa: true,
                marca: true,
                modelo: true,
                clase_vehiculo: true,
              },
            },
          },
        },
        bonificaciones: true,
        pernotes: {
          include: {
            clientes: {
              select: { id: true, nombre: true },
            },
          },
        },
        recargos: {
          include: {
            clientes: {
              select: { id: true, nombre: true },
            },
          },
        },
        mantenimientos: true,
        anticipos: true,
        firmas_desprendibles: true,
        users_liquidaciones_creado_por_idTousers: {
          select: { id: true, nombre: true, correo: true },
        },
        users_liquidaciones_actualizado_por_idTousers: {
          select: { id: true, nombre: true, correo: true },
        },
        users_liquidaciones_liquidado_por_idTousers: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    });

    if (!liquidacion) {
      throw new Error("Liquidación no encontrada");
    }

    const conductor = liquidacion.conductores;
    const vehiculos = liquidacion.liquidacion_vehiculo.map(
      (lv) => lv.vehiculos,
    );

    const creado_por = liquidacion.users_liquidaciones_creado_por_idTousers;
    const actualizado_por =
      liquidacion.users_liquidaciones_actualizado_por_idTousers;
    const liquidado_por =
      liquidacion.users_liquidaciones_liquidado_por_idTousers;

    return {
      ...liquidacion,
      // Alias de periodo para el frontend
      periodo_inicio: liquidacion.periodo_start,
      periodo_fin: liquidacion.periodo_end,
      // Parsear pernotes.fechas de JSON string a array
      pernotes: parsePernotesFechas(liquidacion.pernotes),
      conductor: conductor
        ? {
            id: conductor.id,
            nombre: `${conductor.nombre} ${conductor.apellido}`,
            cedula: conductor.numero_identificacion,
            email: conductor.email,
            telefono: conductor.telefono,
            cargo: conductor.cargo,
            salario_base: conductor.salario_base,
          }
        : null,
      creado_por: creado_por
        ? {
            id: creado_por.id,
            nombre: creado_por.nombre,
            email: creado_por.correo,
          }
        : null,
      actualizado_por: actualizado_por
        ? {
            id: actualizado_por.id,
            nombre: actualizado_por.nombre,
            email: actualizado_por.correo,
          }
        : null,
      liquidado_por: liquidado_por
        ? {
            id: liquidado_por.id,
            nombre: liquidado_por.nombre,
            email: liquidado_por.correo,
          }
        : null,
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
      ajuste_parex_recargos_completos:
        (liquidacion as any).ajuste_parex_recargos_completos ?? false,
      dias_ajuste_deducciones:
        (liquidacion as any).dias_ajuste_deducciones ?? null,
      disponibilidad: Number((liquidacion as any).disponibilidad ?? 0),
      conceptos_adicionales: liquidacion.conceptos_adicionales ?? [],
      // total_devengado = neto + deducciones (sueldo_total ya es sueldoBruto - deducciones)
      total_devengado:
        Number(liquidacion.sueldo_total) +
        Number(liquidacion.salud) +
        Number(liquidacion.pension) +
        Number(liquidacion.total_anticipos),
      total_deducido:
        Number(liquidacion.salud) +
        Number(liquidacion.pension) +
        Number(liquidacion.total_anticipos),
      neto_pagado: Number(liquidacion.sueldo_total),
    };
  },

  // Crear una nueva liquidación
  async crear(data: any, userId: string) {
    const id = randomUUID();
    const now = new Date();

    // Crear la liquidación
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
        salud: data.no_descontar_salud ? 0 : data.salud || 0,
        pension: data.no_descontar_pension ? 0 : data.pension || 0,
        cesantias: data.cesantias || 0,
        interes_cesantias: data.interes_cesantias || 0,
        auxilio_transporte: data.descontar_transporte
          ? 0
          : data.auxilio_transporte || 0,
        total_bonificaciones: data.total_bonificaciones || 0,
        total_pernotes: data.total_pernotes || 0,
        total_recargos: data.total_recargos || 0,
        total_anticipos: data.total_anticipos || 0,
        total_vacaciones: data.total_vacaciones || 0,
        valor_incapacidad: data.valor_incapacidad || 0,
        ajuste_salarial: data.ajuste_valor || 0,
        ajuste_salarial_por_dia: data.ajuste_por_dia_flag || false,
        ajuste_parex: data.ajuste_parex ? data.ajuste_parex_valor || 0 : 0,
        ajuste_recargos_config: data.ajuste_recargos_config || null,
        ajuste_parex_recargos_completos:
          data.ajuste_parex_recargos_completos || false,
        dias_ajuste_deducciones: data.dias_ajuste_deducciones ?? null,
        descontar_salud_salario: data.descontar_salud_salario ?? false,
        descontar_pension_salario: data.descontar_pension_salario ?? false,
        periodo_start_vacaciones: data.periodo_vacaciones_inicio || null,
        periodo_end_vacaciones: data.periodo_vacaciones_fin || null,
        periodo_start_incapacidad: data.periodo_incapacidad_inicio || null,
        periodo_end_incapacidad: data.periodo_incapacidad_fin || null,
        conceptos_adicionales: data.conceptos_adicionales || null,
        disponibilidad: data.disponibilidad || 0,
        observaciones: data.observaciones || null,
        estado: data.estado === "Liquidado" ? "Liquidado" : "Pendiente",
        creado_por_id: userId,
        created_at: now,
        updated_at: now,
      },
    });

    // Crear relaciones con vehículos
    if (data.vehiculos && data.vehiculos.length > 0) {
      await prisma.liquidacion_vehiculo.createMany({
        data: data.vehiculos.map((vehiculoId: string) => ({
          liquidacion_id: id,
          vehiculo_id: vehiculoId,
          created_at: now,
          updated_at: now,
        })),
      });
    }

    // Crear bonificaciones
    if (data.detalles_vehiculos) {
      for (const detalle of data.detalles_vehiculos) {
        const vehiculoId = detalle.vehiculo?.value;

        // Bonificaciones
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
                updated_at: now,
              },
            });
          }
        }

        // Mantenimientos
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
                updated_at: now,
              },
            });
          }
        }

        // Pernotes (solo crear si tienen empresa_id válido)
        if (detalle.pernotes && detalle.pernotes.length > 0) {
          for (const pernote of detalle.pernotes) {
            if (!pernote.empresa_id) continue;
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
                updated_at: now,
              },
            });
          }
        }

        // Recargos (solo crear si tienen empresa_id válido)
        if (detalle.recargos && detalle.recargos.length > 0) {
          for (const recargo of detalle.recargos) {
            if (!recargo.empresa_id) continue;

            // Detectar override: si el frontend envía origen_planilla_id o si
            // ya existe un automático con la misma (vehiculo, empresa, mes).
            let origenPlanillaId: string | null = recargo.origen_planilla_id || null;
            if (!origenPlanillaId) {
              const autoExistente = await prisma.recargos.findFirst({
                where: {
                  liquidacion_id: id,
                  es_automatico: true,
                  vehiculo_id: vehiculoId,
                  empresa_id: recargo.empresa_id,
                  mes: recargo.mes || "",
                },
                select: { id: true, origen_planilla_id: true },
              });
              origenPlanillaId = autoExistente?.origen_planilla_id || null;
            }
            const esOverride = !!origenPlanillaId;

            await prisma.recargos.create({
              data: {
                id: randomUUID(),
                empresa_id: recargo.empresa_id,
                valor: recargo.valor || 0,
                pag_cliente: recargo.pag_cliente || false,
                porcentaje_propietario: recargo.porcentaje_propietario ?? null,
                es_automatico: false,
                es_override: esOverride,
                origen_planilla_id: origenPlanillaId,
                mes: recargo.mes || "",
                vehiculo_id: vehiculoId,
                liquidacion_id: id,
                created_at: now,
                updated_at: now,
              },
            });
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
            updated_at: now,
          },
        });
      }
    }

    return await LiquidacionesService.obtenerPorId(id);
  },

  // Actualizar una liquidación
  async actualizar(id: string, data: any, userId: string) {
    const now = new Date();

    const liquidacionExistente = await prisma.liquidaciones.findUnique({
      where: { id },
    });

    if (!liquidacionExistente) {
      throw new Error("Liquidación no encontrada");
    }

    await prisma.liquidaciones.update({
      where: { id },
      data: {
        conductor_id: data.conductor_id,
        periodo_start: data.periodo_inicio,
        periodo_end: data.periodo_fin,
        dias_laborados:
          data.dias_laborados ?? liquidacionExistente.dias_laborados,
        dias_laborados_villanueva:
          data.dias_laborados_villanueva ??
          liquidacionExistente.dias_laborados_villanueva,
        dias_laborados_anual:
          data.dias_laborados_anual ??
          liquidacionExistente.dias_laborados_anual,
        salario_devengado:
          data.salario_base ?? Number(liquidacionExistente.salario_devengado),
        sueldo_total:
          data.sueldo_total ?? Number(liquidacionExistente.sueldo_total),
        salud: data.no_descontar_salud
          ? 0
          : (data.salud ?? Number(liquidacionExistente.salud)),
        pension: data.no_descontar_pension
          ? 0
          : (data.pension ?? Number(liquidacionExistente.pension)),
        cesantias: data.cesantias ?? Number(liquidacionExistente.cesantias),
        interes_cesantias:
          data.interes_cesantias ??
          Number(liquidacionExistente.interes_cesantias),
        auxilio_transporte: data.descontar_transporte
          ? 0
          : (data.auxilio_transporte ??
            Number(liquidacionExistente.auxilio_transporte)),
        total_bonificaciones:
          data.total_bonificaciones ??
          Number(liquidacionExistente.total_bonificaciones),
        total_pernotes:
          data.total_pernotes ?? Number(liquidacionExistente.total_pernotes),
        total_recargos:
          data.total_recargos ?? Number(liquidacionExistente.total_recargos),
        total_anticipos:
          data.total_anticipos ?? Number(liquidacionExistente.total_anticipos),
        total_vacaciones:
          data.total_vacaciones ??
          Number(liquidacionExistente.total_vacaciones),
        valor_incapacidad:
          data.valor_incapacidad ??
          Number(liquidacionExistente.valor_incapacidad),
        conceptos_adicionales:
          data.conceptos_adicionales ??
          liquidacionExistente.conceptos_adicionales,
        periodo_start_vacaciones: data.periodo_vacaciones_inicio || null,
        periodo_end_vacaciones: data.periodo_vacaciones_fin || null,
        periodo_start_incapacidad: data.periodo_incapacidad_inicio || null,
        periodo_end_incapacidad: data.periodo_incapacidad_fin || null,
        ajuste_salarial:
          data.ajuste_valor ?? Number(liquidacionExistente.ajuste_salarial),
        ajuste_salarial_por_dia:
          data.ajuste_por_dia_flag ??
          liquidacionExistente.ajuste_salarial_por_dia,
        ajuste_parex: data.ajuste_parex
          ? data.ajuste_parex_valor || 0
          : Number(liquidacionExistente.ajuste_parex) || 0,
        ajuste_recargos_config:
          data.ajuste_recargos_config ??
          (liquidacionExistente as any).ajuste_recargos_config ??
          null,
        ajuste_parex_recargos_completos:
          data.ajuste_parex_recargos_completos ??
          (liquidacionExistente as any).ajuste_parex_recargos_completos ??
          false,
        dias_ajuste_deducciones:
          data.dias_ajuste_deducciones !== undefined
            ? data.dias_ajuste_deducciones
            : ((liquidacionExistente as any).dias_ajuste_deducciones ?? null),
        descontar_salud_salario:
          data.descontar_salud_salario ??
          (liquidacionExistente as any).descontar_salud_salario ??
          false,
        descontar_pension_salario:
          data.descontar_pension_salario ??
          (liquidacionExistente as any).descontar_pension_salario ??
          false,
        disponibilidad:
          data.disponibilidad ??
          Number((liquidacionExistente as any).disponibilidad ?? 0),
        observaciones: data.observaciones ?? liquidacionExistente.observaciones,
        estado:
          data.estado === "Liquidado"
            ? "Liquidado"
            : data.estado === "Pendiente"
              ? "Pendiente"
              : liquidacionExistente.estado,
        actualizado_por_id: userId,
        updated_at: now,
      },
    });

    // Actualizar vehículos
    if (data.vehiculos) {
      await prisma.liquidacion_vehiculo.deleteMany({
        where: { liquidacion_id: id },
      });

      if (data.vehiculos.length > 0) {
        await prisma.liquidacion_vehiculo.createMany({
          data: data.vehiculos.map((vehiculoId: string) => ({
            liquidacion_id: id,
            vehiculo_id: vehiculoId,
            created_at: now,
            updated_at: now,
          })),
        });
      }
    }

    // Actualizar anticipos
    if (data.anticipos !== undefined) {
      await prisma.anticipos.deleteMany({
        where: { liquidacion_id: id },
      });

      if (data.anticipos.length > 0) {
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
              updated_at: now,
            },
          });
        }
      }
    }

    // Actualizar detalles de vehículos (bonificaciones, mantenimientos, pernotes, recargos)
    if (data.detalles_vehiculos) {
      // Eliminar registros anteriores
      await prisma.bonificaciones.deleteMany({ where: { liquidacion_id: id } });
      await prisma.mantenimientos.deleteMany({ where: { liquidacion_id: id } });
      await prisma.pernotes.deleteMany({ where: { liquidacion_id: id } });
      await prisma.recargos.deleteMany({ where: { liquidacion_id: id } });

      // Actualizar totales
      await prisma.liquidaciones.update({
        where: { id },
        data: {
          total_bonificaciones: data.total_bonificaciones ?? 0,
          total_pernotes: data.total_pernotes ?? 0,
          total_recargos: data.total_recargos ?? 0,
          updated_at: now,
        },
      });

      // Re-crear detalles por vehículo
      for (const detalle of data.detalles_vehiculos) {
        const vehiculoId = detalle.vehiculo?.value;

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
                updated_at: now,
              },
            });
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
                updated_at: now,
              },
            });
          }
        }

        if (detalle.pernotes && detalle.pernotes.length > 0) {
          for (const pernote of detalle.pernotes) {
            if (!pernote.empresa_id) continue;
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
                updated_at: now,
              },
            });
          }
        }

        if (detalle.recargos && detalle.recargos.length > 0) {
          for (const recargo of detalle.recargos) {
            if (!recargo.empresa_id) continue;

            // Detectar si este recargo manual está sobreescribiendo un automático
            // existente. Si el frontend envía origen_planilla_id, lo respetamos;
            // si no, buscamos por (vehiculo, empresa, mes) en automáticos de la
            // misma liquidación.
            let origenPlanillaId: string | null = recargo.origen_planilla_id || null;
            if (!origenPlanillaId) {
              const autoExistente = await prisma.recargos.findFirst({
                where: {
                  liquidacion_id: id,
                  es_automatico: true,
                  vehiculo_id: vehiculoId,
                  empresa_id: recargo.empresa_id,
                  mes: recargo.mes || "",
                },
                select: { id: true, origen_planilla_id: true },
              });
              origenPlanillaId = autoExistente?.origen_planilla_id || null;
            }
            const esOverride = !!origenPlanillaId;

            await prisma.recargos.create({
              data: {
                id: randomUUID(),
                empresa_id: recargo.empresa_id,
                valor: recargo.valor || 0,
                pag_cliente: recargo.pag_cliente || false,
                porcentaje_propietario: recargo.porcentaje_propietario ?? null,
                es_automatico: false,
                es_override: esOverride,
                origen_planilla_id: origenPlanillaId,
                mes: recargo.mes || "",
                vehiculo_id: vehiculoId,
                liquidacion_id: id,
                created_at: now,
                updated_at: now,
              },
            });
          }
        }
      }

      // Recargos calculados desde planillas (recargos_preview)
      // Idempotente: usa upsert por (liquidacion_id, origen_planilla_id) cuando
      // se conoce el id de la planilla origen. Si no se conoce, cae a create
      // con deduplicación lógica por (vehiculo, empresa, mes, emisor) en el loop.
      const recargosPreviewIncluidos = (data.recargos_preview || []).filter(
        (grupo: any) => grupo.incluir !== false,
      );
      if (recargosPreviewIncluidos.length > 0) {
        for (const grupo of recargosPreviewIncluidos) {
          if (!grupo.empresa_id) continue;

          const dataRecargo = {
            empresa_id: grupo.empresa_id,
            valor: grupo.valor || 0,
            pag_cliente: grupo.pag_cliente || false,
            porcentaje_propietario: grupo.porcentaje_propietario ?? null,
            es_automatico: true,
            mes: grupo.mes || "",
            numero_planilla: grupo.numero_planilla || null,
            incluir: grupo.incluir !== false,
            emisor: grupo.emisor || null,
            vehiculo_id: grupo.vehiculo_id || null,
            liquidacion_id: id,
            updated_at: now,
          };

          if (grupo.origen_planilla_id) {
            // Idempotente: upsert por (liquidacion_id, origen_planilla_id)
            await prisma.recargos.upsert({
              where: {
                uniq_recargo_origen_planilla: {
                  liquidacion_id: id,
                  origen_planilla_id: grupo.origen_planilla_id,
                },
              },
              update: dataRecargo,
              create: {
                id: randomUUID(),
                origen_planilla_id: grupo.origen_planilla_id,
                ...dataRecargo,
                created_at: now,
              },
            });
          } else {
            // Fallback (sin origen_planilla_id): verificar manualmente si ya existe
            const existente = await prisma.recargos.findFirst({
              where: {
                liquidacion_id: id,
                es_automatico: true,
                vehiculo_id: grupo.vehiculo_id || null,
                empresa_id: grupo.empresa_id,
                mes: grupo.mes || "",
                emisor: grupo.emisor || null,
              },
            });
            if (existente) {
              await prisma.recargos.update({
                where: { id: existente.id },
                data: dataRecargo,
              });
            } else {
              await prisma.recargos.create({
                data: {
                  id: randomUUID(),
                  ...dataRecargo,
                  created_at: now,
                },
              });
            }
          }
        }
      }
    }

    const resultado = await LiquidacionesService.obtenerPorId(id);

    // === DEBUG: Log lo que se guardó ===
    console.log("\n========== RESULTADO GUARDADO ==========");
    console.log("salario_devengado:", resultado.salario_devengado);
    console.log("auxilio_transporte:", resultado.auxilio_transporte);
    console.log("total_bonificaciones:", resultado.total_bonificaciones);
    console.log("total_pernotes:", resultado.total_pernotes);
    console.log("total_recargos:", resultado.total_recargos);
    console.log("total_anticipos:", resultado.total_anticipos);
    console.log("salud:", resultado.salud);
    console.log("pension:", resultado.pension);
    console.log("sueldo_total:", resultado.sueldo_total);
    console.log("ajuste_salarial:", resultado.ajuste_salarial);
    console.log("ajuste_parex:", resultado.ajuste_parex);
    console.log("disponibilidad:", resultado.disponibilidad);
    console.log("pernotes count:", resultado.pernotes?.length);
    console.log("recargos count:", resultado.recargos?.length);
    console.log("bonificaciones count:", resultado.bonificaciones?.length);
    console.log("==========================================\n");

    return resultado;
  },

  // Eliminar una liquidación
  async eliminar(id: string) {
    const liquidacion = await prisma.liquidaciones.findUnique({
      where: { id },
    });

    if (!liquidacion) {
      throw new Error("Liquidación no encontrada");
    }

    // Eliminar en cascada las relaciones
    await prisma.$transaction([
      prisma.bonificaciones.deleteMany({ where: { liquidacion_id: id } }),
      prisma.mantenimientos.deleteMany({ where: { liquidacion_id: id } }),
      prisma.pernotes.deleteMany({ where: { liquidacion_id: id } }),
      prisma.recargos.deleteMany({ where: { liquidacion_id: id } }),
      prisma.anticipos.deleteMany({ where: { liquidacion_id: id } }),
      prisma.firmas_desprendibles.deleteMany({ where: { liquidacion_id: id } }),
      prisma.liquidacion_vehiculo.deleteMany({ where: { liquidacion_id: id } }),
      prisma.liquidaciones.delete({ where: { id } }),
    ]);

    return { success: true, message: "Liquidación eliminada correctamente" };
  },

  /**
   * Revierte un override manual sobre un recargo automático.
   * - Valida que el recargo existe, pertenece a la liquidación y es un override.
   * - Borra el recargo manual.
   * - Reactiva el automático original (incluir: true) para que vuelva a contar
   *   en el total.
   * - Devuelve la liquidación actualizada.
   */
  async revertirOverrideRecargo(liquidacionId: string, recargoId: string, _userId?: string) {
    const recargo = await prisma.recargos.findUnique({
      where: { id: recargoId },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado");
    }
    if (recargo.liquidacion_id !== liquidacionId) {
      throw new Error("El recargo no pertenece a esta liquidación");
    }
    if (!recargo.es_override || !recargo.origen_planilla_id) {
      throw new Error("Este recargo no es un override");
    }

    await prisma.$transaction([
      // Borrar el recargo manual (el override)
      prisma.recargos.delete({ where: { id: recargoId } }),
      // Reactivar el automático original (puede haber sido desactivado
      // cuando se creó el override; aquí forzamos incluir: true)
      prisma.recargos.updateMany({
        where: {
          liquidacion_id: liquidacionId,
          es_automatico: true,
          origen_planilla_id: recargo.origen_planilla_id,
        },
        data: { incluir: true },
      }),
    ]);

    return await LiquidacionesService.obtenerPorId(liquidacionId);
  },

  // Obtener configuraciones de liquidación
  async obtenerConfiguraciones(anio?: number) {
    const where: any = { activo: true };
    if (anio) where.anio = anio;

    const configuraciones = await prisma.configuraciones_liquidacion.findMany({
      where,
      orderBy: [{ anio: "desc" }, { nombre: "asc" }],
    });

    return configuraciones.map((config) => ({
      ...config,
      valor: Number(config.valor),
    }));
  },

  // Obtener años disponibles en configuraciones
  async obtenerAniosConfiguraciones() {
    const result = await prisma.configuraciones_liquidacion.findMany({
      where: { activo: true },
      select: { anio: true },
      distinct: ["anio"],
      orderBy: { anio: "desc" },
    });
    return result.map((r) => r.anio);
  },

  // Actualizar una configuración
  async actualizarConfiguracion(
    id: string,
    data: { nombre?: string; valor?: number; tipo?: string },
  ) {
    const config = await prisma.configuraciones_liquidacion.findUnique({
      where: { id },
    });
    if (!config) throw new Error("Configuración no encontrada");

    const updateData: any = { updated_at: new Date() };
    if (data.nombre !== undefined) updateData.nombre = data.nombre;
    if (data.valor !== undefined) updateData.valor = data.valor;
    if (data.tipo !== undefined) updateData.tipo = data.tipo as any;

    const updated = await prisma.configuraciones_liquidacion.update({
      where: { id },
      data: updateData,
    });

    return { ...updated, valor: Number(updated.valor) };
  },

  // Crear nueva configuración
  async crearConfiguracion(data: {
    nombre: string;
    valor: number;
    tipo: string;
    anio: number;
  }) {
    const { randomUUID } = await import("crypto");
    const created = await prisma.configuraciones_liquidacion.create({
      data: {
        id: randomUUID(),
        nombre: data.nombre,
        valor: data.valor,
        tipo: data.tipo as any,
        anio: data.anio,
        activo: true,
        created_at: new Date(),
        updated_at: new Date(),
      },
    });

    return { ...created, valor: Number(created.valor) };
  },

  // Duplicar configuraciones de un año a otro
  async duplicarConfiguracionesAnio(anioOrigen: number, anioDestino: number) {
    // Verificar que no existan configs para el año destino
    const existentes = await prisma.configuraciones_liquidacion.count({
      where: { anio: anioDestino, activo: true },
    });
    if (existentes > 0)
      throw new Error(`Ya existen configuraciones para el año ${anioDestino}`);

    // Obtener configs del año origen
    const originales = await prisma.configuraciones_liquidacion.findMany({
      where: { anio: anioOrigen, activo: true },
    });
    if (originales.length === 0)
      throw new Error(
        `No se encontraron configuraciones para el año ${anioOrigen}`,
      );

    const { randomUUID } = await import("crypto");
    const nuevas = [];
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
          updated_at: new Date(),
        },
      });
      nuevas.push({ ...nueva, valor: Number(nueva.valor) });
    }

    return nuevas;
  },

  // Eliminar (soft delete) una configuración
  async eliminarConfiguracion(id: string) {
    const config = await prisma.configuraciones_liquidacion.findUnique({
      where: { id },
    });
    if (!config) throw new Error("Configuración no encontrada");

    await prisma.configuraciones_liquidacion.update({
      where: { id },
      data: { activo: false, deleted_at: new Date(), updated_at: new Date() },
    });

    return { success: true, message: "Configuración eliminada correctamente" };
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
        direccion: true,
      },
      orderBy: { nombre: "asc" },
    });
  },

  // Preview de recargos desde planillas para un conductor en un período
  async previewRecargos(
    conductor_id: string,
    periodo_inicio: string,
    periodo_fin: string,
  ) {
    // Parsear el período para obtener los meses involucrados
    const fechaInicio = new Date(periodo_inicio + "T00:00:00Z");
    const fechaFin = new Date(periodo_fin + "T00:00:00Z");

    // Generar lista de meses/años que abarca el período
    const mesesPeriodo: Array<{ mes: number; año: number }> = [];
    const current = new Date(
      Date.UTC(fechaInicio.getUTCFullYear(), fechaInicio.getUTCMonth(), 1),
    );
    const lastMonth = new Date(
      Date.UTC(fechaFin.getUTCFullYear(), fechaFin.getUTCMonth(), 1),
    );
    while (current <= lastMonth) {
      mesesPeriodo.push({
        mes: current.getUTCMonth() + 1,
        año: current.getUTCFullYear(),
      });
      current.setUTCMonth(current.getUTCMonth() + 1);
    }

    console.log("📋 [PREVIEW] Conductor:", conductor_id);
    console.log("📋 [PREVIEW] Período:", periodo_inicio, "->", periodo_fin);
    console.log("📋 [PREVIEW] Meses a buscar:", mesesPeriodo);

    // Obtener TODAS las configuraciones salariales activas vigentes en el período
    // Puede haber una config base (empresa_id = null) y configs por empresa
    const configsSalariales = await prisma.configuraciones_salarios.findMany({
      where: {
        activo: true,
        vigencia_desde: { lte: fechaFin },
        OR: [
          { vigencia_hasta: null },
          { vigencia_hasta: { gte: fechaInicio } },
        ],
      },
      orderBy: { vigencia_desde: "desc" },
    });

    // Función helper para obtener la config correcta según empresa_id y mes/año de la planilla
    // Valida que la vigencia de la config cubra el mes de la planilla
    // Si existe config específica para esa empresa vigente en ese mes, usarla. Si no, usar la config base
    function getConfigParaEmpresa(
      empresaId: string,
      mesPlanilla?: number,
      añoPlanilla?: number,
    ) {
      // Función interna para verificar si una config es vigente para un mes/año dado
      const esVigenteParaMes = (
        config: (typeof configsSalariales)[0],
        mes: number,
        año: number,
      ): boolean => {
        // Primer día del mes de la planilla
        const inicioMes = new Date(Date.UTC(año, mes - 1, 1));
        // Último día del mes de la planilla
        const finMes = new Date(Date.UTC(año, mes, 0));

        // La vigencia_desde debe ser <= fin del mes de la planilla
        if (config.vigencia_desde > finMes) return false;
        // La vigencia_hasta (si existe) debe ser >= inicio del mes de la planilla
        if (config.vigencia_hasta && config.vigencia_hasta < inicioMes)
          return false;
        return true;
      };

      if (mesPlanilla !== undefined && añoPlanilla !== undefined) {
        // Buscar config específica para la empresa que esté vigente en el mes de la planilla
        const configEmpresa = configsSalariales.find(
          (c) =>
            c.empresa_id === empresaId &&
            esVigenteParaMes(c, mesPlanilla, añoPlanilla),
        );
        if (configEmpresa) return configEmpresa;
        // Fallback: config base (sin empresa asignada) que esté vigente en el mes
        const configBaseMes = configsSalariales.find(
          (c) =>
            c.empresa_id === null &&
            esVigenteParaMes(c, mesPlanilla, añoPlanilla),
        );
        if (configBaseMes) return configBaseMes;
        // Último fallback: config base sin validar vigencia por mes
        return configsSalariales.find((c) => c.empresa_id === null) || null;
      }

      // Sin mes/año: comportamiento original
      const configEmpresa = configsSalariales.find(
        (c) => c.empresa_id === empresaId,
      );
      if (configEmpresa) return configEmpresa;
      return configsSalariales.find((c) => c.empresa_id === null) || null;
    }

    // Config base (para mostrar en resumen general si no hay específica)
    const configBase =
      configsSalariales.find((c) => c.empresa_id === null) ||
      configsSalariales[0] ||
      null;

    console.log(
      "📋 [PREVIEW] Configs salariales encontradas:",
      configsSalariales.length,
    );
    configsSalariales.forEach((c) => {
      console.log(
        `  → Config ${c.id}: empresa_id=${c.empresa_id || "BASE"}, valor_hora=${Number(c.valor_hora_trabajador)}, salario=${Number(c.salario_basico)}`,
      );
    });

    // Buscar todas las planillas del conductor en los meses del período
    const whereConditions = mesesPeriodo.map((mp) => ({
      mes: mp.mes,
      a_o: mp.año,
    }));

    console.log(
      "📋 [PREVIEW] WHERE conditions para planillas:",
      JSON.stringify(whereConditions),
    );

    const planillas = await prisma.recargos_planillas.findMany({
      where: {
        conductor_id,
        deleted_at: null,
        OR: whereConditions,
      },
      include: {
        vehiculos: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
        clientes: {
          select: { id: true, nombre: true },
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: "asc" },
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
                    categoria: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ a_o: "asc" }, { mes: "asc" }],
    });

    console.log("📋 [PREVIEW] Planillas encontradas:", planillas.length);
    planillas.forEach((p) => {
      console.log(
        `  → Planilla ${p.id}: mes=${p.mes}, año=${p.a_o}, vehículo=${(p.vehiculos as any)?.placa}, empresa=${(p.clientes as any)?.nombre}, días=${p.dias_laborales_planillas?.length}`,
      );
    });

    // Filtrar solo los días que caen dentro del período
    const diaInicio = fechaInicio.getUTCDate();
    const mesInicio = fechaInicio.getUTCMonth() + 1;
    const añoInicio = fechaInicio.getUTCFullYear();
    const diaFin = fechaFin.getUTCDate();
    const mesFin = fechaFin.getUTCMonth() + 1;
    const añoFin = fechaFin.getUTCFullYear();

    // Construir el desglose detallado
    let totalGeneralRecargos = 0;
    let totalDiasTrabajados = 0;
    let totalHorasTrabajadas = 0;
    let totalFestivosGeneral = 0;

    // Resumen por tipo de recargo
    const resumenTipos: Record<
      string,
      {
        codigo: string;
        nombre: string;
        porcentaje: number;
        es_hora_extra: boolean;
        adicional: boolean;
        totalHoras: number;
        valorHoraBase: number;
        valorTotal: number;
      }
    > = {};

    const planillasDetalle = planillas.map((planilla) => {
      const mesPlanilla = planilla.mes;
      const añoPlanilla = planilla.a_o;

      // Obtener config salarial específica para la empresa de esta planilla (validando vigencia por mes)
      const configPlanilla = getConfigParaEmpresa(
        planilla.empresa_id,
        mesPlanilla,
        añoPlanilla,
      );
      // Calcular valor hora con máxima precisión desde salario/horas (como Excel)
      // NO usar el valor_hora_trabajador pre-redondeado de la BD
      const valorHoraBase = configPlanilla
        ? Number(configPlanilla.salario_basico) /
          configPlanilla.horas_mensuales_base
        : 0;
      const pagaFestivos = configPlanilla?.paga_dias_festivos ?? false;
      const porcentajeFestivos = configPlanilla
        ? Number(configPlanilla.porcentaje_festivos)
        : 75;

      // Filtrar días dentro del rango del período
      const diasFiltrados = planilla.dias_laborales_planillas.filter((dia) => {
        const fechaDia = new Date(
          Date.UTC(añoPlanilla, mesPlanilla - 1, dia.dia),
        );
        return fechaDia >= fechaInicio && fechaDia <= fechaFin;
      });

      const diasDetalle = diasFiltrados.map((dia) => {
        const fechaDia = new Date(
          Date.UTC(añoPlanilla, mesPlanilla - 1, dia.dia),
        );
        const nombreDia = fechaDia.toLocaleDateString("es-CO", {
          weekday: "short",
          timeZone: "UTC",
        });
        const fechaFormateada = fechaDia.toLocaleDateString("es-CO", {
          day: "2-digit",
          month: "short",
          year: "numeric",
          timeZone: "UTC",
        });

        // Determinar tipo de día
        let tipoDia = "Normal";
        if (dia.es_festivo) tipoDia = "Festivo";
        else if (dia.es_domingo) tipoDia = "Domingo";

        // Días disponibles no suman al total de horas/días trabajados ni a recargos
        if (!dia.disponibilidad) {
          totalHorasTrabajadas += Number(dia.total_horas);
          totalDiasTrabajados++;
        }

        // Calcular detalles de recargos con valores monetarios
        // Si es día disponible, no calcular valores de recargos
        // Cálculo estilo Excel: usar valor hora = salario/horas_mes con máxima precisión.
        // No redondear intermedios. Los TOTALES se calculan como totalHoras × tasa
        // y se aplica Math.round al final (redondeo estándar, igual que Excel).

        const recargosDetalle = dia.disponibilidad
          ? []
          : dia.detalles_recargos_dias.map((detalle) => {
              const tipo = detalle.tipos_recargos;
              const horas = Number(detalle.horas);
              const porcentaje = Number(tipo.porcentaje);

              // Calcular valor hora calculada con máxima precisión (sin redondear)
              let valorHoraCalc = 0;
              if (tipo.es_hora_extra || tipo.adicional) {
                valorHoraCalc =
                  valorHoraBase + (valorHoraBase * porcentaje) / 100;
              } else {
                valorHoraCalc = (valorHoraBase * porcentaje) / 100;
              }

              // valor_total por día (redondeado para visualización)
              const valorTotal = Math.round(horas * valorHoraCalc);

              // Acumular horas en resumen por tipo (para calcular totales estilo Excel al final)
              if (!resumenTipos[tipo.codigo]) {
                resumenTipos[tipo.codigo] = {
                  codigo: tipo.codigo,
                  nombre: tipo.nombre,
                  porcentaje,
                  es_hora_extra: tipo.es_hora_extra,
                  adicional: tipo.adicional,
                  totalHoras: 0,
                  valorHoraBase: valorHoraBase,
                  valorTotal: 0, // Se recalculará al final como totalHoras × tasa
                };
              }
              resumenTipos[tipo.codigo].totalHoras += horas;

              return {
                tipo_codigo: tipo.codigo,
                tipo_nombre: tipo.nombre,
                es_hora_extra: tipo.es_hora_extra,
                adicional: tipo.adicional,
                porcentaje,
                horas,
                valor_hora_base: Math.round(valorHoraBase),
                valor_hora_calculada: Math.round(valorHoraCalc),
                valor_total: valorTotal,
              };
            });

        const totalDia = recargosDetalle.reduce(
          (sum, r) => sum + r.valor_total,
          0,
        );

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
          total_valor_dia: totalDia,
        };
      });

      // Calcular total_valor de la planilla estilo Excel:
      // Acumular horas por tipo de recargo, luego totalHoras × tasa (sin truncar intermedios)
      const horasPorTipoPlanilla: Record<
        string,
        { horas: number; valorHoraCalc: number }
      > = {};
      for (const dia of diasDetalle) {
        for (const rec of dia.recargos) {
          if (!horasPorTipoPlanilla[rec.tipo_codigo]) {
            horasPorTipoPlanilla[rec.tipo_codigo] = {
              horas: 0,
              valorHoraCalc: 0,
            };
          }
          horasPorTipoPlanilla[rec.tipo_codigo].horas += rec.horas;
          // Recalcular tasa con precisión completa
          const porcentaje = rec.porcentaje;
          if (rec.es_hora_extra || rec.adicional) {
            horasPorTipoPlanilla[rec.tipo_codigo].valorHoraCalc =
              valorHoraBase + (valorHoraBase * porcentaje) / 100;
          } else {
            horasPorTipoPlanilla[rec.tipo_codigo].valorHoraCalc =
              (valorHoraBase * porcentaje) / 100;
          }
        }
      }
      let totalRecargoPlanillaRaw = 0;
      for (const key of Object.keys(horasPorTipoPlanilla)) {
        const { horas, valorHoraCalc } = horasPorTipoPlanilla[key];
        totalRecargoPlanillaRaw += horas * valorHoraCalc; // Sin redondear por tipo
      }
      // Redondear el total de la planilla una sola vez (como Excel)
      const totalRecargoPlanilla = Math.round(totalRecargoPlanillaRaw);

      totalGeneralRecargos += totalRecargoPlanilla;

      // Calcular festivos para ESTA planilla (según su config) - precisión completa
      let festivosPlanilla = 0;
      if (pagaFestivos) {
        const diasFestivosPlanilla = diasDetalle.filter(
          (d) => !d.disponibilidad && (d.es_festivo || d.es_domingo),
        ).length;
        festivosPlanilla = Math.round(
          diasFestivosPlanilla *
            valorHoraBase *
            (porcentajeFestivos / 100) *
            10,
        );
      }
      totalFestivosGeneral += festivosPlanilla;

      return {
        planilla_id: planilla.id,
        numero_planilla: planilla.numero_planilla,
        vehiculo: planilla.vehiculos,
        empresa: planilla.clientes,
        mes: mesPlanilla,
        año: añoPlanilla,
        total_dias: diasDetalle.filter((d) => !d.disponibilidad).length,
        total_horas: diasDetalle
          .filter((d) => !d.disponibilidad)
          .reduce((sum, d) => sum + d.total_horas, 0),
        total_valor: totalRecargoPlanilla,
        total_festivos: festivosPlanilla,
        configuracion_salarial: configPlanilla
          ? {
              id: configPlanilla.id,
              empresa_id: configPlanilla.empresa_id,
              salario_basico: Number(configPlanilla.salario_basico),
              valor_hora_trabajador: Math.round(valorHoraBase),
              horas_mensuales_base: configPlanilla.horas_mensuales_base,
              paga_dias_festivos: pagaFestivos,
              porcentaje_festivos: porcentajeFestivos,
            }
          : null,
        dias: diasDetalle,
      };
    });

    return {
      conductor_id,
      periodo: { inicio: periodo_inicio, fin: periodo_fin },
      configuracion_salarial_base: configBase
        ? {
            id: configBase.id,
            salario_basico: Number(configBase.salario_basico),
            valor_hora_trabajador: Number(configBase.valor_hora_trabajador),
            horas_mensuales_base: configBase.horas_mensuales_base,
            sede: configBase.sede,
            paga_dias_festivos: configBase.paga_dias_festivos,
            porcentaje_festivos: Number(configBase.porcentaje_festivos),
          }
        : null,
      // Mantener compatibilidad con frontend existente
      configuracion_salarial: configBase
        ? {
            id: configBase.id,
            salario_basico: Number(configBase.salario_basico),
            valor_hora_trabajador: Number(configBase.valor_hora_trabajador),
            horas_mensuales_base: configBase.horas_mensuales_base,
            sede: configBase.sede,
            paga_dias_festivos: configBase.paga_dias_festivos,
            porcentaje_festivos: Number(configBase.porcentaje_festivos),
          }
        : null,
      resumen: {
        total_planillas: planillasDetalle.length,
        total_dias_trabajados: totalDiasTrabajados,
        total_horas_trabajadas: Math.round(totalHorasTrabajadas * 10) / 10,
        total_recargos: totalGeneralRecargos,
        total_festivos: totalFestivosGeneral,
        total_general: totalGeneralRecargos,
      },
      resumen_tipos: Object.values(resumenTipos).map((t) => {
        // Recalcular valorTotal estilo Excel: totalHoras × tasa (con precisión completa)
        let valorHoraCalc = 0;
        if (t.es_hora_extra || t.adicional) {
          valorHoraCalc =
            t.valorHoraBase + (t.valorHoraBase * t.porcentaje) / 100;
        } else {
          valorHoraCalc = (t.valorHoraBase * t.porcentaje) / 100;
        }
        return {
          ...t,
          totalHoras: Math.round(t.totalHoras * 100) / 100,
          valorTotal: Math.round(t.totalHoras * valorHoraCalc),
        };
      }),
      planillas: planillasDetalle,
    };
  },

  // Preview de recargos desde planillas para un conductor en un período
  // Obtener una liquidación por ID (ya existente, pero necesitamos su resultado transformado)
  async obtenerPorIdTransformada(id: string) {
    const liquidacion = await LiquidacionesService.obtenerPorId(id);
    // The existing obtenerPorId already returns the transformed object
    return liquidacion;
  },

  // Generar un PDF de desprendible para una liquidación
  async generatePayslipPdfBuffer(
    liquidationId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    // Bypassing full content generation for testing
    const emptyDocDefinition = {
      content: [
        { text: "Test PDF - Empty Content", fontSize: 18, alignment: "center" },
        {
          text: "This is a placeholder PDF for testing file download.",
          fontSize: 12,
          margin: [0, 20],
        },
        { text: `Requested ID: ${liquidationId}`, fontSize: 10 },
      ],
      defaultStyle: {
        font: "Roboto",
      },
    };

    const pdf = pdfMake.createPdf(emptyDocDefinition);
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      pdf.getBuffer((result: Buffer) => resolve(result));
    });

    const fileName = `test_desprendible_${liquidationId.substring(0, 8)}.pdf`;

    return { buffer, fileName };
  },

  // Generar un archivo ZIP con múltiples PDFs de desprendibles
  async generatePayslipsZip(
    liquidationIds: string[],
    socketId?: string,
  ): Promise<Buffer> {
    const io = getIO();
    const total = liquidationIds.length;

    if (socketId) {
      io.to(socketId).emit("progress:start", { total });
    }

    if (!liquidationIds || liquidationIds.length === 0) {
      throw new Error(
        "Se requiere al menos un ID de liquidación para generar el ZIP.",
      );
    }

    const archive = archiver("zip", {
      zlib: { level: 9 }, // Sets the compression level.
    });

    for (let i = 0; i < total; i++) {
      const id = liquidationIds[i];
      try {
        const { buffer, fileName } = await this.generatePayslipPdfBuffer(id);
        archive.append(buffer, { name: fileName });
        if (socketId) {
          io.to(socketId).emit("progress:update", { current: i + 1, total });
        }
      } catch (error: any) {
        console.error(`Error generating PDF for ${id}:`, error);
        if (socketId) {
          io.to(socketId).emit("progress:error", {
            message: `Error generating PDF for ${id}: ${error.message}`,
          });
        }
      }
    }

    await archive.finalize();

    if (socketId) {
      io.to(socketId).emit("progress:complete");
    }

    return await new Promise<Buffer>((resolve, reject) => {
      const buffers: Buffer[] = [];
      archive.on("data", (chunk: Buffer) => buffers.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(buffers)));
      archive.on("error", (err: Error) => reject(err));
    });
  },
};
