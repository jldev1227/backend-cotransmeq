// @ts-nocheck
import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";
import { getS3ObjectAsBase64 } from "../../config/aws";

export const PrimasService = {
  // Obtener todas las primas con paginación y filtros
  async obtenerTodas(filters?: {
    search?: string;
    conductor_id?: string;
    mes?: number;
    anio?: number;
    estado?: string;
    page?: number;
    limit?: number;
    sortBy?: string;
    sortOrder?: string;
  }) {
    const page = filters?.page || 1;
    const limit = filters?.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {
      deleted_at: null,
    };

    if (filters?.conductor_id) {
      where.conductor_id = filters.conductor_id;
    }

    if (filters?.estado) {
      where.estado = filters.estado;
    }

    if (filters?.mes) {
      where.mes = filters.mes;
    }

    if (filters?.anio) {
      where.anio = filters.anio;
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

    // Determinar ordenamiento
    let orderBy: any = { created_at: "desc" };
    const sortOrder = filters?.sortOrder === "asc" ? "asc" : "desc";

    if (filters?.sortBy) {
      switch (filters.sortBy) {
        case "prima":
          orderBy = { prima: sortOrder };
          break;
        case "mes":
          orderBy = { mes: sortOrder };
          break;
        case "anio":
          orderBy = { anio: sortOrder };
          break;
        case "estado":
          orderBy = { estado: sortOrder };
          break;
        case "conductor":
          orderBy = { conductores: { nombre: sortOrder } };
          break;
        default:
          orderBy = { created_at: "desc" };
      }
    }

    const [primas, total, totalPendientes, totalPagados, montoTotalAgg] =
      await Promise.all([
        prisma.primas.findMany({
          where,
          include: {
            conductores: {
              select: {
                id: true,
                nombre: true,
                apellido: true,
                numero_identificacion: true,
                email: true,
              },
            },
            _count: {
              select: {
                firmas_primas: {
                  where: {
                    firma_url: { not: '' },
                    NOT: { firma_url: 'pending' },
                  },
                },
              },
            },
          },
          orderBy,
          take: limit,
          skip,
        }),
        prisma.primas.count({ where }),
        prisma.primas.count({ where: { ...where, estado: "Pendiente" } }),
        prisma.primas.count({ where: { ...where, estado: "Pagado" } }),
        prisma.primas.aggregate({
          where,
          _sum: { prima: true },
        }),
      ]);

    // Transformar los datos para el frontend
    const primasTransformadas = primas.map((p) => {
      const conductor = p.conductores;
      const firmasCount = (p as any)._count?.firmas_primas ?? 0;
      return {
        ...p,
        _count: undefined,
        firmado: firmasCount > 0,
        firmas_primas_count: firmasCount,
        prima: Number(p.prima),
        prima_pendiente:
          p.prima_pendiente !== null && p.prima_pendiente !== undefined
            ? Number(p.prima_pendiente)
            : null,
        tiempo_trabajado_dias:
          p.tiempo_trabajado_dias !== null && p.tiempo_trabajado_dias !== undefined
            ? Number(p.tiempo_trabajado_dias)
            : null,
        sueldo_basico:
          p.sueldo_basico !== null && p.sueldo_basico !== undefined
            ? Number(p.sueldo_basico)
            : null,
        auxilio_transporte:
          p.auxilio_transporte !== null && p.auxilio_transporte !== undefined
            ? Number(p.auxilio_transporte)
            : null,
        sueldo_variable:
          p.sueldo_variable !== null && p.sueldo_variable !== undefined
            ? Number(p.sueldo_variable)
            : null,
        total_base_liquidacion:
          p.total_base_liquidacion !== null && p.total_base_liquidacion !== undefined
            ? Number(p.total_base_liquidacion)
            : null,
        conductor: conductor
          ? {
              id: conductor.id,
              nombre: conductor.nombre,
              apellido: conductor.apellido,
              cedula: conductor.numero_identificacion,
              email: conductor.email,
            }
          : null,
      };
    });

    return {
      primas: primasTransformadas,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
      stats: {
        total,
        totalPendientes,
        totalPagados,
        montoTotal: Number(montoTotalAgg._sum.prima || 0),
      },
    };
  },

  // Obtener una prima por ID
  async obtenerPorId(id: string) {
    const prima = await prisma.primas.findUnique({
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
            sede_trabajo: true,
          },
        },
        users_primas_creado_por_idTousers: {
          select: { id: true, nombre: true, correo: true },
        },
        users_primas_actualizado_por_idTousers: {
          select: { id: true, nombre: true, correo: true },
        },
      },
    });

    if (!prima) {
      throw new Error("Prima no encontrada");
    }

    const conductor = prima.conductores;
    const creado_por = prima.users_primas_creado_por_idTousers;
    const actualizado_por = prima.users_primas_actualizado_por_idTousers;

    return {
      ...prima,
      prima: Number(prima.prima),
      prima_pendiente:
        prima.prima_pendiente !== null && prima.prima_pendiente !== undefined
          ? Number(prima.prima_pendiente)
          : null,
      tiempo_trabajado_dias:
        prima.tiempo_trabajado_dias !== null &&
        prima.tiempo_trabajado_dias !== undefined
          ? Number(prima.tiempo_trabajado_dias)
          : null,
      sueldo_basico:
        prima.sueldo_basico !== null && prima.sueldo_basico !== undefined
          ? Number(prima.sueldo_basico)
          : null,
      auxilio_transporte:
        prima.auxilio_transporte !== null && prima.auxilio_transporte !== undefined
          ? Number(prima.auxilio_transporte)
          : null,
      sueldo_variable:
        prima.sueldo_variable !== null && prima.sueldo_variable !== undefined
          ? Number(prima.sueldo_variable)
          : null,
      total_base_liquidacion:
        prima.total_base_liquidacion !== null &&
        prima.total_base_liquidacion !== undefined
          ? Number(prima.total_base_liquidacion)
          : null,
      conductor: conductor
        ? {
            id: conductor.id,
            nombre: conductor.nombre,
            apellido: conductor.apellido,
            cedula: conductor.numero_identificacion,
            email: conductor.email,
            telefono: conductor.telefono,
            cargo: conductor.cargo,
            sede_trabajo: conductor.sede_trabajo,
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
    };
  },

  // Crear una nueva prima
  async crear(data: any, userId: string) {
    const id = randomUUID();
    const now = new Date();

    const prima = await prisma.primas.create({
      data: {
        id,
        conductor_id: data.conductor_id,
        mes: Number(data.mes),
        anio: Number(data.anio),
        prima: data.prima ?? 0,
        prima_pendiente:
          data.prima_pendiente !== undefined && data.prima_pendiente !== null
            ? Number(data.prima_pendiente)
            : null,
        tiempo_trabajado_dias: data.tiempo_trabajado_dias ?? null,
        sueldo_basico: data.sueldo_basico ?? null,
        auxilio_transporte: data.auxilio_transporte ?? null,
        sueldo_variable: data.sueldo_variable ?? null,
        total_base_liquidacion: data.total_base_liquidacion ?? null,
        observaciones: data.observaciones || null,
        estado: data.estado === "Pagado" ? "Pagado" : "Pendiente",
        creado_por_id: userId,
        created_at: now,
        updated_at: now,
      },
    });

    return await PrimasService.obtenerPorId(id);
  },

  // Actualizar una prima
  async actualizar(id: string, data: any, userId: string) {
    const primaExistente = await prisma.primas.findUnique({
      where: { id },
    });

    if (!primaExistente) {
      throw new Error("Prima no encontrada");
    }

    const updateData: any = {
      updated_at: new Date(),
      actualizado_por_id: userId,
    };

    if (data.conductor_id !== undefined) updateData.conductor_id = data.conductor_id;
    if (data.mes !== undefined) updateData.mes = Number(data.mes);
    if (data.anio !== undefined) updateData.anio = Number(data.anio);
    if (data.prima !== undefined) updateData.prima = data.prima;
    if (data.prima_pendiente !== undefined) {
      updateData.prima_pendiente =
        data.prima_pendiente !== null ? Number(data.prima_pendiente) : null;
    }
    if (data.observaciones !== undefined) updateData.observaciones = data.observaciones;
    if (data.estado !== undefined) {
      updateData.estado = data.estado === "Pagado" ? "Pagado" : "Pendiente";
    }
    if (data.tiempo_trabajado_dias !== undefined) {
      updateData.tiempo_trabajado_dias =
        data.tiempo_trabajado_dias !== null
          ? Number(data.tiempo_trabajado_dias)
          : null;
    }
    if (data.sueldo_basico !== undefined) {
      updateData.sueldo_basico =
        data.sueldo_basico !== null ? Number(data.sueldo_basico) : null;
    }
    if (data.auxilio_transporte !== undefined) {
      updateData.auxilio_transporte =
        data.auxilio_transporte !== null
          ? Number(data.auxilio_transporte)
          : null;
    }
    if (data.sueldo_variable !== undefined) {
      updateData.sueldo_variable =
        data.sueldo_variable !== null ? Number(data.sueldo_variable) : null;
    }
    if (data.total_base_liquidacion !== undefined) {
      updateData.total_base_liquidacion =
        data.total_base_liquidacion !== null
          ? Number(data.total_base_liquidacion)
          : null;
    }

    await prisma.primas.update({
      where: { id },
      data: updateData,
    });

    return await PrimasService.obtenerPorId(id);
  },

  // Eliminar (soft delete) una prima
  async eliminar(id: string) {
    const prima = await prisma.primas.findUnique({
      where: { id },
    });

    if (!prima) {
      throw new Error("Prima no encontrada");
    }

    await prisma.primas.update({
      where: { id },
      data: { deleted_at: new Date(), updated_at: new Date() },
    });

    return { success: true, message: "Prima eliminada correctamente" };
  },

  // Buscar primas por conductor y período (sin paginación)
  async buscarPorConductorPeriodo(
    conductorId: string,
    mes?: number,
    anio?: number,
  ) {
    const where: any = {
      conductor_id: conductorId,
      deleted_at: null,
    };

    if (mes !== undefined && mes !== null) {
      where.mes = Number(mes);
    }

    if (anio !== undefined && anio !== null) {
      where.anio = Number(anio);
    }

    const primas = await prisma.primas.findMany({
      where,
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
            email: true,
          },
        },
      },
      orderBy: [{ anio: "desc" }, { mes: "desc" }],
    });

    return primas.map((p) => ({
      ...p,
      prima: Number(p.prima),
      prima_pendiente:
        p.prima_pendiente !== null && p.prima_pendiente !== undefined
          ? Number(p.prima_pendiente)
          : null,
      tiempo_trabajado_dias:
        p.tiempo_trabajado_dias !== null && p.tiempo_trabajado_dias !== undefined
          ? Number(p.tiempo_trabajado_dias)
          : null,
      sueldo_basico:
        p.sueldo_basico !== null && p.sueldo_basico !== undefined
          ? Number(p.sueldo_basico)
          : null,
      auxilio_transporte:
        p.auxilio_transporte !== null && p.auxilio_transporte !== undefined
          ? Number(p.auxilio_transporte)
          : null,
      sueldo_variable:
        p.sueldo_variable !== null && p.sueldo_variable !== undefined
          ? Number(p.sueldo_variable)
          : null,
      total_base_liquidacion:
        p.total_base_liquidacion !== null && p.total_base_liquidacion !== undefined
          ? Number(p.total_base_liquidacion)
          : null,
      conductor: p.conductores
        ? {
            id: p.conductores.id,
            nombre: p.conductores.nombre,
            apellido: p.conductores.apellido,
            cedula: p.conductores.numero_identificacion,
            email: p.conductores.email,
          }
        : null,
    }));
  },

  /**
   * Obtener firma de una prima para el dashboard de admin.
   * Orden de prioridad:
   *   1) Firma propia de la prima (firmas_primas)
   *   2) Fallback: firma de desprendible del mismo conductor del mismo mes/año
   *      (liquidaciones con periodo_end ±1 mes del mes/año de la prima)
   *
   * Devuelve la imagen como data URL base64 lista para incrustar en PDF.
   */
  async obtenerFirmaEnriquecida(id: string) {
    const prima = await prisma.primas.findFirst({
      where: { id, deleted_at: null }
    });

    if (!prima) {
      throw new Error("Prima no encontrada");
    }

    // 1) Firma propia de la prima
    const firmaPropia = await prisma.firmas_primas.findFirst({
      where: {
        prima_id: id,
        firma_url: { not: "" },
        NOT: { firma_url: "pending" }
      },
      orderBy: { fecha_firma: "desc" }
    });

    if (firmaPropia && firmaPropia.firma_s3_key) {
      try {
        const firmaBase64 = await getS3ObjectAsBase64(firmaPropia.firma_s3_key);
        return {
          presignedUrl: firmaBase64,
          fecha_firma: firmaPropia.fecha_firma,
          origen: "prima" as const,
          liquidacion_id: null
        };
      } catch {
        // Continuar al fallback si falla la lectura desde S3
      }
    }

    // 2) Fallback: firma de desprendible del mismo mes/año (±1 mes)
    const candidatos: Array<{ anio: number; mes: number }> = [];
    for (let offset = -1; offset <= 1; offset++) {
      const d = new Date(prima.anio, prima.mes - 1 + offset, 1);
      candidatos.push({ anio: d.getFullYear(), mes: d.getMonth() + 1 });
    }

    const otrasFirmas = await prisma.firmas_desprendibles.findMany({
      where: {
        conductor_id: prima.conductor_id,
        firma_url: { not: "" },
        NOT: { firma_url: "pending" }
      },
      include: {
        liquidaciones: {
          select: { id: true, periodo_start: true, periodo_end: true }
        }
      },
      orderBy: { fecha_firma: "desc" }
    });

    for (const f of otrasFirmas) {
      if (!f.liquidaciones?.periodo_end) continue;
      const fecha = new Date(
        f.liquidaciones.periodo_end +
          (f.liquidaciones.periodo_end.length === 10 ? "T00:00:00" : "")
      );
      if (isNaN(fecha.getTime())) continue;
      const match = candidatos.some(
        (c) => c.anio === fecha.getFullYear() && c.mes === fecha.getMonth() + 1
      );
      if (!match) continue;
      try {
        const firmaBase64 = await getS3ObjectAsBase64(f.firma_s3_key);
        return {
          presignedUrl: firmaBase64,
          fecha_firma: f.fecha_firma,
          origen: "nomina" as const,
          liquidacion_id: f.liquidacion_id
        };
      } catch {
        continue;
      }
    }

    return null;
  }
};
