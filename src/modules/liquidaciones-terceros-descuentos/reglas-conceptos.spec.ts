/**
 * Paridad entre las DOS implementaciones de la aritmética de conceptos.
 *
 * `reglas-conceptos.ts` (backend, usado por el canvas colaborativo) es un
 * port de `ingreso-svelte/src/lib/editor/business/conceptos.service.ts`
 * (frontend, usado por el editor tabular antiguo, que se conserva).
 *
 * Mientras las dos existan, pueden divergir en silencio: el usuario vería
 * un número en el editor y otro en el canvas, y el PDF un tercero. Este
 * test reimplementa las reglas del frontend como ORÁCULO independiente y
 * compara resultado a resultado.
 *
 * Si falla, NO es que el test esté mal: es que las dos copias ya no
 * calculan lo mismo. Arreglar ambas.
 */

import { describe, it, expect } from 'vitest';
import {
  VALOR_DOTACION,
  VALOR_EXAMEN_MEDICO,
  TARIFA_FIJA_GASTOS_DIVERSOS,
  PORCENTAJE_GASTO_POR_ITEM,
  claveConductor,
  totalDiasNoPropietarios,
  recalcularBasesPrestacionesSS,
  recalcularGastosAutomaticos,
  aplicarCampo,
  CONFIG_GASTOS_FALLBACK,
  importeGastosDiversos,
  importePapeleria,
  gastosPorDefectoDelPeriodo,
  type ConceptoLike,
  type ConfigGastosPeriodo,
} from './reglas-conceptos';

// ─── Oráculo: las reglas tal y como están escritas en el frontend ─────
// Copiadas a mano de `conceptos.service.ts`. Deliberadamente NO se importa
// el módulo real (está en otro build); el valor del test está justamente en
// que sea una transcripción independiente.

const O_VALOR_DOTACION = 3985;
const O_VALOR_EXAMEN_MEDICO = 2882;
const O_TARIFA_FIJA = 20000;
const O_PCT_ITEM = 0.004;

function oraculoClave(id: string | null | undefined): string {
  return `0::${id || 'sin-conductor'}`;
}

function oraculoDias(
  conceptos: any[],
  propietarios: Record<string, boolean>,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL' || c.concepto !== 'SALARIO') continue;
    const key = oraculoClave(c.conductor_id);
    if (seen.has(key)) continue;
    seen.add(key);
    if (propietarios[key]) continue;
    total += Number(c.dias) || 0;
  }
  return total;
}

function oraculoBases(conceptos: any[]): any[] {
  const CON_AUX = ['CESANTIAS', 'INTERESES_CESANTIAS', 'PRIMA'];
  const SIN_AUX = ['VACACIONES'];
  const SEG = ['SALUD', 'PENSION', 'ARP', 'PARAFISCALES'];
  const bases = new Map<string, { basePrest: number; baseSinAux: number }>();
  for (const c of conceptos) {
    if (c.tipo !== 'COSTO_LABORAL') continue;
    const key = oraculoClave(c.conductor_id);
    if (!bases.has(key)) bases.set(key, { basePrest: 0, baseSinAux: 0 });
    const b = bases.get(key)!;
    if (['SALARIO', 'AUXILIO_TRANSPORTE', 'RECARGOS'].includes(c.concepto))
      b.basePrest += c.valor_total || 0;
    if (['SALARIO', 'RECARGOS'].includes(c.concepto)) b.baseSinAux += c.valor_total || 0;
  }
  return conceptos.map((c) => {
    if (c.tipo !== 'COSTO_LABORAL') return c;
    const b = bases.get(oraculoClave(c.conductor_id));
    if (!b) return c;
    if (CON_AUX.includes(c.concepto)) {
      return { ...c, base_calculo: b.basePrest, valor_total: b.basePrest * ((c.porcentaje || 0) / 100) };
    }
    if (SIN_AUX.includes(c.concepto) || SEG.includes(c.concepto)) {
      return { ...c, base_calculo: b.baseSinAux, valor_total: b.baseSinAux * ((c.porcentaje || 0) / 100) };
    }
    return c;
  });
}

function oraculoGastos(
  conceptos: any[],
  totalFacturado: number,
  brutoAdicionales: number,
  propietarios: Record<string, boolean>,
): any[] {
  const totalDias = oraculoDias(conceptos, propietarios);
  const totalItems = totalFacturado + brutoAdicionales;
  const pct = Math.round(totalItems * O_PCT_ITEM);
  return conceptos.map((c) => {
    if (c.tipo !== 'GASTO_OPERATIVO') return c;
    if (c.calculado === false) return c;
    if (c.concepto === 'DOTACION') {
      return { ...c, dias: totalDias, valor_unitario: O_VALOR_DOTACION, valor_total: totalDias * O_VALOR_DOTACION, calculado: true };
    }
    if (c.concepto === 'EXAMEN_MEDICO') {
      return { ...c, dias: totalDias, valor_unitario: O_VALOR_EXAMEN_MEDICO, valor_total: totalDias * O_VALOR_EXAMEN_MEDICO, calculado: true };
    }
    if (c.concepto === 'GASTOS_DIVERSOS') {
      const unit = O_TARIFA_FIJA + pct;
      return { ...c, dias: 1, valor_unitario: unit, valor_total: unit, calculado: true };
    }
    return c;
  });
}

// ─── Escenario: dos conductores, uno de ellos propietario ─────────────

function escenario(): ConceptoLike[] {
  return [
    // Conductor A (no propietario)
    { id: 'a1', tipo: 'COSTO_LABORAL', concepto: 'SALARIO', conductor_id: 'A', dias: 30, valor_unitario: 50000, valor_total: 1500000 },
    { id: 'a2', tipo: 'COSTO_LABORAL', concepto: 'AUXILIO_TRANSPORTE', conductor_id: 'A', dias: 30, valor_unitario: 5000, valor_total: 150000 },
    { id: 'a3', tipo: 'COSTO_LABORAL', concepto: 'RECARGOS', conductor_id: 'A', dias: 1, valor_unitario: 90000, valor_total: 90000 },
    { id: 'a4', tipo: 'COSTO_LABORAL', concepto: 'CESANTIAS', conductor_id: 'A', porcentaje: 8.33, valor_total: 0, base_calculo: 0 },
    { id: 'a5', tipo: 'COSTO_LABORAL', concepto: 'VACACIONES', conductor_id: 'A', porcentaje: 4.17, valor_total: 0, base_calculo: 0 },
    { id: 'a6', tipo: 'COSTO_LABORAL', concepto: 'SALUD', conductor_id: 'A', porcentaje: 8.5, valor_total: 0, base_calculo: 0 },
    // Conductor B (propietario → no aporta días a DOTACION/EXAMEN)
    { id: 'b1', tipo: 'COSTO_LABORAL', concepto: 'SALARIO', conductor_id: 'B', dias: 20, valor_unitario: 60000, valor_total: 1200000 },
    { id: 'b2', tipo: 'COSTO_LABORAL', concepto: 'PENSION', conductor_id: 'B', porcentaje: 12, valor_total: 0, base_calculo: 0 },
    // Gastos
    { id: 'g1', tipo: 'GASTO_OPERATIVO', concepto: 'DOTACION', dias: 0, valor_unitario: 0, valor_total: 0, calculado: true },
    { id: 'g2', tipo: 'GASTO_OPERATIVO', concepto: 'EXAMEN_MEDICO', dias: 0, valor_unitario: 0, valor_total: 0, calculado: true },
    { id: 'g3', tipo: 'GASTO_OPERATIVO', concepto: 'GASTOS_DIVERSOS', dias: 1, valor_unitario: 0, valor_total: 0, calculado: true },
    { id: 'g4', tipo: 'GASTO_OPERATIVO', concepto: 'COMBUSTIBLE', dias: 1, valor_unitario: 300000, valor_total: 300000, calculado: false },
  ];
}

const PROPIETARIOS = { [oraculoClave('B')]: true };
const FACTURADO = 47_500_000;
const ADICIONALES_BRUTO = 2_500_000;

describe('reglas-conceptos: paridad con el frontend', () => {
  it('las constantes coinciden', () => {
    expect(VALOR_DOTACION).toBe(O_VALOR_DOTACION);
    expect(VALOR_EXAMEN_MEDICO).toBe(O_VALOR_EXAMEN_MEDICO);
    expect(TARIFA_FIJA_GASTOS_DIVERSOS).toBe(O_TARIFA_FIJA);
    expect(PORCENTAJE_GASTO_POR_ITEM).toBe(O_PCT_ITEM);
  });

  it('la clave de conductor coincide', () => {
    expect(claveConductor('X')).toBe(oraculoClave('X'));
    expect(claveConductor(null)).toBe(oraculoClave(null));
    expect(claveConductor(undefined)).toBe(oraculoClave(undefined));
  });

  it('los días excluyen al propietario', () => {
    const mios = totalDiasNoPropietarios(escenario(), PROPIETARIOS);
    const suyos = oraculoDias(escenario(), PROPIETARIOS);
    expect(mios).toBe(suyos);
    // Solo el conductor A (30 días); B es propietario.
    expect(mios).toBe(30);
  });

  it('las bases de prestaciones y SS coinciden fila a fila', () => {
    const mios = recalcularBasesPrestacionesSS(escenario());
    const suyos = oraculoBases(escenario());
    for (let i = 0; i < mios.length; i++) {
      expect(
        { base: mios[i].base_calculo, total: mios[i].valor_total },
        `fila ${mios[i].id} (${mios[i].concepto})`,
      ).toEqual({ base: suyos[i].base_calculo, total: suyos[i].valor_total });
    }
  });

  it('CESANTIAS usa SALARIO+AUXILIO+RECARGOS y VACACIONES solo SALARIO+RECARGOS', () => {
    const r = recalcularBasesPrestacionesSS(escenario());
    const cesantias = r.find((c) => c.id === 'a4')!;
    const vacaciones = r.find((c) => c.id === 'a5')!;
    expect(cesantias.base_calculo).toBe(1500000 + 150000 + 90000);
    expect(vacaciones.base_calculo).toBe(1500000 + 90000);
  });

  it('los gastos automáticos coinciden fila a fila', () => {
    const base = recalcularBasesPrestacionesSS(escenario());
    const mios = recalcularGastosAutomaticos(base, FACTURADO, ADICIONALES_BRUTO, PROPIETARIOS);
    const suyos = oraculoGastos(oraculoBases(escenario()), FACTURADO, ADICIONALES_BRUTO, PROPIETARIOS);
    for (let i = 0; i < mios.length; i++) {
      expect(
        { d: mios[i].dias, vu: mios[i].valor_unitario, vt: mios[i].valor_total },
        `fila ${mios[i].id} (${mios[i].concepto})`,
      ).toEqual({ d: suyos[i].dias, vu: suyos[i].valor_unitario, vt: suyos[i].valor_total });
    }
  });

  it('COMBUSTIBLE con calculado=false no se toca', () => {
    const r = recalcularGastosAutomaticos(escenario(), FACTURADO, ADICIONALES_BRUTO, PROPIETARIOS);
    const comb = r.find((c) => c.id === 'g4')!;
    expect(comb.valor_unitario).toBe(300000);
    expect(comb.calculado).toBe(false);
  });

  it('GASTOS_DIVERSOS = 20000 + 0,4% de (facturado + adicionales)', () => {
    const r = recalcularGastosAutomaticos(escenario(), FACTURADO, ADICIONALES_BRUTO, PROPIETARIOS);
    const gd = r.find((c) => c.id === 'g3')!;
    expect(gd.valor_unitario).toBe(20000 + Math.round(50_000_000 * 0.004));
    expect(gd.dias).toBe(1);
  });

  it('editar un gasto automático a mano lo desengancha del recálculo', () => {
    const dotacion = escenario().find((c) => c.id === 'g1')!;
    const editado = aplicarCampo(dotacion, 'valor_unitario', 9999);
    expect(editado.calculado).toBe(false);

    const conceptos = escenario().map((c) => (c.id === 'g1' ? editado : c));
    const r = recalcularGastosAutomaticos(conceptos, FACTURADO, ADICIONALES_BRUTO, PROPIETARIOS);
    expect(r.find((c) => c.id === 'g1')!.valor_unitario).toBe(9999);
  });

  it('editar `porcentaje` recalcula sobre base_calculo', () => {
    const c: ConceptoLike = {
      id: 'x', tipo: 'COSTO_LABORAL', concepto: 'CESANTIAS',
      porcentaje: 8.33, base_calculo: 1_000_000, valor_total: 83_300,
    };
    expect(aplicarCampo(c, 'porcentaje', 10).valor_total).toBe(100_000);
  });

  it('rechaza campos fuera de la lista blanca', () => {
    const c = escenario()[0];
    expect(() => aplicarCampo(c, 'valor_total', 1)).toThrow(/no editable/i);
    expect(() => aplicarCampo(c, 'tipo', 'X')).toThrow(/no editable/i);
  });
});

// ─── Config de gastos por periodo ────────────────────────────────────
//
// Papelería y gastos diversos dejaron de ser constantes de código: los valores
// de partida se configuran por mes. Lo que se prueba aquí es el contrato de
// esa configuración, no la aritmética de arriba.

describe('gastos por periodo', () => {
  const CONFIG: ConfigGastosPeriodo = {
    pct_gastos_diversos: 0.5,
    fijo_gastos_diversos: 30000,
    papeleria_alta: 40000,
    papeleria_baja: 15000,
    papeleria_umbral: 2000000,
  };

  it('el fallback reproduce lo que regía antes de la config', () => {
    // Si esto falla, un mes sin configurar cambió de comportamiento al
    // introducir la tabla, que es justo lo que no puede pasar.
    expect(CONFIG_GASTOS_FALLBACK.fijo_gastos_diversos).toBe(O_TARIFA_FIJA);
    expect(CONFIG_GASTOS_FALLBACK.pct_gastos_diversos / 100).toBe(O_PCT_ITEM);
    expect(importeGastosDiversos(CONFIG_GASTOS_FALLBACK, 1_000_000)).toBe(
      O_TARIFA_FIJA + Math.round(1_000_000 * O_PCT_ITEM),
    );
  });

  it('GASTOS_DIVERSOS = fijo + pct% de la base, con el % redondeado antes de sumar', () => {
    // 3.333.333 × 0,5% = 16.666,665 → 16.667, y no 16.666: el redondeo va
    // ANTES del fijo, como en el cálculo de siempre.
    expect(importeGastosDiversos(CONFIG, 3_333_333)).toBe(30000 + 16667);
  });

  it('PAPELERIA usa el tramo alto solo por ENCIMA del umbral', () => {
    expect(importePapeleria(CONFIG, 2_000_001)).toBe(40000);
    // El umbral exacto NO cuenta como «más de»: sigue siendo el tramo bajo.
    expect(importePapeleria(CONFIG, 2_000_000)).toBe(15000);
    expect(importePapeleria(CONFIG, 900_000)).toBe(15000);
  });

  it('con el fallback, el millón exacto va al tramo bajo y por encima al alto', () => {
    expect(importePapeleria(CONFIG_GASTOS_FALLBACK, 1_000_000)).toBe(20000);
    expect(importePapeleria(CONFIG_GASTOS_FALLBACK, 1_000_001)).toBe(25000);
  });

  it('la siembra del periodo resuelve papelería y gastos diversos, y deja los días en cero', () => {
    const filas = gastosPorDefectoDelPeriodo(CONFIG, {
      baseFacturada: 1_000_000,
      valorLiquidar: 3_000_000,
    });
    const por = (c: string) => filas.find((f) => f.concepto === c)!;

    expect(por('GASTOS_DIVERSOS').valor_unitario).toBe(30000 + 5000);
    expect(por('PAPELERIA').valor_unitario).toBe(40000);
    // Dependen de los conductores, que al generar el borrador aún no existen.
    expect(por('DOTACION').dias).toBe(0);
    expect(por('EXAMEN_MEDICO').dias).toBe(0);
    // COMBUSTIBLE no se estima nunca.
    expect(por('COMBUSTIBLE').valor_unitario).toBe(0);
    expect(filas).toHaveLength(5);
  });

  it('el recálculo aplica la config del periodo a papelería y gastos diversos', () => {
    const conceptos: ConceptoLike[] = [
      { id: 'p', tipo: 'GASTO_OPERATIVO', concepto: 'PAPELERIA', dias: 1, valor_unitario: 1, valor_total: 1, calculado: true },
      { id: 'd', tipo: 'GASTO_OPERATIVO', concepto: 'GASTOS_DIVERSOS', dias: 1, valor_unitario: 1, valor_total: 1, calculado: true },
    ];
    const r = recalcularGastosAutomaticos(conceptos, 1_000_000, 0, {}, CONFIG, 3_000_000);
    expect(r.find((c) => c.concepto === 'PAPELERIA')!.valor_total).toBe(40000);
    expect(r.find((c) => c.concepto === 'GASTOS_DIVERSOS')!.valor_total).toBe(35000);
  });

  it('un valor tecleado a mano en papelería no se pisa', () => {
    const conceptos: ConceptoLike[] = [
      { id: 'p', tipo: 'GASTO_OPERATIVO', concepto: 'PAPELERIA', dias: 1, valor_unitario: 7777, valor_total: 7777, calculado: false },
    ];
    const r = recalcularGastosAutomaticos(conceptos, 1_000_000, 0, {}, CONFIG, 3_000_000);
    expect(r[0].valor_total).toBe(7777);
  });

  it('sin `valorLiquidar` no se inventa un tramo: papelería queda como estaba', () => {
    const conceptos: ConceptoLike[] = [
      { id: 'p', tipo: 'GASTO_OPERATIVO', concepto: 'PAPELERIA', dias: 1, valor_unitario: 5555, valor_total: 5555, calculado: true },
    ];
    const r = recalcularGastosAutomaticos(conceptos, 1_000_000, 0, {}, CONFIG);
    expect(r[0].valor_total).toBe(5555);
  });
});
