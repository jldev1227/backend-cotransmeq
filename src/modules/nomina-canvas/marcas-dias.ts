/**
 * MARCAS POR DÍA DEL DESPRENDIBLE (`liquidaciones.marcas_dias`).
 *
 * Dos decisiones independientes sobre cada día trabajado, que se toman en el
 * canvas de nómina:
 *
 *   · `ocultar` — el día NO aparece en las tablas de recargos (las del canvas
 *     por empresa y las páginas de detalle del PDF). No cambia el dinero.
 *   · `noSumar` — el día SÍ aparece, pero su valor no entra en los recargos
 *     pagados: sale del reparto del canvas, y con él de `total_recargos`, de
 *     las filas de `recargos` y del neto.
 *
 * Marcar las dos saca el día del todo.
 *
 * La clave es `AAAA-MM-DD|empresa_id` y no la columna del canvas: la columna
 * la decide la rejilla global del libro y cambia cuando otro conductor abre un
 * segundo servicio ese día, mientras que fecha y empresa son lo mismo en la
 * planilla, en la copia de días de la liquidación y en el preview del PDF. El
 * precio es que dos servicios del mismo cliente el mismo día comparten marca,
 * que es también como se leen en el desprendible.
 */
export interface MarcaDia {
  ocultar: boolean;
  noSumar: boolean;
}

export const claveMarcaDia = (fecha: string, empresaId: string | null | undefined): string =>
  `${fecha.slice(0, 10)}|${empresaId ?? ''}`;

const CLAVE_VALIDA = /^\d{4}-\d{2}-\d{2}\|[0-9a-fA-F-]{0,36}$/;

/**
 * Lo guardado, limpio: solo claves bien formadas y solo días con alguna marca.
 * Devuelve `null` cuando no queda ninguna, que es como se guarda «nada
 * marcado» — así una liquidación sin marcas no arrastra un `{}` que haya que
 * distinguir de la ausencia.
 */
export function normalizarMarcasDias(valor: unknown): Record<string, MarcaDia> | null {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return null;
  const limpio: Record<string, MarcaDia> = {};
  for (const [clave, m] of Object.entries(valor as Record<string, any>)) {
    if (!CLAVE_VALIDA.test(clave) || !m || typeof m !== 'object') continue;
    const marca = { ocultar: m.ocultar === true, noSumar: m.noSumar === true };
    if (marca.ocultar || marca.noSumar) limpio[clave] = marca;
  }
  return Object.keys(limpio).length ? limpio : null;
}

export function leerMarcasDias(valor: unknown): Map<string, MarcaDia> {
  return new Map(Object.entries(normalizarMarcasDias(valor) ?? {}));
}
