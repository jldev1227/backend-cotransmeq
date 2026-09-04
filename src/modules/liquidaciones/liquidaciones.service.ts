import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";

import * as pdfMake from "pdfmake/build/pdfmake";
import * as pdfFonts from "pdfmake/build/vfs_fonts";
import archiver from "archiver";
import { getIO } from "../../sockets";
import { pdfFromHtml } from "../../services/pdf.service";
import {
  renderDesprendibleHtml,
  type DatosDesprendible,
  type LineaDesprendible,
} from "../nomina-canvas/desprendible.template";

/**
 * `21 JUL 2026 — 20 AGO 2026` a partir de las dos fechas de la liquidación.
 *
 * `periodo_start` y `periodo_end` son VarChar, no Date: son lo que el usuario
 * teclea en el formulario. Si no se pueden interpretar se devuelven tal cual,
 * que es más útil en un documento que un «Invalid Date».
 */
function periodoLegible(inicio: string, fin: string): string {
  const fmt = (iso: string): string | null => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d
      .toLocaleDateString("es-CO", {
        day: "numeric",
        month: "short",
        year: "numeric",
        timeZone: "UTC",
      })
      .toUpperCase()
      .replace(/\./g, "");
  };
  const a = fmt(inicio);
  const b = fmt(fin);
  if (!a || !b) return `${inicio} — ${fin}`;
  return `${a} — ${b}`;
}

/** `Desprendible_DAYRO-RODRIGUEZ_21-JUL-2026.pdf`, sin tildes ni espacios. */
function nombreArchivoDesprendible(d: DatosDesprendible): string {
  const limpio = (t: string) =>
    t
      .normalize("NFD")
      // Marcas combinantes por rango de escapes: los literales son
      // invisibles en el editor y el primer reformateo se los lleva.
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .toUpperCase();
  return `Desprendible_${limpio(d.empleado.nombre)}_${limpio(d.empleado.periodo.split("—")[0] ?? "")}.pdf`;
}
import { RecargosService } from "../recargos/recargos.service";

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

    /// `deleted_at: null` en el punto de partida: el listado, los conteos y el
    /// agregado de montos comparten este `where`, así que el filtro se pone una
    /// vez y no hay forma de olvidarlo en una rama.
    const where: any = { deleted_at: null };

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
            where: { deleted_at: null },
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
          bonificaciones: { where: { deleted_at: null } },
          pernotes: {
            where: { deleted_at: null },
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
            where: { deleted_at: null },
            include: {
              clientes: {
                select: {
                  id: true,
                  nombre: true,
                },
              },
            },
          },
          mantenimientos: { where: { deleted_at: null } },
          anticipos: { where: { deleted_at: null } },
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
        ajuste_geopark: Number((liq as any).ajuste_geopark ?? 0),
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
    const liquidacion = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
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
          where: { deleted_at: null },
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
        bonificaciones: { where: { deleted_at: null } },
        pernotes: {
          where: { deleted_at: null },
          include: {
            clientes: {
              select: { id: true, nombre: true },
            },
          },
        },
        recargos: {
          where: { deleted_at: null },
          include: {
            clientes: {
              select: { id: true, nombre: true },
            },
          },
        },
        mantenimientos: { where: { deleted_at: null } },
        anticipos: { where: { deleted_at: null } },
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
      ajuste_geopark: Number((liquidacion as any).ajuste_geopark ?? 0),
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
        conductores: data.conductor_id
          ? { connect: { id: data.conductor_id } }
          : undefined,
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
        ajuste_parex:
          data.ajuste_parex || data.ajuste_parex_recargos_completos
            ? data.ajuste_parex_valor || 0
            : 0,
        ajuste_geopark: data.ajuste_geopark
          ? data.ajuste_geopark_valor || 0
          : 0,
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
        // Prisma no permite mezclar `liquidacionesCreateInput` (relations) con
        // `liquidacionesUncheckedCreateInput` (scalars) en el mismo `data`.
        // Como ya usamos `conductores: { connect }`, tenemos que usar también
        // la relation para los FKs de usuarios en vez de los scalars.
        users_liquidaciones_creado_por_idTousers: { connect: { id: userId } },
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
            if (!pernote.empresa_id) {
              // Defensa: el frontend ya valida, pero si llega un pernote sin empresa
              // lo loggeamos para que no se pierda silenciosamente en producción.
              const tieneContenido =
                (pernote.fechas?.length || 0) > 0 || (pernote.cantidad || 0) > 0;
              if (tieneContenido) {
                console.warn(
                  `[liquidaciones.crear] Pernote omitido: empresa_id vacío para vehiculo_id=${vehiculoId} ` +
                    `(fechas=${pernote.fechas?.length ?? 0}, cantidad=${pernote.cantidad ?? 0})`
                );
              }
              continue;
            }
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

    // Recargos calculados desde planillas (recargos_preview)
    // Mismo bloque que en `actualizar` (líneas ~949-1032). Sin esto, los
    // recargos automáticos que el usuario incluyó en el preview NUNCA se
    // persistían al crear la liquidación: `item.recargos` quedaba vacío
    // y el PDF caía al fallback de `recargosData.planillas`, que no
    // respeta la marca `incluir` y mostraba también los desmarcados en
    // la sumatoria de "OTROS".
    const recargosPreviewIncluidos = (data.recargos_preview || []).filter(
      (grupo: any) => grupo.incluir !== false,
    );
    const gruposUnicosPorKey = new Map<string, any>();
    for (const grupo of recargosPreviewIncluidos) {
      if (!grupo.empresa_id) continue;
      const dedupKey = `${grupo.vehiculo_id || ""}|${grupo.empresa_id}|${grupo.mes || ""}|${grupo.emisor || ""}`;
      if (!gruposUnicosPorKey.has(dedupKey)) {
        gruposUnicosPorKey.set(dedupKey, grupo);
      }
    }
    const gruposUnicos = Array.from(gruposUnicosPorKey.values());

    if (gruposUnicos.length > 0) {
      for (const grupo of gruposUnicos) {
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
              liquidacion_id_origen_planilla_id: {
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

    const liquidacionExistente = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
    });

    if (!liquidacionExistente) {
      throw new Error("Liquidación no encontrada");
    }

    await prisma.liquidaciones.update({
      where: { id },
      data: {
        conductores: data.conductor_id
          ? { connect: { id: data.conductor_id } }
          : undefined,
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
        ajuste_parex: (() => {
          if (data.ajuste_parex || data.ajuste_parex_recargos_completos) {
            if (data.ajuste_parex_valor !== undefined) {
              return data.ajuste_parex_valor || 0;
            }
            return Number(liquidacionExistente.ajuste_parex) || 0;
          }
          return 0;
        })(),
        ajuste_geopark: data.ajuste_geopark
          ? (data.ajuste_geopark_valor !== undefined
              ? data.ajuste_geopark_valor || 0
              : Number((liquidacionExistente as any).ajuste_geopark) || 0)
          : 0,
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
        // Mismo motivo que en `crear`: como usamos `conductores: { connect }`,
        // los FKs de usuarios deben ir por la relation, no por scalar.
        users_liquidaciones_actualizado_por_idTousers: { connect: { id: userId } },
        updated_at: now,
      },
    });

    // Actualizar vehículos
    if (data.vehiculos) {
      /// Se MARCAN, no se borran: cada edición destruía la versión anterior
      /// de lo que se le iba a pagar a una persona, sin dejar con qué
      /// compararla. Todas las lecturas filtran `deleted_at IS NULL`.
      await prisma.liquidacion_vehiculo.updateMany({
        where: { liquidacion_id: id, deleted_at: null },
        data: { deleted_at: new Date() },
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
      await prisma.anticipos.updateMany({
        where: { liquidacion_id: id, deleted_at: null },
        data: { deleted_at: new Date() },
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
      // Retirar los anteriores. Se marcan; la unicidad de `recargos` por
      // planilla de origen es PARCIAL, así que el archivado no bloquea al
      // nuevo.
      const retirado = new Date();
      await prisma.bonificaciones.updateMany({
        where: { liquidacion_id: id, deleted_at: null }, data: { deleted_at: retirado } });
      await prisma.mantenimientos.updateMany({
        where: { liquidacion_id: id, deleted_at: null }, data: { deleted_at: retirado } });
      await prisma.pernotes.updateMany({
        where: { liquidacion_id: id, deleted_at: null }, data: { deleted_at: retirado } });
      await prisma.recargos.updateMany({
        where: { liquidacion_id: id, deleted_at: null }, data: { deleted_at: retirado } });

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
      // El frontend envía N entradas por grupo (1 por cada origen_planilla_id
      // que compone el grupo), todas con el mismo `valor` (total del grupo).
      // Si iteráramos sin deduplicar crearíamos 1 recargo por entrada y los
      // totales se multiplicarían. Dedupeamos por `key` (vehiculo + mes +
      // empresa + emisor) para crear exactamente 1 recargo por grupo.
      const recargosPreviewIncluidos = (data.recargos_preview || []).filter(
        (grupo: any) => grupo.incluir !== false,
      );
      const gruposUnicosPorKey = new Map<string, any>();
      for (const grupo of recargosPreviewIncluidos) {
        if (!grupo.empresa_id) continue;
        const dedupKey = `${grupo.vehiculo_id || ""}|${grupo.empresa_id}|${grupo.mes || ""}|${grupo.emisor || ""}`;
        if (!gruposUnicosPorKey.has(dedupKey)) {
          gruposUnicosPorKey.set(dedupKey, grupo);
        }
      }
      const gruposUnicos = Array.from(gruposUnicosPorKey.values());

      if (gruposUnicos.length > 0) {
        for (const grupo of gruposUnicos) {
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
                liquidacion_id_origen_planilla_id: {
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
    /// Una liquidación ya retirada se trata como inexistente: borrarla dos
    /// veces debe dar error, no un «eliminada correctamente» sobre nada.
    const liquidacion = await prisma.liquidaciones.findFirst({
      where: { id, deleted_at: null },
    });

    if (!liquidacion) {
      throw new Error("Liquidación no encontrada");
    }

    /// Se MARCA la liquidación y NO se toca nada de lo que cuelga de ella.
    ///
    /// Antes esto destruía la liquidación y SIETE tablas hijas en la misma
    /// transacción: bonificaciones, mantenimientos, pernotes, recargos,
    /// anticipos, `liquidacion_vehiculo` y `firmas_desprendibles`. Esa última
    /// es la FIRMA DEL CONDUCTOR sobre su desprendible —la prueba de que
    /// recibió y aceptó su pago—, y un clic se la llevaba junto con el periodo,
    /// el valor y la fecha.
    ///
    /// Marcando solo la madre, las siete quedan colgando de algo que ninguna
    /// consulta devuelve, y siguen enteras para cuando haya que reconstruir.
    /// Es la misma decisión que con el historial de las liquidaciones de
    /// servicios: la evidencia no se toca.
    await prisma.liquidaciones.update({
      where: { id },
      data: { deleted_at: new Date() },
    });

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

    // Función helper para obtener la config correcta para una FECHA concreta.
    //
    // ⚠️ ANTES esta función usaba `esVigenteParaMes` (overlap con el mes) y luego
    // `find()` sobre configs ordenadas por `vigencia_desde DESC`. Eso provocaba
    // un bug crítico: para una planilla de julio 2026 con dos configs (vieja
    // hasta 14-jul, nueva desde 15-jul), AMBAS solapaban con el mes, y find()
    // devolvía SIEMPRE la nueva → todos los días se calculaban con la tarifa
    // del 15-jul en adelante, aunque fueran del 1-6.
    //
    // Ahora la firma acepta un `diaConcreto` (1-31) y resuelve con la fecha
    // EXACTA. Si no se pasa día, mantiene el comportamiento de compatibilidad
    // (overlap con el mes) para no romper llamadas existentes, pero marcando
    // claramente que es legacy.
    function getConfigParaEmpresa(
      empresaId: string,
      mesPlanilla?: number,
      añoPlanilla?: number,
      diaConcreto?: number,
    ) {
      // Vigencia para una fecha concreta (preferida): solo configs cuyo rango
      // de vigencia ENVUELVA la fecha exacta.
      const esVigenteEnFecha = (
        config: (typeof configsSalariales)[0],
        fecha: Date,
      ): boolean => {
        if (config.vigencia_desde > fecha) return false;
        if (config.vigencia_hasta && config.vigencia_hasta < fecha)
          return false;
        return true;
      };

      // Vigencia por overlap de mes (LEGACY, solo si NO hay día concreto):
      // cualquier config que se solape con el rango del mes. NO usar para
      // resolver configs: induce al bug descrito arriba. Se conserva para
      // diagnóstico, pero el flujo real va siempre por `esVigenteEnFecha`.
      const esVigenteParaMes = (
        config: (typeof configsSalariales)[0],
        mes: number,
        año: number,
      ): boolean => {
        const inicioMes = new Date(Date.UTC(año, mes - 1, 1));
        const finMes = new Date(Date.UTC(año, mes, 0));
        if (config.vigencia_desde > finMes) return false;
        if (config.vigencia_hasta && config.vigencia_hasta < inicioMes)
          return false;
        return true;
      };

      // ── Camino principal: fecha concreta ──
      if (
        mesPlanilla !== undefined &&
        añoPlanilla !== undefined &&
        diaConcreto !== undefined
      ) {
        const fechaDia = new Date(
          Date.UTC(añoPlanilla, mesPlanilla - 1, diaConcreto),
        );
        // Prioridad: específica de la empresa > base. Con datos duplicados
        // (migración ejecutada más de una vez sin UNIQUE constraint) puede
        // haber varias filas "vigentes" para la misma empresa+fecha. Se
        // desempata por:
        //   a) `vigencia_hasta` no nulo (más específico)
        //   b) `vigencia_desde` más reciente
        // Mismo criterio que `tiposVigentesPara` en recargos.service.ts.
        const scoreVigencia = (
          desde: Date | string,
          hasta: Date | string | null,
        ) => (hasta ? 1 : 0) * 1e18 + new Date(desde).getTime();
        const candidatas = configsSalariales.filter((c) =>
          esVigenteEnFecha(c, fechaDia),
        );
        const configEmpresa = candidatas
          .filter((c) => c.empresa_id === empresaId)
          .sort(
            (a, b) =>
              scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
              scoreVigencia(a.vigencia_desde, a.vigencia_hasta),
          )[0];
        if (configEmpresa) return configEmpresa;
        const configBase = candidatas
          .filter((c) => c.empresa_id === null)
          .sort(
            (a, b) =>
              scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
              scoreVigencia(a.vigencia_desde, a.vigencia_hasta),
          )[0];
        if (configBase) return configBase;
        return null;
      }

      // ── Camino legacy: solo mes/año, sin día concreto ──
      // ⚠️ Este camino NO debe usarse para cálculos monetarios. Solo se
      // conserva para que llamadas externas sin día no rompan, pero
      // preferentemente siempre se debe pasar `diaConcreto`.
      if (mesPlanilla !== undefined && añoPlanilla !== undefined) {
        const configEmpresa = configsSalariales.find(
          (c) =>
            c.empresa_id === empresaId &&
            esVigenteParaMes(c, mesPlanilla, añoPlanilla),
        );
        if (configEmpresa) return configEmpresa;
        const configBaseMes = configsSalariales.find(
          (c) =>
            c.empresa_id === null &&
            esVigenteParaMes(c, mesPlanilla, añoPlanilla),
        );
        if (configBaseMes) return configBaseMes;
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

    // Resumen por tipo de recargo.
    // Importante: la clave agrupa por (codigo, porcentaje) para que cuando
    // una planilla cruza un cambio de tarifario (ej: HEFN 155% antes del
    // 15-jul, 165% desde el 15-jul) cada % salga como fila separada con su
    // propio total. Antes la clave era solo `codigo`, lo que mezclaba dos
    // tarifas distintas en una sola fila mostrando el % del primer detalle
    // encontrado (engañoso para el usuario final).
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

    // Pre-cargar configs y tipos vigentes por fecha (para usar el valor
    // hora y % VIGENTES al momento de la consulta, no los snapshots viejos
    // que se guardaron cuando se creó la planilla).
    const tiposTodos = await prisma.tipos_recargos.findMany({
      where: { activo: true, deleted_at: null }
    });
    const tiposMapGlobal = new Map(tiposTodos.map((t) => [t.codigo, t]));

    const configsTodas = await prisma.configuraciones_salarios.findMany({
      where: {
        activo: true,
        deleted_at: null,
        vigencia_desde: { lte: fechaFin },
        OR: [
          { vigencia_hasta: null },
          { vigencia_hasta: { gte: fechaInicio } }
        ]
      },
      orderBy: [{ empresa_id: "desc" }, { vigencia_desde: "desc" }]
    });

    // Helpers para resolver config y tipos vigentes para una fecha concreta
    const scoreVigencia = (
      desde: Date | string,
      hasta: Date | string | null
    ) => (hasta ? 1 : 0) * 1e18 + new Date(desde).getTime();

    const getConfigVigentePorFecha = (empresaId: string, fecha: Date) => {
      const candidatas = configsTodas.filter((c) => {
        if (c.vigencia_desde > fecha) return false;
        if (c.vigencia_hasta && c.vigencia_hasta < fecha) return false;
        return true;
      });
      const emp = candidatas
        .filter((c) => c.empresa_id === empresaId)
        .sort(
          (a, b) =>
            scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
            scoreVigencia(a.vigencia_desde, a.vigencia_hasta)
        )[0];
      if (emp) return emp;
      const base = candidatas
        .filter((c) => c.empresa_id === null)
        .sort(
          (a, b) =>
            scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
            scoreVigencia(a.vigencia_desde, a.vigencia_hasta)
        )[0];
      return base || null;
    };

    const getTipoVigentePorFecha = (codigo: string, fecha: Date) => {
      let best: { id: string; porcentaje: number; es_hora_extra: boolean; score: number } | null =
        null;
      for (const t of tiposTodos) {
        if (t.codigo !== codigo) continue;
        if (t.vigencia_desde > fecha) continue;
        if (t.vigencia_hasta && t.vigencia_hasta < fecha) continue;
        const score = scoreVigencia(t.vigencia_desde, t.vigencia_hasta);
        if (!best || score > best.score) {
          best = {
            id: t.id,
            porcentaje: Number(t.porcentaje),
            es_hora_extra: t.es_hora_extra,
            score
          };
        }
      }
      return best;
    };

    const planillasDetalle = planillas.map((planilla) => {
      const mesPlanilla = planilla.mes;
      const añoPlanilla = planilla.a_o;

      // Filtrar días dentro del rango del período ANTES de resolver la
      // config de planilla, para que el `primer dia` usado por
      // `getConfigParaEmpresa(..., diaConcreto)` refleje el día más antiguo
      // que el usuario está viendo (no un día fuera del rango).
      const diasFiltrados = planilla.dias_laborales_planillas.filter((dia) => {
        const fechaDia = new Date(
          Date.UTC(añoPlanilla, mesPlanilla - 1, dia.dia),
        );
        return fechaDia >= fechaInicio && fechaDia <= fechaFin;
      });

      // Resolver la config salarial pasando el DÍA CONCRETO más antiguo
      // visible de la planilla. Antes se llamaba sin día → caía en el
      // camino legacy de overlap por mes y devolvía la config más nueva
      // (ordenada por `vigencia_desde DESC`), lo que hacía que días previos
      // al cambio de tarifario (ej. 1-6 jul) tomaran el valor del tarifario
      // nuevo (15-jul en adelante). Ver `getConfigParaEmpresa`.
      const primerDiaVisible = diasFiltrados
        .map((d) => d.dia)
        .sort((a, b) => a - b)[0];
      const configPlanilla = getConfigParaEmpresa(
        planilla.empresa_id,
        mesPlanilla,
        añoPlanilla,
        primerDiaVisible,
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

        // ── Leer las horas de la database (detalles_recargos_dias) ──
        //
        // Las horas se leen TAL CUAL de la base de datos. El usuario quiere
        // que la fuente de verdad sea la database, no un cálculo en vivo.
        // Solo recalculamos el VALOR MONETARIO (con la config salarial
        // vigente al momento de la consulta), porque ese sí cambia cuando
        // cambia la config.
        //
        // Esto también significa que el desglose modal muestra las mismas
        // horas que `ModalVisualizarRecargo` (que también lee de
        // `detalles_recargos_dias`).
        const configVigente = getConfigVigentePorFecha(planilla.empresa_id, fechaDia);
        const valorHoraBase = configVigente
          ? Number(configVigente.salario_basico) / configVigente.horas_mensuales_base
          : 0;

        const recargosDetalle = dia.disponibilidad
          ? []
          : dia.detalles_recargos_dias.map((detalle) => {
              const tipo = detalle.tipos_recargos;
              const horas = Number(detalle.horas);

              // % vigente al momento de la consulta (no el del snapshot)
              const tipoVigente = getTipoVigentePorFecha(tipo.codigo, fechaDia);
              const porcentaje = tipoVigente
                ? tipoVigente.porcentaje
                : Number(tipo.porcentaje);

              // Tarifas "all-in" (base + %): horas extras, adicionales y
              // RD (Recargo Dominical/Festivo). El resto (RN, RNDF) son
              // recargos puros sumados a la base.
              const esAllIn =
                (tipoVigente?.es_hora_extra ?? tipo.es_hora_extra) ||
                tipo.adicional ||
                tipo.codigo === "RD";
              const tasa = esAllIn
                ? valorHoraBase + (valorHoraBase * porcentaje) / 100
                : (valorHoraBase * porcentaje) / 100;
              const valorTotal = Math.round(horas * tasa);

              // Acumular en resumen por (tipo, %)
              const resumenKey = `${tipo.codigo}@${porcentaje}`;
              if (!resumenTipos[resumenKey]) {
                resumenTipos[resumenKey] = {
                  codigo: tipo.codigo,
                  nombre: tipo.nombre,
                  porcentaje,
                  es_hora_extra: tipo.es_hora_extra,
                  adicional: tipo.adicional,
                  totalHoras: 0,
                  valorHoraBase: Math.round(valorHoraBase),
                  valorTotal: 0,
                };
              }
              resumenTipos[resumenKey].totalHoras += horas;
              resumenTipos[resumenKey].valorTotal += valorTotal;

              return {
                tipo_codigo: tipo.codigo,
                tipo_nombre: tipo.nombre,
                es_hora_extra: tipo.es_hora_extra,
                adicional: tipo.adicional,
                porcentaje,
                horas,
                valor_hora_base: Math.round(valorHoraBase),
                valor_hora_calculada: Math.round(tasa),
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

      // Calcular total_valor de la planilla sumando los totales POR DÍA
      // que ya están en `diasDetalle` (cada `total_valor_dia` se compone
      // de snapshots por día correctos). Esto reemplaza el cálculo previo
      // que re-multiplicaba horas × valorHoraBase (de planilla) × factor,
      // el cual mezclaba configs de distintos días en un solo factor y
      // producía totales incorrectos cuando la planilla cruzaba un cambio
      // de tarifario. Ahora se respeta el snapshot por día.
      const totalRecargoPlanilla = diasDetalle.reduce(
        (sum, d) => sum + (d.total_valor_dia || 0),
        0,
      );

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
      resumen_tipos: Object.values(resumenTipos)
        .map((t) => {
          // `valorTotal` ya viene acumulado desde los snapshots por día
          // (cada detalle aporta su valor_total real con la config que le
          // correspondía). Solo lo redondeamos para presentación.
          return {
            ...t,
            totalHoras: Math.round(t.totalHoras * 100) / 100,
            valorTotal: Math.round(t.valorTotal),
          };
        })
        // Orden estable: HED, HEN, HEFD, HEFN, RN, RD, RNDF; dentro del
        // mismo codigo, % más bajo primero (cronológico).
        .sort((a, b) => {
          const orden: Record<string, number> = {
            HED: 1, HEN: 2, HEFD: 3, HEFN: 4, RN: 5, RD: 6, RNDF: 7,
          };
          const oa = orden[a.codigo] ?? 99;
          const ob = orden[b.codigo] ?? 99;
          if (oa !== ob) return oa - ob;
          if (a.porcentaje !== b.porcentaje) return a.porcentaje - b.porcentaje;
          return a.nombre.localeCompare(b.nombre);
        }),
      planillas: planillasDetalle,
    };
  },

  // Empresas cuyos servicios se pagan como BONO APARTE al
  // conductor (no como recargo monetario dentro de la liquidación).
  // Sus planillas se muestran en el PDF en azul con la nota
  // "Reconocido como bono aparte", listando solo días y horas
  // (sin desglose HED/RN/HEN ni valor monetario).
  //
  // Si en el futuro se agregan más empresas a esta lista, basta
  // con añadir el nombre aquí. La comparación es case-insensitive
  // y por coincidencia de substring para tolerar variaciones
  // como "GEOLAB S.A.S" vs "GEOLAB".
  EMPRESAS_BONO_APARTE: [
    "GEOLAB",
    "RED SALUD",
    "INGENIERIA ESPECIALIZADA",
  ],

  esEmpresaBonoAparte(p: any): boolean {
    const nombre = String(p?.empresa?.nombre || "").toUpperCase();
    if (!nombre) return false;
    return LiquidacionesService.EMPRESAS_BONO_APARTE.some((e) =>
      nombre.includes(e.toUpperCase()),
    );
  },

  /**
   * Construye el `dataParaPdf` (planillas clasificadas con `_categoria`)
   * que consume el generador de PDF (`pdfDesprendible.ts`).
   *
   * Esta lógica vivía en el frontend del modal de detalle de
   * liquidación. La movimos al backend para que el endpoint del
   * portal del conductor devuelva EXACTAMENTE la misma estructura
   * de datos, evitando diferencias entre el desprendible visto por
   * el admin y el visto por el conductor.
   *
   * Categorías:
   *   - 'pagar'        → recargo monetario que suma al total.
   *   - 'bono_aparte'  → empresa (GEOLAB, RED SALUD, INGENIERIA
   *                      ESPECIALIZADA) cuyos servicios NO se
   *                      remuneran como recargo.
   *   - 'no_pagar'     → días con disponibilidad o recorrido sin
   *                      recargo generado (informativos, sin valor).
   *
   * Si la liquidación no tiene `mostrar_recargos = true`, devuelve
   * `{ planillas: [] }` y el PDF no generará las páginas 2+ de recargos.
   */
  async buildDataParaPdf(liquidacion: any): Promise<{ planillas: any[] }> {
    if (!liquidacion?.mostrar_recargos) {
      return { planillas: [] };
    }
    if (
      !liquidacion.conductor_id ||
      !liquidacion.periodo_inicio ||
      !liquidacion.periodo_fin
    ) {
      return { planillas: [] };
    }

    let preview: any = null;
    try {
      preview = await LiquidacionesService.previewRecargos(
        liquidacion.conductor_id,
        liquidacion.periodo_inicio,
        liquidacion.periodo_fin,
      );
    } catch (e) {
      console.warn(
        "[buildDataParaPdf] No se pudo obtener preview-recargos:",
        e,
      );
      return { planillas: [] };
    }

    const todasLasPlanillas: any[] = preview?.planillas || [];
    const recargosArr: any[] = (liquidacion.recargos as any[]) || [];

    // Coincidencia por (vehiculo, empresa, mes). Razón: el recargo
    // guardado puede ser la SUMA de varias planillas (p. ej.
    // SCHLUMBERGER TM-7282 con 2 planillas, SERTECPET TM-7169 +
    // TM-7210 con 2 planillas) pero `origen_planilla_id` solo apunta
    // a UNA. Si solo incluyéramos esa, los días del desglose no
    // sumarían al TOTAL del recargo.
    //
    // Filtramos por `dias.length > 0` para no incluir planillas
    // totalmente vacías del mismo grupo.
    //
    // IMPORTANTE: NO exigimos `total_valor > 0`. Una planilla puede
    // tener `total_valor = 0` cuando TODOS sus días están marcados
    // como disponibilidad.
    const recargoMatch = (r: any, p: any) => {
      if (!r || !p) return false;
      const matchVehiculo = p.vehiculo?.id === r.vehiculo_id;
      const matchEmpresa =
        p.empresa?.id === (r.empresa_id || r.clientes?.id);
      const planillaMes = `${p.año}-${String(p.mes).padStart(2, "0")}`;
      const matchMes = planillaMes === r.mes;
      const tieneDias = Array.isArray(p.dias) && p.dias.length > 0;
      return matchVehiculo && matchEmpresa && matchMes && tieneDias;
    };

    const planillasFinales: any[] = [];
    const planillaIdsAgregadas = new Set<string>();

    // 1) Planillas del preview que coinciden con algún recargo
    for (const rec of recargosArr) {
      const matches = todasLasPlanillas.filter((p) => recargoMatch(rec, p));
      for (const p of matches) {
        if (planillaIdsAgregadas.has(p.planilla_id)) continue;
        planillaIdsAgregadas.add(p.planilla_id);
        (p as any)._categoria = "pagar";
        planillasFinales.push(p);
      }
    }

    // 1.5) Planillas que NO quedaron ancladas a un recargo guardado
    for (const p of todasLasPlanillas) {
      if (planillaIdsAgregadas.has(p.planilla_id)) continue;
      const diasVisibles = Array.isArray(p.dias) ? p.dias : [];
      if (diasVisibles.length === 0) continue;

      const esBonoAparte = LiquidacionesService.esEmpresaBonoAparte(p);

      const tieneDiasConDisponibilidad = diasVisibles.some(
        (d: any) => d.disponibilidad,
      );
      const tieneDiasConRecorridoSinRecargo = diasVisibles.some(
        (d: any) =>
          !d.disponibilidad &&
          Number(d.total_horas) > 0 &&
          (!Array.isArray(d.recargos) || d.recargos.length === 0),
      );

      if (
        !esBonoAparte &&
        !tieneDiasConDisponibilidad &&
        !tieneDiasConRecorridoSinRecargo
      )
        continue;

      planillaIdsAgregadas.add(p.planilla_id);
      (p as any)._categoria = esBonoAparte ? "bono_aparte" : "no_pagar";
      planillasFinales.push(p);
    }

    // 2) Recargos SIN planilla con días (caso típico FEPCO: el
    //    recargo está guardado pero la planilla en el preview tiene
    //    `dias: []` y `total_valor: 0`). Creamos una planilla
    //    sintética con el valor del recargo para que el TOTAL del
    //    PDF cuadre con el del preview.
    for (const r of recargosArr) {
      if (!r) continue;
      const tieneMatchConDias = todasLasPlanillas.some((p) =>
        recargoMatch(r, p),
      );
      if (tieneMatchConDias) continue;
      if (Number(r.valor || 0) <= 0) continue;

      const vehiculo = (liquidacion.vehiculos as any[])?.find(
        (v) => v.id === r.vehiculo_id,
      );
      const [yearStr, monthStr] = (r.mes || "").split("-");
      const year = Number(yearStr);
      const month = Number(monthStr);

      const planillaReferencia = todasLasPlanillas.find(
        (p) => p.empresa?.id === (r.empresa_id || r.clientes?.id),
      );

      planillasFinales.push({
        planilla_id: r.origen_planilla_id || r.id,
        numero_planilla: r.numero_planilla || "S/N",
        vehiculo: vehiculo
          ? {
              id: vehiculo.id,
              placa: vehiculo.placa,
              marca: vehiculo.marca,
              modelo: vehiculo.modelo,
            }
          : planillaReferencia?.vehiculo || null,
        empresa:
          r.clientes ||
          planillaReferencia?.empresa || { id: r.empresa_id, nombre: "N/A" },
        mes: month || planillaReferencia?.mes || 0,
        año: year || planillaReferencia?.año || 0,
        total_dias: 0,
        total_horas: 0,
        total_valor: Number(r.valor || 0),
        total_festivos: 0,
        configuracion_salarial:
          planillaReferencia?.configuracion_salarial || {
            valor_hora_trabajador: 0,
          },
        dias: [],
      });
    }

    return { planillas: planillasFinales };
  },

  // Preview de recargos desde planillas para un conductor en un período
  // Obtener una liquidación por ID (ya existente, pero necesitamos su resultado transformado)
  async obtenerPorIdTransformada(id: string) {
    const liquidacion = await LiquidacionesService.obtenerPorId(id);
    // The existing obtenerPorId already returns the transformed object
    return liquidacion;
  },

  /**
   * PDF del desprendible de una liquidación.
   *
   * Antes esto devolvía un marcador de posición que decía «Test PDF - Empty
   * Content», con un comentario de «bypassing full content generation for
   * testing». O sea que tanto la descarga individual como el ZIP masivo
   * llevaban tiempo entregando documentos vacíos. Ahora renderiza el
   * desprendible de verdad con Puppeteer, igual que el módulo de terceros.
   */
  async generatePayslipPdfBuffer(
    liquidationId: string,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const datos = await this.datosDesprendible(liquidationId);
    // Sin `prelude`: este repo no tiene el módulo de PDF de terceros, así que
    // no hay fuentes embebidas ni tokens de color que inyectar. El documento
    // sale con las fuentes del sistema y los valores por defecto de cada
    // `var(--tpdf-*)`, que la plantilla ya trae.
    const html = renderDesprendibleHtml(datos);
    const buffer = await pdfFromHtml({
      html,
      landscape: false,
      format: "Letter",
      marginMm: 0,
      // El `@page` de la plantilla manda: si no, Puppeteer impone sus
      // márgenes y el documento sale descuadrado respecto al preview.
      preferCSSPageSize: true,
    });

    return { buffer, fileName: nombreArchivoDesprendible(datos) };
  },

  /**
   * Reúne lo que necesita la plantilla del desprendible.
   *
   * Los importes se leen de la liquidación tal y como está guardada: este es
   * el documento de un periodo cerrado, no un recálculo. Si las cifras no
   * cuadran, lo que hay que arreglar es la liquidación.
   */
  async datosDesprendible(liquidationId: string): Promise<DatosDesprendible> {
    const l = await prisma.liquidaciones.findFirst({
      where: { id: liquidationId, deleted_at: null },
      include: {
        conductores: true,
        bonificaciones: { where: { deleted_at: null } },
        pernotes: { where: { deleted_at: null } },
        anticipos: { where: { deleted_at: null } },
        recargos: { where: { deleted_at: null }, include: { clientes: { select: { nombre: true } } } },
        firmas_desprendibles: true,
      },
    });
    if (!l) throw new Error(`Liquidación ${liquidationId} no encontrada`);

    const n = (v: unknown): number => {
      const x = Number(v);
      return Number.isFinite(x) ? x : 0;
    };

    const devengos: LineaDesprendible[] = [
      { concepto: "SALARIO", cantidad: l.dias_laborados, valor: n(l.salario_devengado) },
      { concepto: "AUXILIO DE TRANSPORTE", cantidad: l.dias_laborados, valor: n(l.auxilio_transporte) },
    ];
    if (n(l.total_vacaciones) > 0) {
      devengos.push({ concepto: "VACACIONES", cantidad: null, valor: n(l.total_vacaciones) });
    }
    if (n(l.ajuste_salarial) > 0) {
      devengos.push({
        concepto: "BONO NIVELACION DE SALARIO",
        cantidad: l.dias_laborados_villanueva,
        valor: n(l.ajuste_salarial),
      });
    }
    for (const b of l.bonificaciones) {
      // `values` es un string JSON con `[{ mes, quantity }]`.
      let cantidad = 0;
      try {
        const parsed = JSON.parse(b.values ?? "[]");
        if (Array.isArray(parsed)) cantidad = parsed.reduce((s, v: any) => s + n(v?.quantity), 0);
      } catch {
        cantidad = 0;
      }
      const valor = cantidad * n(b.value);
      if (valor > 0) {
        devengos.push({ concepto: String(b.name ?? "BONO").toUpperCase(), cantidad, valor });
      }
    }
    for (const p of l.pernotes) {
      const valor = n(p.cantidad) * n(p.valor);
      if (valor > 0) devengos.push({ concepto: "PERNOTES", cantidad: n(p.cantidad), valor });
    }
    // Los recargos van agrupados por empresa: es lo que contabilidad necesita
    // para imputar el gasto, y en la lista plana se pierde.
    const porEmpresa = new Map<string, number>();
    for (const r of l.recargos) {
      if (r.incluir === false) continue;
      const empresa = r.clientes?.nombre ?? "RECARGOS";
      porEmpresa.set(empresa, (porEmpresa.get(empresa) ?? 0) + n(r.valor));
    }
    for (const [empresa, valor] of porEmpresa) {
      if (valor > 0) devengos.push({ concepto: `RECARGOS ${empresa}`, cantidad: null, valor });
    }
    if (n(l.disponibilidad) > 0) {
      devengos.push({ concepto: "DISPONIBILIDAD MES", cantidad: null, valor: n(l.disponibilidad) });
    }
    if (n(l.valor_incapacidad) > 0) {
      devengos.push({ concepto: "INCAPACIDAD", cantidad: null, valor: n(l.valor_incapacidad) });
    }
    if (n(l.interes_cesantias) > 0) {
      devengos.push({ concepto: "INTERESES DE CESANTIAS", cantidad: null, valor: n(l.interes_cesantias) });
    }
    if (Array.isArray(l.conceptos_adicionales)) {
      for (const c of l.conceptos_adicionales as any[]) {
        const valor = n(c?.valor);
        if (valor !== 0) {
          devengos.push({
            concepto: String(c?.nombre ?? "CONCEPTO ADICIONAL").toUpperCase(),
            cantidad: null,
            valor,
          });
        }
      }
    }

    const deducciones: LineaDesprendible[] = [
      { concepto: "SALUD", cantidad: null, valor: n(l.salud) },
      { concepto: "PENSION", cantidad: null, valor: n(l.pension) },
    ];
    const totalAnticipos = l.anticipos.reduce((s, a) => s + n(a.valor), 0);
    if (totalAnticipos > 0) {
      deducciones.push({ concepto: "ANTICIPOS", cantidad: null, valor: totalAnticipos });
    }

    const firma = l.firmas_desprendibles.find(
      (f) => f.firma_url && f.firma_url !== "pending" && f.estado === "Activa",
    );

    const conductor = l.conductores;
    return {
      empresa: {
        nombre: l.es_cotransmeq
          ? "COOPERATIVA DE TRANSPORTADORES DEL META Y CASANARE"
          : "TRANSPORTES Y SERVICIOS ESMERALDA S.A.S",
        nit: l.es_cotransmeq ? "892099216-1" : "901528440-3",
      },
      empleado: {
        nombre: conductor ? `${conductor.nombre} ${conductor.apellido}`.trim() : "—",
        cedula: conductor?.numero_identificacion ?? "—",
        cargo: conductor?.cargo ?? "CONDUCTOR",
        periodo: periodoLegible(l.periodo_start, l.periodo_end),
        estado: (l as any).estado_flujo ?? l.estado,
      },
      devengos: devengos.filter((d) => d.valor !== 0),
      deducciones: deducciones.filter((d) => d.valor !== 0),
      basePrestacional: n(l.salario_devengado) + n(l.total_vacaciones),
      firmaUrl: firma?.firma_url ?? null,
      fechaFirma: firma?.fecha_firma ? firma.fecha_firma.toISOString().slice(0, 10) : null,
    };
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

    // Se generan TODOS los PDF antes de abrir el ZIP. Si uno falla a mitad
    // del empaquetado, el usuario se queda con un archivo truncado que
    // parece válido; así o sale entero o sale un error que se entiende.
    //
    // Secuencial a propósito: cada PDF abre una pestaña de Chromium, y
    // treinta a la vez agotan la memoria del contenedor.
    const documentos: { buffer: Buffer; fileName: string }[] = [];
    const fallidos: { id: string; error: string }[] = [];

    for (let i = 0; i < total; i++) {
      const id = liquidationIds[i];
      try {
        documentos.push(await this.generatePayslipPdfBuffer(id));
      } catch (error: any) {
        console.error(`[nomina-zip] fallo generando el PDF de ${id}:`, error);
        fallidos.push({ id, error: error?.message ?? "error desconocido" });
        if (socketId) {
          io.to(socketId).emit("progress:error", {
            message: `No se pudo generar el desprendible de ${id}: ${error?.message ?? ""}`,
          });
        }
      }
      if (socketId) {
        io.to(socketId).emit("progress:update", { current: i + 1, total });
      }
    }

    if (documentos.length === 0) {
      throw new Error(
        "No se pudo generar ningún desprendible. Revisa que las liquidaciones existan.",
      );
    }

    const archive = archiver("zip", { zlib: { level: 6 } });

    // Los listeners se enganchan ANTES de escribir nada. Con el orden
    // anterior —finalize() y después on("data")— los primeros trozos se
    // emitían sin nadie escuchando y el ZIP salía incompleto.
    const buffers: Buffer[] = [];
    const zip = new Promise<Buffer>((resolve, reject) => {
      archive.on("data", (chunk: Buffer) => buffers.push(chunk));
      archive.on("end", () => resolve(Buffer.concat(buffers)));
      // `archiver` avisa de los errores por EVENTO, no rechazando una
      // promesa: sin este manejador, un fallo tumba el proceso entero.
      archive.on("error", (err: Error) => reject(err));
    });

    // Dos liquidaciones del mismo conductor en el mismo periodo darían el
    // mismo nombre y una pisaría a la otra dentro del ZIP.
    const usados = new Map<string, number>();
    for (const doc of documentos) {
      const veces = usados.get(doc.fileName) ?? 0;
      usados.set(doc.fileName, veces + 1);
      const nombre = veces === 0
        ? doc.fileName
        : doc.fileName.replace(/\.pdf$/i, `_${veces + 1}.pdf`);
      archive.append(doc.buffer, { name: nombre });
    }

    await archive.finalize();
    const resultado = await zip;

    if (socketId) {
      io.to(socketId).emit("progress:complete", {
        generados: documentos.length,
        fallidos,
      });
    }

    return resultado;
  },
};
