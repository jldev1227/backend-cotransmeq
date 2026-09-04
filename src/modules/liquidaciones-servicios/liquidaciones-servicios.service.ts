// @ts-nocheck
import { prisma } from "../../config/prisma";
import {
  reconciliarItems,
  type ItemEntrante,
} from "../../lib/soft-delete/reconciliar-items";
import {
  eliminarLiquidacionServicio,
  restaurarLiquidacionServicio,
  estaEliminada,
} from "../../lib/soft-delete/liquidacion-servicio";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";
import path from "path";
import fs from "fs";
import { LiquidacionesTercerosService } from "../liquidaciones-terceros/liquidaciones-terceros.service";

const MES_NOMBRE_A_NUM: Record<string, number> = {
  ENERO: 1, FEBRERO: 2, MARZO: 3, ABRIL: 4, MAYO: 5, JUNIO: 6,
  JULIO: 7, AGOSTO: 8, SEPTIEMBRE: 9, OCTUBRE: 10, NOVIEMBRE: 11, DICIEMBRE: 12,
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6,
  julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  Enero: 1, Febrero: 2, Marzo: 3, Abril: 4, Mayo: 5, Junio: 6,
  Julio: 7, Agosto: 8, Septiembre: 9, Octubre: 10, Noviembre: 11, Diciembre: 12,
};

function parseMes(value: string | number | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number") return value;
  const num = Number(value);
  if (!isNaN(num)) return num;
  return MES_NOMBRE_A_NUM[value];
}

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
  operadora?: string;
  valor_transporte_adicional?: number;
  valor_recargos?: number;
  recargos_data?: any;
  terceros_items?: any[];
}

export interface FiltrosLiquidacionServicios {
  page?: number;
  limit?: number;
  /**
   * Incluir los borradores que nadie ha guardado a propósito todavía
   * (`confirmada_at IS NULL`). Un usuario normal solo recibe los propios; una
   * sesión administrativa puede verlos todos para recuperar autoguardados.
   */
  incluir_no_confirmadas?: boolean | string;
  /// Id del usuario que consulta. Lo pone el controlador desde la sesión,
  /// nunca el cliente: si viniera del query string, cualquiera podría leer los
  /// borradores de cualquiera.
  usuario_id?: string;
  /// Solo lo establece el controlador a partir de la sesión. Permite que un
  /// administrador rescate autoguardados abandonados por otros usuarios.
  puede_ver_no_confirmadas_ajenas?: boolean;
  cliente_id?: string;
  estado?: EstadoLiquidacionServicio;
  mes?: number;
  anio?: number;
  busqueda?: string;
  placa?: string;
  liquidador_id?: string;
  sortBy?: string;
  sortDir?: string;
  // Column filters (comma-separated values)
  consecutivos?: string;
  estados?: string;
  cliente_nombres?: string;
  liquidador_nombres?: string;
  periodos?: string; // "1-2026,2-2026" format
  facturas?: string;
  placas?: string;
  /**
   * `"true"` → cada liquidación viaja con sus ITEMS completos (una consulta,
   * sin N+1). Lo pide el canvas de historial, que pinta una fila por item;
   * el listado clásico no lo manda y sigue recibiendo solo `placas[]`.
   * Llega como string porque viene de la query HTTP.
   */
  include_items?: string | boolean;
}

// ═══════════════════════════════════════════════════════════════
// SERVICIO
// ═══════════════════════════════════════════════════════════════

/**
 * Ítems normalizados y totales de una liquidación.
 *
 * Estaba duplicado literalmente en `crear` y `actualizar`, y el autoguardado
 * habría sido la tercera copia. Con tres, el día que alguien cambie la fórmula
 * del IVA o el descuento en una sola, la liquidación valdrá distinto según por
 * dónde se guarde — y el síntoma aparecería en la factura, no en un error.
 *
 * Devuelve números planos; envolver en `Decimal` es cosa de cada llamante,
 * porque `crear` y `actualizar` no coinciden en cuáles envuelven.
 */
function construirItemsYTotales(data: CrearLiquidacionInput) {
  let valorServicios = 0;

  const itemsData = data.items.map((item, index) => {
    const subtotal = item.cantidad * item.valor_unitario;
    const descuento = (subtotal * (item.porcentaje_descuento || 0)) / 100;
    const valorFinal = subtotal - descuento;
    valorServicios += valorFinal;

    return {
      id: randomUUID(),
      placa: item.placa,
      fecha_inicial: new Date(item.fecha_inicial),
      fecha_final: new Date(item.fecha_final),
      recorrido: item.recorrido,
      tipo_servicio: item.tipo_servicio as any,
      cantidad: item.cantidad,
      valor_unitario: item.valor_unitario,
      subtotal,
      porcentaje_descuento: item.porcentaje_descuento || 0,
      valor_final: valorFinal,
      numero_planilla: item.numero_planilla || null,
      servicio_id: item.servicio_id || null,
      recargo_planilla_id: item.recargo_planilla_id || null,
      valor_recargos_total: 0,
      orden: index,
      tercero_id: item.tercero_id || null,
    };
  });

  // `valor_recargos` viene ya calculado del liquidador del frontend.
  const valorRecargos = data.valor_recargos || 0;
  const valorTransporteAdicional = data.valor_transporte_adicional || 0;
  const subtotal =
    valorServicios +
    valorTransporteAdicional +
    valorRecargos +
    (data.valor_pernoctes || 0);
  const porcentajeIva = data.porcentaje_iva || 0;
  const valorIva = (subtotal * porcentajeIva) / 100;
  const total = subtotal + valorIva;

  return {
    itemsData,
    valorServicios,
    valorRecargos,
    valorTransporteAdicional,
    subtotal,
    porcentajeIva,
    valorIva,
    total,
  };
}

/**
 * Qué liquidaciones son visibles.
 *
 * Por defecto, solo las confirmadas: una fila con `confirmada_at IS NULL` nació
 * de un autoguardado y nadie ha pulsado Guardar, así que para el resto del
 * mundo todavía no existe. Sin este filtro, el listado y el canvas de todos se
 * llenarían de liquidaciones a medio escribir en cuanto alguien abre el
 * formulario — que es lo que puede hundir la funcionalidad socialmente.
 *
 * La excepción es el propio autor, y solo si la pide: es lo que le permite
 * volver a un borrador que dejó a medias. Administración puede pedirlos todos
 * para detectar y recuperar trabajo abandonado.
 */
function filtroVisibilidad(filtros: FiltrosLiquidacionServicios) {
  const incluir =
    filtros.incluir_no_confirmadas === true ||
    filtros.incluir_no_confirmadas === "true";
  if (incluir && filtros.usuario_id) {
    if (filtros.puede_ver_no_confirmadas_ajenas) return {};
    return {
      OR: [
        { confirmada_at: { not: null } },
        { creado_por_id: filtros.usuario_id },
      ],
    };
  }
  return { confirmada_at: { not: null } };
}

/**
 * Resuelve la operadora a las DOS columnas: la FK nueva y el texto heredado.
 *
 * Se escriben las dos durante la transición. El texto lo siguen leyendo el
 * canvas del historial y el exportador de Excel, y quitarlo a la vez que se
 * añade la FK dejaría la columna OPERADORA vacía en el Excel del cierre — que
 * es algo que nadie mira hasta que lo ve el cliente, un mes después.
 *
 * Acepta `operadora_id` (lo que manda el editor nuevo) o `operadora` como
 * texto (lo que mandan los clientes viejos), y sale con las dos coherentes.
 *
 * TOLERANTE A PROPÓSITO: si la tabla `operadoras` todavía no existe —el SQL de
 * `migrations/31-08-2026-operadoras-catalogo.sql` se aplica a mano y puede ir
 * por detrás del despliegue— cae al comportamiento de antes en vez de romper
 * el alta. Esta red se quita cuando el SQL esté aplicado en los dos entornos.
 */
async function resolverOperadora(data: any): Promise<{
  operadora: string | null;
  operadora_id: string | null;
}> {
  const texto = typeof data?.operadora === "string" ? data.operadora.trim() : "";
  const id = data?.operadora_id ?? null;

  if (!id && !texto) return { operadora: null, operadora_id: null };

  try {
    const encontrada = id
      ? await prisma.operadoras.findUnique({ where: { id } })
      : await prisma.operadoras.findUnique({
          where: { codigo: texto.toUpperCase() },
        });

    if (encontrada) {
      return { operadora: encontrada.codigo, operadora_id: encontrada.id };
    }
    /// Texto que no está en el catálogo: se conserva tal cual y sin FK. Pasa
    /// con las liquidaciones anteriores al catálogo, y forzar aquí un valor
    /// sería inventarse a quién se le atribuyó el servicio.
    return { operadora: texto || null, operadora_id: null };
  } catch {
    return { operadora: texto || null, operadora_id: null };
  }
}

export const LiquidacionesServiciosService = {
  // ── Helper: crear snapshot de una liquidación ──
  async _crearSnapshot(
    liquidacionId: string,
    userId: string,
    accion: string,
    estadoAnterior?: string,
    estadoNuevo?: string,
    motivo?: string,
  ) {
    const liq = await prisma.liquidacion_servicio.findUnique({
      where: { id: liquidacionId },
      include: {
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true } },
        actualizado_por: { select: { id: true, nombre: true } },
        liquidado_por: { select: { id: true, nombre: true } },
        aprobado_por: { select: { id: true, nombre: true } },
        /// Solo ítems vivos. El snapshot de `actualizar` se toma DESPUÉS de
        /// reconciliar, así que sin este filtro guardaba como «versión» las
        /// filas que el usuario acababa de quitar.
        items: {
          where: { deleted_at: null },
          orderBy: { orden: "asc" },
          include: { tercero: { select: { id: true, nombre_completo: true } } },
        },
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
      valor_unitario_pernoctes: Number(liq.valor_unitario_pernoctes),
      cantidad_pernoctes: Number(liq.cantidad_pernoctes),
      subtotal: Number(liq.subtotal),
      porcentaje_iva: Number(liq.porcentaje_iva),
      valor_iva: Number(liq.valor_iva),
      total: Number(liq.total),
      observaciones: liq.observaciones,
      osi: liq.osi,
      operadora: liq.operadora,
      tercero_liquidado: liq.tercero_liquidado,
      motivo_anulacion: liq.motivo_anulacion,
      creado_por: liq.creado_por,
      actualizado_por: liq.actualizado_por,
      liquidado_por: liq.liquidado_por,
      aprobado_por: liq.aprobado_por,
      fecha_liquidacion: liq.fecha_liquidacion,
      fecha_aprobacion: liq.fecha_aprobacion,
      items: liq.items.map((i) => ({
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
        estado_nuevo: estadoNuevo || (liq.estado as string),
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

            // Tarifas "all-in" (base + %): horas extras, adicionales y RD
            // (Recargo Dominical/Festivo se paga completo: base + recargo).
            // El resto (RN, RNDF) son recargos puros sumados a la base.
            const esAllIn = tipo.es_hora_extra || tipo.adicional || tipo.codigo === 'RD';

            let valorCalculado = 0;
            if (esAllIn) {
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
                valorUnitario: esAllIn
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
        valor_unitario_pernoctes: Math.round(valor_unitario_pernoctes),
        cantidad_pernoctes: Math.round(cantidad_pernoctes),
        subtotal: Math.round(subtotal),
        porcentaje_iva: porcentajeIva,
        valor_iva: Math.round(valorIva),
        total: Math.round(totalGeneral),
      },
    };
  },

  // ── BORRADOR PREVIO ──
  //
  // Solo para la fase en la que la fila real todavía no puede existir. En
  // cuanto el autoguardado crea la liquidación, el borrador «nuevo» del usuario
  // se borra y a partir de ahí la verdad es la fila.

  /**
   * Guarda (o pisa) el borrador del usuario.
   *
   * `findFirst` + `create`/`update` en transacción, y no `upsert`, porque la
   * unicidad real son dos índices PARCIALES que Prisma no sabe expresar (ver
   * el modelo). Sin la transacción, dos pestañas del mismo usuario podrían
   * crear dos borradores «nuevos» a la vez y el índice parcial rechazaría uno
   * con un error feo en vez de simplemente pisarlo.
   */
  async guardarDraft(
    usuarioId: string,
    liquidacionId: string | null,
    payload: any,
  ) {
    return prisma.$transaction(async (tx) => {
      const existente = await tx.liquidacion_servicio_draft.findFirst({
        where: { usuario_id: usuarioId, liquidacion_id: liquidacionId },
      });

      if (existente) {
        const actualizado = await tx.liquidacion_servicio_draft.update({
          where: { id: existente.id },
          data: { payload, version: existente.version + 1 },
        });
        return { ok: true, id: actualizado.id, version: actualizado.version };
      }

      const creado = await tx.liquidacion_servicio_draft.create({
        data: {
          usuario_id: usuarioId,
          liquidacion_id: liquidacionId,
          payload,
          version: 1,
        },
      });
      return { ok: true, id: creado.id, version: creado.version };
    });
  },

  async obtenerDraft(usuarioId: string, liquidacionId: string | null) {
    const draft = await prisma.liquidacion_servicio_draft.findFirst({
      where: { usuario_id: usuarioId, liquidacion_id: liquidacionId },
    });
    if (!draft) return null;
    return {
      id: draft.id,
      payload: draft.payload,
      version: draft.version,
      updated_at: draft.updated_at,
    };
  },

  /**
   * `deleteMany` y no `delete`: borrar un borrador que ya no está es un
   * no-op deseable, no un error. Se llama tras guardar de verdad y al cancelar,
   * y en los dos casos puede no existir.
   */
  async eliminarDraft(usuarioId: string, liquidacionId: string | null) {
    const { count } = await prisma.liquidacion_servicio_draft.deleteMany({
      where: { usuario_id: usuarioId, liquidacion_id: liquidacionId },
    });
    return { ok: true, eliminados: count };
  },

  /**
   * Barrido de borradores viejos.
   *
   * Sin esto la tabla solo crece: un borrador que nadie retomó en un mes no lo
   * va a retomar ya, y la restauración lo descartaría igualmente por antiguo.
   */
  async limpiarDraftsViejos(dias = 30) {
    const corte = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
    const { count } = await prisma.liquidacion_servicio_draft.deleteMany({
      where: { updated_at: { lt: corte } },
    });
    return { eliminados: count };
  },

  // ── CHECK CONSECUTIVO UNIQUE ──

  async checkConsecutivo(consecutivo: string, excludeId?: string) {
    const existing = await prisma.liquidacion_servicio.findFirst({
      where: { consecutivo, deleted_at: null },
      select: { id: true },
    });
    if (!existing) return { available: true };
    if (excludeId && existing.id === excludeId) return { available: true };
    return { available: false };
  },

// ── CRUD LIQUIDACIONES ──

  /**
   * Autoguardado: crea o actualiza la liquidación como BORRADOR real.
   *
   * Es un método APARTE de `crear`/`actualizar`, y no una rama con un flag
   * dentro de ellos, porque lo que lo define es todo lo que NO hace:
   *
   *  - no emite `liquidacion-servicio-created/updated`, que van por `io.emit`
   *    global y sin salas: cada tecleo llegaría a todos los clientes;
   *  - no dispara el fan-out de `NotificacionesService`, que avisa a todos los
   *    aprobadores — serían N notificaciones cada pocos segundos;
   *  - no deja snapshot en el historial salvo una vez, al nacer la fila, o el
   *    historial de una liquidación tendría doscientas entradas «edicion».
   *
   * Si algún día alguien "unifica" esto con `crear`, esas tres cosas vuelven a
   * la vez y nadie lo nota hasta que suena el teléfono.
   *
   * La fila nace en BORRADOR con `confirmada_at = null`, que es lo que la
   * mantiene fuera del listado y del canvas del resto del mundo hasta que
   * alguien pulse Guardar de verdad.
   */
  async autoguardar(
    data: CrearLiquidacionInput & {
      cliente_key?: string | null;
      borrador_id?: string | null;
      base_version?: number | null;
    },
    userId: string,
  ) {
    const {
      itemsData,
      valorServicios,
      valorRecargos,
      valorTransporteAdicional,
      subtotal,
      porcentajeIva,
      valorIva,
      total,
    } = construirItemsYTotales(data);
    const operadoraResuelta = await resolverOperadora(data);

    // ── Alta ──────────────────────────────────────────────────────────
    if (!data.borrador_id) {
      const consecutivo =
        data.consecutivo || (await generarConsecutivo(data.anio));

      /// Idempotencia por `cliente_key`: dos autoguardados en vuelo a la vez
      /// —el debounce dispara, la red tarda, el usuario sigue escribiendo— no
      /// conocen todavía el id que devolvió el otro, así que sin esto crearían
      /// dos liquidaciones. Se comprueba ANTES y se vuelve a leer si el índice
      /// único salta: entre la lectura y el insert cabe la otra petición.
      if (data.cliente_key) {
        const yaCreada = await prisma.liquidacion_servicio.findUnique({
          where: { cliente_key: data.cliente_key },
        });
        if (yaCreada) {
          return this.autoguardar(
            { ...data, borrador_id: yaCreada.id, base_version: yaCreada.version },
            userId,
          );
        }
      }

      try {
        const creada = await prisma.liquidacion_servicio.create({
          data: {
            consecutivo,
            cliente_id: data.cliente_id,
            mes: data.mes,
            anio: data.anio,
            estado: "BORRADOR" as any,
            tercero_liquidado: computeTerceroLiquidado(data.recargos_data),
            valor_servicios: valorServicios,
            valor_recargos: valorRecargos,
            valor_transporte_adicional: valorTransporteAdicional,
            valor_pernoctes: data.valor_pernoctes || 0,
            valor_unitario_pernoctes: data.valor_unitario_pernoctes || 0,
            cantidad_pernoctes: data.cantidad_pernoctes || 0,
            subtotal,
            porcentaje_iva: porcentajeIva,
            valor_iva: valorIva,
            total,
            recargos_data: data.recargos_data || undefined,
            observaciones: data.observaciones,
            osi: data.osi || null,
            operadora: operadoraResuelta.operadora,
            operadora_id: operadoraResuelta.operadora_id,
            creado_por_id: userId,
            cliente_key: data.cliente_key || null,
            /// La marca de «todavía nadie la guardó a propósito».
            confirmada_at: null,
            items: { createMany: { data: itemsData } },
          },
        });

        /// El único snapshot del autoguardado: el del nacimiento. Los
        /// siguientes no dejan rastro, a propósito.
        await this._crearSnapshot(creada.id, userId, "creacion", null, "BORRADOR");

        /// Ya hay fila: el borrador «nuevo» del usuario deja de ser la verdad y
        /// se retira. Dejarlo vivo es tener dos fuentes para lo mismo, que es
        /// exactamente el bug que este cambio viene a cerrar.
        await this.eliminarDraft(userId, null);

        return {
          id: creada.id,
          consecutivo: creada.consecutivo,
          estado: creada.estado,
          version: creada.version,
          updated_at: creada.updated_at,
          creada: true,
        };
      } catch (e: any) {
        /// Carrera perdida: la otra petición insertó entre nuestro `findUnique`
        /// y este `create`. Se relee y se sigue por la rama de actualización.
        if (e?.code === "P2002" && data.cliente_key) {
          const otra = await prisma.liquidacion_servicio.findUnique({
            where: { cliente_key: data.cliente_key },
          });
          if (otra) {
            return this.autoguardar(
              { ...data, borrador_id: otra.id, base_version: otra.version },
              userId,
            );
          }
        }
        throw e;
      }
    }

    // ── Actualización con compare-and-swap ────────────────────────────
    const id = data.borrador_id;

    /// Los ítems YA NO se borran aquí.
    ///
    /// Antes esto era `deleteMany` + `createMany`: cada autoguardado destruía
    /// los ítems anteriores y los recreaba. Un payload vacío —una pestaña que
    /// se cierra antes de hidratar, una respuesta que llega tarde— los borraba
    /// todos sin crear ninguno, y la cascada de la cabecera remataba el resto
    /// al eliminar la liquidación. Ahora se reconcilian más abajo, después de
    /// ganar el compare-and-swap.
    const [afectadas] = await prisma.$transaction([
      prisma.liquidacion_servicio.updateMany({
        /// Las tres condiciones del WHERE son tres motivos distintos de
        /// rechazo, y por eso abajo se relee para saber cuál fue.
        where: {
          id,
          ...(data.base_version != null ? { version: data.base_version } : {}),
          estado: "BORRADOR" as any,
          deleted_at: null,
        },
        data: {
          consecutivo: data.consecutivo || undefined,
          cliente_id: data.cliente_id,
          mes: data.mes,
          anio: data.anio,
          tercero_liquidado: computeTerceroLiquidado(data.recargos_data),
          valor_servicios: valorServicios,
          valor_recargos: valorRecargos,
          valor_transporte_adicional: valorTransporteAdicional,
          valor_pernoctes: data.valor_pernoctes || 0,
          valor_unitario_pernoctes: data.valor_unitario_pernoctes || 0,
          cantidad_pernoctes: data.cantidad_pernoctes || 0,
          subtotal,
          porcentaje_iva: porcentajeIva,
          valor_iva: valorIva,
          total,
          recargos_data: data.recargos_data || undefined,
          observaciones: data.observaciones,
          osi: data.osi || null,
          operadora: operadoraResuelta.operadora,
          operadora_id: operadoraResuelta.operadora_id,
          actualizado_por_id: userId,
          version: { increment: 1 },
        },
      }),
    ]);

    if (afectadas.count === 0) {
      /// Se relee para distinguir el motivo: un 409 genérico no le dice al
      /// editor si debe recargar, avisar de que ya no es un borrador, o
      /// rendirse porque la borraron.
      const actual = await prisma.liquidacion_servicio.findUnique({
        where: { id },
        select: {
          id: true,
          consecutivo: true,
          estado: true,
          version: true,
          updated_at: true,
          deleted_at: true,
          actualizado_por: { select: { id: true, nombre: true } },
        },
      });

      const motivo = !actual || actual.deleted_at
        ? "borrada"
        : actual.estado !== "BORRADOR"
          ? "estado"
          : "version";

      const err: any = new Error(
        motivo === "borrada"
          ? "La liquidación ya no existe."
          : motivo === "estado"
            ? `La liquidación pasó a ${actual!.estado} y dejó de ser un borrador.`
            : "Otra persona guardó cambios sobre este borrador.",
      );
      err.conflicto = { motivo, servidor: actual ?? null };
      throw err;
    }

    /**
     * Reconciliación en vez de recreación.
     *
     * Se actualiza lo que sigue, se crea lo nuevo y lo que ya no llega se marca
     * con `deleted_at`. Nada se borra físicamente, así que restaurar la
     * liquidación devuelve todo.
     *
     * `rechazarVaciadoTotal` es lo que impide que un autoguardado sin ítems
     * vacíe una liquidación que sí los tiene: en el autoguardado, una lista
     * vacía casi nunca es «el usuario borró todas las filas», es un estado a
     * medio hidratar. Vaciar de verdad se hace desde la edición explícita.
     */
    await prisma.$transaction(async (tx) => {
      await reconciliarItems(tx, id, itemsData as ItemEntrante[], {
        rechazarVaciadoTotal: true,
      });
    });

    const actualizada = await prisma.liquidacion_servicio.findUnique({
      where: { id },
      select: {
        id: true,
        consecutivo: true,
        estado: true,
        version: true,
        updated_at: true,
        confirmada_at: true,
      },
    });

    return { ...actualizada, creada: false };
  },

  async crear(data: CrearLiquidacionInput, userId: string) {
    // Use provided consecutivo or generate one
    const consecutivo =
      data.consecutivo || (await generarConsecutivo(data.anio));

    const {
      itemsData,
      valorServicios,
      valorRecargos,
      valorTransporteAdicional,
      subtotal,
      porcentajeIva,
      valorIva,
      total,
    } = construirItemsYTotales(data);

    /// Se resuelve antes del `create` y no dentro del literal: un `await`
    /// interpolado ahí rompe la inferencia de tipos de Prisma y el `include`
    /// deja de verse en el valor de retorno.
    const operadoraResuelta = await resolverOperadora(data);

    const liquidacion = await prisma.liquidacion_servicio.create({
      data: {
        consecutivo,
        cliente_id: data.cliente_id,
        mes: data.mes,
        anio: data.anio,
        estado: "BORRADOR" as any,
        tercero_liquidado: computeTerceroLiquidado(data.recargos_data),
        valor_servicios: valorServicios,
        valor_recargos: valorRecargos,
        valor_transporte_adicional: valorTransporteAdicional,
        valor_pernoctes: data.valor_pernoctes,
        valor_unitario_pernoctes: data.valor_unitario_pernoctes,
        cantidad_pernoctes: data.cantidad_pernoctes,
        subtotal,
        porcentaje_iva: porcentajeIva,
        valor_iva: valorIva,
        total,
        recargos_data: data.recargos_data || undefined,
        observaciones: data.observaciones,
        osi: data.osi || null,
        operadora: operadoraResuelta.operadora,
        operadora_id: operadoraResuelta.operadora_id,
        creado_por_id: userId,
        items: {
          createMany: { data: itemsData },
        },
      },
      include: {
        cliente: { select: { id: true, nombre: true, nit: true } },
        creado_por: { select: { id: true, nombre: true, correo: true } },
        items: { where: { deleted_at: null }, orderBy: { orden: "asc" } },
      },
    });

    // Crear snapshot inicial
    await this._crearSnapshot(
      liquidacion.id,
      userId,
      "creacion",
      null,
      "BORRADOR",
    );

    // Guardar terceros_items si vienen en el payload
    if (
      data.terceros_items &&
      Array.isArray(data.terceros_items) &&
      data.terceros_items.length > 0
    ) {
      // Resolver item_id a partir de src_index → orden del item de servicio
      const createdItems = liquidacion.items; // ya vienen ordenados por orden
      const tercerosConItemId = data.terceros_items.map((t: any) => {
        const srcIdx = t.src_index ?? 0;
        const matchedItem = createdItems[srcIdx];
        return { ...t, item_id: matchedItem?.id || null };
      });
      await LiquidacionesTercerosService.guardar(
        liquidacion.id,
        tercerosConItemId,
      );
    }

    return liquidacion;
  },

  async listar(filtros: FiltrosLiquidacionServicios) {
    const page = Number(filtros.page) || 1;
    const limit = Number(filtros.limit) || 10;
    const skip = (page - 1) * limit;
    const conItems =
      filtros.include_items === true || filtros.include_items === "true";

    /// `filtroVisibilidad` va en el `where` base a propósito: `whereExcluding`
    /// deriva de él, así que las listas de valores de los filtros de columna
    /// tampoco delatan los borradores ajenos.
    const where: any = { deleted_at: null, ...filtroVisibilidad(filtros) };
    if (filtros.cliente_id) where.cliente_id = filtros.cliente_id;
    if (filtros.estado) where.estado = filtros.estado;
    if (filtros.mes) where.mes = parseMes(filtros.mes);
    if (filtros.anio) where.anio = Number(filtros.anio);
    if (filtros.busqueda) {
      where.OR = [
        { consecutivo: { contains: filtros.busqueda, mode: "insensitive" } },
        {
          cliente: {
            nombre: { contains: filtros.busqueda, mode: "insensitive" },
          },
        },
        { items: { some: { placa: { contains: filtros.busqueda, mode: "insensitive" }, deleted_at: null } } },
      ];
    }
    if (filtros.placa) {
      // ── Filtro de placa tolerante a formato ──
      // La BD tiene items con la columna `placa` en formatos
      // inconsistentes ("KSQ-992", "KSQ992", "KSQ 992") según cómo se
      // crearon. El `contains` de Prisma es substring literal, así que
      // "KSQ-992" NO matchea "KSQ992". Usamos un raw query que
      // normaliza ambos lados (strip no-alfanumérico) antes de comparar,
      // para que cualquier variación matchee correctamente.
      const placaNormalized = filtros.placa
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "");
      const matchingLiqIds = await prisma.$queryRaw<{ liquidacion_id: string }[]>`
        SELECT DISTINCT liquidacion_id
        FROM liquidacion_servicio_item
        WHERE UPPER(REGEXP_REPLACE(placa, '[^A-Za-z0-9]', '', 'g')) = ${placaNormalized}
      `;
      const liqIds = matchingLiqIds.map((r) => r.liquidacion_id);
      if (liqIds.length === 0) {
        // Forzar resultado vacío: usamos un UUID inexistente
        where.id = "00000000-0000-0000-0000-000000000000";
      } else {
        where.id = { in: liqIds };
      }
    }

    // Sorting
    const sortableFields: Record<string, string> = {
      consecutivo: "consecutivo",
      cliente: "cliente.nombre",
      periodo: "anio",
      estado: "estado",
      total: "total",
      items: "total", // will sort by _count below
      fecha: "created_at",
    };
    let orderBy: any = { created_at: "desc" };
    if (filtros.sortBy && sortableFields[filtros.sortBy]) {
      const dir = filtros.sortDir === "asc" ? "asc" : "desc";
      const field = filtros.sortBy;
      if (field === "cliente") {
        orderBy = { cliente: { nombre: dir } };
      } else if (field === "periodo") {
        orderBy = [{ anio: dir }, { mes: dir }];
      } else {
        orderBy = { [sortableFields[field]]: dir };
      }
    }

    // Filtro por liquidador
    if (filtros.liquidador_id) {
      where.AND = [
        ...(where.AND || []),
        {
          OR: [
            { liquidado_por_id: filtros.liquidador_id },
            { creado_por_id: filtros.liquidador_id },
          ],
        },
      ];
    }

    // ── Column filters: build individual conditions ──
    const colConditions: Record<string, any> = {};

    if (filtros.consecutivos) {
      const vals = filtros.consecutivos.split(",").filter(Boolean);
      if (vals.length)
        colConditions.consecutivos = { consecutivo: { in: vals } };
    }
    if (filtros.estados) {
      const vals = filtros.estados.split(",").filter(Boolean);
      if (vals.length) colConditions.estados = { estado: { in: vals } };
    }
    if (filtros.cliente_nombres) {
      const vals = filtros.cliente_nombres.split(",").filter(Boolean);
      if (vals.length)
        colConditions.cliente_nombres = { cliente: { nombre: { in: vals } } };
    }
    if (filtros.liquidador_nombres) {
      const vals = filtros.liquidador_nombres.split(",").filter(Boolean);
      if (vals.length)
        colConditions.liquidador_nombres = {
          OR: [
            { liquidado_por: { nombre: { in: vals } } },
            { creado_por: { nombre: { in: vals } } },
          ],
        };
    }
    if (filtros.periodos) {
      const pairs = filtros.periodos
        .split(",")
        .filter(Boolean)
        .map((p) => {
          const [m, a] = p.split("-");
          return { mes: Number(m), anio: Number(a) };
        })
        .filter((p) => p.mes && p.anio);
      if (pairs.length)
        colConditions.periodos = {
          OR: pairs.map((p) => ({ mes: p.mes, anio: p.anio })),
        };
    }
    if (filtros.facturas) {
      const vals = filtros.facturas.split(",").filter(Boolean);
      if (vals.length) {
        const items = await prisma.factura_liquidacion_item.findMany({
          where: {
            deleted_at: null,
            factura: {
              numero_factura: { in: vals },
              estado: "ACTIVA",
              deleted_at: null,
            },
          },
          select: { liquidacion_id: true },
          distinct: ["liquidacion_id"],
        });
        colConditions.facturas = {
          id: { in: items.map((i) => i.liquidacion_id) },
        };
      }
    }
    if (filtros.placas) {
      const vals = filtros.placas.split(",").filter(Boolean);
      if (vals.length)
        /// `some` sin filtro encontraría liquidaciones por la placa de un ítem
        /// ya eliminado, que es justo lo que el usuario no ve en la tabla.
        colConditions.placas = { items: { some: { placa: { in: vals }, deleted_at: null } } };
    }

    // Apply ALL column conditions to main where
    const allColKeys = Object.keys(colConditions);
    if (allColKeys.length) {
      where.AND = [
        ...(where.AND || []),
        ...allColKeys.map((k) => colConditions[k]),
      ];
    }

    // Helper: build where excluding one specific column filter (for cascading dropdown options)
    function whereExcluding(excludeKey: string) {
      const otherConditions = allColKeys
        .filter((k) => k !== excludeKey)
        .map((k) => colConditions[k]);
      const base = { ...where };
      // Rebuild AND without the excluded key's condition
      const baseAnd = (where.AND || []).filter(
        (c: any) => !allColKeys.map((k) => colConditions[k]).includes(c),
      );
      base.AND = [...baseAnd, ...otherConditions];
      if (!base.AND.length) delete base.AND;
      return base;
    }

    const globalWhere = {
      deleted_at: null as null,
      ...filtroVisibilidad(filtros),
      ...(filtros.mes ? { mes: parseMes(filtros.mes) } : {}),
      ...(filtros.anio ? { anio: Number(filtros.anio) } : {}),
    };

    const [
      liquidaciones,
      total,
      metadata,
      uniqueClients,
      uniqueLiquidadores,
      uniqueConsecutivos,
      uniquePeriodos,
      uniqueFacturas,
      uniqueEstados,
      uniquePlacas,
    ] = await Promise.all([
      prisma.liquidacion_servicio.findMany({
        where,
        include: {
          cliente: { select: { id: true, nombre: true, nit: true } },
          creado_por: { select: { id: true, nombre: true, correo: true } },
          liquidado_por: { select: { id: true, nombre: true, correo: true } },
          aprobado_por: { select: { id: true, nombre: true, correo: true } },
          /// Contar TODOS los ítems inflaba `total_items`: los eliminados
          /// siguen en la tabla desde que el guardado marca en vez de borrar.
          _count: { select: { items: { where: { deleted_at: null } } } },
          /// Idem para las filas que pinta el canvas de historial y para las
          /// placas que se derivan de ellas.
          items: conItems
            ? { where: { deleted_at: null }, orderBy: { orden: "asc" as const } }
            : { where: { deleted_at: null }, select: { placa: true } },
          // La factura viva SIEMPRE embebida: el tipo del frontend ya la
          // documentaba como parte de `listar`, pero nunca se incluyó y la
          // columna N° FACTURA del canvas salía vacía. El listado clásico la
          // resolvía aparte con POST /batch-info — un viaje extra por página.
          factura_items: {
            where: { factura: { estado: "ACTIVA", deleted_at: null } },
            select: {
              factura: {
                select: { id: true, numero_factura: true, estado: true },
              },
            },
          },
        },
        orderBy,
        skip,
        take: limit,
      }),
      prisma.liquidacion_servicio.count({ where }),
      // Global metadata (only filtered by mes/anio for stats cards)
      prisma.liquidacion_servicio.groupBy({
        by: ["estado"],
        where: globalWhere,
        _count: { id: true },
        _sum: { total: true },
      }),
      // Unique clients (cascading: exclude own filter)
      prisma.liquidacion_servicio.findMany({
        where: whereExcluding("cliente_nombres"),
        select: { cliente: { select: { id: true, nombre: true } } },
        distinct: ["cliente_id"],
        orderBy: { cliente: { nombre: "asc" } },
      }),
      // Unique liquidadores (cascading: exclude own filter)
      prisma.liquidacion_servicio.findMany({
        where: {
          ...whereExcluding("liquidador_nombres"),
          liquidado_por_id: { not: null },
        },
        select: { liquidado_por: { select: { id: true, nombre: true } } },
        distinct: ["liquidado_por_id"],
      }),
      // Unique consecutivos (cascading: exclude own filter)
      prisma.liquidacion_servicio.findMany({
        where: whereExcluding("consecutivos"),
        select: { consecutivo: true },
        distinct: ["consecutivo"],
        orderBy: { consecutivo: "asc" },
      }),
      // Unique periodos (cascading: exclude own filter)
      prisma.liquidacion_servicio.groupBy({
        by: ["mes", "anio"],
        where: whereExcluding("periodos"),
        orderBy: [{ anio: "desc" }, { mes: "desc" }],
      }),
      // Unique factura numbers (cascading: exclude own filter)
      prisma.factura_liquidacion_item.findMany({
        where: {
          deleted_at: null,
          liquidacion: whereExcluding("facturas"),
          factura: { estado: "ACTIVA", deleted_at: null },
        },
        select: { factura: { select: { numero_factura: true } } },
        distinct: ["factura_id"],
      }),
      // Unique estados (cascading: exclude own filter)
      prisma.liquidacion_servicio.groupBy({
        by: ["estado"],
        where: whereExcluding("estados"),
      }),
      // Unique placas (cascading: exclude own filter, sorted A-Z)
      prisma.liquidacion_servicio_item.findMany({
        /// `deleted_at` del propio ítem, no solo de su liquidación: si no, el
        /// desplegable ofrece placas que ya no están en ninguna fila viva.
        where: { deleted_at: null, liquidacion: whereExcluding("placas") },
        select: { placa: true },
        distinct: ["placa"],
        orderBy: { placa: "asc" },
      }),
    ]);

    // Build metadata summary
    const globalTotal = metadata.reduce(
      (s, g) => s + Number(g._sum.total || 0),
      0,
    );
    const globalCount = metadata.reduce((s, g) => s + g._count.id, 0);
    const estadoCounts: Record<string, number> = {};
    for (const g of metadata) {
      estadoCounts[g.estado] = g._count.id;
    }

    const clientes = uniqueClients.map((c) => c.cliente).filter(Boolean);
    const liquidadores = uniqueLiquidadores
      .map((l) => l.liquidado_por)
      .filter(Boolean);

    return {
      liquidaciones: liquidaciones.map((l) => ({
        ...l,
        valor_servicios: Number(l.valor_servicios),
        valor_recargos: Number(l.valor_recargos),
        valor_pernoctes: Number(l.valor_pernoctes),
        valor_unitario_pernoctes: Number(l.valor_unitario_pernoctes),
        cantidad_pernoctes: Number(l.cantidad_pernoctes),
        subtotal: Number(l.subtotal),
        porcentaje_iva: Number(l.porcentaje_iva),
        valor_iva: Number(l.valor_iva),
        total: Number(l.total),
        valor_transporte_adicional: Number(l.valor_transporte_adicional),
        valor_administracion_ta: Number(l.valor_administracion_ta),
        total_items: l._count.items,
        placas: [...new Set((l.items || []).map((i: any) => i.placa))],
        // Los Decimal de Prisma serializan como string; el canvas los suma.
        items: conItems
          ? (l.items || []).map((i: any) => ({
              ...i,
              cantidad: Number(i.cantidad),
              valor_unitario: Number(i.valor_unitario),
              subtotal: Number(i.subtotal),
              porcentaje_descuento: Number(i.porcentaje_descuento),
              valor_final: Number(i.valor_final),
              valor_recargos_total: Number(i.valor_recargos_total),
              valor_pernocte_unitario: Number(i.valor_pernocte_unitario),
              valor_pernoctes_total: Number(i.valor_pernoctes_total),
            }))
          : undefined,
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
      metadata: {
        globalTotal,
        globalCount,
        estadoCounts,
        clientes,
        liquidadores,
        consecutivos: uniqueConsecutivos.map((c) => c.consecutivo),
        periodos: uniquePeriodos.map((p) => ({ mes: p.mes, anio: p.anio })),
        facturas: uniqueFacturas
          .map((f) => f.factura?.numero_factura)
          .filter(Boolean) as string[],
        estados: uniqueEstados.map((e) => e.estado),
        placas: uniquePlacas.map((p) => p.placa).filter(Boolean) as string[],
      },
    };
  },

  async obtenerPorId(id: string) {
    const liquidacion = await prisma.liquidacion_servicio.findFirst({
      /// Una liquidación eliminada no se abre: `actualizar` ya la rechaza con
      /// 409, pero sin esto el editor la cargaba igual y el usuario perdía el
      /// trabajo al guardar. La papelera se lee con `listarEliminadas`.
      where: { id, deleted_at: null },
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
        /// Solo ítems vivos: los eliminados existen para poder restaurar la
        /// liquidación, no para volver al formulario ni sumar en los totales.
        items: { where: { deleted_at: null }, orderBy: { orden: "asc" } },
        /// Cada guardado marca las filas anteriores con `deleted_at` y crea
        /// las nuevas (ver `LiquidacionesTercerosService.guardar`). Sin este
        /// filtro el editor mostraba todas las versiones apiladas.
        terceros_items: {
          where: { deleted_at: null },
          orderBy: { orden: "asc" },
          include: {
            tercero: {
              select: {
                id: true,
                nombre_completo: true,
                identificacion: true,
                tipo_persona: true,
              },
            },
          },
        },
      },
    });

    if (!liquidacion) throw new Error("Liquidación de servicio no encontrada");

    return {
      ...liquidacion,
      valor_servicios: Number(liquidacion.valor_servicios),
      valor_recargos: Number(liquidacion.valor_recargos),
      valor_pernoctes: Number(liquidacion.valor_pernoctes),
      valor_unitario_pernoctes: Number(liquidacion.valor_unitario_pernoctes),
      cantidad_pernoctes: Number(liquidacion.cantidad_pernoctes),
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
      terceros_items: liquidacion.terceros_items.map((t) => ({
        ...t,
        valor_unitario: Number(t.valor_unitario),
        cantidad: Number(t.cantidad),
        total_facturado: Number(t.total_facturado),
        porcentaje_admin: Number(t.porcentaje_admin),
        valor_admin: Number(t.valor_admin),
        valor_liquidar: Number(t.valor_liquidar),
        ingreso_extra_global: Number(t.ingreso_extra_global),
        ingresos_extra_aval: Number(t.ingresos_extra_aval),
        ingreso_empresa: Number(t.ingreso_empresa),
      })),
    };
  },

  /**
   * Elimina lógicamente la liquidación Y su árbol.
   *
   * Antes solo marcaba la cabecera. Los ítems no tenían `deleted_at`, así que
   * la cascada `ON DELETE CASCADE` los borraba físicamente en cuanto alguien
   * borraba de verdad, y restaurar devolvía un encabezado vacío con unos
   * totales que no correspondían a ninguna fila. Con ellos se perdían los
   * terceros del servicio y sus conceptos.
   */
  async eliminar(id: string, userId?: string | null, motivo?: string | null) {
    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id } });
    if (!liq) throw new Error("Liquidación no encontrada");
    if (liq.deleted_at) throw new Error("Esta liquidación ya fue eliminada");

    // Check if linked to any ACTIVE factura before attempting delete
    const activeFacturas = await prisma.factura_liquidacion_item.count({
      where: {
        deleted_at: null,
        liquidacion_id: id,
        factura: { estado: "ACTIVA", deleted_at: null },
      },
    });
    if (activeFacturas > 0) {
      throw new Error(
        "No se puede eliminar: esta liquidación tiene facturas activas asociadas. Anule la factura primero.",
      );
    }

    const marcadas = await eliminarLiquidacionServicio(id, {
      usuarioId: userId ?? null,
      motivo: motivo ?? null,
    });

    return {
      message: "Liquidación de servicio eliminada exitosamente",
      relacionadas: marcadas,
    };
  },

  /**
   * Restaura la liquidación y todo lo que se marcó con ella.
   *
   * El historial de estados no se toca ni al eliminar ni al restaurar: es la
   * evidencia de por qué la liquidación llegó a donde llegó.
   */
  async restaurar(id: string, userId?: string | null, motivo?: string | null) {
    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id } });
    if (!liq) throw new Error("Liquidación no encontrada");
    if (!liq.deleted_at) throw new Error("Esta liquidación no está eliminada");

    const restauradas = await restaurarLiquidacionServicio(id, {
      usuarioId: userId ?? null,
      motivo: motivo ?? null,
    });

    return {
      message: "Liquidación de servicio restaurada exitosamente",
      relacionadas: restauradas,
    };
  },

  async listarEliminadas(filtros: FiltrosLiquidacionServicios) {
    const page = Number(filtros.page) || 1;
    const limit = Number(filtros.limit) || 10;
    const skip = (page - 1) * limit;

    const where: any = {
      deleted_at: { not: null },
      ...filtroVisibilidad(filtros),
    };
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
          _count: { select: { items: true } },
          items: { where: { deleted_at: null }, select: { placa: true } },
        },
        orderBy: { deleted_at: "desc" },
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
        valor_unitario_pernoctes: Number(l.valor_unitario_pernoctes),
        cantidad_pernoctes: Number(l.cantidad_pernoctes),
        subtotal: Number(l.subtotal),
        porcentaje_iva: Number(l.porcentaje_iva),
        valor_iva: Number(l.valor_iva),
        total: Number(l.total),
        valor_transporte_adicional: Number(l.valor_transporte_adicional),
        valor_administracion_ta: Number(l.valor_administracion_ta),
        total_items: l._count.items,
        placas: [...new Set((l.items || []).map((i) => i.placa))],
      })),
      total,
      totalPages: Math.ceil(total / limit),
      page,
    };
  },

  /**
   * Marca la liquidación como confirmada: alguien pulsó Guardar de verdad.
   *
   * A partir de aquí sale en el listado y en el canvas de todo el mundo. Es
   * idempotente —`confirmada_at` no se reescribe si ya estaba— para que un
   * doble Guardar no mueva la fecha de nacimiento.
   */
  async confirmar(id: string) {
    await prisma.liquidacion_servicio.updateMany({
      where: { id, confirmada_at: null },
      data: { confirmada_at: new Date() },
    });
  },

  async actualizar(id: string, data: CrearLiquidacionInput, userId: string) {
    /**
     * Una liquidación eliminada no se edita.
     *
     * Sin esto, guardar sobre ella crearía ítems ACTIVOS colgando de una
     * cabecera que nadie ve — y esos ítems no se restaurarían nunca, porque la
     * restauración solo revive lo que tiene `deleted_at`. Hay que restaurarla
     * primero.
     */
    if (await estaEliminada(id)) {
      const err: any = new Error(
        "Esta liquidación está eliminada. Restáurala antes de editarla.",
      );
      err.codigo = "LIQUIDACION_ELIMINADA";
      err.statusCode = 409;
      throw err;
    }

    const liq = await prisma.liquidacion_servicio.findUnique({ where: { id } });
    if (!liq) throw new Error("Liquidación no encontrada");

    console.log(data, "data que llega")

    console.log(liq, "liq existente")

    const {
      itemsData,
      valorServicios,
      valorRecargos,
      valorTransporteAdicional,
      subtotal,
      porcentajeIva,
      valorIva,
      total,
    } = construirItemsYTotales(data);

    // Update consecutivo if provided, otherwise keep existing
    const consecutivo = data.consecutivo || liq.consecutivo;

    /// Igual que en `crear`: fuera del literal para no romper la inferencia.
    const operadoraResuelta = await resolverOperadora(data);

    /// Los ítems ya no se borran y recrean: se reconcilian después de
    /// actualizar la cabecera, dentro de la misma transacción. Ver
    /// `lib/soft-delete/reconciliar-items.ts`.
    const [liquidacion] = await prisma.$transaction([
      prisma.liquidacion_servicio.update({
        where: { id },
        data: {
          consecutivo,
          cliente: {
            connect: {
              id: data.cliente_id,
            },
          },
          mes: data.mes,
          anio: data.anio,
          valor_servicios: valorServicios,
          valor_recargos: toDecimal(valorRecargos),
          valor_transporte_adicional: valorTransporteAdicional,
          valor_pernoctes: data.valor_pernoctes || 0,
          valor_unitario_pernoctes: data.valor_unitario_pernoctes || 0,
          cantidad_pernoctes: data.cantidad_pernoctes || 0,
          subtotal: toDecimal(subtotal),
          porcentaje_iva: porcentajeIva,
          valor_iva: valorIva,
          total: toDecimal(total),
          tercero_liquidado: computeTerceroLiquidado(data.recargos_data),
          recargos_data: data.recargos_data || undefined,
          observaciones: data.observaciones,
          osi: data.osi || null,
          operadora: operadoraResuelta.operadora,
          /// Por relación y no por FK escalar: este `update` usa la forma
          /// «checked» de Prisma (`cliente: { connect }`), y mezclar las dos
          /// variantes en el mismo literal tumba la inferencia — el valor de
          /// retorno pierde el `include` y `liquidacion.cliente` deja de existir
          /// para TypeScript.
          operadora_rel: operadoraResuelta.operadora_id
            ? { connect: { id: operadoraResuelta.operadora_id } }
            : { disconnect: true },
          actualizado_por: {
            connect: { id: userId },
          },
        },
        include: {
          cliente: { select: { id: true, nombre: true, nit: true } },
          creado_por: { select: { id: true, nombre: true, correo: true } },
          actualizado_por: { select: { id: true, nombre: true, correo: true } },
          /// Solo los ítems vivos: incluir los eliminados los devolvería al
          /// formulario y el usuario los vería reaparecer al guardar.
          items: { where: { deleted_at: null }, orderBy: { orden: "asc" } },
        },
      }),
    ]);

    /**
     * Reconciliación de los ítems.
     *
     * Sin `rechazarVaciadoTotal`: aquí vaciar SÍ es una acción deliberada del
     * usuario, que quitó todas las filas y le dio a guardar. La guardia solo
     * tiene sentido en el autoguardado, donde una lista vacía suele venir de un
     * estado a medio cargar.
     */
    await prisma.$transaction(async (tx) => {
      await reconciliarItems(tx, id, itemsData as ItemEntrante[]);
    });

    // Crear snapshot de edición
    await this._crearSnapshot(
      liquidacion.id,
      userId,
      "edicion",
      liq.estado as string,
      liq.estado as string,
    );

    // Guardar terceros_items si vienen en el payload
    if (data.terceros_items && Array.isArray(data.terceros_items)) {
      // Resolver item_id a partir de src_index → orden del item de servicio
      const createdItems = liquidacion.items; // ya vienen ordenados por orden
      const tercerosConItemId = data.terceros_items.map((t: any) => {
        const srcIdx = t.src_index ?? 0;
        const matchedItem = createdItems[srcIdx];
        return { ...t, item_id: matchedItem?.id || null };
      });
      await LiquidacionesTercerosService.guardar(
        liquidacion.id,
        tercerosConItemId,
      );
    }

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
    if (!current) throw new Error("Liquidación no encontrada");
    const estadoAnterior = current.estado;

    const data: any = {
      estado: estado as any,
      actualizado_por_id: userId,
    };
    if (estado === "LIQUIDADA") {
      data.liquidado_por_id = userId;
      data.fecha_liquidacion = new Date();
    }
    if (estado === "APROBADA") {
      data.aprobado_por_id = userId;
      data.fecha_aprobacion = new Date();
    }
    if (estado === "BORRADOR") {
      data.liquidado_por_id = null;
      data.aprobado_por_id = null;
      data.fecha_aprobacion = null;
    }
    if (estado === "ANULADA" && motivo_anulacion) {
      data.motivo_anulacion = motivo_anulacion;
    } else if (estado !== "ANULADA") {
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
    await this._crearSnapshot(
      id,
      userId,
      "cambio_estado",
      estadoAnterior as string,
      estado,
      motivo_anulacion,
    );

    return result;
  },

  // ── Historial de estados ──
  async obtenerHistorial(liquidacionId: string) {
    return await prisma.historial_estado_liquidacion.findMany({
      where: { liquidacion_id: liquidacionId },
      include: {
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
      orderBy: { created_at: "desc" },
    });
  },

  // ── Documento Excel de liquidacion - Hoja 1 ──
  async obtenerCSV(liquidacionId: string) {
    const liq = await prisma.liquidacion_servicio.findUnique({
      where: { id: liquidacionId },
      include: {
        cliente: { select: { nombre: true, nit: true } },
        items: { where: { deleted_at: null }, orderBy: { orden: "asc" } },
      },
    });

    if (!liq) throw new Error("Liquidación no encontrada");

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Items Liquidación");

    // 1. Agregar Logo
    const logoPath = path.join(
      process.cwd(),
      "src/assets/transmeralda-logo.png",
    );
    if (fs.existsSync(logoPath)) {
      const logo = workbook.addImage({
        filename: logoPath,
        extension: "png",
      });
      worksheet.addImage(logo, {
        tl: { col: 0, row: 0 },
        ext: { width: 150, height: 50 },
      });
    }

    // 2. Información de Encabezado (empezando en fila 4 para dejar espacio al logo)
    worksheet.mergeCells("A1:K3"); // Espacio para logo si se desea centrar o algo mas

    const headerStartRow = 5;
    worksheet.getCell(`A${headerStartRow}`).value = "CLIENTE:";
    worksheet.getCell(`B${headerStartRow}`).value = liq.cliente.nombre;
    worksheet.getCell(`A${headerStartRow + 1}`).value = "NIT:";
    worksheet.getCell(`B${headerStartRow + 1}`).value = liq.cliente.nit;
    worksheet.getCell(`A${headerStartRow + 2}`).value = "CONSECUTIVO:";
    worksheet.getCell(`B${headerStartRow + 2}`).value = liq.consecutivo;
    worksheet.getCell(`A${headerStartRow + 3}`).value = "PERIODO:";
    worksheet.getCell(`B${headerStartRow + 3}`).value = `${liq.mes}/${liq.anio}`;

    // Estilo negrita para etiquetas de encabezado
    ["A5", "A6", "A7", "A8"].forEach((cell) => {
      worksheet.getCell(cell).font = { bold: true };
    });

    // 3. Tabla de Items
    const tableHeaderRow = 10;
    const columns = [
      { header: "PLACA", key: "placa", width: 12 },
      { header: "FECHA INICIAL", key: "fecha_ini", width: 15 },
      { header: "FECHA FINAL", key: "fecha_fin", width: 15 },
      { header: "RECORRIDO", key: "recorrido", width: 45 },
      { header: "TIPO SERVICIO", key: "tipo", width: 15 },
      { header: "CANTIDAD", key: "cantidad", width: 10 },
      { header: "VALOR UNITARIO", key: "v_unit", width: 18 },
      { header: "SUBTOTAL", key: "subtotal", width: 18 },
      { header: "DESC (%)", key: "desc", width: 10 },
      { header: "VALOR FINAL", key: "v_final", width: 18 },
      { header: "NRO. PLANILLA", key: "planilla", width: 15 },
    ];

    const headerRow = worksheet.getRow(tableHeaderRow);
    columns.forEach((col, idx) => {
      const cell = headerRow.getCell(idx + 1);
      cell.value = col.header;
      worksheet.getColumn(idx + 1).width = col.width;

      // Estilo Emerald con texto blanco
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF059669" }, // Emerald 600
      };
      cell.font = {
        color: { argb: "FFFFFFFF" },
        bold: true,
      };
      cell.alignment = { vertical: "middle", horizontal: "center" };
      cell.border = {
        top: { style: "thin" },
        left: { style: "thin" },
        bottom: { style: "thin" },
        right: { style: "thin" },
      };
    });

    // 4. Datos
    liq.items.forEach((item, idx) => {
      const row = worksheet.getRow(tableHeaderRow + 1 + idx);
      row.values = [
        item.placa,
        item.fecha_inicial.toISOString().split("T")[0],
        item.fecha_final.toISOString().split("T")[0],
        item.recorrido,
        item.tipo_servicio.replace("_", " "),
        Number(item.cantidad),
        Number(item.valor_unitario),
        Number(item.subtotal),
        Number(item.porcentaje_descuento),
        Number(item.valor_final),
        item.numero_planilla || "",
      ];

      // Formato COP y bordes
      [7, 8, 10].forEach((colIdx) => {
        row.getCell(colIdx).numFmt = '"$"#,##0;[Red]"-"$#,##0';
      });

      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      });
    });

    // 5. Totales
    const lastDataRow = tableHeaderRow + liq.items.length;
    const totalsRow = worksheet.getRow(lastDataRow + 2);
    totalsRow.getCell(1).value = "TOTALES";
    totalsRow.getCell(1).font = { bold: true };

    totalsRow.getCell(6).value = liq.items.reduce(
      (sum, i) => sum + Number(i.cantidad),
      0,
    );
    totalsRow.getCell(8).value = liq.items.reduce(
      (sum, i) => sum + Number(i.subtotal),
      0,
    );
    totalsRow.getCell(10).value = liq.items.reduce(
      (sum, i) => sum + Number(i.valor_final),
      0,
    );

    [6, 8, 10].forEach((colIdx) => {
      totalsRow.getCell(colIdx).font = { bold: true };
      if (colIdx >= 8) {
        totalsRow.getCell(colIdx).numFmt = '"$"#,##0;[Red]"-"$#,##0';
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();

    return {
      buffer,
      filename: `Liquidacion_${liq.consecutivo}.xlsx`,
    };
  },

  // ── Estadísticas ──
  async estadisticas() {
    /// Estas tres no tenían `where` ninguno: contaban hasta las borradas. Con
    /// el autoguardado eso pasa de ser un descuido a ser un número que sube
    /// solo mientras alguien teclea, así que se acota a lo confirmado y vivo.
    const where = { deleted_at: null, confirmada_at: { not: null } };
    const [total, porEstado, montoTotal] = await Promise.all([
      prisma.liquidacion_servicio.count({ where }),
      prisma.liquidacion_servicio.groupBy({
        by: ["estado"],
        where,
        _count: { id: true },
      }),
      prisma.liquidacion_servicio.aggregate({
        where,
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
        deleted_at: null,
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
        vigencia_desde: true,
        vigencia_hasta: true,
      },
      orderBy: { orden_calculo: "asc" },
    });

    return tipos.map((t) => ({
      ...t,
      porcentaje: Number(t.porcentaje),
      vigencia_desde:
        t.vigencia_desde instanceof Date ? t.vigencia_desde.toISOString() : t.vigencia_desde,
      vigencia_hasta:
        t.vigencia_hasta instanceof Date ? t.vigencia_hasta.toISOString() : t.vigencia_hasta,
    }));
  },

  // ── CONFIGURACIÓN LIQUIDADOR DE SERVICIOS ──

  async obtenerConfigLiquidador() {
    let config = await prisma.configuracion_liquidacion_servicio.findFirst({
      where: { activo: true },
    });
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
    let config = await prisma.configuracion_liquidacion_servicio.findFirst({
      where: { activo: true },
    });
    if (!config) {
      config = await prisma.configuracion_liquidacion_servicio.create({
        data: { id: randomUUID(), ...(data as any) },
      });
    } else {
      config = await prisma.configuracion_liquidacion_servicio.update({
        where: { id: config.id },
        data: {
          ...(data.salario_basico !== undefined && {
            salario_basico: data.salario_basico,
          }),
          ...(data.cargo !== undefined && { cargo: data.cargo }),
          ...(data.valor_hora_override !== undefined && {
            valor_hora_override: data.valor_hora_override,
          }),
          ...(data.conductor_adicional !== undefined && {
            conductor_adicional: data.conductor_adicional,
          }),
          ...(data.pct_seg_social !== undefined && {
            pct_seg_social: data.pct_seg_social,
          }),
          ...(data.pct_prestaciones !== undefined && {
            pct_prestaciones: data.pct_prestaciones,
          }),
          ...(data.pct_admin !== undefined && { pct_admin: data.pct_admin }),
          ...(data.prueba_covid !== undefined && {
            prueba_covid: data.prueba_covid,
          }),
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

const toDecimal = (n: number) => Number(n.toFixed(2));

async function generarConsecutivo(anio: number): Promise<string> {
  const ultima = await prisma.liquidacion_servicio.findFirst({
    where: { anio, deleted_at: null },
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
