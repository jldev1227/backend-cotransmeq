import { describe, it, expect } from 'vitest';
import {
  liquidarNomina,
  derivadosLiquidacion,
  type EntradaLiquidacion,
  type ParametrosNomina,
} from './liquidar';

const PAREX = 'cfb258a6-448c-4469-aa71-8eeafa4530ef';
const GEOPARK = 'eea5eda5-1b60-45a0-b4c7-606a8c908ff9';

const PARAMS: ParametrosNomina = {
  auxilioTransporteMensual: 249095,
  salarioVillanueva: 2358897,
  porcentajeSalud: 4,
  porcentajePension: 4,
  empresaParexId: PAREX,
  empresaGeoparkId: GEOPARK,
  fraccionAjusteRecargos: 0.08,
};

function entrada(over: Partial<EntradaLiquidacion> = {}): EntradaLiquidacion {
  return {
    salarioBase: 1750905,
    diasLaborados: 30,
    diasLaboradosVillanueva: 0,
    detallesVehiculos: [],
    previewRecargosGrupos: [],
    anticipos: [],
    conceptosAdicionales: [],
    valorVacaciones: 0,
    vacacionesInicio: null,
    vacacionesFin: null,
    interesCesantias: 0,
    disponibilidad: 0,
    descontarTransporte: false,
    aplicaAjusteVillanueva: false,
    ajusteVillanuevaPorDia: false,
    aplicaAjusteParex: false,
    aplicaAjusteGeopark: false,
    ajusteRecargosCompletos: false,
    aplicaIncapacidad: false,
    diasAjusteDeducciones: null,
    noDescontarSalud: false,
    noDescontarPension: false,
    descontarSaludSalario: false,
    descontarPensionSalario: false,
    ...over,
  };
}

describe('caso base — contrastado con DayroRodriguez-Agosto2026.xlsx', () => {
  // Del Excel: X25 SALARIO = 1 750 905 (30 días), X27 AUXILIO = 249 095,
  // Z25 SALUD = Z26 PENSIÓN = 70 036,20 (4 % sobre base 1 750 905).
  const r = liquidarNomina(entrada(), PARAMS);

  it('devenga el salario completo con 30 días', () => {
    expect(r.salarioDevengado).toBe(1750905);
  });

  it('prorratea el auxilio de transporte a 30 días', () => {
    expect(Math.round(r.auxilioTransporte)).toBe(249095);
  });

  it('descuenta 4 % de salud y 4 % de pensión sobre el devengado', () => {
    expect(r.salud).toBeCloseTo(70036.2, 2);
    expect(r.pension).toBeCloseTo(70036.2, 2);
  });

  it('el auxilio de transporte suma al bruto pero no cotiza', () => {
    expect(r.baseCalculoSalud).toBe(1750905);
    expect(r.sueldoBruto).toBeCloseTo(1750905 + 249095, 2);
  });

  it('neto = bruto − deducciones', () => {
    expect(r.sueldoTotal).toBeCloseTo(r.sueldoBruto - r.totalDeducciones, 6);
  });
});

describe('prorrateo por días', () => {
  it('15 días devengan la mitad', () => {
    const r = liquidarNomina(entrada({ diasLaborados: 15 }), PARAMS);
    expect(r.salarioDevengado).toBeCloseTo(1750905 / 2, 6);
    // 249095/30*15 da 124547,4999… en coma flotante, no 124547,5 exacto.
    expect(r.auxilioTransporte).toBeCloseTo(124547.5, 2);
  });

  it('descontarTransporte anula el auxilio', () => {
    const r = liquidarNomina(entrada({ descontarTransporte: true }), PARAMS);
    expect(r.auxilioTransporte).toBe(0);
  });
});

describe('recargos del preview', () => {
  // El preview llega EXPANDIDO: una entrada por planilla origen, todas con
  // el mismo `valor` = total del grupo. Sumarlas tal cual multiplica.
  const grupos = [
    { key: 'g1', valor: 100000, empresa_id: PAREX, origen_planilla_id: 'p1' },
    { key: 'g1', valor: 100000, empresa_id: PAREX, origen_planilla_id: 'p2' },
    { key: 'g2', valor: 50000, empresa_id: GEOPARK, origen_planilla_id: 'p3' },
  ];

  it('deduplica por key en vez de sumar cada expansión', () => {
    const r = liquidarNomina(entrada({ previewRecargosGrupos: grupos }), PARAMS);
    expect(r.totalRecargos).toBe(150000);
  });

  it('respeta incluir: false', () => {
    const r = liquidarNomina(
      entrada({
        previewRecargosGrupos: grupos.map((g) =>
          g.key === 'g2' ? { ...g, incluir: false } : g,
        ),
      }),
      PARAMS,
    );
    expect(r.totalRecargos).toBe(100000);
  });

  it('un grupo con TODAS sus planillas sobreescritas no suma dos veces', () => {
    const r = liquidarNomina(
      entrada({
        previewRecargosGrupos: grupos,
        detallesVehiculos: [
          {
            bonos: [],
            pernotes: [],
            recargos: [
              { valor: 90000, empresa_id: PAREX, es_override: true, origen_planilla_id: 'p1' },
              { valor: 0, empresa_id: PAREX, es_override: true, origen_planilla_id: 'p2' },
            ],
          },
        ],
      }),
      PARAMS,
    );
    // g1 (200k expandido → 100k) se descarta; quedan los manuales 90k + g2 50k.
    expect(r.totalRecargos).toBe(140000);
  });

  it('si queda una planilla del grupo sin sobreescribir, el grupo aporta entero', () => {
    const r = liquidarNomina(
      entrada({
        previewRecargosGrupos: grupos,
        detallesVehiculos: [
          {
            bonos: [],
            pernotes: [],
            recargos: [
              { valor: 90000, empresa_id: PAREX, es_override: true, origen_planilla_id: 'p1' },
            ],
          },
        ],
      }),
      PARAMS,
    );
    expect(r.totalRecargos).toBe(90000 + 100000 + 50000);
  });

  it('los recargos automáticos no se suman por el canal manual', () => {
    const r = liquidarNomina(
      entrada({
        detallesVehiculos: [
          {
            bonos: [],
            pernotes: [],
            recargos: [
              { valor: 77000, empresa_id: PAREX, es_automatico: true },
              { valor: 11000, empresa_id: PAREX },
            ],
          },
        ],
      }),
      PARAMS,
    );
    expect(r.totalRecargos).toBe(11000);
  });
});

describe('ajuste salarial Villanueva', () => {
  it('con 17 días o más se paga el ajuste completo', () => {
    const r = liquidarNomina(
      entrada({ aplicaAjusteVillanueva: true, diasLaboradosVillanueva: 17 }),
      PARAMS,
    );
    expect(r.bonificacionVillanueva).toBe(2358897 - 1750905);
  });

  it('con menos de 17 días se prorratea', () => {
    const r = liquidarNomina(
      entrada({ aplicaAjusteVillanueva: true, diasLaboradosVillanueva: 10 }),
      PARAMS,
    );
    expect(r.bonificacionVillanueva).toBeCloseTo(((2358897 - 1750905) / 30) * 10, 6);
  });

  it('el interruptor "por día" fuerza el prorrateo aunque haya 17+', () => {
    const r = liquidarNomina(
      entrada({
        aplicaAjusteVillanueva: true,
        ajusteVillanuevaPorDia: true,
        diasLaboradosVillanueva: 20,
      }),
      PARAMS,
    );
    expect(r.bonificacionVillanueva).toBeCloseTo(((2358897 - 1750905) / 30) * 20, 6);
  });

  it('el IBC usa el ajuste teórico completo, no el prorrateado por días trabajados', () => {
    const r = liquidarNomina(
      entrada({ aplicaAjusteVillanueva: true, diasLaboradosVillanueva: 5 }),
      PARAMS,
    );
    expect(r.baseCalculoSalud).toBeCloseTo(1750905 + (2358897 - 1750905), 6);
  });

  it('diasAjusteDeducciones prorratea solo la parte del IBC', () => {
    const r = liquidarNomina(
      entrada({
        aplicaAjusteVillanueva: true,
        diasLaboradosVillanueva: 20,
        diasAjusteDeducciones: 6,
      }),
      PARAMS,
    );
    expect(r.baseCalculoSalud).toBeCloseTo(1750905 + ((2358897 - 1750905) / 30) * 6, 6);
  });
});

describe('ajustes del 8 %', () => {
  const grupos = [
    { key: 'gp', valor: 400000, empresa_id: PAREX, origen_planilla_id: 'p1' },
    { key: 'gg', valor: 200000, empresa_id: GEOPARK, origen_planilla_id: 'p2' },
    { key: 'go', valor: 100000, empresa_id: 'otra', origen_planilla_id: 'p3' },
  ];

  it('PAREX toma el 8 % solo de los recargos de PAREX', () => {
    const r = liquidarNomina(
      entrada({ previewRecargosGrupos: grupos, aplicaAjusteParex: true }),
      PARAMS,
    );
    expect(r.totalRecargosParex).toBe(400000);
    expect(r.ajusteParex).toBeCloseTo(32000, 6);
  });

  it('"recargos completos" toma el 8 % de todos', () => {
    const r = liquidarNomina(
      entrada({ previewRecargosGrupos: grupos, ajusteRecargosCompletos: true }),
      PARAMS,
    );
    expect(r.ajusteParex).toBeCloseTo(700000 * 0.08, 6);
  });

  it('Geopark toma el 8 % solo de los suyos', () => {
    const r = liquidarNomina(
      entrada({ previewRecargosGrupos: grupos, aplicaAjusteGeopark: true }),
      PARAMS,
    );
    expect(r.ajusteGeopark).toBeCloseTo(16000, 6);
  });

  it('el 100 % de esos recargos entra al IBC (el 8 % no)', () => {
    const r = liquidarNomina(
      entrada({ previewRecargosGrupos: grupos, aplicaAjusteParex: true }),
      PARAMS,
    );
    expect(r.baseCalculoSalud).toBeCloseTo(1750905 + 400000, 6);
  });

  it('sin UUID configurado no se calcula ajuste (antes era un literal en tres archivos)', () => {
    const r = liquidarNomina(
      entrada({ previewRecargosGrupos: grupos, aplicaAjusteParex: true }),
      { ...PARAMS, empresaParexId: null },
    );
    expect(r.ajusteParex).toBe(0);
    expect(r.totalRecargosParex).toBe(0);
  });
});

describe('vacaciones', () => {
  it('el valor manual manda sobre las fechas', () => {
    const r = liquidarNomina(
      entrada({
        valorVacaciones: 500000,
        vacacionesInicio: '2026-08-01',
        vacacionesFin: '2026-08-15',
      }),
      PARAMS,
    );
    expect(r.totalVacaciones).toBe(500000);
  });

  it('sin valor manual se deduce de las fechas, extremos incluidos', () => {
    const r = liquidarNomina(
      entrada({ vacacionesInicio: '2026-08-01', vacacionesFin: '2026-08-15' }),
      PARAMS,
    );
    expect(r.totalVacaciones).toBeCloseTo((1750905 / 30) * 15, 6);
  });
});

describe('deducciones', () => {
  it('los interruptores "no descontar" las anulan por separado', () => {
    const r = liquidarNomina(entrada({ noDescontarSalud: true }), PARAMS);
    expect(r.salud).toBe(0);
    expect(r.pension).toBeCloseTo(70036.2, 2);
  });

  it('"descontar del salario base" reduce el IBC de esa deducción sola', () => {
    const r = liquidarNomina(
      entrada({
        previewRecargosGrupos: [
          { key: 'g', valor: 900000, empresa_id: PAREX, origen_planilla_id: 'p' },
        ],
        aplicaAjusteParex: true,
        descontarSaludSalario: true,
      }),
      PARAMS,
    );
    expect(r.baseCalculoSalud).toBe(1750905);
    expect(r.baseCalculoPension).toBeCloseTo(1750905 + 900000, 6);
  });

  it('los anticipos se restan del neto', () => {
    const r = liquidarNomina(
      entrada({ anticipos: [{ valor: 200000 }, { valor: 50000 }] }),
      PARAMS,
    );
    expect(r.totalAnticipos).toBe(250000);
    expect(r.totalDeducciones).toBeCloseTo(r.salud + r.pension + 250000, 6);
  });
});

describe('bonos, pernotes y conceptos adicionales', () => {
  it('los bonos se pagan cantidad × valor por cada entrada', () => {
    const r = liquidarNomina(
      entrada({
        detallesVehiculos: [
          {
            bonos: [
              { values: [{ quantity: 12 }], value: 15000 }, // BONO DÍA TRABAJADO
              { values: [{ quantity: 1 }], value: 25000 }, // BONO DÍA TRABAJO DOBLE
            ],
            pernotes: [{ cantidad: 2, valor: 111567 }],
            recargos: [],
          },
        ],
      }),
      PARAMS,
    );
    expect(r.totalBonificaciones).toBe(12 * 15000 + 25000);
    expect(r.totalPernotes).toBe(223134);
  });

  it('bonos, pernotes y conceptos adicionales suman al bruto pero no al IBC', () => {
    const r = liquidarNomina(
      entrada({
        detallesVehiculos: [
          { bonos: [{ values: [{ quantity: 1 }], value: 25000 }], pernotes: [], recargos: [] },
        ],
        conceptosAdicionales: [{ valor: 40000 }],
      }),
      PARAMS,
    );
    expect(r.baseCalculoSalud).toBe(1750905);
    expect(r.sueldoBruto).toBeCloseTo(1750905 + 249095 + 25000 + 40000, 6);
  });
});

describe('incapacidad', () => {
  it('cubre lo que se dejó de devengar', () => {
    const r = liquidarNomina(
      entrada({ diasLaborados: 20, aplicaIncapacidad: true }),
      PARAMS,
    );
    expect(r.valorIncapacidad).toBeCloseTo(1750905 - (1750905 / 30) * 20, 6);
  });

  it('nunca es negativa', () => {
    const r = liquidarNomina(
      entrada({ diasLaborados: 45, aplicaIncapacidad: true }),
      PARAMS,
    );
    expect(r.valorIncapacidad).toBe(0);
  });
});

// Las dos rarezas portadas tal cual del formulario. Los tests están para que,
// el día que se corrijan, salte aquí y se corrijan también en el componente.
describe('⚠ comportamiento heredado del formulario', () => {
  it('las vacaciones deducidas de fechas cotizan pero NO se pagan', () => {
    const r = liquidarNomina(
      entrada({ vacacionesInicio: '2026-08-01', vacacionesFin: '2026-08-15' }),
      PARAMS,
    );
    expect(r.totalVacaciones).toBeGreaterThan(0);
    expect(r.baseCalculoSalud).toBeCloseTo(1750905 + r.totalVacaciones, 6);
    expect(r.sueldoBruto).toBeCloseTo(1750905 + 249095, 6); // sin vacaciones
  });

  it('el 8 % de PAREX/Geopark se calcula y se guarda, pero no entra al bruto', () => {
    const r = liquidarNomina(
      entrada({
        previewRecargosGrupos: [
          { key: 'g', valor: 400000, empresa_id: PAREX, origen_planilla_id: 'p' },
        ],
        aplicaAjusteParex: true,
      }),
      PARAMS,
    );
    expect(r.ajusteParex).toBeCloseTo(32000, 6);
    expect(r.sueldoBruto).toBeCloseTo(1750905 + 249095 + 400000, 6);
  });
});

describe('derivadosLiquidacion', () => {
  it('reconstruye los totales que persiste el backend', () => {
    const r = liquidarNomina(entrada({ anticipos: [{ valor: 100000 }] }), PARAMS);
    const d = derivadosLiquidacion(r);
    expect(d.neto_pagado).toBe(r.sueldoTotal);
    expect(d.total_deducido).toBeCloseTo(r.salud + r.pension + 100000, 6);
    expect(d.total_devengado).toBeCloseTo(r.sueldoBruto, 6);
  });
});

describe('robustez', () => {
  it('sin datos no revienta y devuelve ceros', () => {
    const r = liquidarNomina(entrada({ salarioBase: 0, diasLaborados: 0 }), {
      ...PARAMS,
      auxilioTransporteMensual: 0,
    });
    expect(r.sueldoTotal).toBe(0);
  });

  it('valores no numéricos se tratan como cero, no como NaN', () => {
    const r = liquidarNomina(
      entrada({ anticipos: [{ valor: undefined as unknown as number }] }),
      PARAMS,
    );
    expect(Number.isNaN(r.sueldoTotal)).toBe(false);
    expect(r.totalAnticipos).toBe(0);
  });
});
