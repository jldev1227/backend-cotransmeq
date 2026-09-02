/**
 * Regla de la cascada de copropietarios y del reparto con cuadre exacto.
 *
 * MISMA TABLA DE CASOS que el spec espejo del frontend
 * (`ingreso-svelte/src/lib/editor/business/reparto-propietarios.spec.ts`).
 * Si se añade un caso aquí, añadirlo también allá: el valor de la pareja de
 * specs es fijar la regla en las dos copias de la aritmética.
 */

import { describe, it, expect } from 'vitest';
import {
  calcularPorcentajesEfectivos,
  repartirValor,
} from './reparto-propietarios';

const p = (id: string, porcentaje: number, orden: number) => ({ id, porcentaje, orden });
const e = (id: string, efectivo: number, orden: number) => ({ id, efectivo, orden });

describe('calcularPorcentajesEfectivos (cascada por orden)', () => {
  it('PMX605: 15/50/50 → 15/42.5/42.5', () => {
    const out = calcularPorcentajesEfectivos([
      p('nelly', 15, 0),
      p('edwin', 50, 1),
      p('transmeralda', 50, 2),
    ]);
    expect(out.get('nelly')).toBe(15);
    expect(out.get('edwin')).toBe(42.5);
    expect(out.get('transmeralda')).toBe(42.5);
  });

  it('respeta `orden`, no la posición en el arreglo', () => {
    const out = calcularPorcentajesEfectivos([
      p('edwin', 50, 1),
      p('transmeralda', 50, 2),
      p('nelly', 15, 0),
    ]);
    expect(out.get('nelly')).toBe(15);
    expect(out.get('edwin')).toBe(42.5);
  });

  it('reordenar cambia la cascada: Edwin primero → 50, y 15/50 reparten el 50', () => {
    const out = calcularPorcentajesEfectivos([
      p('edwin', 50, 0),
      p('nelly', 15, 1),
      p('transmeralda', 50, 2),
    ]);
    expect(out.get('edwin')).toBe(50);
    // 50 × 15/65 y 50 × 50/65, a 4 decimales
    expect(out.get('nelly')).toBe(11.5385);
    expect(out.get('transmeralda')).toBe(38.4615);
  });

  it('propietario único conserva su porcentaje declarado', () => {
    expect(calcularPorcentajesEfectivos([p('a', 100, 0)]).get('a')).toBe(100);
    expect(calcularPorcentajesEfectivos([p('a', 40, 0)]).get('a')).toBe(40);
  });

  it('p1 ≥ 100: el resto recibe 0', () => {
    const out = calcularPorcentajesEfectivos([p('a', 100, 0), p('b', 50, 1), p('c', 50, 2)]);
    expect(out.get('a')).toBe(100);
    expect(out.get('b')).toBe(0);
    expect(out.get('c')).toBe(0);
  });

  it('Σ del resto = 0: el resto recibe 0', () => {
    const out = calcularPorcentajesEfectivos([p('a', 30, 0), p('b', 0, 1), p('c', 0, 2)]);
    expect(out.get('a')).toBe(30);
    expect(out.get('b')).toBe(0);
    expect(out.get('c')).toBe(0);
  });

  it('dos propietarios 80/20: el segundo se queda el remanente completo', () => {
    const out = calcularPorcentajesEfectivos([p('a', 80, 0), p('b', 20, 1)]);
    expect(out.get('a')).toBe(80);
    expect(out.get('b')).toBe(20);
  });

  it('lista vacía → mapa vacío', () => {
    expect(calcularPorcentajesEfectivos([]).size).toBe(0);
  });
});

describe('repartirValor (cuadre exacto con residuo al último)', () => {
  const tres = [e('nelly', 15, 0), e('edwin', 42.5, 1), e('transmeralda', 42.5, 2)];

  it('la suma de las partes es exactamente el total', () => {
    for (const total of [10_000_000, 9_999_999, 1_234_567, 3, 1]) {
      const out = repartirValor(total, tres);
      const suma = [...out.values()].reduce((a, b) => a + b, 0);
      expect(suma).toBe(total);
    }
  });

  it('caso PMX605 con residuo: 1.000.001 → 150.000 / 425.000 / 425.001', () => {
    const out = repartirValor(1_000_001, tres);
    expect(out.get('nelly')).toBe(150_000);
    expect(out.get('edwin')).toBe(425_000);
    expect(out.get('transmeralda')).toBe(425_001);
  });

  it('el residuo cae en el propietario de mayor `orden`, no en el último del arreglo', () => {
    const out = repartirValor(100, [
      e('b', 33.3333, 2),
      e('a', 33.3333, 0),
      e('c', 33.3334, 1),
    ]);
    const suma = [...out.values()].reduce((x, y) => x + y, 0);
    expect(suma).toBe(100);
    expect(out.get('a')).toBe(33);
    expect(out.get('c')).toBe(33);
    expect(out.get('b')).toBe(34);
  });

  it('totales negativos también cuadran (descuentos negativos)', () => {
    const out = repartirValor(-1001, tres);
    const suma = [...out.values()].reduce((a, b) => a + b, 0);
    expect(suma).toBe(-1001);
  });

  it('total no entero se redondea antes de repartir', () => {
    const out = repartirValor(100.4, [e('a', 100, 0)]);
    expect(out.get('a')).toBe(100);
  });

  it('con fila manual: el remanente se reparte entre los demás renormalizando (patrón del service)', () => {
    // Nelly (15) tiene fila manual de $10.000 sobre un impuesto de $100.000.
    // El remanente $90.000 se reparte entre Edwin y Transmeralda (42.5 c/u)
    // renormalizados a 50/50 → 45.000 y 45.000, y el concepto cuadra.
    const restante = 100_000 - 10_000;
    const autos = [e('edwin', 42.5, 1), e('transmeralda', 42.5, 2)];
    const sumaEf = autos.reduce((s, x) => s + x.efectivo, 0);
    const out = repartirValor(
      restante,
      autos.map((x) => ({ ...x, efectivo: (x.efectivo * 100) / sumaEf }))
    );
    expect(out.get('edwin')).toBe(45_000);
    expect(out.get('transmeralda')).toBe(45_000);
    expect(10_000 + 45_000 + 45_000).toBe(100_000);
  });

  it('lista vacía → mapa vacío; cero → todo ceros', () => {
    expect(repartirValor(1000, []).size).toBe(0);
    const out = repartirValor(0, tres);
    expect([...out.values()]).toEqual([0, 0, 0]);
  });
});
