import { prisma } from "../../config/prisma";
import { getIo } from "../../sockets";
import { sheetRoomKey } from "../../sockets/sheet-rooms";
import { recalcularTotalesCierre as recalcularTotalesCompartido } from "../liquidaciones-terceros-descuentos/totales-cierre";

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

/**
 * Fila de `liquidacion_tercero_final_adicional` enriquecida con metadata
 * del cierre final al que pertenece. Es lo que consume el canvas Univer.
 *
 * `id` es el UUID REAL de la fila. Antes era un id sintético
 * `${cierre_id}::${idx}` porque los adicionales vivían en un array JSONB
 * sin PK; eso hacía que insertar o borrar una fila desplazara la identidad
 * de todas las siguientes.
 */
export interface AdicionalListado {
  id: string;
  cierre_id: string;
  cierre_consecutivo: string | null;
  placa: string;
  tercero_id: string | null;
  tercero_nombre: string | null;
  /// Estado del CIERRE (no de la fila). El canvas lo usa para saber si la
  /// fila es editable.
  estado: string;
  cliente: string;
  recorrido: string;
  fechas: string;
  valor_unitario: number;
  cantidad: number;
  porcentaje_admin: number;
  valor_admin: number;
  valor_liquidar: number;
  aplica_impuestos: boolean;
  orden: number;
  /// Concurrencia optimista: se devuelve al cliente y vuelve en cada PATCH.
  version: number;
}

const ESTADOS_BLOQUEADOS = ["APROBADA", "FACTURADA", "ANULADA"];

/// Campos que el canvas puede editar celda a celda. Es la lista blanca del
/// servidor y espeja `EDITABLE_FIELDS` de `cell-permission-adicionales.ts`.
/// Sin ella, un PATCH podría escribir cualquier columna de la tabla.
export const CAMPOS_EDITABLES = new Set([
  "valor_unitario",
  "cantidad",
  "porcentaje_admin",
  "aplica_impuestos",
  "cliente",
  "recorrido",
  "fechas",
]);

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

function toNumber(v: any): number {
  if (v == null) return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

/**
 * Deriva `valor_admin` y `valor_liquidar`.
 *
 * Es la FUENTE DE VERDAD de esas dos columnas: el canvas las pinta con
 * fórmulas vivas (`=ROUND(F*pct/100,0)` y `=F-E`) que espejan exactamente
 * esta función. Si divergen, lo que se ve y lo que se guarda dejan de
 * coincidir.
 */
export function derivarAdicional(input: {
  valor_unitario: any;
  cantidad: any;
  porcentaje_admin: any;
}): { valor_admin: number; valor_liquidar: number } {
  const vUnit = toNumber(input.valor_unitario);
  const cant = toNumber(input.cantidad) || 1;
  const pctAdmin = toNumber(input.porcentaje_admin);
  const bruto = vUnit * cant;
  const vAdmin = Math.round((bruto * pctAdmin) / 100);
  return { valor_admin: vAdmin, valor_liquidar: bruto - vAdmin };
}

function mapFila(fila: any, cierre: any): AdicionalListado {
  return {
    id: fila.id,
    cierre_id: cierre.id,
    cierre_consecutivo: cierre.consecutivo,
    placa: fila.placa || cierre.placa,
    tercero_id: fila.tercero_id ?? cierre.tercero_id,
    tercero_nombre: fila.tercero_nombre ?? cierre.tercero?.nombre_completo ?? null,
    estado: cierre.estado,
    cliente: fila.cliente || "",
    recorrido: fila.recorrido || "",
    fechas: fila.fechas || "",
    valor_unitario: toNumber(fila.valor_unitario),
    cantidad: toNumber(fila.cantidad),
    porcentaje_admin: toNumber(fila.porcentaje_admin),
    valor_admin: toNumber(fila.valor_admin),
    valor_liquidar: toNumber(fila.valor_liquidar),
    aplica_impuestos: fila.aplica_impuestos !== false,
    orden: fila.orden ?? 0,
    version: fila.version ?? 1,
  };
}

const SELECT_CIERRE = {
  id: true,
  consecutivo: true,
  placa: true,
  tercero_id: true,
  estado: true,
  mes: true,
  anio: true,
  total_descuentos: true,
  tercero: { select: { nombre_completo: true } },
  adicionales_filas: {
    where: { deleted_at: null },
    orderBy: [{ orden: "asc" as const }, { created_at: "asc" as const }],
  },
};

/**
 * Recalcula y persiste los totales del cierre.
 *
 * Delega en `totales-cierre.ts`, la fuente única de verdad, en vez de tener
 * su propia versión: este service sumaba los adicionales de la TABLA
 * mientras `recalcularTotales` del módulo de descuentos los sumaba del
 * JSONB, así que `valor_liquidar` acababa dependiendo de cuál de los dos
 * caminos se hubiera ejecutado de último.
 */
async function recalcularTotalesCierre(tx: any, cierreId: string): Promise<void> {
  await recalcularTotalesCompartido(tx, cierreId);
}

/** Lanza si el cierre no existe o su estado no admite ediciones. */
async function assertCierreEditable(
  tx: any,
  cierreId: string,
): Promise<{ id: string; mes: number; anio: number; estado: string }> {
  const cierre = await tx.liquidacion_tercero_final.findFirst({
    where: { id: cierreId, deleted_at: null },
    select: { id: true, mes: true, anio: true, estado: true },
  });
  if (!cierre) throw new Error(`Cierre ${cierreId} no encontrado`);
  if (ESTADOS_BLOQUEADOS.includes(cierre.estado)) {
    throw new Error(
      `No se pueden modificar los adicionales de un cierre en estado ${cierre.estado}`,
    );
  }
  return cierre;
}

/** Error de concurrencia optimista, para que el controller devuelva 409. */
export class ConflictoVersionError extends Error {
  readonly code = "VERSION_CONFLICT";
  constructor(
    readonly entityId: string,
    readonly serverRow: AdicionalListado | null,
  ) {
    super("La fila fue modificada por otro usuario");
  }
}

/**
 * Avisa a los clientes de que un mes cambió de forma que NO se puede aplicar
 * como patch de celda: filas creadas o borradas, o un guardado en lote.
 *
 * Esos cambios alteran la geometría de la hoja, así que el receptor tiene que
 * releer el mes y reconstruirlo. Los cambios de UN valor viajan por otro
 * camino (`sheet:patch:applied` desde el gateway), que sí se pinta sin
 * remontar.
 *
 * El room es el del gateway de hojas (`sheet:${scope}:${anio}`). Antes se
 * emitía a `row:liquidacion-tercero-adicionales:{mes}-{anio}`, un room al que
 * ya nadie se une.
 */
function emitirCambio(
  mes: number,
  anio: number,
  cierresIds: string[],
  userId: string | undefined,
  detalle: Record<string, any>,
): void {
  try {
    const io = getIo();
    const updatedAt = new Date().toISOString();
    io.to(sheetRoomKey("adicionales", anio)).emit("sheet:invalidate", {
      scope: "adicionales",
      mes,
      anio,
      updatedBy: userId,
      updatedAt,
      ...detalle,
    });
    for (const cierreId of cierresIds) {
      io.emit("row:updated:global", {
        id: cierreId,
        changes: { adicionales: true },
        updatedById: userId,
        updatedAt,
      });
    }
  } catch (e) {
    console.warn("[adicionales-service] socket emit failed:", e);
  }
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════

export class LiquidacionesTercerosAdicionalesService {
  /**
   * Todos los adicionales de los cierres finales de un mes/año.
   *
   * Orden estable: cierres por `consecutivo ASC` y, dentro de cada cierre,
   * por `orden ASC` con desempate por `created_at`.
   */
  static async obtenerAdicionalesPorPeriodo(
    mes: number,
    anio: number,
  ): Promise<AdicionalListado[]> {
    const cierres = await prisma.liquidacion_tercero_final.findMany({
      where: { mes, anio, deleted_at: null },
      orderBy: { consecutivo: "asc" },
      select: SELECT_CIERRE,
    });

    const out: AdicionalListado[] = [];
    for (const c of cierres) {
      for (const fila of c.adicionales_filas) {
        out.push(mapFila(fila, c));
      }
    }
    return out;
  }

  /**
   * Los 12 meses de un año en UNA sola consulta.
   *
   * Sustituye el fan-out de 12 peticiones que hacía el canvas. Devuelve
   * SIEMPRE las 12 claves, aunque el mes no tenga cierres: el libro anual
   * necesita las 12 hojas para que el deep-link `?mes=` sea estable.
   */
  static async obtenerAdicionalesAnual(
    anio: number,
  ): Promise<Record<number, AdicionalListado[]>> {
    const cierres = await prisma.liquidacion_tercero_final.findMany({
      where: { anio, deleted_at: null },
      orderBy: [{ mes: "asc" }, { consecutivo: "asc" }],
      select: SELECT_CIERRE,
    });

    const meses: Record<number, AdicionalListado[]> = {};
    for (let m = 1; m <= 12; m++) meses[m] = [];

    for (const c of cierres) {
      const bucket = meses[c.mes];
      if (!bucket) continue;
      for (const fila of c.adicionales_filas) {
        bucket.push(mapFila(fila, c));
      }
    }
    return meses;
  }

  /** Crea una fila nueva al final del cierre. */
  static async crearAdicional(params: {
    cierre_id: string;
    user_id?: string;
    datos?: Record<string, any>;
  }): Promise<AdicionalListado> {
    const { cierre_id, user_id, datos = {} } = params;

    const { fila, cierre } = await prisma.$transaction(async (tx) => {
      const cierre = await assertCierreEditable(tx, cierre_id);

      const ultimo = await tx.liquidacion_tercero_final_adicional.findFirst({
        where: { liquidacion_tercero_final_id: cierre_id, deleted_at: null },
        orderBy: { orden: "desc" },
        select: { orden: true },
      });

      const base = {
        valor_unitario: toNumber(datos.valor_unitario),
        cantidad: toNumber(datos.cantidad) || 1,
        porcentaje_admin: toNumber(datos.porcentaje_admin),
      };
      const derivado = derivarAdicional(base);

      const creada = await tx.liquidacion_tercero_final_adicional.create({
        data: {
          liquidacion_tercero_final_id: cierre_id,
          orden: (ultimo?.orden ?? -1) + 1,
          cliente: String(datos.cliente || "TRANSMERALDA"),
          placa: String(datos.placa || ""),
          tercero_id: datos.tercero_id || null,
          tercero_nombre: datos.tercero_nombre || null,
          vehiculo_id: datos.vehiculo_id || null,
          recorrido: datos.recorrido || null,
          fechas: datos.fechas || null,
          ...base,
          ...derivado,
          aplica_impuestos: datos.aplica_impuestos !== false,
          creado_por_id: user_id || null,
          actualizado_por_id: user_id || null,
        },
      });

      await recalcularTotalesCierre(tx, cierre_id);
      return { fila: creada, cierre };
    });

    const cierreFull = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: cierre_id },
      select: SELECT_CIERRE,
    });
    if (!cierreFull) throw new Error(`Cierre ${cierre_id} no encontrado`);

    emitirCambio(cierre.mes, cierre.anio, [cierre_id], user_id, {
      accion: "created",
      adicional_id: fila.id,
    });

    return mapFila(fila, cierreFull);
  }

  /**
   * Actualiza UN campo de UNA fila con concurrencia optimista.
   *
   * Este es el camino que usa la edición por celda del canvas. El UPDATE
   * exige `version = base_version`; si no afecta filas, otro usuario
   * escribió antes y se lanza `ConflictoVersionError` con el valor actual
   * del servidor para que el cliente decida.
   */
  static async actualizarCampo(params: {
    id: string;
    field: string;
    value: any;
    base_version: number;
    user_id?: string;
  }): Promise<AdicionalListado> {
    const { id, field, value, base_version, user_id } = params;

    if (!CAMPOS_EDITABLES.has(field)) {
      throw new Error(`Campo no editable: ${field}`);
    }

    const cierreId = await prisma.$transaction(async (tx) => {
      const actual = await tx.liquidacion_tercero_final_adicional.findFirst({
        where: { id, deleted_at: null },
        select: {
          id: true,
          liquidacion_tercero_final_id: true,
          version: true,
          valor_unitario: true,
          cantidad: true,
          porcentaje_admin: true,
        },
      });
      if (!actual) throw new Error(`Adicional ${id} no encontrado`);

      await assertCierreEditable(tx, actual.liquidacion_tercero_final_id);

      // Valores post-edición, para derivar admin/liquidar en el servidor.
      const siguiente = {
        valor_unitario: field === "valor_unitario" ? value : actual.valor_unitario,
        cantidad: field === "cantidad" ? value : actual.cantidad,
        porcentaje_admin:
          field === "porcentaje_admin" ? value : actual.porcentaje_admin,
      };
      const derivado = derivarAdicional(siguiente);

      const data: Record<string, any> =
        field === "aplica_impuestos"
          ? { aplica_impuestos: value !== false }
          : ["cliente", "recorrido", "fechas"].includes(field)
            ? { [field]: value == null ? null : String(value) }
            : { [field]: toNumber(value), ...derivado };

      // Concurrencia optimista: el `version` del WHERE es lo que convierte
      // esto en un compare-and-swap.
      const afectadas = await tx.liquidacion_tercero_final_adicional.updateMany({
        where: { id, version: base_version, deleted_at: null },
        data: {
          ...data,
          version: { increment: 1 },
          actualizado_por_id: user_id || null,
          updated_at: new Date(),
        },
      });

      if (afectadas.count === 0) {
        // Devolver el valor ACTUAL del servidor, no solo "hubo conflicto":
        // el cliente necesita con qué repintar la celda. Es una lectura, así
        // que el rollback del throw no pierde nada.
        const cierreFull = await tx.liquidacion_tercero_final.findUnique({
          where: { id: actual.liquidacion_tercero_final_id },
          select: SELECT_CIERRE,
        });
        const filaServidor = cierreFull?.adicionales_filas.find(
          (f: any) => f.id === id,
        );
        throw new ConflictoVersionError(
          id,
          filaServidor ? mapFila(filaServidor, cierreFull) : null,
        );
      }

      await recalcularTotalesCierre(tx, actual.liquidacion_tercero_final_id);
      return actual.liquidacion_tercero_final_id;
    });

    const cierreFull = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: cierreId },
      select: SELECT_CIERRE,
    });
    const fila = cierreFull?.adicionales_filas.find((f: any) => f.id === id);
    if (!cierreFull || !fila) {
      throw new Error(`Adicional ${id} no encontrado tras actualizar`);
    }

    emitirCambio(cierreFull.mes, cierreFull.anio, [cierreId], user_id, {
      accion: "updated",
      adicional_id: id,
      field,
    });

    return mapFila(fila, cierreFull);
  }

  /** Soft-delete de una fila. */
  static async eliminarAdicional(params: {
    id: string;
    user_id?: string;
  }): Promise<{ ok: true }> {
    const { id, user_id } = params;

    const cierreId = await prisma.$transaction(async (tx) => {
      const actual = await tx.liquidacion_tercero_final_adicional.findFirst({
        where: { id, deleted_at: null },
        select: { liquidacion_tercero_final_id: true },
      });
      if (!actual) throw new Error(`Adicional ${id} no encontrado`);

      await assertCierreEditable(tx, actual.liquidacion_tercero_final_id);

      await tx.liquidacion_tercero_final_adicional.update({
        where: { id },
        data: {
          deleted_at: new Date(),
          actualizado_por_id: user_id || null,
          version: { increment: 1 },
        },
      });

      await recalcularTotalesCierre(tx, actual.liquidacion_tercero_final_id);
      return actual.liquidacion_tercero_final_id;
    });

    const cierre = await prisma.liquidacion_tercero_final.findUnique({
      where: { id: cierreId },
      select: { mes: true, anio: true },
    });
    emitirCambio(cierre!.mes, cierre!.anio, [cierreId], user_id, {
      accion: "deleted",
      adicional_id: id,
    });

    return { ok: true };
  }

  /**
   * Guardado en lote de un periodo. DEPRECADO.
   *
   * Se conserva un ciclo para no romper clientes viejos, pero el canvas ya
   * usa POST/PATCH/DELETE por fila. A diferencia de la versión anterior,
   * este upsert NO borra las filas ausentes del payload: hacerlo era
   * precisamente lo que provocaba que dos usuarios editando el mismo cierre
   * se pisaran el trabajo.
   */
  static async guardarAdicionalesPorPeriodo(params: {
    mes: number;
    anio: number;
    items: AdicionalListado[];
    user_id?: string;
  }): Promise<{ ok: boolean; actualizados: number; cierres: number }> {
    const { mes, anio, items, user_id } = params;
    if (!Array.isArray(items)) throw new Error("`items` debe ser un array");

    const byCierre = new Map<string, AdicionalListado[]>();
    for (const it of items) {
      if (!it?.cierre_id || !it?.id) continue;
      const arr = byCierre.get(it.cierre_id) || [];
      arr.push(it);
      byCierre.set(it.cierre_id, arr);
    }
    if (byCierre.size === 0) return { ok: true, actualizados: 0, cierres: 0 };

    let actualizados = 0;

    await prisma.$transaction(async (tx) => {
      for (const [cierreId, filas] of byCierre.entries()) {
        // Valida que los cierres del payload sean realmente del periodo del
        // body. Antes no se comprobaba: un cliente podía mandar `mes/anio` de
        // agosto y `cierre_id` de marzo, y se escribía igual.
        const cierre = await assertCierreEditable(tx, cierreId);
        if (cierre.mes !== mes || cierre.anio !== anio) {
          throw new Error(
            `El cierre ${cierreId} pertenece a ${cierre.mes}/${cierre.anio}, no a ${mes}/${anio}`,
          );
        }

        for (const fila of filas) {
          const derivado = derivarAdicional(fila);
          const res = await tx.liquidacion_tercero_final_adicional.updateMany({
            where: {
              id: fila.id,
              liquidacion_tercero_final_id: cierreId,
              deleted_at: null,
            },
            data: {
              valor_unitario: toNumber(fila.valor_unitario),
              cantidad: toNumber(fila.cantidad) || 1,
              porcentaje_admin: toNumber(fila.porcentaje_admin),
              ...derivado,
              aplica_impuestos: fila.aplica_impuestos !== false,
              cliente: String(fila.cliente || "TRANSMERALDA"),
              recorrido: fila.recorrido || null,
              fechas: fila.fechas || null,
              version: { increment: 1 },
              actualizado_por_id: user_id || null,
              updated_at: new Date(),
            },
          });
          actualizados += res.count;
        }

        await recalcularTotalesCierre(tx, cierreId);
      }
    });

    emitirCambio(mes, anio, Array.from(byCierre.keys()), user_id, {
      accion: "batch",
      actualizados,
      cierres: byCierre.size,
    });

    return { ok: true, actualizados, cierres: byCierre.size };
  }
}
