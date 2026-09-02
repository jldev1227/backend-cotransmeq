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
 *    en APROBADA o FACTURADA lo podía hacer cualquiera. Es decir, el
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

export type EstadoCierre =
  | "BORRADOR"
  | "LIQUIDADA"
  | "APROBADA"
  | "FACTURADA"
  | "ANULADA"
  | "REEMPLAZADA";

export const ESTADOS_VALIDOS: EstadoCierre[] = [
  "BORRADOR",
  "LIQUIDADA",
  "APROBADA",
  "FACTURADA",
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
  APROBADA: ["LIQUIDADA", "ANULADA", "FACTURADA"],
  FACTURADA: ["ANULADA"],
  ANULADA: [],
  REEMPLAZADA: ["BORRADOR"],
};

/**
 * Estados a los que solo puede llevar administración.
 *
 * APROBADA y FACTURADA son los que congelan el documento de cara a
 * contabilidad; que los pudiera fijar cualquiera vaciaba de sentido la
 * cadena de aprobación.
 */
export const ESTADOS_QUE_EXIGEN_ADMIN: EstadoCierre[] = ["APROBADA", "FACTURADA"];

/** Estados en los que el canvas deja la hoja en solo lectura. */
export const ESTADOS_BLOQUEADOS: string[] = [
  "APROBADA",
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
      | "FALTA_MOTIVO",
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
 * APROBADA/FACTURADA y el de salida de APROBADA. Si no reflejara ambos,
 * la lista diría que se puede hacer algo que luego el servidor rechaza.
 *
 * Espejo de `ingreso-svelte/src/lib/editor/builders/cierres-finales-estado.ts`.
 */
export function transicionesPermitidas(
  estadoActual: string,
  actor: Actor | null | undefined,
): EstadoCierre[] {
  const admin = esAdmin(actor);
  if (estadoActual === "APROBADA" && !admin) return [];
  const posibles = TRANSICIONES[estadoActual] ?? [];
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

    if (!(TRANSICIONES[estadoActual] ?? []).includes(estado as EstadoCierre)) {
      throw new ErrorEstado(
        `Transición no válida de ${estadoActual} a ${estado}. Permitidas: ${
          TRANSICIONES[estadoActual]?.join(", ") || "ninguna"
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

    // Guard de SALIDA: sacar algo de APROBADA sigue siendo de administración.
    if (estadoActual === "APROBADA" && !esAdmin(actor)) {
      throw new ErrorEstado(
        "La liquidación está aprobada. Solo Administración puede modificar su estado.",
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
   */
  async cambiarLote(params: {
    anio: number;
    mes: number;
    desde: string;
    hacia: string;
    motivo?: string | null;
    actor: Actor;
  }): Promise<{
    total: number;
    cambiados: ResultadoCambioEstado[];
    fallidos: { id: string; placa: string | null; error: string }[];
  }> {
    const { anio, mes, desde, hacia, motivo, actor } = params;

    if (!(TRANSICIONES[desde] ?? []).includes(hacia as EstadoCierre)) {
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

    const candidatos = await prisma.liquidacion_tercero_final.findMany({
      where: { anio, mes, estado: desde, deleted_at: null },
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
