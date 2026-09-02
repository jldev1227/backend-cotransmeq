/**
 * Reparto del cierre final entre copropietarios: cascada de porcentajes y
 * distribución de valores con cuadre exacto.
 *
 * REGLA DE NEGOCIO (cascada por orden). Los porcentajes declarados de los
 * copropietarios son "visuales" y pueden sumar más de 100% (ej. PMX605:
 * 15 + 50 + 50 = 115%). El porcentaje EFECTIVO con el que se calcula es:
 *
 *   - el propietario con menor `orden` toma su porcentaje del total;
 *   - los demás se reparten el remanente (100 − p1) proporcionalmente a sus
 *     porcentajes declarados.
 *
 *   15/50/50 → 15 / 42.5 / 42.5.
 *
 * ⚠️ CONVIVEN DOS COPIAS DE ESTA ARITMÉTICA: esta y el espejo del frontend
 * `ingreso-svelte/src/lib/editor/business/reparto-propietarios.ts` (lo usa el
 * builder de la hoja y el documento del preview/PDF). Cambiar SIEMPRE los dos
 * sitios; `reparto-propietarios.spec.ts` fija la regla con la misma tabla de
 * casos en ambos repos.
 */

export interface PropietarioCascada {
  id: string;
  /** Porcentaje declarado (visual), 0–9999.9999. */
  porcentaje: number;
  orden: number;
}

export interface PropietarioEfectivo {
  id: string;
  /** Porcentaje efectivo (salida de la cascada), 0–100. */
  efectivo: number;
  orden: number;
}

/** Redondeo a los 4 decimales de la columna `porcentaje_efectivo` DECIMAL(8,4). */
function a4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Cascada por orden → porcentaje efectivo por propietario.
 *
 * - n = 1: el efectivo es el declarado tal cual.
 * - p1 ≥ 100: el primero se queda con su porcentaje y el resto recibe 0.
 * - Σ(p2..pn) = 0: no hay proporción posible, el resto recibe 0.
 */
export function calcularPorcentajesEfectivos(
  props: PropietarioCascada[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (props.length === 0) return out;

  const ordenados = [...props].sort((a, b) => a.orden - b.orden);
  const [primero, ...resto] = ordenados;
  out.set(primero.id, a4(primero.porcentaje));
  if (resto.length === 0) return out;

  const remanente = Math.max(0, 100 - primero.porcentaje);
  const sumaResto = resto.reduce((s, p) => s + p.porcentaje, 0);
  for (const p of resto) {
    out.set(p.id, sumaResto > 0 ? a4((remanente * p.porcentaje) / sumaResto) : 0);
  }
  return out;
}

/**
 * Reparte `total` (COP) entre los propietarios según su porcentaje efectivo,
 * con CUADRE EXACTO: cada parte se redondea al peso y el residuo
 * (total − Σ partes) se asigna al propietario de mayor `orden`, de modo que
 * la suma de las partes sea siempre el total redondeado.
 */
export function repartirValor(
  total: number,
  props: PropietarioEfectivo[],
): Map<string, number> {
  const out = new Map<string, number>();
  if (props.length === 0) return out;

  const totalRedondeado = Math.round(total);
  let suma = 0;
  for (const p of props) {
    const parte = Math.round((totalRedondeado * p.efectivo) / 100);
    out.set(p.id, parte);
    suma += parte;
  }

  const ultimo = props.reduce((a, b) => (b.orden >= a.orden ? b : a));
  out.set(ultimo.id, (out.get(ultimo.id) ?? 0) + (totalRedondeado - suma));
  return out;
}
