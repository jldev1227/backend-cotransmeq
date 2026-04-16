// @ts-nocheck
import { prisma } from "../../config/prisma";
import { randomUUID } from "crypto";

// ═══════════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════════

export type TipoServicioTarifa = "HORA_24" | "HORA_12" | "HORA" | "KILOMETRO";
export type EstadoLiquidacionServicio =
  | "BORRADOR"
  | "LIQUIDADA"
  | "APROBADA"
  | "FACTURADA"
  | "ANULADA";
export type Operadora = "PAREX" | "GEOPARK";

export interface TarifaInput {
  operadora: Operadora;
  anio: number;
  valor_24h: number;
  valor_12h: number;
  valor_hora: number;
  valor_km: number;
  km_dia?: number;
  valor_pernocte?: number;
}

export interface ItemLiquidacionInput {
  servicio_id?: string;
  recargo_planilla_id?: string;
  placa: string;
  fecha_inicial: string;
  fecha_final: string;
  recorrido: string;
  tipo_servicio: TipoServicioTarifa;
  cantidad: number;
  valor_unitario: number;
  porcentaje_descuento?: number;
  numero_planilla?: string;
  cantidad_pernoctes?: number;
  valor_pernocte_unitario?: number;
  tercero_id?: string | null;
}

export interface CrearLiquidacionInput {
  cliente_id: string;
  consecutivo?: string;
  mes: number;
  anio: number;
  items: ItemLiquidacionInput[];
  porcentaje_iva?: number;
  observaciones?: string;
  osi?: string;
  valor_transporte_adicional?: number;
  valor_recargos?: number;
  recargos_data?: any;
}

export interface FiltrosLiquidacionServicios {
  page?: number;
  limit?: number;
  cliente_id?: string;
  estado?: EstadoLiquidacionServicio;
  mes?: number;
  anio?: number;
  busqueda?: string;
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

export const LiquidacionesServiciosService = {

  // ── Helper: crear snapshot de una liquidación ──
  async _crearSnapshot(liquidacionId: string, userId: string, accion: string, estadoAnterior?: string, estadoNuevo?: string, motivo?: string) {
    const liq = await prisma.liquidacion_servicio.findUnique({
      where: { id: liquidacionId },
      include: {
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true } },
        actualizado_por: { select: { id: true, nombre: true } },
        liquidado_por: { select: { id: true, nombre: true } },
        aprobado_por: { select: { id: true, nombre: true } },
        items: { orderBy: { orden: 'asc' }, include: { tercero: { select: { id: true, nombre_completo: true } } } },
      },
    });
    if (!liq) return;

    const snapshot = {
      consecutivo: liq.consecutivo,
      cliente: liq.cliente,
      mes: liq.mes,
      anio: liq.anio,
      estado: liq.estado,
      valor_servicios: Number(liq.valor_servicios),
      valor_recargos: Number(liq.valor_recargos),
      valor_transporte_adicional: Number(liq.valor_transporte_adicional),
      valor_pernoctes: Number(liq.valor_pernoctes),
      subtotal: Number(liq.subtotal),
      porcentaje_iva: Number(liq.porcentaje_iva),
      valor_iva: Number(liq.valor_iva),
      total: Number(liq.total),
      observaciones: liq.observaciones,
      osi: liq.osi,
      tercero_liquidado: liq.tercero_liquidado,
      motivo_anulacion: liq.motivo_anulacion,
      creado_por: liq.creado_por,
      actualizado_por: liq.actualizado_por,
      liquidado_por: liq.liquidado_por,
      aprobado_por: liq.aprobado_por,
      fecha_liquidacion: liq.fecha_liquidacion,
      fecha_aprobacion: liq.fecha_aprobacion,
      items: liq.items.map(i => ({
        placa: i.placa,
        recorrido: i.recorrido,
        tipo_servicio: i.tipo_servicio,
        cantidad: Number(i.cantidad),
        valor_unitario: Number(i.valor_unitario),
        subtotal: Number(i.subtotal),
        porcentaje_descuento: Number(i.porcentaje_descuento),
        valor_final: Number(i.valor_final),
        fecha_inicial: i.fecha_inicial,
        fecha_final: i.fecha_final,
        numero_planilla: i.numero_planilla,
        cantidad_pernoctes: i.cantidad_pernoctes,
        valor_pernocte_unitario: Number(i.valor_pernocte_unitario),
        valor_pernoctes_total: Number(i.valor_pernoctes_total),
        tercero: i.tercero,
      })),
      total_items: liq.items.length,
    };

    await prisma.historial_estado_liquidacion.create({
      data: {
        liquidacion_id: liquidacionId,
        estado_anterior: estadoAnterior || null,
        estado_nuevo: estadoNuevo || liq.estado as string,
        usuario_id: userId,
        motivo: motivo || null,
        accion,
        snapshot,
      },
    });
  },

  // ── TARIFAS CRUD ──

  async obtenerTarifas(clienteId?: string, operadora?: string, anio?: number) {
    const where: any = {};

    if (clienteId || operadora || anio) {
      where.activo = true;
      if (clienteId) where.cliente_id = clienteId;
      if (operadora) where.operadora = operadora;
      if (anio) where.anio = anio;
    }

    return await prisma.tarifas_servicios.findMany({
      where,
      include: { empresas: true },
      orderBy: [{ operadora: "asc" }, { anio: "desc" }],
    });
  },

  async crearTarifa(data: TarifaInput) {
    return await prisma.tarifas_servicios.create({
      data: {
        operadora: data.operadora,
        anio: data.anio,
        valor_24h: data.valor_24h,
        valor_12h: data.valor_12h,
        valor_hora: data.valor_hora,
        valor_km: data.valor_km,
        km_dia: data.km_dia || 150,
        valor_pernocte: data.valor_pernocte || 0,
      },
    });
  },

  async actualizarTarifa(id: string, data: Partial<TarifaInput>) {
    return await prisma.tarifas_servicios.update({
      where: { id },
      data: {
        ...(data.valor_24h !== undefined && { valor_24h: data.valor_24h }),
        ...(data.valor_12h !== undefined && { valor_12h: data.valor_12h }),
        ...(data.valor_hora !== undefined && { valor_hora: data.valor_hora }),
        ...(data.valor_km !== undefined && { valor_km: data.valor_km }),
        ...(data.km_dia !== undefined && { km_dia: data.km_dia }),
        ...(data.valor_pernocte !== undefined && {
          valor_pernocte: data.valor_pernocte,
        }),
      },
    });
  },

  async eliminarTarifa(id: string) {
    await prisma.tarifas_servicios.update({
      where: { id },
      data: { activo: false },
    });
    return { message: "Tarifa desactivada exitosamente" };
  },

  // ── PREVIEW DE LIQUIDACIÓN ──
  // tarifa_id: el usuario escoge qué tarifa de operadora aplicar
  async previewLiquidacion(
    cliente_id: string,
    mes: number,
    anio: number,
    servicioIds?: string[],
    tarifa_id?: string,
  ) {
    // 1. Obtener tarifa por ID (obligatorio ahora - el usuario debe seleccionar)
    if (!tarifa_id) {
      throw new Error(
        "Debe seleccionar una tarifa de operadora para generar la liquidación",
      );
    }

    const tarifa = await prisma.tarifas_servicios.findUnique({
      where: { id: tarifa_id },
    });

    if (!tarifa) {
      throw new Error("La tarifa seleccionada no existe");
    }

    // Obtener datos del cliente
    const cliente = await prisma.clientes.findUnique({
      where: { id: cliente_id },
      select: { id: true, nombre: true, nit: true },
    });

    if (!cliente) {
      throw new Error("Cliente no encontrado");
    }

    // 2. Obtener servicios del cliente en el mes/año
    const fechaInicio = new Date(Date.UTC(anio, mes - 1, 1));
    const fechaFin = new Date(Date.UTC(anio, mes, 0)); // Último día del mes

    const whereServicios: any = {
      cliente_id,
      fecha_realizacion: {
        gte: fechaInicio,
        lte: fechaFin,
      },
      estado: { in: ["realizado", "planilla_asignada", "liquidado"] },
    };

    // Si se pasan IDs específicos, filtrar
    if (servicioIds && servicioIds.length > 0) {
      whereServicios.id = { in: servicioIds };
    }

    const servicios = await prisma.servicio.findMany({
      where: whereServicios,
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
            salario_base: true,
          },
        },
        vehiculos: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
        clientes: {
          select: { id: true, nombre: true, nit: true },
        },
        municipios_servicio_origen_idTomunicipios: {
          select: { nombre_municipio: true, nombre_departamento: true },
        },
        municipios_servicio_destino_idTomunicipios: {
          select: { nombre_municipio: true, nombre_departamento: true },
        },
        recargos_planillas: {
          where: { deleted_at: null },
          include: {
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
        },
      },
      orderBy: { fecha_realizacion: "asc" },
    });

    // 3. Obtener configuración salarial vigente para calcular recargos
    const configSalarial = await prisma.configuraciones_salarios.findFirst({
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

    const salarioBasico = configSalarial
      ? Number(configSalarial.salario_basico)
      : 2358886;
    const valorHoraBase = configSalarial
      ? Number(configSalarial.valor_hora_trabajador)
      : 10722;
    const seguridadSocial = configSalarial
      ? Number(configSalarial.seguridad_social)
      : 22.96;
    const prestacionesSociales = configSalarial
      ? Number(configSalarial.prestaciones_sociales)
      : 21.83;
    const administracion = configSalarial
      ? Number(configSalarial.administracion)
      : 8;
    const pruebaAntigeno = configSalarial
      ? Number(configSalarial.prueba_antigeno_covid)
      : 210000;

    // 4. Procesar cada servicio → generar items OP-FR-07 + liquidador recargos OP-FR-06
    const items: any[] = [];
    let totalValorServicios = 0;
    let totalValorRecargos = 0;
    let totalPernoctes = 0;

    for (const servicio of servicios) {
      const origen = servicio.municipios_servicio_origen_idTomunicipios;
      const destino = servicio.municipios_servicio_destino_idTomunicipios;
      const recorrido = `${origen.nombre_municipio} → ${destino.nombre_municipio}`;
      const placa = servicio.vehiculos?.placa || "S/P";

      // Determinar tipo de servicio y valor unitario
      // Calcular duración para determinar tipo
      const fechaRealizacion = servicio.fecha_realizacion
        ? new Date(servicio.fecha_realizacion)
        : new Date(servicio.fecha_solicitud);
      const fechaFinalizacion = servicio.fecha_finalizacion
        ? new Date(servicio.fecha_finalizacion)
        : fechaRealizacion;

      const diffMs = fechaFinalizacion.getTime() - fechaRealizacion.getTime();
      const diffHoras = diffMs / (1000 * 60 * 60);
      const diffDias = Math.ceil(diffHoras / 24) || 1;

      // Autodetectar tipo de servicio basado en duración
      let tipoServicio: TipoServicioTarifa = "HORA_24";
      let cantidad = diffDias;
      let valorUnitario = Number(tarifa.valor_24h);

      if (diffHoras <= 12) {
        tipoServicio = "HORA_12";
        cantidad = 1;
        valorUnitario = Number(tarifa.valor_12h);
      } else if (diffHoras <= 24) {
        tipoServicio = "HORA_24";
        cantidad = 1;
        valorUnitario = Number(tarifa.valor_24h);
      } else {
        tipoServicio = "HORA_24";
        cantidad = diffDias;
        valorUnitario = Number(tarifa.valor_24h);
      }

      // Si tiene valor manual, usar ese
      if (Number(servicio.valor) > 0) {
        valorUnitario = Number(servicio.valor) / cantidad;
      }

      const subtotalServicio = cantidad * valorUnitario;
      const valorFinal = subtotalServicio; // Sin descuento por defecto
      totalValorServicios += valorFinal;

      // Calcular recargos desde la planilla asociada
      let recargosDetalle: any = null;
      let valorRecargosTotal = 0;
      let cantidadPernoctes = 0;
      let numeroPlanilla = servicio.numero_planilla || "";

      if (
        servicio.recargos_planillas &&
        servicio.recargos_planillas.length > 0
      ) {
        const planilla = servicio.recargos_planillas[0];
        numeroPlanilla = planilla.numero_planilla || numeroPlanilla;

        // Calcular recargos por tipo (para OP-FR-06)
        const resumenRecargos: Record<
          string,
          {
            codigo: string;
            nombre: string;
            porcentaje: number;
            es_hora_extra: boolean;
            totalHoras: number;
            valorUnitario: number;
            valorTotal: number;
          }
        > = {};

        let subtotal1 = 0;

        for (const dia of planilla.dias_laborales_planillas) {
          if (dia.disponibilidad) continue;
          if (dia.pernocte) cantidadPernoctes++;

          for (const detalle of dia.detalles_recargos_dias) {
            const tipo = detalle.tipos_recargos;
            const horas = Number(detalle.horas);
            const porcentaje = Number(tipo.porcentaje);

            let valorCalculado = 0;
            if (tipo.es_hora_extra || tipo.adicional) {
              valorCalculado =
                horas * (valorHoraBase + (valorHoraBase * porcentaje) / 100);
            } else {
              valorCalculado = horas * ((valorHoraBase * porcentaje) / 100);
            }

            if (!resumenRecargos[tipo.codigo]) {
              resumenRecargos[tipo.codigo] = {
                codigo: tipo.codigo,
                nombre: tipo.nombre,
                porcentaje,
                es_hora_extra: tipo.es_hora_extra,
                totalHoras: 0,
                valorUnitario: (tipo.es_hora_extra || tipo.adicional)
                  ? Math.round(
                      valorHoraBase + (valorHoraBase * porcentaje) / 100,
                    )
                  : Math.round((valorHoraBase * porcentaje) / 100),
                valorTotal: 0,
              };
            }
            resumenRecargos[tipo.codigo].totalHoras += horas;
            resumenRecargos[tipo.codigo].valorTotal += valorCalculado;
            subtotal1 += valorCalculado;
          }
        }

        // Calcular SS, PS, admin sobre subtotal1
        const valSeguridadSocial = (subtotal1 * seguridadSocial) / 100;
        const valPrestaciones = (subtotal1 * prestacionesSociales) / 100;
        const subtotal2 = subtotal1 + valSeguridadSocial + valPrestaciones;
        const valAdministracion = (subtotal2 * administracion) / 100;
        valorRecargosTotal = Math.round(
          subtotal2 + pruebaAntigeno + valAdministracion,
        );

        recargosDetalle = {
          salario_basico: salarioBasico,
          valor_hora_trabajador: valorHoraBase,
          conductor: servicio.conductores
            ? {
                nombre: `${servicio.conductores.nombre} ${servicio.conductores.apellido}`,
                cedula: servicio.conductores.numero_identificacion,
              }
            : null,
          conceptos: Object.values(resumenRecargos).map((r) => ({
            ...r,
            totalHoras: Math.round(r.totalHoras * 10) / 10,
            valorTotal: Math.round(r.valorTotal),
          })),
          subtotal_1: Math.round(subtotal1),
          seguridad_social: {
            porcentaje: seguridadSocial,
            valor: Math.round(valSeguridadSocial),
          },
          prestaciones_sociales: {
            porcentaje: prestacionesSociales,
            valor: Math.round(valPrestaciones),
          },
          subtotal_2: Math.round(subtotal2),
          prueba_antigeno: pruebaAntigeno,
          administracion: {
            porcentaje: administracion,
            valor: Math.round(valAdministracion),
          },
          total: valorRecargosTotal,
        };

        totalValorRecargos += valorRecargosTotal;
      }

      // Pernoctes
      const valorPernocteUnitario = Number(tarifa.valor_pernocte) || 0;
      const valorPernotesTotal = cantidadPernoctes * valorPernocteUnitario;
      totalPernoctes += valorPernotesTotal;

      items.push({
        servicio_id: servicio.id,
        recargo_planilla_id: servicio.recargos_planillas?.[0]?.id || null,
        placa,
        fecha_inicial: fechaRealizacion.toISOString().split("T")[0],
        fecha_final: fechaFinalizacion.toISOString().split("T")[0],
        recorrido,
        tipo_servicio: tipoServicio,
        cantidad,
        valor_unitario: valorUnitario,
        subtotal: subtotalServicio,
        porcentaje_descuento: 0,
        valor_final: valorFinal,
        numero_planilla: numeroPlanilla,
        recargos_detalle: recargosDetalle,
        valor_recargos_total: valorRecargosTotal,
        cantidad_pernoctes: cantidadPernoctes,
        valor_pernocte_unitario: valorPernocteUnitario,
        valor_pernoctes_total: valorPernotesTotal,
        conductor: servicio.conductores
          ? {
              nombre: `${servicio.conductores.nombre} ${servicio.conductores.apellido}`,
              cedula: servicio.conductores.numero_identificacion,
            }
          : null,
      });
    }

    // 5. Calcular totales OP-FR-07
    const subtotal = totalValorServicios + totalValorRecargos + totalPernoctes;
    const porcentajeIva = 0;
    const valorIva = (subtotal * porcentajeIva) / 100;
    const totalGeneral = subtotal + valorIva;

    return {
      cliente,
      tarifa: {
        id: tarifa.id,
        operadora: tarifa.operadora,
        anio: tarifa.anio,
        valor_24h: Number(tarifa.valor_24h),
        valor_12h: Number(tarifa.valor_12h),
        valor_hora: Number(tarifa.valor_hora),
        valor_km: Number(tarifa.valor_km),
        km_dia: tarifa.km_dia,
        valor_pernocte: Number(tarifa.valor_pernocte),
      },
      config_salarial: configSalarial
        ? {
            salario_basico: salarioBasico,
            valor_hora_trabajador: valorHoraBase,
            seguridad_social: seguridadSocial,
            prestaciones_sociales: prestacionesSociales,
            administracion,
            prueba_antigeno: pruebaAntigeno,
          }
        : null,
      mes,
      anio,
      items,
      totales: {
        valor_servicios: Math.round(totalValorServicios),
        valor_recargos: Math.round(totalValorRecargos),
        valor_pernoctes: Math.round(totalPernoctes),
        subtotal: Math.round(subtotal),
        porcentaje_iva: porcentajeIva,
        valor_iva: Math.round(valorIva),
        total: Math.round(totalGeneral),
      },
    };
  },

  async checkConsecutivo(consecutivo: string, excludeId?: string) {
    const existing = await prisma.liquidacion_servicio.findUnique({
      where: { consecutivo },
      select: { id: true },
    });
    if (!existing) return { available: true };
    if (excludeId && existing.id === excludeId) return { available: true };
    return { available: false };
  },

  // ── CRUD LIQUIDACIONES ──

  async crear(data: CrearLiquidacionInput, userId: string) {
    // Use provided consecutivo or generate one
    const consecutivo = data.consecutivo || await generarConsecutivo(data.anio);

    // Calcular totales de items
    let valorServicios = 0;
    let valorPernoctes = 0;

    const itemsData = data.items.map((item, index) => {
      const subtotal = item.cantidad * item.valor_unitario;
      const descuento = (subtotal * (item.porcentaje_descuento || 0)) / 100;
      const valorFinal = subtotal - descuento;
      valorServicios += valorFinal;

      const cantPernoctes = item.cantidad_pernoctes || 0;
      const valPernocteUnit = item.valor_pernocte_unitario || 0;
      const valPernotesTotal = cantPernoctes * valPernocteUnit;
      valorPernoctes += valPernotesTotal;

      return {
        id: randomUUID(),
        placa: String(item.placa || "").slice(0, 20),
        fecha_inicial: new Date(item.fecha_inicial),
        fecha_final: new Date(item.fecha_final),
        recorrido: String(item.recorrido || "").slice(0, 500),
        tipo_servicio: item.tipo_servicio as any,
        cantidad: item.cantidad,
        valor_unitario: item.valor_unitario,
        subtotal,
        porcentaje_descuento: item.porcentaje_descuento || 0,
        valor_final: valorFinal,
        numero_planilla: item.numero_planilla ? String(item.numero_planilla).slice(0, 50) : null,
        servicio_id: item.servicio_id || null,
        recargo_planilla_id: item.recargo_planilla_id || null,
        valor_recargos_total: 0,
        cantidad_pernoctes: cantPernoctes,
        valor_pernocte_unitario: valPernocteUnit,
        valor_pernoctes_total: valPernotesTotal,
        orden: index,
        tercero_id: item.tercero_id || null,
      };
    });

    // Use valor_recargos from frontend (liqTotal from liquidador) if provided
    const valorRecargos = data.valor_recargos || 0;
    const valorTransporteAdicional = data.valor_transporte_adicional || 0;
    const subtotal = valorServicios + valorTransporteAdicional + valorRecargos + valorPernoctes;
    const porcentajeIva = data.porcentaje_iva || 0;
    const valorIva = (subtotal * porcentajeIva) / 100;
    const total = subtotal + valorIva;

    // DEBUG: Log all string field lengths to find the "too long" column
    // DEBUG: Log string field lengths
    console.log('[LIQ-DEBUG] Creating liquidacion:', {
      consecutivo, consecutivo_len: String(consecutivo).length,
      obs_len: String(data.observaciones || '').length,
      osi_len: String(data.osi || '').length,
      items_count: itemsData.length,
      items_fields: itemsData.map((it, i) => ({
        i, placa: it.placa, placa_len: it.placa.length,
        recorrido_len: it.recorrido.length, planilla: it.numero_planilla,
        tipo: it.tipo_servicio
      }))
    });

    const liquidacion = await prisma.liquidacion_servicio.create({
      data: {
        consecutivo,
        cliente_id: data.cliente_id,
        mes: data.mes,
        anio: data.anio,
        estado: 'BORRADOR' as any,
        tercero_liquidado: computeTerceroLiquidado(data.recargos_data),
        valor_servicios: valorServicios,
        valor_recargos: valorRecargos,
        valor_transporte_adicional: valorTransporteAdicional,
        valor_pernoctes: valorPernoctes,
        subtotal,
        porcentaje_iva: porcentajeIva,
        valor_iva: valorIva,
        total,
        recargos_data: data.recargos_data || undefined,
        observaciones: data.observaciones,
        osi: data.osi || null,
        creado_por_id: userId,
        items: {
          createMany: { data: itemsData },
        },
      },
      include: {
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true, correo: true } },
        items: { orderBy: { orden: "asc" } },
      },
    });

    // Crear snapshot inicial
    await this._crearSnapshot(liquidacion.id, userId, 'creacion', null, 'BORRADOR');

    return liquidacion;
  },

  async listar(filtros: FiltrosLiquidacionServicios) {
    const page = Number(filtros.page) || 1;
    const limit = Number(filtros.limit) || 10;
    const skip = (page - 1) * limit;

    const where: any = {};
    if (filtros.cliente_id) where.cliente_id = filtros.cliente_id;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.mes) where.mes = filtros.mes;
    if (filtros.anio) where.anio = filtros.anio;
    if (filtros.busqueda) {
      where.OR = [
        { consecutivo: { contains: filtros.busqueda, mode: "insensitive" } },
        {
          cliente: {
            nombre: { contains: filtros.busqueda, mode: "insensitive" },
          },
        },
      ];
    }

    const [liquidaciones, total] = await Promise.all([
      prisma.liquidacion_servicio.findMany({
        where,
        include: {
          cliente: { select: { id: true, nombre: true, nit: true } },
          creado_por: { select: { id: true, nombre: true, correo: true } },
          liquidado_por: { select: { id: true, nombre: true, correo: true } },
          aprobado_por: { select: { id: true, nombre: true, correo: true } },
          _count: { select: { items: true } },
        },
        orderBy: { created_at: "desc" },
        skip,
        take: limit,
      }),
      prisma.liquidacion_servicio.count({ where }),
    ]);

    return {
      liquidaciones: liquidaciones.map((l) => ({
        ...l,
        valor_servicios: Number(l.valor_servicios),
        valor_recargos: Number(l.valor_recargos),
        valor_pernoctes: Number(l.valor_pernoctes),
        subtotal: Number(l.subtotal),
        porcentaje_iva: Number(l.porcentaje_iva),
        valor_iva: Number(l.valor_iva),
        total: Number(l.total),
        valor_transporte_adicional: Number(l.valor_transporte_adicional),
        valor_administracion_ta: Number(l.valor_administracion_ta),
        total_items: l._count.items,
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
    };
  },

  async obtenerPorId(id: string) {
    const liquidacion = await prisma.liquidacion_servicio.findUnique({
      where: { id },
      include: {
        cliente: {
          select: {
            id: true,
            nombre: true,
            nit: true,
            representante: true,
            telefono: true,
            direccion: true,
          },
        },
        creado_por: { select: { id: true, nombre: true, correo: true } },
        actualizado_por: { select: { id: true, nombre: true, correo: true } },
        liquidado_por: { select: { id: true, nombre: true, correo: true } },
        aprobado_por: { select: { id: true, nombre: true, correo: true } },
        items: { orderBy: { orden: "asc" } },
      },
    });

    if (!liquidacion) throw new Error("Liquidación de servicio no encontrada");

    return {
      ...liquidacion,
      valor_servicios: Number(liquidacion.valor_servicios),
      valor_recargos: Number(liquidacion.valor_recargos),
      valor_pernoctes: Number(liquidacion.valor_pernoctes),
      subtotal: Number(liquidacion.subtotal),
      porcentaje_iva: Number(liquidacion.porcentaje_iva),
      valor_iva: Number(liquidacion.valor_iva),
      total: Number(liquidacion.total),
      valor_transporte_adicional: Number(
        liquidacion.valor_transporte_adicional,
      ),
      valor_administracion_ta: Number(liquidacion.valor_administracion_ta),
      items: liquidacion.items.map((item) => ({
        ...item,
        cantidad: Number(item.cantidad),
        valor_unitario: Number(item.valor_unitario),
        subtotal: Number(item.subtotal),
        porcentaje_descuento: Number(item.porcentaje_descuento),
        valor_final: Number(item.valor_final),
        valor_recargos_total: Number(item.valor_recargos_total),
        valor_pernocte_unitario: Number(item.valor_pernocte_unitario),
        valor_pernoctes_total: Number(item.valor_pernoctes_total),
      })),
    };
  },

  async eliminar(id: string) {
    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id } });
    if (!liq) throw new Error("Liquidación no encontrada");

    // Check if linked to any ACTIVE factura before attempting delete
    const activeFacturas = await prisma.factura_liquidacion_item.count({
      where: {
        liquidacion_id: id,
        factura: { estado: "ACTIVA" },
      },
    });
    if (activeFacturas > 0) {
      throw new Error("No se puede eliminar: esta liquidación tiene facturas activas asociadas. Anule la factura primero.");
    }

    // Also delete any factura_liquidacion_item refs from anulled facturas
    await prisma.factura_liquidacion_item.deleteMany({
      where: { liquidacion_id: id },
    });

    await prisma.$transaction([
      prisma.liquidacion_servicio_item.deleteMany({
        where: { liquidacion_id: id },
      }),
      prisma.liquidacion_servicio.delete({ where: { id } }),
    ]);

    return { message: "Liquidación de servicio eliminada exitosamente" };
  },

  async actualizar(id: string, data: CrearLiquidacionInput, userId: string) {
    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id } });
    if (!liq) throw new Error("Liquidación no encontrada");

    // Calcular totales de items
    let valorServicios = 0;
    let valorPernoctes = 0;

    const itemsData = data.items.map((item, index) => {
      const subtotal = item.cantidad * item.valor_unitario;
      const descuento = (subtotal * (item.porcentaje_descuento || 0)) / 100;
      const valorFinal = subtotal - descuento;
      valorServicios += valorFinal;

      const cantPernoctes = item.cantidad_pernoctes || 0;
      const valPernocteUnit = item.valor_pernocte_unitario || 0;
      const valPernotesTotal = cantPernoctes * valPernocteUnit;
      valorPernoctes += valPernotesTotal;

      return {
        id: randomUUID(),
        placa: String(item.placa || "").slice(0, 20),
        fecha_inicial: new Date(item.fecha_inicial),
        fecha_final: new Date(item.fecha_final),
        recorrido: String(item.recorrido || "").slice(0, 500),
        tipo_servicio: item.tipo_servicio as any,
        cantidad: item.cantidad,
        valor_unitario: item.valor_unitario,
        subtotal,
        porcentaje_descuento: item.porcentaje_descuento || 0,
        valor_final: valorFinal,
        numero_planilla: item.numero_planilla ? String(item.numero_planilla).slice(0, 50) : null,
        servicio_id: item.servicio_id || null,
        recargo_planilla_id: item.recargo_planilla_id || null,
        valor_recargos_total: 0,
        cantidad_pernoctes: cantPernoctes,
        valor_pernocte_unitario: valPernocteUnit,
        valor_pernoctes_total: valPernotesTotal,
        orden: index,
        tercero_id: item.tercero_id || null,
      };
    });

    // Use valor_recargos from frontend (liqTotal from liquidador) if provided
    const valorRecargos = data.valor_recargos || 0;
    const valorTransporteAdicional = data.valor_transporte_adicional || 0;
    const subtotal = valorServicios + valorTransporteAdicional + valorRecargos + valorPernoctes;
    const porcentajeIva = data.porcentaje_iva || 0;
    const valorIva = (subtotal * porcentajeIva) / 100;
    const total = subtotal + valorIva;

    // Update consecutivo if provided, otherwise keep existing
    const consecutivo = data.consecutivo || liq.consecutivo;

    // Delete old items and update liquidación in a transaction
    const [, liquidacion] = await prisma.$transaction([
      prisma.liquidacion_servicio_item.deleteMany({
        where: { liquidacion_id: id },
      }),
      prisma.liquidacion_servicio.update({
        where: { id },
        data: {
          consecutivo,
          cliente_id: data.cliente_id,
          mes: data.mes,
          anio: data.anio,
          valor_servicios: valorServicios,
          valor_recargos: valorRecargos,
          valor_transporte_adicional: valorTransporteAdicional,
          valor_pernoctes: valorPernoctes,
          subtotal,
          porcentaje_iva: porcentajeIva,
          valor_iva: valorIva,
          total,
          tercero_liquidado: computeTerceroLiquidado(data.recargos_data),
          recargos_data: data.recargos_data || undefined,
          observaciones: data.observaciones,
          osi: data.osi || null,
          actualizado_por_id: userId,
          items: {
            createMany: { data: itemsData },
          },
        },
        include: {
          cliente: { select: { id: true, nombre: true, nit: true } },
          creado_por: { select: { id: true, nombre: true, correo: true } },
          actualizado_por: { select: { id: true, nombre: true, correo: true } },
          items: { orderBy: { orden: "asc" } },
        },
      }),
    ]);

    // Crear snapshot de edición
    await this._crearSnapshot(liquidacion.id, userId, 'edicion', liq.estado as string, liq.estado as string);

    return liquidacion;
  },

  async cambiarEstado(
    id: string,
    estado: EstadoLiquidacionServicio,
    userId: string,
    motivo_anulacion?: string,
  ) {
    // Fetch current state for historial
    const current = await prisma.liquidacion_servicio.findUnique({
      where: { id },
      select: { estado: true },
    });
    if (!current) throw new Error('Liquidación no encontrada');
    const estadoAnterior = current.estado;

    const data: any = {
      estado: estado as any,
      actualizado_por_id: userId,
    };
    if (estado === 'LIQUIDADA') {
      data.liquidado_por_id = userId;
      data.fecha_liquidacion = new Date();
    }
    if (estado === 'APROBADA') {
      data.aprobado_por_id = userId;
      data.fecha_aprobacion = new Date();
    }
    if (estado === 'BORRADOR') {
      data.liquidado_por_id = null;
      data.aprobado_por_id = null;
      data.fecha_aprobacion = null;
    }
    if (estado === 'ANULADA' && motivo_anulacion) {
      data.motivo_anulacion = motivo_anulacion;
    } else if (estado !== 'ANULADA') {
      data.motivo_anulacion = null;
    }

    // Transaction: update estado
    const result = await prisma.liquidacion_servicio.update({
      where: { id },
      data,
      include: {
        cliente: { select: { id: true, nombre: true, nit: true } },
        liquidado_por: { select: { id: true, nombre: true, correo: true } },
        aprobado_por: { select: { id: true, nombre: true, correo: true } },
        creado_por: { select: { id: true, nombre: true, correo: true } },
      },
    });

    // Crear snapshot con el nuevo estado
    await this._crearSnapshot(id, userId, 'cambio_estado', estadoAnterior as string, estado, motivo_anulacion);

    return result;
  },

  // ── Historial de estados ──
  async obtenerHistorial(liquidacionId: string) {
    return await prisma.historial_estado_liquidacion.findMany({
      where: { liquidacion_id: liquidacionId },
      include: {
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  },

  // ── Estadísticas ──
  async estadisticas() {
    const [total, porEstado, montoTotal] = await Promise.all([
      prisma.liquidacion_servicio.count(),
      prisma.liquidacion_servicio.groupBy({
        by: ["estado"],
        _count: { id: true },
      }),
      prisma.liquidacion_servicio.aggregate({
        _sum: { total: true },
      }),
    ]);

    return {
      total,
      por_estado: porEstado.map((e) => ({
        estado: e.estado,
        cantidad: e._count.id,
      })),
      monto_total: Number(montoTotal._sum.total || 0),
    };
  },

  // ── Obtener servicios disponibles para liquidar ──
  async serviciosDisponibles(cliente_id: string, mes: number, anio: number) {
    const fechaInicio = new Date(Date.UTC(anio, mes - 1, 1));
    const fechaFin = new Date(Date.UTC(anio, mes, 0));

    return await prisma.servicio.findMany({
      where: {
        cliente_id,
        fecha_realizacion: {
          gte: fechaInicio,
          lte: fechaFin,
        },
        estado: { in: ["realizado", "planilla_asignada"] },
      },
      include: {
        conductores: {
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
          },
        },
        vehiculos: {
          select: { id: true, placa: true, marca: true, modelo: true },
        },
        municipios_servicio_origen_idTomunicipios: {
          select: { nombre_municipio: true },
        },
        municipios_servicio_destino_idTomunicipios: {
          select: { nombre_municipio: true },
        },
        recargos_planillas: {
          where: { deleted_at: null },
          select: { id: true, numero_planilla: true, mes: true, a_o: true },
        },
      },
      orderBy: { fecha_realizacion: "asc" },
    });
  },

  // ── Tipos de recargo (para Hoja 3 / Liquidador) ──
  async obtenerTiposRecargo() {
    const tipos = await prisma.tipos_recargos.findMany({
      where: { activo: true, deleted_at: null },
      select: {
        id: true,
        codigo: true,
        nombre: true,
        porcentaje: true,
        es_hora_extra: true,
        adicional: true,
        categoria: true,
        orden_calculo: true,
      },
      orderBy: { orden_calculo: "asc" },
    });

    return tipos.map((t) => ({
      ...t,
      porcentaje: Number(t.porcentaje),
    }));
  },

  // ── CONFIGURACIÓN LIQUIDADOR DE SERVICIOS ──

  async obtenerConfigLiquidador() {
    let config = await prisma.configuracion_liquidacion_servicio.findFirst({ where: { activo: true } });
    if (!config) {
      config = await prisma.configuracion_liquidacion_servicio.create({
        data: {
          id: randomUUID(),
          salario_basico: 2358886,
          cargo: "Conductor",
          valor_hora_override: 0,
          conductor_adicional: 73693,
          pct_seg_social: 22.96,
          pct_prestaciones: 21.83,
          pct_admin: 8,
          prueba_covid: 0,
        },
      });
    }
    return {
      id: config.id,
      salario_basico: Number(config.salario_basico),
      cargo: config.cargo,
      valor_hora_override: Number(config.valor_hora_override),
      conductor_adicional: Number(config.conductor_adicional),
      pct_seg_social: Number(config.pct_seg_social),
      pct_prestaciones: Number(config.pct_prestaciones),
      pct_admin: Number(config.pct_admin),
      prueba_covid: Number(config.prueba_covid),
    };
  },

  async actualizarConfigLiquidador(data: {
    salario_basico?: number;
    cargo?: string;
    valor_hora_override?: number;
    conductor_adicional?: number;
    pct_seg_social?: number;
    pct_prestaciones?: number;
    pct_admin?: number;
    prueba_covid?: number;
  }) {
    let config = await prisma.configuracion_liquidacion_servicio.findFirst({ where: { activo: true } });
    if (!config) {
      config = await prisma.configuracion_liquidacion_servicio.create({
        data: { id: randomUUID(), ...data as any },
      });
    } else {
      config = await prisma.configuracion_liquidacion_servicio.update({
        where: { id: config.id },
        data: {
          ...(data.salario_basico !== undefined && { salario_basico: data.salario_basico }),
          ...(data.cargo !== undefined && { cargo: data.cargo }),
          ...(data.valor_hora_override !== undefined && { valor_hora_override: data.valor_hora_override }),
          ...(data.conductor_adicional !== undefined && { conductor_adicional: data.conductor_adicional }),
          ...(data.pct_seg_social !== undefined && { pct_seg_social: data.pct_seg_social }),
          ...(data.pct_prestaciones !== undefined && { pct_prestaciones: data.pct_prestaciones }),
          ...(data.pct_admin !== undefined && { pct_admin: data.pct_admin }),
          ...(data.prueba_covid !== undefined && { prueba_covid: data.prueba_covid }),
        },
      });
    }
    return {
      id: config.id,
      salario_basico: Number(config.salario_basico),
      cargo: config.cargo,
      valor_hora_override: Number(config.valor_hora_override),
      conductor_adicional: Number(config.conductor_adicional),
      pct_seg_social: Number(config.pct_seg_social),
      pct_prestaciones: Number(config.pct_prestaciones),
      pct_admin: Number(config.pct_admin),
      prueba_covid: Number(config.prueba_covid),
    };
  },
};

// ── Helpers ──

/** Determina si hay liquidación de terceros basado en recargos_data.terceroRows */
function computeTerceroLiquidado(recargosData: any): boolean {
  if (!recargosData || !Array.isArray(recargosData.terceroRows)) return false;
  const rows = recargosData.terceroRows as any[];
  if (rows.length === 0) return false;
  // Hay liquidación de terceros si alguna fila tiene vr_unit * cant > 0
  return rows.some((t: any) => {
    const totalRow = (parseFloat(t.vr_unit) || 0) * (parseFloat(t.cant) || 0);
    return totalRow > 0;
  });
}

async function generarConsecutivo(anio: number): Promise<string> {
  const ultima = await prisma.liquidacion_servicio.findFirst({
    where: { anio },
    orderBy: { consecutivo: "desc" },
    select: { consecutivo: true },
  });

  let siguiente = 1;
  if (ultima?.consecutivo) {
    const partes = ultima.consecutivo.split("-");
    const num = parseInt(partes[partes.length - 1]);
    if (!isNaN(num)) siguiente = num + 1;
  }

  return `LS-${anio}-${String(siguiente).padStart(4, "0")}`;
}
