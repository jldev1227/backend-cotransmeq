// @ts-nocheck
import { prisma } from "../../config/prisma";

/**
 * Anotaciones libres de los canvas.
 *
 * Son las celdas que el usuario escribe FUERA del bloque estructurado de la
 * hoja: referencias, recordatorios, valores de apoyo. Nunca entran en un
 * total ni en una fórmula — son complemento visual compartido.
 *
 * Se guardan con anclaje RELATIVO (`offset_fila`, distancia CON SIGNO al final
 * del bloque) en vez de con la fila absoluta, para que sigan en su sitio
 * cuando la tabla crece. La única excepción es la cabecera (`top`), que no se
 * desplaza. Ver el comentario del modelo en `schema.prisma`.
 */

export type ScopeCanvas =
  | "cierres-finales"
  | "ocasional"
  | "adicionales"
  | "ingresos";

const SCOPES: ReadonlySet<string> = new Set([
  "cierres-finales",
  "ocasional",
  "adicionales",
  "ingresos",
]);

export interface AnotacionCelda {
  ancla_tipo: string;
  ancla_ref: string;
  offset_fila: number;
  columna: number;
  valor: string | null;
  estilo: any | null;
  version: number;
  sheet_key: string;
  actualizado_por?: { id: string; nombre: string } | null;
  updated_at: string;
}

function serializar(a: any): AnotacionCelda {
  return {
    ancla_tipo: a.ancla_tipo ?? "fila",
    ancla_ref: a.ancla_ref ?? "",
    offset_fila: a.offset_fila,
    columna: a.columna,
    valor: a.valor,
    estilo: a.estilo ?? null,
    version: a.version,
    sheet_key: a.sheet_key ?? "",
    actualizado_por: a.actualizado_por
      ? { id: a.actualizado_por.id, nombre: a.actualizado_por.nombre }
      : null,
    updated_at:
      a.updated_at instanceof Date ? a.updated_at.toISOString() : a.updated_at,
  };
}

/// Anclas que se localizan por NOMBRE o por ID, no por posición.
const ANCLAS_CON_REF: ReadonlySet<string> = new Set(["item", "clave"]);

/**
 * Normaliza el par (tipo, ref) del ancla.
 *
 * `fila` y `top` no llevan ref —su posición es el offset—, mientras que `item`
 * y `clave` la necesitan: sin ella la celda no se puede volver a encontrar, y
 * guardarla con ref vacía la dejaría colisionando con cualquier otra del mismo
 * tipo por la clave única de la tabla.
 */
function normalizarAncla(a: { ancla_tipo?: string; ancla_ref?: string }): {
  ancla_tipo: string;
  ancla_ref: string;
} {
  const ancla_tipo =
    a.ancla_tipo === "item" ||
    a.ancla_tipo === "clave" ||
    a.ancla_tipo === "top"
      ? a.ancla_tipo
      : "fila";
  const ancla_ref = ANCLAS_CON_REF.has(ancla_tipo)
    ? String(a.ancla_ref ?? "")
    : "";
  if (ANCLAS_CON_REF.has(ancla_tipo) && !ancla_ref) {
    throw new Error(`ancla_ref es obligatorio cuando ancla_tipo = '${ancla_tipo}'`);
  }
  return { ancla_tipo, ancla_ref };
}

export const CanvasAnotacionesService = {
  /**
   * Anotaciones de un periodo. El canvas las pide UNA vez al montar y luego
   * se mantiene al día por socket.
   *
   * `mes` opcional: los libros anuales cargan los 12 meses de una tacada.
   */
  async listar(params: { scope: string; anio: number; mes?: number | null }) {
    const { scope, anio, mes } = params;
    if (!SCOPES.has(scope)) throw new Error(`scope inválido: ${scope}`);

    const filas = await prisma.canvas_anotacion.findMany({
      where: {
        scope,
        anio: Number(anio),
        ...(mes != null ? { mes: Number(mes) } : {}),
        // Las borradas conservan la fila para no perder el hilo de `version`,
        // pero no se envían al canvas.
        NOT: { valor: null },
      },
      include: {
        actualizado_por: { select: { id: true, nombre: true } },
      },
      orderBy: [{ mes: "asc" }, { offset_fila: "asc" }, { columna: "asc" }],
    });

    // Agrupadas por mes y hoja: es como las consume el builder.
    const porMes: Record<number, Record<string, AnotacionCelda[]>> = {};
    for (const f of filas) {
      const m = (porMes[f.mes] ??= {});
      (m[f.sheet_key ?? ""] ??= []).push(serializar(f));
    }
    return porMes;
  },

  /**
   * Crea o actualiza una celda anotada.
   *
   * Mismo compare-and-swap que el resto del canvas: el `version` viaja en el
   * WHERE, así que dos usuarios escribiendo la misma celda no se pisan en
   * silencio — el segundo recibe conflicto y el cliente repinta.
   *
   * `base_version: 0` significa "creo la celda". Si ya existiera (otro se
   * adelantó por milisegundos), se responde conflicto en vez de sobrescribir.
   */
  async guardar(params: {
    scope: string;
    anio: number;
    mes: number;
    sheet_key?: string | null;
    /// 'fila' (distancia CON SIGNO al final de la tabla de items), 'top' (fila
    /// absoluta, para la cabecera que no se mueve), 'item' (id del item) o
    /// 'clave' (celda que el builder declara por nombre).
    ancla_tipo?: string;
    ancla_ref?: string;
    offset_fila: number;
    columna: number;
    valor: string | null;
    estilo?: any;
    base_version: number;
    user_id?: string | null;
  }) {
    const {
      scope,
      anio,
      mes,
      offset_fila,
      columna,
      valor,
      estilo,
      base_version,
      user_id,
    } = params;
    const { ancla_tipo, ancla_ref } = normalizarAncla(params);
    if (!SCOPES.has(scope)) throw new Error(`scope inválido: ${scope}`);
    const sheet_key = params.sheet_key ?? "";

    // EL OFFSET DE `fila` VA CON SIGNO. Cuenta filas desde el final del bloque
    // estructurado, y en cierres y adicionales ese final está por DEBAJO de
    // casi toda la hoja: anotar sobre los gastos, los anticipos o los impuestos
    // da un offset negativo perfectamente válido — esa zona entera se desplaza
    // en bloque con el ancla. Exigir `>= 0` para todos los tipos rechazaba justo
    // esas celdas, y como el canvas conserva lo tecleado al fallar el patch, el
    // usuario veía su texto en pantalla creyéndolo guardado.
    //
    // `top` sí es absoluto (fila desde arriba) y `item`/`clave` no usan offset,
    // así que ahí el negativo no significa nada y se sigue rechazando.
    if (!Number.isInteger(offset_fila)) {
      throw new Error("offset_fila debe ser un entero");
    }
    if (ancla_tipo !== "fila" && offset_fila < 0) {
      throw new Error(
        `offset_fila debe ser >= 0 cuando ancla_tipo = '${ancla_tipo}'`,
      );
    }
    if (!Number.isInteger(columna) || columna < 0) {
      throw new Error("columna debe ser un entero >= 0");
    }

    const clave = {
      scope,
      anio: Number(anio),
      mes: Number(mes),
      sheet_key,
      ancla_tipo,
      ancla_ref,
      offset_fila: Number(offset_fila),
      columna: Number(columna),
    };

    const actual = await prisma.canvas_anotacion.findUnique({
      where: { uniq_anotacion_celda: clave },
      select: { id: true, version: true },
    });

    if (!actual) {
      if (Number(base_version) !== 0) {
        // El cliente creía editar algo que ya no está (p. ej. tras revertir
        // un snapshot). Que repinte en vez de resucitarlo.
        return { conflicto: true as const, fila: null };
      }
      const creada = await prisma.canvas_anotacion.create({
        data: {
          ...clave,
          valor,
          estilo: estilo ?? undefined,
          version: 1,
          creado_por_id: user_id ?? null,
          actualizado_por_id: user_id ?? null,
        },
        include: { actualizado_por: { select: { id: true, nombre: true } } },
      });
      return { conflicto: false as const, fila: serializar(creada) };
    }

    // `updateMany` y no `update`: el `version` en el WHERE es lo que convierte
    // esto en compare-and-swap. `update` por id no permite condicionarlo.
    const res = await prisma.canvas_anotacion.updateMany({
      where: { id: actual.id, version: Number(base_version) },
      data: {
        valor,
        ...(estilo !== undefined ? { estilo } : {}),
        version: { increment: 1 },
        actualizado_por_id: user_id ?? null,
      },
    });
    if (res.count === 0) return { conflicto: true as const, fila: null };

    const fila = await prisma.canvas_anotacion.findUnique({
      where: { id: actual.id },
      include: { actualizado_por: { select: { id: true, nombre: true } } },
    });
    return { conflicto: false as const, fila: fila ? serializar(fila) : null };
  },

  /**
   * Snapshot de las anotaciones de un periodo, para incrustarlo en el payload
   * del snapshot de la liquidación y poder restaurarlas al revertir.
   */
  async exportar(scope: string, anio: number, mes: number) {
    if (!SCOPES.has(scope)) throw new Error(`scope inválido: ${scope}`);
    const filas = await prisma.canvas_anotacion.findMany({
      where: { scope, anio: Number(anio), mes: Number(mes) },
      select: {
        sheet_key: true,
        ancla_tipo: true,
        ancla_ref: true,
        offset_fila: true,
        columna: true,
        valor: true,
        estilo: true,
      },
      // Orden fijo. Sin `orderBy`, Postgres no garantiza uno estable y el
      // array cambiaba de posición entre capturas: el snapshot de la
      // liquidación que lo incrusta parecía distinto sin haber cambiado nada.
      orderBy: [{ id: "asc" }],
    });
    return filas;
  },

  /**
   * Restaura las anotaciones de un snapshot.
   *
   * Se sustituye el periodo entero: lo que no venga en el snapshot se marca
   * como borrado (`valor = null`) en vez de eliminarse, para no romper el
   * `version` de clientes que tuvieran esa celda abierta.
   */
  async restaurar(params: {
    scope: string;
    anio: number;
    mes: number;
    anotaciones: Array<{
      sheet_key?: string | null;
      ancla_tipo?: string;
      ancla_ref?: string;
      offset_fila: number;
      columna: number;
      valor: string | null;
      estilo?: any;
    }>;
    user_id?: string | null;
  }) {
    const { scope, anio, mes, anotaciones, user_id } = params;
    if (!SCOPES.has(scope)) throw new Error(`scope inválido: ${scope}`);

    await prisma.$transaction(async (tx) => {
      await tx.canvas_anotacion.updateMany({
        where: { scope, anio: Number(anio), mes: Number(mes) },
        data: {
          valor: null,
          version: { increment: 1 },
          actualizado_por_id: user_id ?? null,
        },
      });

      for (const a of anotaciones ?? []) {
        const clave = {
          scope,
          anio: Number(anio),
          mes: Number(mes),
          sheet_key: a.sheet_key ?? "",
          ...normalizarAncla(a),
          offset_fila: Number(a.offset_fila),
          columna: Number(a.columna),
        };
        await tx.canvas_anotacion.upsert({
          where: { uniq_anotacion_celda: clave },
          create: {
            ...clave,
            valor: a.valor ?? null,
            estilo: a.estilo ?? undefined,
            version: 1,
            creado_por_id: user_id ?? null,
            actualizado_por_id: user_id ?? null,
          },
          update: {
            valor: a.valor ?? null,
            estilo: a.estilo ?? undefined,
            version: { increment: 1 },
            actualizado_por_id: user_id ?? null,
          },
        });
      }
    });
  },
};
