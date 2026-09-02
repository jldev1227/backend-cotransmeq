import { numeroDeCelda } from "../../utils/numero-de-celda";
/**
 * Reglas de negocio sobre los conceptos de un cierre final.
 *
 * PORT del frontend `ingreso-svelte/src/lib/editor/business/conceptos.service.ts`.
 *
 * ⚠️ CONVIVEN DOS COPIAS DE ESTA ARITMÉTICA. La del frontend la sigue usando
 * el editor tabular antiguo, que se conserva. Mientras las dos existan, hay
 * riesgo de que divirjan y el usuario vea un número en el editor y otro en
 * el canvas. Las constantes y las fórmulas deben cambiarse SIEMPRE en los
 * dos sitios; `reglas-conceptos.spec.ts` compara ambas implementaciones.
 *
 * Este módulo NO calcula impuestos: esa lógica ya vive en
 * `calcularImpuestos` / `recalcularImpuestosPorPropietario`, incluida la
 * regla no configurable de que AVISOS_TABLEROS y SOBRETASA_BOMBERIL gravan
 * sobre el VALOR de RETENCION_ICA y no sobre la base. Reimplementarla aquí
 * sería la tercera copia.
 */

// ─── Constantes de dominio ────────────────────────────────────────────
// Deben coincidir con `conceptos.service.ts` del frontend.

export const ORDEN_GASTOS_CANONICO: Record<string, number> = {
  DOTACION: 1,
  EXAMEN_MEDICO: 2,
  COMBUSTIBLE: 3,
  PAPELERIA: 4,
  GASTOS_DIVERSOS: 5,
};

export const CONCEPTOS_CALCULADOS_AUTO = new Set([
  'DOTACION',
  'EXAMEN_MEDICO',
  'GASTOS_DIVERSOS',
]);

/**
 * Base del `orden` de los gastos. Espejo de `conceptos.service.ts` en el
 * frontend: el builder del canvas ordena la sección por `orden`, así que si
 * los dos lados no arrancan del mismo número las filas salen barajadas.
 */
export const ORDEN_BASE_GASTO = 5000;
/** Gastos que no están en `ORDEN_GASTOS_CANONICO`: van detrás de los cinco fijos. */
export const ORDEN_BASE_GASTO_NO_CANONICO =
  ORDEN_BASE_GASTO + Object.keys(ORDEN_GASTOS_CANONICO).length;
export const ORDEN_BASE_ANTICIPO = 6000;

/**
 * Bloque de partida de un conductor añadido A MANO desde el canvas.
 *
 * No sale de la nómina —por definición: si estuviera en nómina se traería con
 * «Sincronizar con nómina»—, así que hace falta un punto de partida. Son los
 * valores con los que el equipo abre la fila y luego ajusta en la hoja.
 *
 * LO QUE TRAE VALOR ES EL PRECIO UNITARIO, NO LA CANTIDAD. Las cuatro filas
 * nacen con CANTIDAD CERO —y por tanto con total cero— porque cuántos días
 * trabajó alguien, cuántos bonos recibió o cuántas horas de recargo hizo es
 * un dato del mes que nadie puede suponer. Sembrar 20 días «por si acaso»
 * mete plata en la liquidación que nadie tecleó, y un cero que hay que
 * rellenar se ve; un número inventado que parece bueno, no.
 *
 * El precio unitario sí se siembra: es tarifa, no medida, y ahorra buscarla.
 *
 * ⚠️ El valor del día de SALARIO aquí (69.510) NO es el
 * `valor_dia_conductor` de la configuración (78.629,90) que usa
 * `autocompletarNomina`. Es deliberado: son dos orígenes distintos y el alta
 * manual arranca con la tarifa que pidió el negocio.
 */
/**
 * Tarifa del TURNO DOBLE.
 *
 * Va aquí arriba, y no incrustada en el bloque, porque la usan los dos
 * caminos por los que nace un conductor en un cierre: el alta manual desde el
 * modal del carril y la sincronización con nómina. Nómina NO trae este dato
 * —no hay concepto de turno doble en la liquidación laboral—, así que la fila
 * nace en CANTIDAD CERO y es el equipo quien teclea cuántos hubo en el mes.
 * Es el mismo criterio que BONIFICACION y que los gastos de vehículo: la
 * tarifa se siembra porque es tarifa y ahorra buscarla; la medida no, porque
 * inventarla mete plata que nadie tecleó.
 */
export const VALOR_TURNO_DOBLE = 25000;

export const BLOQUE_CONDUCTOR_MANUAL = {
  DIAS_POR_DEFECTO: 0,
  SALARIO: 69510,
  AUXILIO_TRANSPORTE: 8303,
  BONIFICACION: { dias: 0, valor_unitario: 26061 },
  BONIFICACION_TURNO_DOBLE: { dias: 0, valor_unitario: VALOR_TURNO_DOBLE },
  RECARGOS: { dias: 0, valor_unitario: 0 },
} as const;

export const VALOR_DOTACION = 3985;
export const VALOR_EXAMEN_MEDICO = 2882;
export const VALOR_PAPELERIA = 25000;
export const TARIFA_FIJA_GASTOS_DIVERSOS = 20000;
export const PORCENTAJE_GASTO_POR_ITEM = 0.004;

/**
 * Las CINCO filas de GASTOS DE VEHÍCULO, con su valor de partida.
 *
 * La sección existe siempre, aunque esté a cero: son gastos fijos del
 * vehículo y el equipo necesita las filas para teclear encima. Hasta ahora un
 * cierre recién generado enseñaba «(sin gastos)» y no había forma de crear
 * ninguna desde el canvas.
 *
 * Tres se recalculan solas (`CONCEPTOS_CALCULADOS_AUTO`) y su
 * `valor_unitario` de aquí es solo el punto de partida:
 *
 *   DOTACION        = díasNoPropietarios × 3.985
 *   EXAMEN_MEDICO   = díasNoPropietarios × 2.882
 *   GASTOS_DIVERSOS = 20.000 + 0,4% × (Σ TOTAL de los items + Σ bruto adicionales)
 *
 * Las otras dos son 100% manuales y no las toca nadie:
 *
 *   COMBUSTIBLE  nace en CERO — lo carga quien lo liquide, no hay forma de
 *                estimarlo.
 *   PAPELERIA    nace en 25.000, que es la tarifa fija del negocio.
 */
export const GASTOS_POR_DEFECTO: Array<{
  concepto: string;
  dias: number;
  valor_unitario: number;
  calculado: boolean;
}> = [
  { concepto: 'DOTACION', dias: 0, valor_unitario: VALOR_DOTACION, calculado: true },
  { concepto: 'EXAMEN_MEDICO', dias: 0, valor_unitario: VALOR_EXAMEN_MEDICO, calculado: true },
  { concepto: 'COMBUSTIBLE', dias: 1, valor_unitario: 0, calculado: false },
  { concepto: 'PAPELERIA', dias: 1, valor_unitario: VALOR_PAPELERIA, calculado: false },
  { concepto: 'GASTOS_DIVERSOS', dias: 1, valor_unitario: TARIFA_FIJA_GASTOS_DIVERSOS, calculado: true },
];

const PRESTACIONES_CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
const PRESTACIONES_SIN_AUX = ['VACACIONES'];
const SEGURIDAD = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];
const BASE_CON_AUX = ['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'];
const BASE_SIN_AUX = ['SALARIO', 'RECARGOS'];

export interface ConceptoLike {
  id: string;
  tipo: string;
  concepto: string;
  conductor_id?: string | null;
  dias?: any;
  valor_unitario?: any;
  porcentaje?: any;
  valor_total?: any;
  base_calculo?: any;
  calculado?: boolean;
  orden?: number;
}

function num(v: any): number {
  // `numeroDeCelda` y no `Number`: lo que manda el canvas puede venir ya
  // formateado (`"$8,303"`), y `Number` de eso es NaN → se guardaba 0.
  return numeroDeCelda(v) ?? 0;
}

/**
 * Clave del map de propietarios.
 *
 * El prefijo `0::` es herencia del editor tabular, donde la clave incluía
 * el índice de placa. Se conserva porque `es_propietario_overrides` ya está
 * persistido con ese formato; cambiarlo invalidaría los overrides guardados.
 */
export function claveConductor(conductorId: string | null | undefined): string {
  return `0::${conductorId || 'sin-conductor'}`;
}

/**
 * Normaliza `es_propietario_overrides` a la clave del cálculo (`0::id`).
 *
 * La columna ha convivido con DOS formatos, y no se puede elegir uno sin
 * migrar: el editor tabular guardaba el `conductorId` CRUDO, y el endpoint de
 * conductores del canvas guarda ya la clave con prefijo. Quien lee tiene que
 * aceptar los dos, o los cierres viejos dejarían de reconocer a su
 * propietario y le empezarían a imputar dotación y examen médico.
 */
export function normalizarOverridesPropietario(
  raw: Record<string, any> | null | undefined,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    out[k.startsWith('0::') ? k : claveConductor(k)] = v === true;
  }
  return out;
}

/**
 * Días de SALARIO de conductores NO propietarios, deduplicados por conductor.
 *
 * Es la base de DOTACION y EXAMEN_MEDICO: al propietario del vehículo no se
 * le imputan esos gastos.
 */
export function totalDiasNoPropietarios(
  conceptos: ConceptoLike[],
  propietarios: Record<string, boolean>,
): number {
  const vistos = new Set<string>();
  let total = 0;
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL' || c.concepto !== 'SALARIO') continue;
    const key = claveConductor(c.conductor_id);
    if (vistos.has(key)) continue;
    vistos.add(key);
    if (propietarios[key]) continue;
    total += num(c.dias);
  }
  return total;
}

/**
 * Recalcula `base_calculo` y `valor_total` de prestaciones y seguridad
 * social a partir de los salarios de cada conductor.
 *
 *   PRESTACIONES_CON_AUX (cesantías, intereses, prima) → SALARIO + AUXILIO + RECARGOS
 *   VACACIONES y SEGURIDAD SOCIAL                      → SALARIO + RECARGOS
 */
export function recalcularBasesPrestacionesSS(
  conceptos: ConceptoLike[],
): ConceptoLike[] {
  const bases = new Map<string, { conAux: number; sinAux: number }>();

  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL') continue;
    const key = claveConductor(c.conductor_id);
    if (!bases.has(key)) bases.set(key, { conAux: 0, sinAux: 0 });
    const b = bases.get(key)!;
    if (BASE_CON_AUX.includes(c.concepto)) b.conAux += num(c.valor_total);
    if (BASE_SIN_AUX.includes(c.concepto)) b.sinAux += num(c.valor_total);
  }

  return conceptos.map((c) => {
    if (c.tipo !== 'COSTO_LABORAL') return c;
    const b = bases.get(claveConductor(c.conductor_id));
    if (!b) return c;
    if (PRESTACIONES_CON_AUX.includes(c.concepto)) {
      return { ...c, base_calculo: b.conAux, valor_total: b.conAux * (num(c.porcentaje) / 100) };
    }
    if (PRESTACIONES_SIN_AUX.includes(c.concepto) || SEGURIDAD.includes(c.concepto)) {
      return { ...c, base_calculo: b.sinAux, valor_total: b.sinAux * (num(c.porcentaje) / 100) };
    }
    return c;
  });
}

/**
 * Recalcula los tres gastos automáticos.
 *
 * Respeta `calculado === false`, que es la marca de que el usuario
 * sobreescribió el valor a mano y no quiere que se le pise.
 *
 *   DOTACION        = díasNoPropietarios × 3985
 *   EXAMEN_MEDICO   = díasNoPropietarios × 2882
 *   GASTOS_DIVERSOS = 20000 + round(0,4% × (Σ facturado items + Σ bruto adicionales))
 *
 * COMBUSTIBLE y PAPELERIA son 100% manuales: no se tocan nunca.
 */
export function recalcularGastosAutomaticos(
  conceptos: ConceptoLike[],
  totalFacturadoItems: number,
  brutoAdicionales: number,
  propietarios: Record<string, boolean>,
): ConceptoLike[] {
  const dias = totalDiasNoPropietarios(conceptos, propietarios);
  const baseDiversos = totalFacturadoItems + brutoAdicionales;
  const porcentaje = Math.round(baseDiversos * PORCENTAJE_GASTO_POR_ITEM);

  return conceptos.map((c) => {
    if (c.tipo !== 'GASTO_OPERATIVO') return c;
    if (c.calculado === false) return c;

    if (c.concepto === 'DOTACION') {
      return { ...c, dias, valor_unitario: VALOR_DOTACION, valor_total: dias * VALOR_DOTACION, calculado: true };
    }
    if (c.concepto === 'EXAMEN_MEDICO') {
      return { ...c, dias, valor_unitario: VALOR_EXAMEN_MEDICO, valor_total: dias * VALOR_EXAMEN_MEDICO, calculado: true };
    }
    if (c.concepto === 'GASTOS_DIVERSOS') {
      const unit = TARIFA_FIJA_GASTOS_DIVERSOS + porcentaje;
      return { ...c, dias: 1, valor_unitario: unit, valor_total: unit, calculado: true };
    }
    return c;
  });
}

/**
 * Aplica la edición de UN campo sobre UNA fila y devuelve la fila mutada.
 *
 * Es el equivalente servidor de lo que hacía el adapter en el cliente. Se
 * mantiene aquí para que la derivación `valor_total = dias × valor_unitario`
 * viva en un solo sitio.
 */
export function aplicarCampo(
  concepto: ConceptoLike,
  field: string,
  value: any,
): ConceptoLike {
  const c = { ...concepto };

  switch (field) {
    case 'dias':
      c.dias = num(value);
      c.valor_total = num(c.dias) * num(c.valor_unitario);
      // Editar a mano un gasto automático lo desengancha del recálculo.
      if (c.tipo === 'GASTO_OPERATIVO' && CONCEPTOS_CALCULADOS_AUTO.has(c.concepto)) {
        c.calculado = false;
      }
      break;

    case 'valor_unitario':
      c.valor_unitario = num(value);
      c.valor_total = num(c.dias) * num(c.valor_unitario);
      if (c.tipo === 'GASTO_OPERATIVO' && CONCEPTOS_CALCULADOS_AUTO.has(c.concepto)) {
        c.calculado = false;
      }
      break;

    case 'porcentaje':
      c.porcentaje = num(value);
      c.valor_total = num(c.base_calculo) * (num(c.porcentaje) / 100);
      break;

    case 'concepto':
      c.concepto = String(value ?? '');
      break;

    case 'observaciones':
      // En los ANTICIPOS este campo guarda la FECHA (no hay columna propia).
      (c as any).observaciones = value == null ? null : String(value);
      break;

    default:
      throw new Error(`Campo no editable: ${field}`);
  }

  return c;
}

/** Campos que un patch puede tocar. Espejo de `EDITABLE_FIELDS` del cliente. */
export const CAMPOS_EDITABLES_CONCEPTO = new Set([
  'dias',
  'valor_unitario',
  'porcentaje',
  'concepto',
  'observaciones',
]);
