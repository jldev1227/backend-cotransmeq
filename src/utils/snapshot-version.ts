/**
 * Utilidades comunes a los tres módulos de snapshots (final, ocasional y
 * adicionales por periodo): cómo se numera un snapshot y cuándo NO hay que
 * escribirlo.
 *
 * ─── 1. Numeración ────────────────────────────────────────────────────────
 *
 * Los tres servicios numeraban con un `SELECT MAX(version)` y un `INSERT`
 * sueltos, fuera de transacción. Entre ambos pasos median SEGUNDOS: en medio
 * se construye el payload completo, que son decenas de queries. Cualquier
 * otro proceso que capturara la misma cabecera dentro de esa ventana leía el
 * mismo máximo y calculaba la MISMA versión; el segundo INSERT reventaba:
 *
 *   Unique constraint failed on the fields: (`liquidacion_ocasional_id`,`version`)
 *
 * `reservarVersionSnapshot` serializa lectura + inserción con un advisory
 * lock de Postgres tomado sobre `scope`. Es un lock de transacción
 * (`pg_advisory_xact_lock`): se libera solo en el commit/rollback, sirve
 * entre procesos e instancias —no es un mutex de Node, que no serviría de
 * nada con dos réplicas contra la misma BD— y únicamente frena a quien
 * comparte `scope`, así que dos cabeceras distintas siguen capturando en
 * paralelo. El payload se construye FUERA a propósito: dentro del lock solo
 * debe quedar la lectura del último número y el INSERT.
 *
 * ─── 2. Cuándo no escribir ────────────────────────────────────────────────
 *
 * El cron horario capturaba SIEMPRE, hubiera cambios o no: de ahí versiones
 * como la 1042 de un cierre final, cada una con el payload entero repetido en
 * JSONB. Dos frenos, complementarios:
 *
 *   · `hashSnapshotPayload` — si el contenido es idéntico al último snapshot,
 *     la captura `auto` no inserta nada.
 *   · `inicioVentanaAntirrebote` — si ya hay un snapshot `auto` de hace pocos
 *     minutos, el cron ni siquiera construye el payload. Esto es lo que
 *     absorbe el doble disparo: el job corre in-process en CADA instancia y
 *     además está expuesto como endpoint `.../cron-hora`, así que a la misma
 *     hora puede entrar más de una vez.
 */

import { createHash } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";

export type SnapshotTx = Prisma.TransactionClient;

export async function reservarVersionSnapshot<T>(opts: {
  /**
   * Identifica el espacio de numeración. Debe coincidir exactamente con las
   * columnas del unique, p. ej. `snapshot:ocasional:<id>` o
   * `snapshot:adicionales:<anio>-<mes>`.
   */
  scope: string;
  /** Última versión usada. `null` si aún no hay snapshots. */
  ultimaVersion: (tx: SnapshotTx) => Promise<number | null | undefined>;
  /** Inserta con la versión ya reservada; corre con el lock tomado. */
  insertar: (tx: SnapshotTx, version: number) => Promise<T>;
  /** La BD ronda los 500 ms por query, de ahí el margen. */
  timeoutMs?: number;
}): Promise<T> {
  const { scope, ultimaVersion, insertar, timeoutMs = 20000 } = opts;

  return prisma.$transaction(
    async (tx) => {
      // `::text` explícito: sin él, el parámetro llega sin tipo y Postgres
      // no puede resolver la sobrecarga de `hashtext`.
      // `$executeRaw` y no `$queryRaw`: la función devuelve `void` y Prisma no
      // sabe deserializar esa columna ("Failed to deserialize column of type
      // 'void'"). Aquí solo interesa el efecto, no el resultado.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope}::text)::bigint)`;
      const last = await ultimaVersion(tx);
      return insertar(tx, (last ?? 0) + 1);
    },
    { timeout: timeoutMs, maxWait: timeoutMs },
  );
}

/**
 * Serialización canónica. JSONB NO conserva el orden de las claves, así que
 * comparar el `JSON.stringify` de un payload recién construido contra el que
 * vuelve de la BD daría distinto siempre, aunque el contenido sea idéntico.
 */
function canonicalizar(valor: any): any {
  if (Array.isArray(valor)) return valor.map(canonicalizar);
  if (valor instanceof Date) return valor.toISOString();
  if (valor && typeof valor === "object") {
    const orden: Record<string, any> = {};
    for (const clave of Object.keys(valor).sort()) {
      const v = canonicalizar(valor[clave]);
      // JSON.stringify ya descarta `undefined`; hacerlo aquí evita que la
      // diferencia entre "clave ausente" y "clave undefined" mueva el hash.
      if (v !== undefined) orden[clave] = v;
    }
    return orden;
  }
  return valor;
}

/**
 * Huella del CONTENIDO de un snapshot. `meta` queda fuera: lleva
 * `capturado_en` y `version_origen`, que cambian en cada captura por
 * definición y harían que dos snapshots idénticos nunca coincidieran.
 */
export function hashSnapshotPayload(payload: any): string {
  const { meta: _meta, ...contenido } = (payload ?? {}) as Record<string, any>;
  return createHash("sha1")
    .update(JSON.stringify(canonicalizar(contenido)))
    .digest("hex");
}

/**
 * Ventana antirrebote de las capturas `auto`. Algo por debajo de la hora que
 * separa dos ejecuciones legítimas del cron, de modo que solo caiga el
 * disparo duplicado (que llega con segundos o minutos de diferencia).
 */
export const VENTANA_ANTIRREBOTE_MIN = Number(
  process.env.SNAPSHOT_ANTIRREBOTE_MIN || 50,
);

export function inicioVentanaAntirrebote(): Date {
  return new Date(Date.now() - VENTANA_ANTIRREBOTE_MIN * 60 * 1000);
}
