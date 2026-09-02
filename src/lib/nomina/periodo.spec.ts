import { describe, it, expect } from 'vitest';
import {
  diasDelPeriodo,
  mesesDePlanilla,
  textoDias,
  semanasDelPeriodo,
  tramosDeMes,
} from './periodo';

// Los valores esperados salen de los Excel reales de agosto 2026
// (~/Downloads/NOMINA*AGOSTO 2026). Si el canvas no reproduce estos
// literales, el desglose por empresa no se parecerá al que la gente
// lleva leyendo todo el año.

describe('diasDelPeriodo', () => {
  const dias = diasDelPeriodo(2026, 8);

  it('va del 21 de julio al 20 de agosto', () => {
    expect(dias).toHaveLength(31);
    expect(dias[0]).toMatchObject({ fecha: '2026-07-21', dia: 21, mes: 7, nombreMes: 'JULIO' });
    expect(dias[30]).toMatchObject({ fecha: '2026-08-20', dia: 20, mes: 8, nombreMes: 'AGOSTO' });
  });

  it('reproduce los nombres de día de la fila 5 del Excel', () => {
    // R5 del Excel: 21=MARTES, 22=MIERCOLES … 31=VIERNES, 1=SABADO
    expect(dias[0].nombreDia).toBe('MARTES');
    expect(dias[1].nombreDia).toBe('MIÉRCOLES');
    expect(dias[4].nombreDia).toBe('SÁBADO');
    expect(dias[5].nombreDia).toBe('DOMINGO');
    expect(dias[5].esDomingo).toBe(true);
    // 1 de agosto = índice 11
    expect(dias[11]).toMatchObject({ dia: 1, mes: 8, nombreDia: 'SÁBADO' });
  });

  it('no se desplaza por zona horaria', () => {
    // Con hora local de Bogotá un new Date('2026-08-01') cae en el 31 de julio.
    expect(dias.filter((d) => d.fecha === '2026-08-01')).toHaveLength(1);
    expect(new Set(dias.map((d) => d.fecha)).size).toBe(31);
  });

  it('con corte 1 devuelve el mes natural', () => {
    const naturales = diasDelPeriodo(2026, 8, 1);
    expect(naturales).toHaveLength(31);
    expect(naturales[0].fecha).toBe('2026-08-01');
    expect(naturales[30].fecha).toBe('2026-08-31');
  });

  it('cruza el cambio de año', () => {
    const enero = diasDelPeriodo(2026, 1);
    expect(enero[0]).toMatchObject({ fecha: '2025-12-21', anio: 2025, mes: 12 });
    expect(enero[enero.length - 1].fecha).toBe('2026-01-20');
  });
});

describe('mesesDePlanilla', () => {
  it('pide los dos meses que cruza el periodo', () => {
    expect(mesesDePlanilla(2026, 8)).toEqual([{ anio: 2026, mes: 7 }, { anio: 2026, mes: 8 }]);
    expect(mesesDePlanilla(2026, 1)).toEqual([{ anio: 2025, mes: 12 }, { anio: 2026, mes: 1 }]);
  });
});

describe('textoDias — literales tomados de los Excel', () => {
  it('un solo día', () => {
    expect(textoDias([25], 7, 2026)).toBe('25 DE JULIO DE 2026');
  });
  it('dos días sueltos', () => {
    expect(textoDias([26, 29], 7, 2026)).toBe('26 Y 29 DE JULIO DE 2026');
  });
  it('racha de tres se lista, no se abrevia', () => {
    expect(textoDias([1, 2, 3], 8, 2026)).toBe('1, 2 Y 3 DE AGOSTO DE 2026');
  });
  it('cuatro sueltos', () => {
    expect(textoDias([12, 14, 15, 16], 8, 2026)).toBe('12, 14, 15 Y 16 DE AGOSTO DE 2026');
  });
  it('suelto + rango: sin conjunción final', () => {
    expect(textoDias([7, 13, 14, 15, 16, 17, 18, 19], 8, 2026)).toBe(
      '7, 13 AL 19 DE AGOSTO DE 2026',
    );
  });
  it('rango + suelto: sin conjunción final', () => {
    expect(textoDias([1, 2, 3, 4, 5, 13], 8, 2026)).toBe('1 AL 5, 13 DE AGOSTO DE 2026');
  });
  it('un único rango', () => {
    expect(textoDias([21, 22, 23, 24, 25], 7, 2026)).toBe('21 AL 25 DE JULIO DE 2026');
  });
  it('ordena y deduplica lo que le llegue', () => {
    expect(textoDias([3, 1, 2, 3], 8, 2026)).toBe('1, 2 Y 3 DE AGOSTO DE 2026');
  });
  it('sin días devuelve cadena vacía', () => {
    expect(textoDias([], 8, 2026)).toBe('');
  });
});

describe('semanasDelPeriodo — etiquetas de las filas N24:S33 del Excel', () => {
  const semanas = semanasDelPeriodo(diasDelPeriodo(2026, 8));

  it('parte en semanas de lunes a domingo recortadas', () => {
    expect(semanas.map((s) => s.etiqueta)).toEqual([
      'SEMANA DEL 21 AL 26 DE JULIO',
      'SEMANA DEL 27 DE JULIO AL 2 DE AGOSTO',
      'SEMANA DEL 3 AL 9 DE AGOSTO',
      'SEMANA DEL 10 AL 16 DE AGOSTO',
      'SEMANA DEL 17 AL 20 DE AGOSTO',
    ]);
  });

  it('cubre el periodo entero sin huecos ni solapes', () => {
    const indices = semanas.flatMap((s) => s.indices);
    expect(indices).toEqual([...Array(31).keys()]);
  });
});

describe('tramosDeMes', () => {
  it('da los merges de la fila de cabecera', () => {
    expect(tramosDeMes(diasDelPeriodo(2026, 8))).toEqual([
      { nombreMes: 'JULIO', mes: 7, anio: 2026, desde: 0, hasta: 10 },
      { nombreMes: 'AGOSTO', mes: 8, anio: 2026, desde: 11, hasta: 30 },
    ]);
  });
});
