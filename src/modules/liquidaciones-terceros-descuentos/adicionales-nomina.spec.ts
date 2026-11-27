import { describe, expect, it } from "vitest";
import {
  adicionalesDelMes,
  adicionalesNoDescartados,
} from "./adicionales-nomina";

describe("adicionales de nómina para cierres finales", () => {
  it("descarta solo el concepto y conductor del cierre indicado", () => {
    const adicionales = [
      { conductor_id: "a", concepto: "BONO", valor: 10 },
      { conductor_id: "b", concepto: "BONO", valor: 20 },
    ];
    expect(
      adicionalesNoDescartados(adicionales, [
        { conductor_id: "a", concepto: "BONO" },
      ]),
    ).toEqual([adicionales[1]]);
  });
  it("usa el mes de periodo_end, suma conceptos repetidos y separa conductores", () => {
    const filas = [
      {
        conductor_id: "a",
        periodo_end: "2026-10-20",
        conceptos_adicionales: [
          { observaciones: "Bono pactado", valor: 120000 },
          { observaciones: "Descuento especial", valor: -10000 },
        ],
      },
      {
        conductor_id: "a",
        periodo_end: "2026-10-31",
        conceptos_adicionales: [
          { observaciones: " bono  pactado ", valor: 30000 },
        ],
      },
      {
        conductor_id: "b",
        periodo_end: "2026-10-20",
        conceptos_adicionales: [{ nombre: "Bono pactado", valor: 5000 }],
      },
      {
        conductor_id: "b",
        periodo_end: "2026-10-20",
        conceptos_adicionales: [{ observaciones: "SALARIO", valor: 2500 }],
      },
      {
        conductor_id: "a",
        periodo_end: "2026-11-20",
        conceptos_adicionales: [
          { observaciones: "Bono pactado", valor: 999999 },
        ],
      },
    ];
    expect(adicionalesDelMes(filas, 2026, 10)).toEqual([
      { conductor_id: "a", concepto: "BONO_PACTADO", valor: 150000 },
      { conductor_id: "a", concepto: "DESCUENTO_ESPECIAL", valor: -10000 },
      { conductor_id: "b", concepto: "BONO_PACTADO", valor: 5000 },
      { conductor_id: "b", concepto: "ADICIONAL_NOMINA_SALARIO", valor: 2500 },
    ]);
    expect(adicionalesDelMes(filas, 2026, 9)).toEqual([]);
  });
});
