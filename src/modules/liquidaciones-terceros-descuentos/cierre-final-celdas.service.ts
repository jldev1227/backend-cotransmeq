/**
 * Edición por CELDA de un cierre final, con concurrencia optimista.
 *
 * Es el camino que usa el canvas colaborativo. A diferencia del de
 * adicionales, aquí un solo cambio CASCADEA:
 *
 *   editar `dias` de SALARIO
 *     → cambia `valor_total` del salario
 *     → cambian las bases de prestaciones y seguridad social de ese conductor
 *     → cambian sus `valor_total`
 *     → cambia el nº de días de DOTACION y EXAMEN_MEDICO
 *     → cambia GASTOS_DIVERSOS (depende del facturado, no de los días)
 *     → cambian los impuestos (dependen del valor a liquidar)
 *     → cambian los totales del cierre
 *
 * Por eso el ACK devuelve `rows` en PLURAL y los `totales`: el cliente
 * repinta todas las filas afectadas de una vez. Mandar solo la fila editada
 * dejaría el resto de la hoja mostrando números viejos hasta el próximo
 * refresco.
 */

import { prisma } from "../../config/prisma";
import { numeroDeCelda } from "../../utils/numero-de-celda";
import {
  BLOQUE_CONDUCTOR_MANUAL,
  CAMPOS_EDITABLES_CONCEPTO,
  GASTOS_POR_DEFECTO,
  ORDEN_BASE_ANTICIPO,
  ORDEN_BASE_GASTO,
  ORDEN_BASE_GASTO_NO_CANONICO,
  ORDEN_GASTOS_CANONICO,
  aplicarCampo,
  claveConductor,
  normalizarOverridesPropietario,
  recalcularBasesPrestacionesSS,
  recalcularGastosAutomaticos,
  type ConceptoLike,
} from "./reglas-conceptos";
import {
  recalcularTotalesCierre,
  type TotalesCierre,
} from "./totales-cierre";

const ESTADOS_BLOQUEADOS = ["APROBADA", "FACTURADA", "ANULADA", "REEMPLAZADA"];

export interface FilaConcepto {
  id: string;
  tipo: string;
  concepto: string;
  conductor_id: string | null;
  propietario_id: string | null;
  dias: number | null;
  valor_unitario: number;
  porcentaje: number | null;
  valor_total: number;
  base_calculo: number | null;
  calculado: boolean;
  observaciones: string | null;
  orden: number;
  version: number;
}

/** Fila del pivote tal y como la pinta el canvas. */
export interface FilaItem {
  id: string;
  aplica_impuestos: boolean;
  excluido: boolean;
  /**
   * Porcentaje de administración y las tres columnas que se derivan de él.
   *
   * Viajan de vuelta porque editar el porcentaje mueve ADMON $ y V/LIQUIDAR
   * en la misma fila, y el canvas no recalcula nada por su cuenta: pinta lo
   * que el servidor le devuelve. `total_facturado` va también aunque no
   * cambie, para que el cliente pueda comprobar de dónde salen los otros dos.
   */
  porcentaje_admin: number;
  valor_admin: number;
  total_facturado: number;
  valor_liquidar: number;
}

export interface ResultadoPatchItem {
  /** Filas de IMPUESTO regeneradas. Vacío si el cierre no tenía impuestos. */
  rows: FilaConcepto[];
  /** La fila del pivote que cambió. */
  items: FilaItem[];
  totales: TotalesCierre;
}

export interface ResultadoPatchAdicional {
  /** Filas de IMPUESTO regeneradas: el adicional entra en la base imponible. */
  rows: FilaConcepto[];
  /** El adicional ya derivado por el servidor (ADMON $ y V/LIQUIDAR). */
  adicional: any;
  totales: TotalesCierre;
  /** Versión nueva de la fila, para el siguiente compare-and-swap. */
  version: number;
}

/** Campos del pivote que el canvas puede alternar. */
export const CAMPOS_EDITABLES_ITEM = new Set([
  "aplica_impuestos",
  "excluido",
  // No es un flag y NO vive en el pivote sino en `liquidacion_tercero`, que
  // es la fila de la liquidación de servicio. Ver `actualizarCampoItem`.
  "porcentaje_admin",
]);

/**
 * Deriva ADMON $ y V/LIQUIDAR de un item a partir de su porcentaje.
 *
 *   valor_admin    = total_facturado × pct / 100
 *   valor_liquidar = total_facturado − valor_admin
 *
 * SIN REDONDEAR, a diferencia de `derivarAdicional`. No es un descuido: las
 * 241 filas de items de junio 2026 guardan el valor con sus dos decimales
 * (10% de 2.214.165 son 221.416,50, no 221.417), y redondear aquí desplazaría
 * medio peso cada fila que alguien tocara respecto a las de al lado. La
 * columna es `Decimal(12,2)`, así que los dos decimales caben.
 */
export function derivarItemAdmin(
  totalFacturado: number,
  porcentajeAdmin: number,
): { valor_admin: number; valor_liquidar: number } {
  // A dos decimales explícitos: el producto en coma flotante puede dar
  // 221416.50000000003 y la columna lo aceptaría, ensuciando el dato.
  const valorAdmin = Math.round(totalFacturado * porcentajeAdmin) / 100;
  return {
    valor_admin: valorAdmin,
    valor_liquidar: Math.round((totalFacturado - valorAdmin) * 100) / 100,
  };
}

/**
 * Interpreta lo que el usuario escribió en una celda SÍ/NO.
 *
 * La celda es texto libre, así que llega lo que sea que haya tecleado. Se
 * acepta un abanico razonable y se rechaza lo demás con un error explícito
 * en vez de asumir `false`, que convertiría un typo en un cambio silencioso
 * de la base imponible.
 */
export function parseBooleano(valor: any): boolean {
  if (typeof valor === "boolean") return valor;
  if (typeof valor === "number") return valor !== 0;
  const t = String(valor ?? "")
    .trim()
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (["SI", "S", "TRUE", "1", "X", "YES", "Y"].includes(t)) return true;
  if (["NO", "N", "FALSE", "0", "", "-"].includes(t)) return false;
  throw new Error(`Valor no interpretable como SÍ/NO: "${valor}"`);
}

/**
 * Interpreta lo que el usuario escribió en la celda ADMON %.
 *
 * La celda es numérica con patrón `0.00"%"`, así que lo normal es que llegue
 * un número. Pero puede llegar texto: pegando desde Excel, o de las hojas
 * montadas antes de este cambio, que escribían la cadena `"10%"`.
 * `numeroDeCelda` ya se encarga de los dos casos —quita el `%` junto con el
 * resto de símbolos de formato— y devuelve `null` si no hay número.
 *
 * `numeroDeCelda` y NO el helper `num` de este archivo: `num` colapsa el
 * `null` a 0, así que un "abc" se habría guardado como 0% sin decir nada.
 *
 * El tope es 100 y no el 999,99 que admitiría `Decimal(5,2)`: un porcentaje
 * de administración por encima del 100% dejaría el V/LIQUIDAR en negativo, y
 * eso es un error de tecleo, no un caso de negocio.
 */
export function parsePorcentajeAdmin(valor: any): number {
  const n = numeroDeCelda(valor);
  if (n == null) {
    throw new Error(`Porcentaje de administración no numérico: "${valor}"`);
  }
  if (n < 0 || n > 100) {
    throw new Error(
      `El porcentaje de administración debe estar entre 0 y 100 (llegó ${n})`,
    );
  }
  // Dos decimales: es lo que admite la columna `Decimal(5,2)`.
  return Math.round(n * 100) / 100;
}

export interface ResultadoPatch {
  /** TODAS las filas que cambiaron, no solo la editada. */
  rows: FilaConcepto[];
  totales: TotalesCierre;
  /** Versión nueva de la fila que el usuario editó. */
  version: number;
}

/** Conflicto de concurrencia optimista, para responder 409 / `patch:conflict`. */
export class ConflictoVersionConcepto extends Error {
  readonly code = "VERSION_CONFLICT";
  constructor(
    readonly entityId: string,
    readonly serverRow: FilaConcepto | null,
  ) {
    super("La fila fue modificada por otro usuario");
  }
}

function num(v: any): number {
  // `numeroDeCelda` y no `Number`: lo que manda el canvas puede venir ya
  // formateado (`"$8,303"`), y `Number` de eso es NaN → se guardaba 0.
  return numeroDeCelda(v) ?? 0;
}

function aFila(c: any): FilaConcepto {
  return {
    id: c.id,
    tipo: c.tipo,
    concepto: c.concepto,
    conductor_id: c.conductor_id ?? null,
    propietario_id: c.propietario_id ?? null,
    dias: c.dias == null ? null : num(c.dias),
    valor_unitario: num(c.valor_unitario),
    porcentaje: c.porcentaje == null ? null : num(c.porcentaje),
    valor_total: num(c.valor_total),
    base_calculo: c.base_calculo == null ? null : num(c.base_calculo),
    calculado: c.calculado === true,
    observaciones: c.observaciones ?? null,
    orden: c.orden ?? 0,
    version: c.version ?? 1,
  };
}

/** Qué campos de una fila cambiaron respecto a su estado en BD. */
function difiere(antes: ConceptoLike, despues: ConceptoLike): boolean {
  return (
    num(antes.dias) !== num(despues.dias) ||
    num(antes.valor_unitario) !== num(despues.valor_unitario) ||
    num(antes.porcentaje) !== num(despues.porcentaje) ||
    num(antes.valor_total) !== num(despues.valor_total) ||
    num(antes.base_calculo) !== num(despues.base_calculo) ||
    antes.calculado !== despues.calculado ||
    antes.concepto !== despues.concepto ||
    (antes as any).observaciones !== (despues as any).observaciones
  );
}

export const CierreFinalCeldasService = {
  /**
   * Actualiza UN campo de UN concepto y devuelve toda la cascada.
   *
   * La concurrencia se resuelve con compare-and-swap sobre `version`: si el
   * UPDATE no afecta filas, otro usuario escribió antes y se lanza
   * `ConflictoVersionConcepto` con el valor actual del servidor para que el
   * cliente repinte en vez de perder el dato.
   */
  async actualizarCampoConcepto(params: {
    id: string;
    field: string;
    value: any;
    base_version: number;
    user_id: string;
  }): Promise<ResultadoPatch> {
    const { id, field, value, base_version, user_id } = params;

    if (!CAMPOS_EDITABLES_CONCEPTO.has(field)) {
      throw new Error(`Campo no editable: ${field}`);
    }

    const { cierreId, cambiadas } = await prisma.$transaction(async (tx) => {
      const actual = await tx.liquidacion_tercero_final_concepto.findFirst({
        where: { id, deleted_at: null },
        select: {
          id: true,
          liquidacion_tercero_final_id: true,
          version: true,
        },
      });
      if (!actual) throw new Error(`Concepto ${id} no encontrado`);

      const cierreId = actual.liquidacion_tercero_final_id;

      const cierre = await tx.liquidacion_tercero_final.findFirst({
        where: { id: cierreId, deleted_at: null },
        select: { id: true, estado: true, es_multi_propietario: true, es_propietario_overrides: true },
      });
      if (!cierre) throw new Error(`Cierre ${cierreId} no encontrado`);
      if (ESTADOS_BLOQUEADOS.includes(cierre.estado)) {
        throw new Error(
          `No se puede editar un cierre en estado ${cierre.estado}`,
        );
      }

      // ── 1. Compare-and-swap sobre la fila editada ──────────────────
      // El `version` del WHERE es lo que convierte esto en un CAS. Se hace
      // ANTES de la cascada: si perdemos la carrera, no queremos haber
      // recalculado nada.
      const gano = await tx.liquidacion_tercero_final_concepto.updateMany({
        where: { id, version: base_version, deleted_at: null },
        data: { version: { increment: 1 }, updated_at: new Date() },
      });

      if (gano.count === 0) {
        const server = await tx.liquidacion_tercero_final_concepto.findUnique({
          where: { id },
        });
        throw new ConflictoVersionConcepto(id, server ? aFila(server) : null);
      }

      // ── 2. Cargar el estado completo del cierre ────────────────────
      const [conceptosBD, itemsPivote, adicionales] = await Promise.all([
        tx.liquidacion_tercero_final_concepto.findMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          orderBy: [{ orden: "asc" }, { concepto: "asc" }],
        }),
        tx.liquidacion_tercero_final_item.findMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          select: { liquidacion_tercero: { select: { total_facturado: true } } },
        }),
        tx.liquidacion_tercero_final_adicional.findMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          select: { valor_unitario: true, cantidad: true },
        }),
      ]);

      const antesPorId = new Map(conceptosBD.map((c) => [c.id, aFila(c) as ConceptoLike]));

      // ── 3. Cascada, en el mismo orden que el editor tabular ────────
      let trabajo: ConceptoLike[] = conceptosBD.map((c) => aFila(c) as ConceptoLike);

      // 3a. Aplicar la edición del usuario.
      trabajo = trabajo.map((c) => (c.id === id ? aplicarCampo(c, field, value) : c));

      // 3b. Bases de prestaciones y seguridad social.
      trabajo = recalcularBasesPrestacionesSS(trabajo);

      // 3c. Gastos automáticos (dependen de los días y del facturado).
      const totalFacturado = itemsPivote.reduce(
        (s, it) => s + num(it.liquidacion_tercero?.total_facturado),
        0,
      );
      const brutoAdicionales = adicionales.reduce(
        (s, a) => s + num(a.valor_unitario) * (num(a.cantidad) || 1),
        0,
      );
      const overrides = normalizarOverridesPropietario(
        cierre.es_propietario_overrides as any,
      );
      trabajo = recalcularGastosAutomaticos(
        trabajo,
        totalFacturado,
        brutoAdicionales,
        overrides,
      );

      // ── 4. Persistir SOLO lo que cambió ───────────────────────────
      // Un `updateMany` por fila tocada, no un delete-all + createMany: eso
      // último es lo que hace el gateway antiguo y es justamente lo que
      // dejaría los bindings del canvas apuntando a UUIDs muertos.
      const cambiadas: ConceptoLike[] = [];
      for (const c of trabajo) {
        const antes = antesPorId.get(c.id);
        if (!antes) continue;
        // La fila editada ya subió de versión en el CAS.
        const esLaEditada = c.id === id;
        if (!esLaEditada && !difiere(antes, c)) continue;

        await tx.liquidacion_tercero_final_concepto.update({
          where: { id: c.id },
          data: {
            concepto: c.concepto,
            dias: c.dias == null ? null : String(c.dias),
            valor_unitario: String(num(c.valor_unitario)),
            porcentaje: c.porcentaje == null ? null : String(c.porcentaje),
            valor_total: String(num(c.valor_total)),
            base_calculo: c.base_calculo == null ? null : String(c.base_calculo),
            calculado: c.calculado === true,
            observaciones: (c as any).observaciones ?? null,
            ...(esLaEditada ? {} : { version: { increment: 1 } }),
            updated_at: new Date(),
          },
        });
        cambiadas.push(c);
      }

      return { cierreId, cambiadas };
    },
    {
      // Los 5s por defecto se quedaron cortos en cuanto los cierres tuvieron
      // conductores de verdad. Editar los `dias` de un SALARIO cascadea a sus
      // ocho filas de prestaciones y seguridad social más DOTACION,
      // EXAMEN_MEDICO y GASTOS_DIVERSOS: once UPDATE secuenciales que contra
      // una base remota son ~200ms cada uno. El margen es la red de
      // seguridad; lo que de verdad acorta la transacción es haber sacado de
      // ella el recálculo de totales (ver abajo).
      timeout: 30_000,
      maxWait: 15_000,
    });

    // ── 5. Impuestos y totales, FUERA de la transacción ─────────────
    // Los impuestos NO se recalculan aquí: dependen del valor a liquidar, que
    // no cambia al editar conceptos. Solo cambian si se tocan items o
    // adicionales, y ese camino ya llama a `calcularImpuestos`.
    //
    // `recalcularTotalesCierre` son SEIS consultas —items, sus liquidaciones,
    // la suma de adicionales, los conceptos, la cabecera y su UPDATE— que
    // sumaban ~1,5s DENTRO de la transacción y se llevaron por delante su
    // presupuesto de tiempo. No necesitan estar dentro: leen el estado ya
    // escrito y solo actualizan la cabecera, que converge igual porque el
    // servidor difunde el resultado a todo el room. Es el mismo criterio que
    // ya usaba `actualizarCampoItem`.
    const totales = await recalcularTotalesCierre(prisma, cierreId, { userId: user_id });

    // Releer las filas tocadas para devolver la versión definitiva.
    const finales = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: { id: { in: cambiadas.map((c) => c.id) } },
    });

    const editada = finales.find((f) => f.id === id);

    return {
      rows: finales.map(aFila),
      totales,
      version: editada?.version ?? base_version + 1,
    };
  },

  /**
   * Escribe un campo de la fila de items y devuelve la cascada.
   *
   * Son DOS destinos distintos según el campo:
   *
   *   `aplica_impuestos` / `excluido` → el PIVOTE
   *     (`liquidacion_tercero_final_item`). Pertenecen a esta liquidación
   *     final: dicen si el item entra en la base de impuestos y si se cuenta.
   *
   *   `porcentaje_admin` → la fila de la LIQUIDACIÓN DE SERVICIO
   *     (`liquidacion_tercero`). Ojo con esto: el porcentaje de administración
   *     no es del cierre, es del servicio facturado, así que tocarlo aquí lo
   *     cambia también para el módulo de servicios y para los canvas de
   *     ingresos y ocasionales que leen esa misma fila. Es lo que pide el
   *     negocio —el porcentaje se ajusta cuando se está liquidando— pero no es
   *     una edición local a esta hoja.
   *
   * ⚠️ ESTE MÉTODO EXISTE POR UN FALLO QUE VENÍA DE ANTES.
   * `actualizarAplicaImpuestosItem` escribía el flag y devolvía el detalle,
   * pero NUNCA llamaba a `calcularImpuestos`. Y `recalcularTotales` solo
   * regenera las filas de IMPUESTO cuando el cierre es multi-propietario, así
   * que en un cierre normal marcar o desmarcar un item no cambiaba ni la base
   * ni el valor de ninguna retención. El toggle era decorativo.
   *
   * Aquí el recálculo es explícito y va DENTRO de la misma transacción que la
   * escritura del flag: si dos usuarios marcan items distintos a la vez, el
   * segundo lee el estado ya escrito por el primero.
   *
   * SIN COMPARE-AND-SWAP, a diferencia del resto del canvas.
   * `liquidacion_tercero_final_item` no tiene columna `version`, así que aquí
   * gana quien escriba de último.
   *
   * Por qué es aceptable: el servidor difunde el estado RESULTANTE a todo el
   * room, así que los clientes convergen en él — no hay forma de quedarse con
   * dos verdades distintas. Y desde la iteración 3 deja de ser mudo: si a
   * alguien le pisan un cambio que tenía pendiente, la página se lo dice con
   * el nombre de quien lo hizo. Con `porcentaje_admin` el argumento es algo
   * más flojo que con un booleano —dos usuarios pueden teclear porcentajes
   * distintos y gana el último—, pero sigue convergiendo y no hay estado
   * intermedio incoherente: las tres columnas derivadas se recalculan en el
   * servidor a partir del valor que quedó escrito.
   *
   * Qué haría falta para tener CAS de verdad: una columna `version` en el
   * pivote (migración) y pasar `base_version` en el patch, exactamente como
   * hacen conceptos y adicionales. Se descartó por no añadir otra migración
   * pendiente de ejecutar a cambio de proteger un dato convergente.
   */
  async actualizarCampoItem(params: {
    pivoteId: string;
    field: string;
    value: any;
    user_id: string;
  }): Promise<ResultadoPatchItem> {
    const { pivoteId, field, value, user_id } = params;

    if (!CAMPOS_EDITABLES_ITEM.has(field)) {
      throw new Error(`Campo de item no editable: ${field}`);
    }

    const esPorcentaje = field === "porcentaje_admin";
    // El porcentaje se valida ANTES de abrir la transacción: si el usuario
    // teclea "abc" no hay nada que escribir y el mensaje debe decir qué pasa,
    // no fallar por un NaN dentro del UPDATE.
    let porcentaje = 0;
    if (esPorcentaje) {
      porcentaje = parsePorcentajeAdmin(value);
    }
    const flag = esPorcentaje ? false : parseBooleano(value);

    const cierreId = await prisma.$transaction(async (tx) => {
      const pivote = await tx.liquidacion_tercero_final_item.findUnique({
        where: { id: pivoteId },
        select: {
          id: true,
          liquidacion_tercero_final_id: true,
          liquidacion_tercero_id: true,
        },
      });
      if (!pivote) throw new Error(`Item de pivote ${pivoteId} no encontrado`);

      const cierre = await tx.liquidacion_tercero_final.findFirst({
        where: { id: pivote.liquidacion_tercero_final_id, deleted_at: null },
        select: { id: true, estado: true },
      });
      if (!cierre) throw new Error("Cierre no encontrado");
      if (ESTADOS_BLOQUEADOS.includes(cierre.estado)) {
        throw new Error(`No se puede editar un cierre en estado ${cierre.estado}`);
      }

      if (esPorcentaje) {
        // Va a `liquidacion_tercero`, no al pivote. Se relee el
        // `total_facturado` DENTRO de la transacción para derivar sobre el
        // valor vigente y no sobre el que traía el cliente.
        /// `findFirst` con filtro: una fila marcada no debe alimentar el
        /// cierre. `findUnique` la habría devuelto igual.
        const fila = await tx.liquidacion_tercero.findFirst({
          where: { id: pivote.liquidacion_tercero_id, deleted_at: null },
          select: { id: true, total_facturado: true },
        });
        if (!fila) {
          throw new Error(
            `Item de liquidación ${pivote.liquidacion_tercero_id} no encontrado`,
          );
        }
        const { valor_admin, valor_liquidar } = derivarItemAdmin(
          num(fila.total_facturado),
          porcentaje,
        );
        await tx.liquidacion_tercero.update({
          where: { id: fila.id },
          data: {
            porcentaje_admin: String(porcentaje),
            valor_admin: String(valor_admin),
            valor_liquidar: String(valor_liquidar),
          },
        });
      } else {
        await tx.liquidacion_tercero_final_item.update({
          where: { id: pivoteId },
          data:
            field === "excluido"
              ? { deleted_at: flag ? new Date() : null }
              : { aplica_impuestos: flag },
        });
      }

      return cierre.id;
    });

    // `calcularImpuestos` y `recalcularTotalesCierre` van FUERA de la
    // transacción anterior: el primero abre la suya propia y anidarlas con el
    // `$transaction` interactivo de Prisma bloquea la conexión.
    const { LiquidacionesTercerosDescuentosService } = await import(
      "./liquidaciones-terceros-descuentos.service"
    );
    await LiquidacionesTercerosDescuentosService.calcularImpuestos(cierreId);
    const totales = await recalcularTotalesCierre(prisma, cierreId, { userId: user_id });

    const [impuestos, pivoteFinal] = await Promise.all([
      prisma.liquidacion_tercero_final_concepto.findMany({
        where: {
          liquidacion_tercero_final_id: cierreId,
          tipo: "IMPUESTO",
          deleted_at: null,
        },
        orderBy: [{ orden: "asc" }, { concepto: "asc" }],
      }),
      prisma.liquidacion_tercero_final_item.findUnique({
        where: { id: pivoteId },
        select: {
          id: true,
          aplica_impuestos: true,
          deleted_at: true,
          // Las cuatro columnas de dinero de la fila, releídas del servidor:
          // el canvas pinta lo que le llega y no deriva nada por su cuenta.
          liquidacion_tercero: {
            select: {
              porcentaje_admin: true,
              valor_admin: true,
              total_facturado: true,
              valor_liquidar: true,
            },
          },
        },
      }),
    ]);

    return {
      rows: impuestos.map(aFila),
      items: pivoteFinal
        ? [
            {
              id: pivoteFinal.id,
              aplica_impuestos: pivoteFinal.aplica_impuestos !== false,
              excluido: !!pivoteFinal.deleted_at,
              porcentaje_admin: num(pivoteFinal.liquidacion_tercero?.porcentaje_admin),
              valor_admin: num(pivoteFinal.liquidacion_tercero?.valor_admin),
              total_facturado: num(pivoteFinal.liquidacion_tercero?.total_facturado),
              valor_liquidar: num(pivoteFinal.liquidacion_tercero?.valor_liquidar),
            },
          ]
        : [],
      totales,
    };
  },

  /**
   * Actualiza UN campo de UN adicional del cierre.
   *
   * ── POR QUÉ ESTÁ AQUÍ Y NO SOLO EN EL MÓDULO DE ADICIONALES ──
   * El canvas de cierres pinta los adicionales DENTRO de la tabla de items,
   * porque así un único `=SUM()` los totaliza junto a las liquidaciones de
   * servicio. Pero editarlos no es como editarlos en su propio canvas: aquí
   * el cambio CASCADEA igual que el de un concepto —entran en la base
   * imponible, así que mueven los impuestos, y de ahí TOTAL DESCUENTOS y
   * TOTAL A PAGAR—.
   *
   * El módulo de adicionales sigue siendo el dueño de la escritura y de su
   * compare-and-swap; lo que se añade aquí es la cascada, con el mismo
   * contrato de respuesta que el resto de celdas del cierre.
   *
   * Antes esto NO existía: el gateway rechazaba `entity_type: 'adicional'` en
   * `cierres-finales` con «no soportado», así que las celdas de adicional del
   * canvas estaban bindeadas contra un camino muerto y devolvían error.
   */
  async actualizarCampoAdicional(params: {
    id: string;
    field: string;
    value: any;
    base_version: number;
    user_id: string;
  }): Promise<ResultadoPatchAdicional> {
    const { user_id } = params;

    // Import diferido, igual que con `calcularImpuestos`: los dos módulos se
    // referencian entre sí y en carga estática uno de los dos queda a medio
    // inicializar.
    const { LiquidacionesTercerosAdicionalesService } = await import(
      "../liquidaciones-terceros-adicionales/liquidaciones-terceros-adicionales.service"
    );
    const adicional =
      await LiquidacionesTercerosAdicionalesService.actualizarCampo(params);

    const cierreId = adicional.cierre_id;

    // `actualizarCampo` ya recalculó los TOTALES, pero no los impuestos: la
    // base imponible cambia con el valor a liquidar del adicional, así que hay
    // que rehacerlos y volver a totalizar sobre ellos.
    const { LiquidacionesTercerosDescuentosService } = await import(
      "./liquidaciones-terceros-descuentos.service"
    );
    await LiquidacionesTercerosDescuentosService.calcularImpuestos(cierreId);
    const totales = await recalcularTotalesCierre(prisma, cierreId, {
      userId: user_id,
    });

    const impuestos = await prisma.liquidacion_tercero_final_concepto.findMany({
      where: {
        liquidacion_tercero_final_id: cierreId,
        tipo: "IMPUESTO",
        deleted_at: null,
      },
      orderBy: [{ orden: "asc" }, { concepto: "asc" }],
    });

    return {
      rows: impuestos.map(aFila),
      adicional,
      totales,
      version: adicional.version,
    };
  },

  /**
   * Da de alta, de baja y marca como propietario a los conductores de un
   * cierre, en UNA sola operación.
   *
   * POR QUÉ HACÍA FALTA UN CAMINO NUEVO:
   *
   *   `es_propietario_overrides` solo se podía escribir desde
   *   `guardarBorrador`, que recrea items y conceptos con ids nuevos. Usarlo
   *   para marcar un propietario habría reseteado `aplica_impuestos` de todo
   *   el pivote, invalidado las versiones del compare-and-swap y dejado
   *   huérfanas las anotaciones ancladas a un item. Y `guardarConceptos` ni
   *   toca los overrides ni dispara `recalcularGastosAutomaticos`, así que
   *   marcar al propietario por ahí no habría cambiado DOTACION ni
   *   EXAMEN_MEDICO: el flag habría quedado escrito y sin efecto, que es el
   *   mismo fallo que ya tuvo el toggle de `aplica_impuestos`.
   *
   * QUÉ ES SER PROPIETARIO: al dueño del vehículo no se le imputan DOTACION
   * ni EXAMEN_MEDICO. Ambos salen de `totalDiasNoPropietarios`, así que
   * marcarlo baja los días base de esos dos gastos — no los pone a cero,
   * salvo que sea el único conductor.
   *
   * ALTAS Y BAJAS son por BLOQUE: un conductor es su fila de SALARIO más sus
   * prestaciones y su seguridad social. Darlo de baja es un soft-delete de
   * todo el bloque; las filas se conservan por si hay que auditar el cierre.
   *
   * A los conductores que YA estaban solo se les toca `dias`, y solo si
   * cambian: sus valores pueden haber sido ajustados a mano en el canvas y
   * regenerar el bloque los perdería.
   */
  async sincronizarConductores(params: {
    cierreId: string;
    conductores: Array<{
      conductor_id: string;
      dias: number;
      es_propietario: boolean;
    }>;
    user_id?: string;
  }): Promise<{
    agregados: string[];
    eliminados: string[];
    /// Para que el llamador pueda difundir `sheet:invalidate` al room del
    /// periodo sin volver a consultar el cierre.
    mes: number;
    anio: number;
    totales: TotalesCierre;
  }> {
    const { cierreId, conductores, user_id } = params;

    // Deduplicar por conductor: la última entrada gana. El modal no debería
    // mandar repetidos, pero un payload repetido crearía dos bloques del
    // mismo conductor y `totalDiasNoPropietarios` contaría sus días dos veces.
    const pedidos = new Map<string, { dias: number; es_propietario: boolean }>();
    for (const c of conductores ?? []) {
      if (!c?.conductor_id) continue;
      pedidos.set(c.conductor_id, {
        dias: Math.max(0, num(c.dias)),
        es_propietario: c.es_propietario === true,
      });
    }

    const { LiquidacionesTercerosDescuentosService } = await import(
      "./liquidaciones-terceros-descuentos.service"
    );
    // La configuración es una lectura pura y no depende del cierre: fuera de
    // la transacción para no alargar la que sí bloquea filas.
    const config: any[] = await LiquidacionesTercerosDescuentosService.obtenerConfiguracion();
    const prestaciones = config.filter(
      (c) => c.categoria === "PRESTACION_SOCIAL" && c.activo,
    );
    const seguridad = config.filter(
      (c) => c.categoria === "SEGURIDAD_SOCIAL" && c.activo,
    );
    const resultado = await prisma.$transaction(async (tx) => {
      const cierre = await tx.liquidacion_tercero_final.findFirst({
        where: { id: cierreId, deleted_at: null },
        select: { id: true, estado: true, mes: true, anio: true },
      });
      if (!cierre) throw new Error(`Cierre ${cierreId} no encontrado`);
      if (ESTADOS_BLOQUEADOS.includes(cierre.estado)) {
        throw new Error(`No se puede editar un cierre en estado ${cierre.estado}`);
      }

      const conceptosBD = await tx.liquidacion_tercero_final_concepto.findMany({
        where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
        orderBy: [{ orden: "asc" }, { concepto: "asc" }],
      });

      const actuales = new Set<string>();
      for (const c of conceptosBD) {
        if (c.tipo === "COSTO_LABORAL" && c.conductor_id) actuales.add(c.conductor_id);
      }

      const eliminados = [...actuales].filter((id) => !pedidos.has(id));
      const agregados = [...pedidos.keys()].filter((id) => !actuales.has(id));

      // ── Bajas ────────────────────────────────────────────────────
      if (eliminados.length) {
        await tx.liquidacion_tercero_final_concepto.updateMany({
          where: {
            liquidacion_tercero_final_id: cierreId,
            tipo: "COSTO_LABORAL",
            conductor_id: { in: eliminados },
            deleted_at: null,
          },
          data: { deleted_at: new Date() },
        });
      }

      // ── Altas ────────────────────────────────────────────────────
      // El bloque se genera con la MISMA forma que `autocompletarNomina`:
      // los cinco devengados (SALARIO, AUXILIO_TRANSPORTE, BONIFICACION,
      // BONIFICACION_TURNO_DOBLE y RECARGOS) más una fila por prestación y
      // una por seguridad social.
      //
      // Los cinco van SIEMPRE, incluso RECARGOS en cero: son las filas del
      // recuadro que el equipo espera ver para poder teclear encima. Crear
      // solo las que traen valor obligaría a añadirlas a mano después, que es
      // justo lo que este modal viene a evitar.
      let orden = conceptosBD.reduce((m, c) => Math.max(m, c.orden ?? 0), 0);
      const nuevos: any[] = [];

      const fila = (
        conductorId: string,
        concepto: string,
        campos: Record<string, unknown>,
      ) => ({
        liquidacion_tercero_final_id: cierreId,
        tipo: "COSTO_LABORAL",
        concepto,
        conductor_id: conductorId,
        calculado: true,
        orden: ++orden,
        ...campos,
      });

      for (const conductorId of agregados) {
        const p = pedidos.get(conductorId)!;
        const D = BLOQUE_CONDUCTOR_MANUAL;

        const salario = p.dias * D.SALARIO;
        const auxilio = p.dias * D.AUXILIO_TRANSPORTE;
        const bonificacion = D.BONIFICACION.dias * D.BONIFICACION.valor_unitario;
        const turnoDoble =
          D.BONIFICACION_TURNO_DOBLE.dias * D.BONIFICACION_TURNO_DOBLE.valor_unitario;
        const recargos = D.RECARGOS.dias * D.RECARGOS.valor_unitario;

        nuevos.push(
          fila(conductorId, "SALARIO", {
            dias: String(p.dias),
            valor_unitario: String(D.SALARIO),
            valor_total: String(salario),
          }),
          fila(conductorId, "AUXILIO_TRANSPORTE", {
            dias: String(p.dias),
            valor_unitario: String(D.AUXILIO_TRANSPORTE),
            valor_total: String(auxilio),
          }),
          fila(conductorId, "BONIFICACION", {
            dias: String(D.BONIFICACION.dias),
            valor_unitario: String(D.BONIFICACION.valor_unitario),
            valor_total: String(bonificacion),
          }),
          fila(conductorId, "BONIFICACION_TURNO_DOBLE", {
            dias: String(D.BONIFICACION_TURNO_DOBLE.dias),
            valor_unitario: String(D.BONIFICACION_TURNO_DOBLE.valor_unitario),
            valor_total: String(turnoDoble),
          }),
          fila(conductorId, "RECARGOS", {
            dias: String(D.RECARGOS.dias),
            valor_unitario: String(D.RECARGOS.valor_unitario),
            valor_total: String(recargos),
          }),
        );

        // Bases de partida, con el mismo reparto que `recalcularBasesPrestacionesSS`:
        // cesantías, intereses y prima gravan sobre el auxilio; vacaciones y
        // la seguridad social, no. La cascada de más abajo las recalcula de
        // todas formas — esto solo evita que la fila nazca en cero.
        const baseConAux = salario + auxilio + recargos;
        const baseSinAux = salario + recargos;

        for (const cfg of prestaciones) {
          const porcentaje = num(cfg.porcentaje);
          const base = cfg.concepto === "VACACIONES" ? baseSinAux : baseConAux;
          nuevos.push(
            fila(conductorId, cfg.concepto, {
              porcentaje: String(porcentaje),
              base_calculo: String(base),
              valor_total: String((base * porcentaje) / 100),
            }),
          );
        }
        for (const cfg of seguridad) {
          const porcentaje = num(cfg.porcentaje);
          nuevos.push(
            fila(conductorId, cfg.concepto, {
              porcentaje: String(porcentaje),
              base_calculo: String(baseSinAux),
              valor_total: String((baseSinAux * porcentaje) / 100),
            }),
          );
        }
      }
      // ── GASTOS DE VEHÍCULO que falten ────────────────────────────
      // La sección existe siempre, aunque esté a cero. Se siembra aquí y no
      // al generar el borrador porque DOTACION y EXAMEN_MEDICO se calculan
      // sobre los días de los conductores NO propietarios: sin conductores no
      // hay nada que calcular, y este es justo el momento en que los hay.
      //
      // Solo se crean las que FALTAN: las que ya existen pueden llevar un
      // valor tecleado a mano y volver a crearlas lo perdería.
      const gastosPresentes = new Set(
        conceptosBD.filter((c) => c.tipo === "GASTO_OPERATIVO").map((c) => c.concepto),
      );
      for (const g of GASTOS_POR_DEFECTO) {
        if (gastosPresentes.has(g.concepto)) continue;
        nuevos.push({
          liquidacion_tercero_final_id: cierreId,
          tipo: "GASTO_OPERATIVO",
          concepto: g.concepto,
          conductor_id: null,
          dias: String(g.dias),
          valor_unitario: String(g.valor_unitario),
          valor_total: String(g.dias * g.valor_unitario),
          calculado: g.calculado,
          // Con la base compartida con el frontend, para que el builder los
          // pinte en el orden canónico y no por fecha de creación.
          orden: ORDEN_BASE_GASTO + (ORDEN_GASTOS_CANONICO[g.concepto] ?? 0) - 1,
        });
      }

      if (nuevos.length) {
        await tx.liquidacion_tercero_final_concepto.createMany({ data: nuevos });
      }

      // ── Días de los que ya estaban ───────────────────────────────
      // SALARIO y AUXILIO_TRANSPORTE son los dos que se cuentan por día
      // trabajado, así que los dos siguen al valor del modal. BONIFICACION
      // (bonos) y RECARGOS (horas) tienen su propia cantidad y no se tocan.
      const POR_DIA_TRABAJADO = new Set(["SALARIO", "AUXILIO_TRANSPORTE"]);
      for (const c of conceptosBD) {
        if (c.tipo !== "COSTO_LABORAL" || !POR_DIA_TRABAJADO.has(c.concepto)) continue;
        if (!c.conductor_id) continue;
        const p = pedidos.get(c.conductor_id);
        if (!p || num(c.dias) === p.dias) continue;
        await tx.liquidacion_tercero_final_concepto.update({
          where: { id: c.id },
          data: {
            dias: String(p.dias),
            valor_total: String(p.dias * num(c.valor_unitario)),
            version: { increment: 1 },
            updated_at: new Date(),
          },
        });
      }

      // ── Overrides de propietario ─────────────────────────────────
      // Se REEMPLAZAN, no se fusionan: el modal manda la lista completa, y
      // conservar la marca de un conductor que acaba de salir del cierre
      // dejaría basura que nadie puede ya desmarcar desde la interfaz.
      const overrides: Record<string, boolean> = {};
      for (const [id, p] of pedidos) overrides[claveConductor(id)] = p.es_propietario;
      await tx.liquidacion_tercero_final.update({
        where: { id: cierreId },
        data: {
          es_propietario_overrides: overrides as any,
          ...(user_id ? { actualizado_por_id: user_id } : {}),
        },
      });

      // ── Cascada ──────────────────────────────────────────────────
      // Releer: `conceptosBD` es de antes de las altas y las bajas. El orden
      // es el mismo que en la edición por celda — bases primero, gastos
      // automáticos después, porque estos dependen de los días de aquellas.
      const vigentes = await tx.liquidacion_tercero_final_concepto.findMany({
        where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
        orderBy: [{ orden: "asc" }, { concepto: "asc" }],
      });
      const [itemsPivote, adicionales] = await Promise.all([
        tx.liquidacion_tercero_final_item.findMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          select: { liquidacion_tercero: { select: { total_facturado: true } } },
        }),
        tx.liquidacion_tercero_final_adicional.findMany({
          where: { liquidacion_tercero_final_id: cierreId, deleted_at: null },
          select: { valor_unitario: true, cantidad: true },
        }),
      ]);

      const antesPorId = new Map(
        vigentes.map((c) => [c.id, aFila(c) as ConceptoLike]),
      );
      let trabajo: ConceptoLike[] = vigentes.map((c) => aFila(c) as ConceptoLike);
      trabajo = recalcularBasesPrestacionesSS(trabajo);
      trabajo = recalcularGastosAutomaticos(
        trabajo,
        itemsPivote.reduce((s, it) => s + num(it.liquidacion_tercero?.total_facturado), 0),
        adicionales.reduce((s, a) => s + num(a.valor_unitario) * (num(a.cantidad) || 1), 0),
        overrides,
      );

      for (const c of trabajo) {
        const antes = antesPorId.get(c.id);
        if (!antes || !difiere(antes, c)) continue;
        await tx.liquidacion_tercero_final_concepto.update({
          where: { id: c.id },
          data: {
            dias: c.dias == null ? null : String(c.dias),
            valor_unitario: String(num(c.valor_unitario)),
            porcentaje: c.porcentaje == null ? null : String(c.porcentaje),
            valor_total: String(num(c.valor_total)),
            base_calculo: c.base_calculo == null ? null : String(c.base_calculo),
            calculado: c.calculado === true,
            version: { increment: 1 },
            updated_at: new Date(),
          },
        });
      }

      return {
        agregados,
        eliminados,
        mes: Number(cierre.mes),
        anio: Number(cierre.anio),
      };
    },
    {
      // Los 5s por defecto de Prisma no bastan. A diferencia de la edición
      // por celda —que toca dos o tres filas—, dar de alta un conductor
      // inserta nueve (salario, cuatro prestaciones, cuatro de seguridad
      // social) y luego la cascada recorre TODOS los conceptos del cierre
      // uno a uno. Con dos conductores ya son ~20 idas y vueltas dentro de
      // la misma transacción, y contra una base remota eso se pasa de 5s.
      timeout: 30_000,
      maxWait: 15_000,
    });

    // Fuera de la transacción, por lo mismo que en `actualizarCampoItem`:
    // anidar transacciones interactivas de Prisma bloquea la conexión.
    const totales = await recalcularTotalesCierre(prisma, cierreId, {
      userId: user_id,
    });

    return { ...resultado, totales };
  },

  /**
   * Añade UNA fila a GASTOS DE VEHÍCULO o a ANTICIPOS.
   *
   * POR QUÉ NO SE HACE INSERTANDO UNA FILA EN LA HOJA. Univer sabe insertar
   * filas, pero la fila que inserta está vacía en todos los sentidos que
   * importan aquí: sin combinación A:B, sin el patrón de moneda, sin bordes,
   * sin fórmula y —lo decisivo— sin `id` en la base. Todo el canvas se apoya
   * en un registro de bindings `(fila, columna) → entidad` que se construye al
   * montar la hoja; una fila que Univer mete por su cuenta no está en ese
   * registro, así que lo que se teclee en ella no tiene dónde guardarse. El
   * servidor lo rechazaba con `offset_fila debe ser un entero >= 0` y el
   * usuario no se enteraba.
   *
   * Naciendo en el servidor, la fila vuelve con su id y el builder la pinta
   * como a sus vecinas: combinada, formateada y dentro del `=SUM()` de la
   * sección.
   *
   * IMPUESTOS NO SE PUEDEN AÑADIR ASÍ, a propósito: `calcularImpuestos` hace
   * `deleteMany` + `createMany` sobre las filas de impuesto cada vez que
   * corre, así que una añadida a mano duraría hasta el siguiente recálculo.
   * Los cuatro salen de `configuracion-descuentos-tercero`, y un quinto se
   * añade ahí.
   */
  async agregarConcepto(params: {
    cierreId: string;
    tipo: "GASTO_OPERATIVO" | "ANTICIPO";
    concepto: string;
    dias: number;
    valor_unitario: number;
    /** En ANTICIPOS es la FECHA: no hay columna propia, va en observaciones. */
    observaciones?: string | null;
    user_id?: string;
  }): Promise<{ id: string; mes: number; anio: number; totales: TotalesCierre }> {
    const { cierreId, tipo, user_id } = params;

    // El canvas muestra los guiones bajos como espacios, así que se guarda en
    // la forma canónica y se deja que el builder lo presente.
    const concepto = String(params.concepto || "")
      .trim()
      .toUpperCase()
      .replace(/\s+/g, "_");
    if (!concepto) throw new Error("El concepto no puede ir vacío");

    const dias = num(params.dias);
    const valorUnitario = num(params.valor_unitario);

    const creado = await prisma.$transaction(async (tx) => {
      const cierre = await tx.liquidacion_tercero_final.findFirst({
        where: { id: cierreId, deleted_at: null },
        select: { id: true, estado: true, mes: true, anio: true },
      });
      if (!cierre) throw new Error(`Cierre ${cierreId} no encontrado`);
      if (ESTADOS_BLOQUEADOS.includes(cierre.estado)) {
        throw new Error(`No se puede editar un cierre en estado ${cierre.estado}`);
      }

      const hermanos = await tx.liquidacion_tercero_final_concepto.findMany({
        where: { liquidacion_tercero_final_id: cierreId, tipo, deleted_at: null },
        select: { concepto: true, orden: true },
      });
      if (hermanos.some((h) => h.concepto === concepto)) {
        throw new Error(`${concepto.replace(/_/g, " ")} ya está en esta sección`);
      }

      // El builder ordena cada sección por `orden`, así que la fila nueva tiene
      // que caer detrás de las suyas y no mezclarse con las de otra sección.
      let orden: number;
      if (tipo === "GASTO_OPERATIVO") {
        const canon = ORDEN_GASTOS_CANONICO[concepto];
        orden = canon
          ? ORDEN_BASE_GASTO + canon - 1
          : Math.max(
              ORDEN_BASE_GASTO_NO_CANONICO - 1,
              ...hermanos.map((h) => h.orden ?? 0),
            ) + 1;
      } else {
        orden =
          Math.max(ORDEN_BASE_ANTICIPO - 1, ...hermanos.map((h) => h.orden ?? 0)) + 1;
      }

      const fila = await tx.liquidacion_tercero_final_concepto.create({
        data: {
          liquidacion_tercero_final_id: cierreId,
          tipo,
          concepto,
          conductor_id: null,
          dias: String(dias),
          valor_unitario: String(valorUnitario),
          valor_total: String(dias * valorUnitario),
          // `false` = manual. Es lo que impide que
          // `recalcularGastosAutomaticos` le pise el valor al usuario si el
          // nombre coincidiera con uno de los tres automáticos.
          calculado: false,
          observaciones: params.observaciones || null,
          orden,
        },
        select: { id: true },
      });

      return { id: fila.id, mes: Number(cierre.mes), anio: Number(cierre.anio) };
    });

    // Fuera de la transacción, igual que en el resto del módulo: anidar
    // transacciones interactivas de Prisma bloquea la conexión.
    const totales = await recalcularTotalesCierre(prisma, cierreId, {
      userId: user_id,
    });
    return { ...creado, totales };
  },

  /**
   * Quita UNA fila de GASTOS o ANTICIPOS.
   *
   * Soft-delete, como las bajas de conductor: la fila deja de pintarse pero
   * queda para auditar el cierre.
   *
   * No se admite sobre COSTO_LABORAL —esas se gestionan por conductor, y
   * borrar una suelta dejaría un recuadro cojo— ni sobre IMPUESTO, que se
   * regenera solo.
   */
  async eliminarConcepto(params: {
    conceptoId: string;
    user_id?: string;
  }): Promise<{ cierreId: string; mes: number; anio: number; totales: TotalesCierre }> {
    const { conceptoId, user_id } = params;

    const info = await prisma.$transaction(async (tx) => {
      const fila = await tx.liquidacion_tercero_final_concepto.findFirst({
        where: { id: conceptoId, deleted_at: null },
        select: { id: true, tipo: true, liquidacion_tercero_final_id: true },
      });
      if (!fila) throw new Error("Concepto no encontrado");
      if (fila.tipo !== "GASTO_OPERATIVO" && fila.tipo !== "ANTICIPO") {
        throw new Error(
          `No se puede eliminar una fila de tipo ${fila.tipo} desde aquí`,
        );
      }

      const cierre = await tx.liquidacion_tercero_final.findFirst({
        where: { id: fila.liquidacion_tercero_final_id, deleted_at: null },
        select: { id: true, estado: true, mes: true, anio: true },
      });
      if (!cierre) throw new Error("Cierre no encontrado");
      if (ESTADOS_BLOQUEADOS.includes(cierre.estado)) {
        throw new Error(`No se puede editar un cierre en estado ${cierre.estado}`);
      }

      await tx.liquidacion_tercero_final_concepto.update({
        where: { id: conceptoId },
        data: { deleted_at: new Date() },
      });

      return {
        cierreId: cierre.id,
        mes: Number(cierre.mes),
        anio: Number(cierre.anio),
      };
    });

    const totales = await recalcularTotalesCierre(prisma, info.cierreId, {
      userId: user_id,
    });
    return { ...info, totales };
  },
};
