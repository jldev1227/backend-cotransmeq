import { prisma } from "../../config/prisma";

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export interface CrearFacturaInput {
  numero_factura: string;
  liquidacion_ids: string[];
  observaciones?: string;
}

export interface FiltrosFacturas {
  page?: number;
  limit?: number;
  busqueda?: string;
  estado?: "ACTIVA" | "ANULADA" | "";
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const FacturacionLiquidacionesService = {
  /**
   * Crear una factura y asociar liquidaciones.
   * Cambia el estado de cada liquidación a FACTURADA.
   */
  async crear(data: CrearFacturaInput, userId: string) {
    const { numero_factura, liquidacion_ids, observaciones } = data;

    if (!numero_factura || !numero_factura.trim()) {
      throw new Error("El número de factura es obligatorio");
    }
    if (!liquidacion_ids || liquidacion_ids.length === 0) {
      throw new Error("Debe seleccionar al menos una liquidación");
    }

    // Verificar que el número de factura no exista (entre no eliminadas)
    const existe = await prisma.factura_liquidacion_servicio.findFirst({
      where: { numero_factura: numero_factura.trim(), deleted_at: null },
    });
    if (existe) {
      throw new Error(
        `Ya existe una factura con el número "${numero_factura.trim()}"`,
      );
    }

    // Verificar que todas las liquidaciones existan y estén en estado LIQUIDADA o APROBADA
    const liquidaciones = await prisma.liquidacion_servicio.findMany({
      where: { id: { in: liquidacion_ids } },
      select: { id: true, consecutivo: true, estado: true, total: true },
    });

    if (liquidaciones.length !== liquidacion_ids.length) {
      throw new Error("Algunas liquidaciones no fueron encontradas");
    }

    // «Ya facturada» ANTES que «no está en estado para facturar»: una
    // liquidación facturada incumple las dos condiciones, y el mensaje útil
    // es en qué factura está, no que le falta un estado.
    const yaFacturadas = await prisma.factura_liquidacion_item.findMany({
      where: {
        /// Solo pivotes vivos: uno archivado significa que esa liquidación se
        /// sacó de su factura y vuelve a ser facturable.
        deleted_at: null,
        liquidacion_id: { in: liquidacion_ids },
        factura: { estado: "ACTIVA" },
      },
      include: {
        liquidacion: { select: { consecutivo: true } },
        factura: { select: { numero_factura: true } },
      },
    });
    if (yaFacturadas.length > 0) {
      const detalles = yaFacturadas
        .map(
          (f) =>
            `${f.liquidacion.consecutivo} (Factura: ${f.factura.numero_factura})`,
        )
        .join(", ");
      throw new Error(
        `Las siguientes liquidaciones ya están facturadas: ${detalles}`,
      );
    }

    const noFacturables = liquidaciones.filter(
      (l) => !["LIQUIDADA", "APROBADA"].includes(l.estado),
    );
    if (noFacturables.length > 0) {
      const consecutivos = noFacturables.map((l) => l.consecutivo).join(", ");
      throw new Error(
        `Las siguientes liquidaciones no están en estado para facturar: ${consecutivos}`,
      );
    }

    // Calcular valor total
    const valorTotal = liquidaciones.reduce(
      (sum, l) => sum + Number(l.total),
      0,
    );

    // Crear factura + items + cambiar estado de liquidaciones en transacción
    const factura = await prisma.$transaction(async (tx) => {
      // ── Toma de posesión de las liquidaciones ──
      //
      // Las comprobaciones de arriba corren FUERA de la transacción, así que
      // entre ellas y este punto otra petición puede haber facturado las
      // mismas liquidaciones. Sin este paso, dos usuarios facturando a la vez
      // recibían ambos un 201 y la liquidación acababa en DOS facturas
      // activas — con `factura_items` duplicados y un `N° FACTURA` que
      // dependía de cuál se leyera primero.
      //
      // El `updateMany` condicional actúa de cerrojo: la segunda transacción
      // se bloquea en las mismas filas hasta que la primera confirma y, al
      // reevaluar el `where` con la instantánea nueva (READ COMMITTED), ya no
      // las encuentra facturables. `count` distinto del esperado ⇒ alguien se
      // adelantó ⇒ se aborta.
      const tomadas = await tx.liquidacion_servicio.updateMany({
        where: {
          id: { in: liquidacion_ids },
          estado: { in: ["LIQUIDADA", "APROBADA"] },
          deleted_at: null,
        },
        data: { estado: "FACTURADA", fecha_facturacion: new Date() },
      });
      if (tomadas.count !== liquidacion_ids.length) {
        throw new Error(
          "Las siguientes liquidaciones ya están facturadas: otra sesión se adelantó. Recarga y vuelve a intentarlo.",
        );
      }

      // Crear factura
      const fac = await tx.factura_liquidacion_servicio.create({
        data: {
          numero_factura: numero_factura.trim(),
          observaciones: observaciones || null,
          valor_total: valorTotal,
          facturado_por_id: userId,
          items: {
            create: liquidaciones.map((l) => ({
              liquidacion_id: l.id,
              valor_liquidacion: Number(l.total),
            })),
          },
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
                  cliente: { select: { id: true, nombre: true, nit: true } },
                },
              },
            },
          },
        },
      });

      // El cambio de estado ya lo hizo la toma de posesión de arriba.

      // Registrar historial para cada liquidación
      await tx.historial_estado_liquidacion.createMany({
        data: liquidaciones.map((l) => ({
          liquidacion_id: l.id,
          estado_anterior: l.estado,
          estado_nuevo: "FACTURADA",
          usuario_id: userId,
        })),
      });

      return fac;
    });

    return {
      ...factura,
      valor_total: Number(factura.valor_total),
      items: factura.items.map((i) => ({
        ...i,
        valor_liquidacion: Number(i.valor_liquidacion),
        liquidacion: i.liquidacion
          ? {
              ...i.liquidacion,
              total: Number(i.liquidacion.total),
            }
          : null,
      })),
    };
  },

  /**
   * Listar facturas con paginación y filtros
   */
  async listar(filtros: FiltrosFacturas) {
    const page = Number(filtros.page) || 1;
    const limit = Number(filtros.limit) || 15;
    const skip = (page - 1) * limit;

    const where: any = { deleted_at: null };
    if (filtros.estado) {
      where.estado = filtros.estado;
    }
    if (filtros.busqueda) {
      where.OR = [
        { numero_factura: { contains: filtros.busqueda, mode: "insensitive" } },
        {
          items: {
            some: {
              liquidacion: {
                consecutivo: {
                  contains: filtros.busqueda,
                  mode: "insensitive",
                },
              },
            },
          },
        },
        {
          items: {
            some: {
              liquidacion: {
                cliente: {
                  nombre: { contains: filtros.busqueda, mode: "insensitive" },
                },
              },
            },
          },
        },
      ];
    }

    const [facturas, total, metadata] = await Promise.all([
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
                  cliente: { select: { id: true, nombre: true, nit: true } },
                },
              },
            },
          },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.factura_liquidacion_servicio.count({ where }),
      metadataFacturas(where),
    ]);

    return {
      facturas: facturas.map((f) => ({
        ...f,
        valor_total: Number(f.valor_total),
        total_liquidaciones: f._count.items,
        items: f.items.map((i) => ({
          ...i,
          valor_liquidacion: Number(i.valor_liquidacion),
          liquidacion: i.liquidacion
            ? {
                ...i.liquidacion,
                total: Number(i.liquidacion.total),
              }
            : null,
        })),
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
      metadata,
    };
  },

  /**
   * Obtener una factura por ID
   */
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
              },
            },
          },
        },
      },
    });

    if (!factura) throw new Error("Factura no encontrada");

    return {
      ...factura,
      valor_total: Number(factura.valor_total),
      items: factura.items.map((i) => ({
        ...i,
        valor_liquidacion: Number(i.valor_liquidacion),
        liquidacion: i.liquidacion
          ? {
              ...i.liquidacion,
              total: Number(i.liquidacion.total),
              valor_servicios: Number(i.liquidacion.valor_servicios),
              valor_recargos: Number(i.liquidacion.valor_recargos),
              subtotal: Number(i.liquidacion.subtotal),
              valor_iva: Number(i.liquidacion.valor_iva),
            }
          : null,
      })),
    };
  },

  /**
   * Anular una factura — revertir liquidaciones a estado LIQUIDADA
   */
  async anular(id: string, userId: string, motivo: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      include: {
        items: { select: { liquidacion_id: true } },
      },
    });

    if (!factura) throw new Error("Factura no encontrada");
    if (factura.estado === "ANULADA")
      throw new Error("La factura ya está anulada");

    const liquidacionIds = factura.items.map((i) => i.liquidacion_id);

    const result = await prisma.$transaction(async (tx) => {
      // Anular factura
      const updated = await tx.factura_liquidacion_servicio.update({
        where: { id },
        data: {
          estado: "ANULADA",
          anulado_por_id: userId,
          motivo_anulacion: motivo || "Anulada por usuario",
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
                  cliente: { select: { id: true, nombre: true, nit: true } },
                },
              },
            },
          },
        },
      });

      // Revertir liquidaciones a LIQUIDADA
      await tx.liquidacion_servicio.updateMany({
        where: { id: { in: liquidacionIds }, estado: "FACTURADA" },
        data: { estado: "LIQUIDADA", fecha_facturacion: null },
      });

      // Registrar historial para cada liquidación revertida
      await tx.historial_estado_liquidacion.createMany({
        data: liquidacionIds.map((lid) => ({
          liquidacion_id: lid,
          estado_anterior: "FACTURADA",
          estado_nuevo: "LIQUIDADA",
          usuario_id: userId,
          motivo: motivo || "Factura anulada",
        })),
      });

      return updated;
    });

    return {
      ...result,
      valor_total: Number(result.valor_total),
      items: result.items.map((i) => ({
        ...i,
        valor_liquidacion: Number(i.valor_liquidacion),
        liquidacion: i.liquidacion
          ? {
              ...i.liquidacion,
              total: Number(i.liquidacion.total),
            }
          : null,
      })),
    };
  },

  /**
   * Eliminar una factura — solo si está ANULADA.
   * Elimina los items de la factura y la factura misma.
   */
  async eliminar(id: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      select: {
        id: true,
        estado: true,
        numero_factura: true,
        deleted_at: true,
      },
    });

    if (!factura) throw new Error("Factura no encontrada");
    if (factura.deleted_at) throw new Error("Factura ya fue eliminada");
    if (factura.estado === "ACTIVA") {
      throw new Error(
        "No se puede eliminar una factura activa. Anúlela primero.",
      );
    }

    await prisma.factura_liquidacion_servicio.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        numero_factura: `${factura.numero_factura}_ELIMINADA`,
      },
    });

    return {
      message: `Factura ${factura.numero_factura} eliminada exitosamente`,
    };
  },

  /**
   * Restaurar una factura eliminada (soft delete)
   */
  async restaurar(id: string) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id },
      select: { id: true, numero_factura: true, deleted_at: true },
    });
    if (!factura) throw new Error("Factura no encontrada");
    if (!factura.deleted_at) throw new Error("La factura no está eliminada");

    await prisma.factura_liquidacion_servicio.update({
      where: { id },
      data: { deleted_at: null },
    });
    return {
      message: `Factura ${factura.numero_factura} restaurada exitosamente`,
    };
  },

  /**
   * Listar facturas eliminadas
   */
  async listarEliminadas() {
    return prisma.factura_liquidacion_servicio.findMany({
      where: { deleted_at: { not: null } },
      orderBy: { deleted_at: "desc" },
      include: {
        facturado_por: { select: { nombre: true } },
        items: {
          include: {
            liquidacion: {
              select: {
                id: true,
                consecutivo: true,
                cliente: { select: { nombre: true } },
              },
            },
          },
        },
      },
    });
  },

  /**
   * Asociar liquidaciones a una factura EXISTENTE.
   *
   * Mismas reglas que `crear`: la liquidación debe estar en LIQUIDADA o
   * APROBADA y sin factura activa. La factura recalcula su `valor_total`
   * desde sus items — no se suma incrementalmente, para que una asociación
   * concurrente no deje el total desfasado.
   */
  async agregarLiquidaciones(
    facturaId: string,
    liquidacionIds: string[],
    userId: string,
  ) {
    if (!liquidacionIds || liquidacionIds.length === 0) {
      throw new Error("Debe seleccionar al menos una liquidación");
    }

    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id: facturaId },
      select: { id: true, numero_factura: true, estado: true, deleted_at: true },
    });
    if (!factura || factura.deleted_at) throw new Error("Factura no encontrada");
    if (factura.estado !== "ACTIVA") {
      throw new Error(
        `La factura ${factura.numero_factura} está anulada: no admite liquidaciones`,
      );
    }

    const liquidaciones = await prisma.liquidacion_servicio.findMany({
      where: { id: { in: liquidacionIds }, deleted_at: null },
      select: { id: true, consecutivo: true, estado: true, total: true },
    });
    if (liquidaciones.length !== liquidacionIds.length) {
      throw new Error("Algunas liquidaciones no fueron encontradas");
    }

    // El orden importa: «ya está facturada» va ANTES que «no está en estado
    // para facturar». Una liquidación facturada incumple las dos condiciones,
    // y decirle al usuario que «no está en estado» le hace buscar el estado
    // correcto cuando lo que necesita saber es en qué factura está ya.
    const yaFacturadas = await prisma.factura_liquidacion_item.findMany({
      where: {
        deleted_at: null,
        liquidacion_id: { in: liquidacionIds },
        factura: { estado: "ACTIVA" },
      },
      include: {
        liquidacion: { select: { consecutivo: true } },
        factura: { select: { numero_factura: true } },
      },
    });
    if (yaFacturadas.length > 0) {
      const detalles = yaFacturadas
        .map(
          (f) =>
            `${f.liquidacion.consecutivo} (Factura: ${f.factura.numero_factura})`,
        )
        .join(", ");
      throw new Error(
        `Las siguientes liquidaciones ya están facturadas: ${detalles}`,
      );
    }

    const noFacturables = liquidaciones.filter(
      (l) => !["LIQUIDADA", "APROBADA"].includes(l.estado),
    );
    if (noFacturables.length > 0) {
      throw new Error(
        `Las siguientes liquidaciones no están en estado para facturar: ${noFacturables
          .map((l) => l.consecutivo)
          .join(", ")}`,
      );
    }

    const actualizada = await prisma.$transaction(async (tx) => {
      // Misma toma de posesión que en `crear`: es el cerrojo que impide que
      // dos sesiones enganchen la misma liquidación a dos facturas distintas.
      const tomadas = await tx.liquidacion_servicio.updateMany({
        where: {
          id: { in: liquidacionIds },
          estado: { in: ["LIQUIDADA", "APROBADA"] },
          deleted_at: null,
        },
        data: { estado: "FACTURADA", fecha_facturacion: new Date() },
      });
      if (tomadas.count !== liquidacionIds.length) {
        throw new Error(
          "Las siguientes liquidaciones ya están facturadas: otra sesión se adelantó. Recarga y vuelve a intentarlo.",
        );
      }

      await tx.factura_liquidacion_item.createMany({
        data: liquidaciones.map((l) => ({
          factura_id: facturaId,
          liquidacion_id: l.id,
          valor_liquidacion: Number(l.total),
        })),
      });

      await tx.historial_estado_liquidacion.createMany({
        data: liquidaciones.map((l) => ({
          liquidacion_id: l.id,
          estado_anterior: l.estado,
          estado_nuevo: "FACTURADA",
          usuario_id: userId,
          motivo: `Asociada a la factura ${factura.numero_factura}`,
        })),
      });

      const agg = await tx.factura_liquidacion_item.aggregate({
        /// Solo los pivotes activos: al marcar en vez de borrar, incluir los
        /// archivados sumaría dos veces la misma liquidación al total de la
        /// factura.
        where: { factura_id: facturaId, deleted_at: null },
        _sum: { valor_liquidacion: true },
      });

      return tx.factura_liquidacion_servicio.update({
        where: { id: facturaId },
        data: { valor_total: Number(agg._sum.valor_liquidacion ?? 0) },
        include: facturaIncludeCompleto(),
      });
    });

    return {
      factura: mapFactura(actualizada),
      liquidaciones_afectadas: liquidaciones.map((l) => ({
        id: l.id,
        consecutivo: l.consecutivo,
        estado: "FACTURADA" as const,
        factura_id: facturaId,
        numero_factura: factura.numero_factura,
      })),
    };
  },

  /**
   * Quitar UNA liquidación de su factura y devolverla a LIQUIDADA.
   *
   * `quedo_vacia` avisa de que la factura se quedó sin items: no se borra
   * sola — anularla y eliminarla es una decisión del usuario.
   */
  async quitarLiquidacion(
    facturaId: string,
    liquidacionId: string,
    userId: string,
  ) {
    const factura = await prisma.factura_liquidacion_servicio.findUnique({
      where: { id: facturaId },
      select: { id: true, numero_factura: true, estado: true, deleted_at: true },
    });
    if (!factura || factura.deleted_at) throw new Error("Factura no encontrada");
    if (factura.estado !== "ACTIVA") {
      throw new Error(
        `La factura ${factura.numero_factura} está anulada: sus liquidaciones ya fueron revertidas`,
      );
    }

    /// `findFirst` con filtro: con la unicidad ya parcial, `findUnique` sobre
    /// la clave compuesta podría devolver un pivote archivado de una
    /// facturación anterior.
    const item = await prisma.factura_liquidacion_item.findFirst({
      where: {
        factura_id: facturaId,
        liquidacion_id: liquidacionId,
        deleted_at: null,
      },
      include: { liquidacion: { select: { consecutivo: true, estado: true } } },
    });
    if (!item) {
      throw new Error("La liquidación no pertenece a esta factura");
    }

    const actualizada = await prisma.$transaction(async (tx) => {
      /// Se MARCA, no se borra.
      ///
      /// La tabla recibió `deleted_at` con la migración de liquidaciones, y su
      /// unicidad `(factura_id, liquidacion_id)` ya es PARCIAL —solo sobre
      /// filas activas—, justo para que quitar una liquidación de una factura
      /// y volver a añadirla más tarde no choque contra el pivote archivado.
      await tx.factura_liquidacion_item.updateMany({
        where: {
          factura_id: facturaId,
          liquidacion_id: liquidacionId,
          deleted_at: null,
        },
        data: { deleted_at: new Date() },
      });

      // Solo se revierte si sigue FACTURADA: si alguien la anuló por otra
      // vía en paralelo, no se pisa ese estado.
      await tx.liquidacion_servicio.updateMany({
        where: { id: liquidacionId, estado: "FACTURADA" },
        data: { estado: "LIQUIDADA", fecha_facturacion: null },
      });

      await tx.historial_estado_liquidacion.create({
        data: {
          liquidacion_id: liquidacionId,
          estado_anterior: "FACTURADA",
          estado_nuevo: "LIQUIDADA",
          usuario_id: userId,
          motivo: `Quitada de la factura ${factura.numero_factura}`,
        },
      });

      const agg = await tx.factura_liquidacion_item.aggregate({
        /// Solo los pivotes activos: al marcar en vez de borrar, incluir los
        /// archivados sumaría dos veces la misma liquidación al total de la
        /// factura.
        where: { factura_id: facturaId, deleted_at: null },
        _sum: { valor_liquidacion: true },
      });

      return tx.factura_liquidacion_servicio.update({
        where: { id: facturaId },
        data: { valor_total: Number(agg._sum.valor_liquidacion ?? 0) },
        include: facturaIncludeCompleto(),
      });
    });

    const mapped = mapFactura(actualizada);
    return {
      factura: mapped,
      quedo_vacia: mapped.items.length === 0,
      liquidaciones_afectadas: [
        {
          id: liquidacionId,
          consecutivo: item.liquidacion?.consecutivo ?? "",
          estado: "LIQUIDADA" as const,
          factura_id: null,
          numero_factura: null,
        },
      ],
    };
  },

  /**
   * Obtener la factura activa asociada a una liquidación (si existe)
   */
  async obtenerFacturaDeLiquidacion(liquidacionId: string) {
    const item = await prisma.factura_liquidacion_item.findFirst({
      where: {
        deleted_at: null,
        liquidacion_id: liquidacionId,
        factura: { estado: "ACTIVA" },
      },
      include: {
        factura: {
          select: {
            id: true,
            numero_factura: true,
            fecha_facturacion: true,
            facturado_por: { select: { nombre: true } },
          },
        },
      },
    });
    return item?.factura || null;
  },

  /**
   * Obtener info de factura para múltiples liquidaciones en batch (para el listado)
   */
  async obtenerFacturasDeLiquidaciones(liquidacionIds: string[]) {
    const items = await prisma.factura_liquidacion_item.findMany({
      where: {
        deleted_at: null,
        liquidacion_id: { in: liquidacionIds },
        factura: { estado: "ACTIVA" },
      },
      select: {
        liquidacion_id: true,
        factura: {
          select: { id: true, numero_factura: true },
        },
      },
    });
    // Map: liquidacionId → { factura_id, numero_factura }
    const map: Record<string, { factura_id: string; numero_factura: string }> =
      {};
    for (const item of items) {
      map[item.liquidacion_id] = {
        factura_id: item.factura.id,
        numero_factura: item.factura.numero_factura,
      };
    }
    return map;
  },
};


/**
 * Include estándar de una factura "completa", con la misma forma que
 * devuelve `listar`: es lo que el canvas fusiona en su panel de facturas
 * tras asociar/desasociar, y si la forma difiere la UI pinta huecos.
 */
function facturaIncludeCompleto() {
  return {
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
            cliente: { select: { id: true, nombre: true, nit: true } },
          },
        },
      },
    },
  } as const;
}

/** Decimal → number, y `total_liquidaciones` derivado, como en `listar`. */
function mapFactura(f: any) {
  return {
    ...f,
    valor_total: Number(f.valor_total),
    total_liquidaciones: f._count?.items ?? f.items?.length ?? 0,
    items: (f.items ?? []).map((i: any) => ({
      ...i,
      valor_liquidacion: Number(i.valor_liquidacion),
      liquidacion: i.liquidacion
        ? { ...i.liquidacion, total: Number(i.liquidacion.total) }
        : null,
    })),
  };
}

/**
 * Agregados de la lista de facturas sobre TODOS los registros que casan con
 * el filtro, no solo la página actual.
 *
 * POR QUÉ: las stat cards del tab de Facturas se calculaban en el cliente
 * con `facturas.reduce(...)` sobre la página (15 registros), así que
 * mostraban "Total Facturado" de 15 facturas y no del filtro completo. El
 * tab de Liquidaciones ya lo hacía bien vía `metadata`; esto lo empareja.
 *
 * Se resuelve con `aggregate` + `groupBy` sobre el MISMO `where` que la
 * consulta paginada — si divergieran, la tarjeta contradiría a la tabla.
 */
async function metadataFacturas(where: any) {
  const [agg, porEstado, itemsCount] = await Promise.all([
    prisma.factura_liquidacion_servicio.aggregate({
      where,
      _sum: { valor_total: true },
      _count: { _all: true },
    }),
    prisma.factura_liquidacion_servicio.groupBy({
      where,
      by: ["estado"],
      _count: { _all: true },
      _sum: { valor_total: true },
    }),
    prisma.factura_liquidacion_item.count({ where: { factura: where, deleted_at: null } }),
  ]);

  const estadoCounts: Record<string, number> = {};
  const estadoTotales: Record<string, number> = {};
  for (const g of porEstado) {
    estadoCounts[g.estado] = g._count._all;
    estadoTotales[g.estado] = Number(g._sum.valor_total ?? 0);
  }

  return {
    /// Nº de facturas que casan con el filtro (no las de la página).
    globalCount: agg._count._all,
    /// Σ valor_total de esas facturas.
    globalTotal: Number(agg._sum.valor_total ?? 0),
    /// Nº de liquidaciones incluidas en esas facturas.
    globalLiquidaciones: itemsCount,
    estadoCounts,
    estadoTotales,
  };
}
