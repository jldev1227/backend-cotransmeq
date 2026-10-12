/**
 * Ciclo de vida del ESTADO de un cierre final.
 *
 * Existía disperso: la matriz de transiciones vivía dentro de
 * `cambiarEstado`, el guard de administración en el controller, y el
 * cambio no dejaba rastro salvo un snapshot JSONB ni avisaba a nadie.
 *
 * Tres cosas que aquí cambian respecto a ese comportamiento:
 *
 * 1. **El guard es de ENTRADA, no de salida.** Antes solo se comprobaba
 *    que fueras administración para *sacar* un cierre de APROBADA; entrar
 *    en APROBADA o PAGADA lo podía hacer cualquiera. Es decir, el
 *    permiso de aprobación no existía.
 *
 * 2. **Concurrencia optimista.** El header del canvas muestra el estado de
 *    la hoja activa a N usuarios a la vez. Sin CAS, dos clics simultáneos
 *    en "Aprobar" y "Anular" se resuelven por orden de llegada y el
 *    segundo pisa al primero sin enterarse.
 *
 * 3. **Historial en tabla.** `historial_estado_liquidacion` no sirve: su
 *    FK apunta a `liquidacion_servicio`, no al cierre final.
 */

import { prisma } from "../../config/prisma";
import { emitSheetEstadoChanged } from "../../sockets/sheet.gateway";
import { LiquidacionesTercerosPagosService } from "../liquidaciones-terceros-pagos/liquidaciones-terceros-pagos.service";
import { validarPagoCierre, type DatosPagoCierre } from "../liquidaciones-terceros-pagos/pago-cierre";

/**
 * PAGADA reemplaza a FACTURADA (oct-2026). Con terceros quien factura es el
 * propietario; la empresa le PAGA. «Marcar facturada» se usaba ya con el
 * sentido de «ya se le pagó» (ver `dashboard/seccion-facturacion.ts`), así
 * que el nombre mentía. Mismo trato que el PAGADA de nómina.
 *
 * FACTURADA sigue en el tipo SOLO como estado heredado: una fila que no se
 * haya migrado se sigue leyendo, queda bloqueada y se puede anular, pero ya
 * no es destino de ninguna transición.
 */
export type EstadoCierre =
  | "BORRADOR"
  | "LIQUIDADA"
  | "APROBADA"
  | "PAGADA"
  | "FACTURADA"
  | "ANULADA"
  | "REEMPLAZADA";

/** Destinos que se pueden FIJAR. FACTURADA ya no está: ver arriba. */
export const ESTADOS_VALIDOS: EstadoCierre[] = [
  "BORRADOR",
  "LIQUIDADA",
  "APROBADA",
  "PAGADA",
  "ANULADA",
];

/**
 * Matriz de transiciones. Idéntica a la que tenía `cambiarEstado` en
 * línea; se extrae para que el header del canvas pueda pedirla y pintar
 * solo los botones válidos.
 */
export const TRANSICIONES: Record<string, EstadoCierre[]> = {
  BORRADOR: ["LIQUIDADA", "ANULADA"],
  LIQUIDADA: ["APROBADA", "BORRADOR", "ANULADA"],
  APROBADA: ["LIQUIDADA", "ANULADA", "PAGADA"],
  PAGADA: ["ANULADA"],
  /// Heredado: solo se puede anular. Las filas se migran a PAGADA.
  FACTURADA: ["ANULADA"],
  ANULADA: [],
  REEMPLAZADA: ["BORRADOR"],
};

/**
 * Estados a los que solo puede llevar administración.
 *
 * APROBADA y PAGADA son los que congelan el documento de cara a
 * contabilidad; que los pudiera fijar cualquiera vaciaba de sentido la
 * cadena de aprobación.
 */
export const ESTADOS_QUE_EXIGEN_ADMIN: EstadoCierre[] = ["APROBADA", "PAGADA"];

/**
 * Puerta de atrás de Administración, igual que en nómina: PAGADA no tenía
 * vuelta —su única salida era ANULADA— y una hoja se marca pagada por error
 * como cualquier otra cosa. Va aparte de `TRANSICIONES` para que la matriz
 * base siga describiendo el flujo NORMAL.
 */
export const TRANSICIONES_ADMIN: Record<string, EstadoCierre[]> = {
  PAGADA: ["APROBADA"],
};

/** Salir de estos estados también es de Administración. */
export const ESTADOS_SALIDA_ADMIN: string[] = ["APROBADA", "PAGADA", "FACTURADA"];

/** Destinos que existen desde `estadoActual`, con o sin la puerta de atrás. */
export function destinosPosibles(estadoActual: string, admin: boolean): EstadoCierre[] {
  const base = TRANSICIONES[estadoActual] ?? [];
  if (!admin) return base;
  const extra = (TRANSICIONES_ADMIN[estadoActual] ?? []).filter((e) => !base.includes(e));
  return [...base, ...extra];
}

/** Estados en los que el canvas deja la hoja en solo lectura. */
export const ESTADOS_BLOQUEADOS: string[] = [
  "APROBADA",
  "PAGADA",
  "FACTURADA",
  "ANULADA",
  "REEMPLAZADA",
];

export interface Actor {
  id: string | null;
  name?: string | null;
  areas?: string[] | string | null;
}

export class ErrorEstado extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code:
      | "ESTADO_INVALIDO"
      | "TRANSICION_INVALIDA"
      | "SIN_PERMISO"
      | "VERSION_CONFLICT"
      | "NO_ENCONTRADO"
      | "FALTA_MOTIVO"
      | "FALTA_PAGO",
    readonly detalle?: Record<string, any>,
  ) {
    super(message);
  }
}

export function esAdmin(actor: Actor | null | undefined): boolean {
  const raw = actor?.areas;
  const areas = !raw ? [] : Array.isArray(raw) ? raw : [raw];
  return areas.some((a) => String(a).toUpperCase() === "ADMINISTRACION");
}

/**
 * Transiciones que este actor puede ejecutar desde `estadoActual`.
 *
 * Refleja los DOS guards que aplica `cambiar()`: el de entrada a
 * APROBADA/PAGADA y el de salida de APROBADA/PAGADA. Si no reflejara ambos,
 * la lista diría que se puede hacer algo que luego el servidor rechaza.
 *
 * Espejo de `ingreso-svelte/src/lib/editor/builders/cierres-finales-estado.ts`.
 */
export function transicionesPermitidas(
  estadoActual: string,
  actor: Actor | null | undefined,
): EstadoCierre[] {
  const admin = esAdmin(actor);
  if (ESTADOS_SALIDA_ADMIN.includes(estadoActual) && !admin) return [];
  const posibles = destinosPosibles(estadoActual, admin);
  return admin ? posibles : posibles.filter((e) => !ESTADOS_QUE_EXIGEN_ADMIN.includes(e));
}

export interface ResultadoCambioEstado {
  id: string;
  estado: EstadoCierre;
  estado_anterior: string;
  version: number;
  anio: number;
  mes: number;
  placa: string | null;
  motivo_anulacion: string | null;
}

export const CierreEstadoService = {
  /**
   * Cambia el estado de UN cierre.
   *
   * `base_version` es opcional para no romper a los clientes antiguos
   * (el editor tabular no la manda). Cuando llega, el UPDATE la usa como
   * compare-and-swap y un `count === 0` significa que otro usuario cambió
   * el estado mientras tanto.
   */
  async cambiar(params: {
    id: string;
    estado: string;
    motivo?: string | null;
    base_version?: number | null;
    actor: Actor;
    /**
     * Fecha, medio, referencia y comprobante del pago. Obligatorio al pasar a
     * PAGADA (fecha y medio): el estado solo decía «se pagó», sin cuándo ni
     * cómo, y contabilidad tenía que reconstruirlo del extracto del banco.
     */
    pago?: unknown;
  }): Promise<ResultadoCambioEstado> {
    const { id, estado, motivo, base_version, actor } = params;

    if (!ESTADOS_VALIDOS.includes(estado as EstadoCierre)) {
      throw new ErrorEstado(
        `Estado inválido: ${estado}. Válidos: ${ESTADOS_VALIDOS.join(", ")}`,
        400,
        "ESTADO_INVALIDO",
      );
    }

    const actual = await prisma.liquidacion_tercero_final.findFirst({
      where: { id, deleted_at: null },
      select: {
        id: true,
        estado: true,
        version: true,
        anio: true,
        mes: true,
        placa: true,
        total_pagar: true,
      },
    });
    if (!actual) {
      throw new ErrorEstado(
        "Liquidación final de tercero no encontrada",
        404,
        "NO_ENCONTRADO",
      );
    }

    const estadoActual = actual.estado || "BORRADOR";
    const destinos = destinosPosibles(estadoActual, esAdmin(actor));

    if (!destinos.includes(estado as EstadoCierre)) {
      throw new ErrorEstado(
        `Transición no válida de ${estadoActual} a ${estado}. Permitidas: ${
          destinos.join(", ") || "ninguna"
        }`,
        409,
        "TRANSICION_INVALIDA",
        { estado_actual: estadoActual },
      );
    }

    // Guard de ENTRADA.
    if (
      ESTADOS_QUE_EXIGEN_ADMIN.includes(estado as EstadoCierre) &&
      !esAdmin(actor)
    ) {
      throw new ErrorEstado(
        `Solo Administración puede pasar una liquidación a ${estado}.`,
        403,
        "SIN_PERMISO",
      );
    }

    // Guard de SALIDA: sacar algo de APROBADA o PAGADA es de administración.
    if (ESTADOS_SALIDA_ADMIN.includes(estadoActual) && !esAdmin(actor)) {
      throw new ErrorEstado(
        `La liquidación está ${estadoActual}. Solo Administración puede modificar su estado.`,
        403,
        "SIN_PERMISO",
      );
    }

    if (estado === "ANULADA" && !motivo) {
      throw new ErrorEstado(
        "Se requiere motivo para anular",
        400,
        "FALTA_MOTIVO",
      );
    }

    let pago: DatosPagoCierre | null = null;
    if (estado === "PAGADA") {
      const v = validarPagoCierre(params.pago);
      if (!v.pago) throw new ErrorEstado(v.motivo ?? "Faltan los datos del pago", 400, "FALTA_PAGO");
      pago = v.pago;
    }

    const resultado = await prisma.$transaction(async (tx) => {
      const gano = await tx.liquidacion_tercero_final.updateMany({
        where: {
          id,
          deleted_at: null,
          estado: estadoActual,
          ...(base_version != null ? { version: base_version } : {}),
        },
        data: {
          estado,
          motivo_anulacion: estado === "ANULADA" ? motivo ?? null : null,
          actualizado_por_id: actor.id || null,
          version: { increment: 1 },
        },
      });

      if (gano.count === 0) {
        const server = await tx.liquidacion_tercero_final.findUnique({
          where: { id },
          select: { estado: true, version: true },
        });
        throw new ErrorEstado(
          "Otro usuario cambió el estado mientras tanto",
          409,
          "VERSION_CONFLICT",
          { estado_servidor: server?.estado, version_servidor: server?.version },
        );
      }

      await tx.historial_estado_liquidacion_tercero_final.create({
        data: {
          liquidacion_tercero_final_id: id,
          estado_anterior: estadoActual,
          estado_nuevo: estado,
          usuario_id: actor.id || null,
          motivo: motivo ?? null,
        },
      });

      /// El pago va en la MISMA transacción que el estado: un cierre PAGADA
      /// sin su fila de pago (o al revés) sería justo el hueco que esto cierra.
      if (pago) {
        await LiquidacionesTercerosPagosService.registrarEnTx(
          tx,
          id,
          pago,
          actor.id || null,
          actual.total_pagar,
        );
      } else if (estadoActual === "PAGADA" && estado === "APROBADA") {
        /// Puerta de atrás de Administración: se marcó pagada por error. El
        /// pago se archiva, no se borra, para que quede qué se había anotado.
        /// A ANULADA no se archiva: anular no deshace un pago que sí salió.
        await LiquidacionesTercerosPagosService.archivarEnTx(
          tx,
          id,
          actor.id || null,
          motivo ? `Devuelta a APROBADA: ${motivo}` : "Devuelta a APROBADA",
        );
      }

      const fresco = await tx.liquidacion_tercero_final.findUnique({
        where: { id },
        select: { version: true, motivo_anulacion: true },
      });

      return {
        id,
        estado: estado as EstadoCierre,
        estado_anterior: estadoActual,
        version: fresco?.version ?? (base_version ?? 0) + 1,
        anio: actual.anio,
        mes: actual.mes,
        placa: actual.placa,
        motivo_anulacion: fresco?.motivo_anulacion ?? null,
      };
    });

    // El socket va FUERA de la transacción: emitir dentro anunciaría un
    // cambio que todavía podría hacer rollback.
    emitSheetEstadoChanged({
      anio: resultado.anio,
      mes: resultado.mes,
      cierreId: id,
      estado: resultado.estado,
      version: resultado.version,
      by: { id: actor.id || "sistema", name: actor.name || "Sistema" },
    });

    return resultado;
  },

  /**
   * Cambia el estado de TODOS los cierres de un periodo que estén en
   * `desde`. Es la acción de lote del header: con 80 hojas, liquidarlas
   * una a una a mano no es viable.
   *
   * Deliberadamente NO es una transacción única. Con 80 cierres, un fallo
   * en el último revertiría los 79 anteriores y el usuario no sabría
   * cuál falló. Se procesan de uno en uno y se devuelve el parte de
   * resultados.
   *
   * Con `ids` se mueven SOLO esas hojas (las que el usuario marcó en el
   * canvas), cada una desde su estado actual: `desde` deja de hacer falta
   * y cada transición la valida `cambiar`, igual que el botón de una hoja.
   * Las que no pueden ir a `hacia` salen en `fallidos` con el motivo.
   */
  async cambiarLote(params: {
    anio: number;
    mes: number;
    desde?: string | null;
    ids?: string[] | null;
    hacia: string;
    motivo?: string | null;
    actor: Actor;
    /** Mismo pago para todas las hojas (una transferencia que paga el lote). */
    pago?: unknown;
  }): Promise<{
    total: number;
    cambiados: ResultadoCambioEstado[];
    fallidos: { id: string; placa: string | null; error: string }[];
  }> {
    const { anio, mes, desde, hacia, motivo, actor } = params;
    const ids = (params.ids ?? []).filter(Boolean);

    if (!ESTADOS_VALIDOS.includes(hacia as EstadoCierre)) {
      throw new ErrorEstado(`Estado destino no válido: ${hacia}`, 400, "ESTADO_INVALIDO");
    }
    if (!ids.length && !desde) {
      throw new ErrorEstado("Indica las hojas (ids) o el estado de origen (desde).", 400, "ESTADO_INVALIDO");
    }
    if (desde && !destinosPosibles(desde, esAdmin(actor)).includes(hacia as EstadoCierre)) {
      throw new ErrorEstado(
        `Transición no válida de ${desde} a ${hacia}`,
        409,
        "TRANSICION_INVALIDA",
      );
    }
    if (
      ESTADOS_QUE_EXIGEN_ADMIN.includes(hacia as EstadoCierre) &&
      !esAdmin(actor)
    ) {
      throw new ErrorEstado(
        `Solo Administración puede pasar liquidaciones a ${hacia}.`,
        403,
        "SIN_PERMISO",
      );
    }
    /// Antes de tocar ninguna hoja: sin esto, un lote a PAGADA sin datos
    /// devolvía 80 fallidos con el mismo motivo en vez de un solo error.
    if (hacia === "PAGADA") {
      const v = validarPagoCierre(params.pago);
      if (!v.pago) throw new ErrorEstado(v.motivo ?? "Faltan los datos del pago", 400, "FALTA_PAGO");
    }

    const candidatos = await prisma.liquidacion_tercero_final.findMany({
      where: {
        anio,
        mes,
        deleted_at: null,
        ...(ids.length ? { id: { in: ids } } : {}),
        ...(desde ? { estado: desde } : {}),
      },
      select: { id: true, placa: true, version: true },
      orderBy: [{ placa: "asc" }, { consecutivo: "asc" }],
    });

    const cambiados: ResultadoCambioEstado[] = [];
    const fallidos: { id: string; placa: string | null; error: string }[] = [];

    for (const c of candidatos) {
      try {
        cambiados.push(
          await this.cambiar({
            id: c.id,
            estado: hacia,
            motivo,
            base_version: c.version,
            actor,
            pago: params.pago,
          }),
        );
      } catch (e: any) {
        fallidos.push({
          id: c.id,
          placa: c.placa,
          error: e?.message || "Error desconocido",
        });
      }
    }

    return { total: candidatos.length, cambiados, fallidos };
  },

  /** Historial de estados de un cierre, para el panel del header. */
  async historial(cierreId: string) {
    const filas = await prisma.historial_estado_liquidacion_tercero_final.findMany({
      where: { liquidacion_tercero_final_id: cierreId },
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        estado_anterior: true,
        estado_nuevo: true,
        motivo: true,
        created_at: true,
        usuario: { select: { id: true, nombre: true, correo: true } },
      },
    });

    return filas.map((f) => ({
      id: f.id,
      estado_anterior: f.estado_anterior,
      estado_nuevo: f.estado_nuevo,
      motivo: f.motivo,
      fecha: f.created_at,
      usuario: f.usuario
        ? { id: f.usuario.id, nombre: f.usuario.nombre, correo: f.usuario.correo }
        : null,
    }));
  },
};
