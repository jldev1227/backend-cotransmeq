/**
 * Resolución de vigencias dentro de un corte de nómina.
 *
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * El corte de nómina va del 21 de un mes al 20 del siguiente, así que cruza
 * por la mitad cualquier cambio normativo que entre en vigor a mitad de mes.
 * El 15-jul-2026 (Ley 2466) pasaron dos cosas a la vez:
 *
 *   · los porcentajes de RD (80→90), HEFD (105→115), HEFN (155→165) y
 *     RNDF (115→125);
 *   · las horas mensuales base, 220 → 210, que es el DIVISOR del valor hora.
 *
 * Lo segundo es lo que se pasa por alto: al cambiar el divisor, el valor hora
 * sube de 7.958,66 a 8.337,64 y **todos** los códigos valen distinto, también
 * los que no tocaron el porcentaje (RN, HED, HEN).
 *
 * Resolver la vigencia una sola vez —con la del cierre del corte, que es lo
 * que se hacía— significa pagar los días de junio a tarifa de julio. Estas
 * dos funciones permiten resolverla POR DÍA y partir el corte en tramos.
 */

/** Lo mínimo que se le pide a una fila con vigencia. */
export interface Vigente {
  vigencia_desde: Date | string;
  vigencia_hasta: Date | string | null;
}

/**
 * El instante con el que se consulta una fecha del calendario.
 *
 * Mediodía UTC = 07:00 en Bogotá: cae dentro del día natural colombiano sin
 * rozar ninguno de sus dos bordes. Importa porque las vigencias se guardan
 * con hora: el corte de la Ley 2466 está en `2026-07-14 19:00:00-05`, que es
 * `2026-07-15T00:00:00Z`. Con mediodía UTC el día 14 resuelve a la tarifa
 * vieja y el 15 a la nueva, que es justo lo que `detalles_recargos_dias`
 * tiene guardado en `fecha_aplicacion`.
 */
export function instanteDeConsulta(fechaISO: string): Date {
  return new Date(`${fechaISO}T12:00:00.000Z`);
}

/**
 * La fila vigente en una fecha: la de `vigencia_desde` más reciente que ya
 * empezó y todavía no expiró. `null` si ninguna cubre esa fecha.
 *
 * No asume que `filas` venga ordenada.
 */
export function vigenteEn<T extends Vigente>(filas: T[], fechaISO: string): T | null {
  const t = instanteDeConsulta(fechaISO).getTime();
  let mejor: T | null = null;
  let mejorDesde = -Infinity;
  for (const f of filas) {
    const desde = new Date(f.vigencia_desde).getTime();
    if (!Number.isFinite(desde) || desde > t) continue;
    if (f.vigencia_hasta !== null && f.vigencia_hasta !== undefined) {
      const hasta = new Date(f.vigencia_hasta).getTime();
      if (Number.isFinite(hasta) && hasta < t) continue;
    }
    if (desde > mejorDesde) {
      mejor = f;
      mejorDesde = desde;
    }
  }
  return mejor;
}

/**
 * Parte una lista de fechas consecutivas en tramos que comparten `clave`.
 *
 * Las vigencias son monótonas en el tiempo, así que agrupar corridas
 * consecutivas basta: no hace falta ordenar ni deduplicar. Devuelve al menos
 * un tramo siempre que `fechas` no esté vacía.
 */
export function tramosPorClave(
  fechas: string[],
  clave: (fechaISO: string) => string,
): { desde: string; hasta: string; clave: string; fechas: string[] }[] {
  const tramos: { desde: string; hasta: string; clave: string; fechas: string[] }[] = [];
  for (const f of fechas) {
    const k = clave(f);
    const ultimo = tramos[tramos.length - 1];
    if (ultimo && ultimo.clave === k) {
      ultimo.hasta = f;
      ultimo.fechas.push(f);
    } else {
      tramos.push({ desde: f, hasta: f, clave: k, fechas: [f] });
    }
  }
  return tramos;
}
