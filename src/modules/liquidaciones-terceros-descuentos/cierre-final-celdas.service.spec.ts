/**
 * Interpretación de las celdas SÍ/NO de la tabla de items.
 *
 * Esas dos columnas deciden qué entra en la base imponible de RETENCION ICA,
 * AVISOS y BOMBERIL, y qué items quedan fuera del cierre. Son celdas de
 * texto libre en Univer: llega lo que el usuario haya tecleado.
 *
 * Lo que se protege aquí es que un typo NO se interprete como `false`. Si
 * "Sí" con acento, o "s", o "1" cayeran en el saco del `else`, marcar un
 * item se convertiría en desmarcarlo y las retenciones bajarían sin que
 * nadie lo hubiera pedido.
 */

import { describe, it, expect } from "vitest";
import {
  parseBooleano,
  CAMPOS_EDITABLES_ITEM,
} from "./cierre-final-celdas.service";

describe("parseBooleano", () => {
  it("acepta las formas afirmativas que un usuario escribiría", () => {
    for (const v of ["SÍ", "sí", "Si", "SI", "s", "S", "true", "TRUE", "1", "x", "X", "yes"]) {
      expect(parseBooleano(v), `"${v}" debería ser true`).toBe(true);
    }
  });

  it("acepta las formas negativas", () => {
    for (const v of ["NO", "no", "n", "N", "false", "FALSE", "0", "", "-", "  "]) {
      expect(parseBooleano(v), `"${v}" debería ser false`).toBe(false);
    }
  });

  it("los acentos no cambian el resultado", () => {
    // La celda se rellena con "SÍ", pero el usuario puede reescribirla sin
    // acento. Las dos formas tienen que significar lo mismo.
    expect(parseBooleano("SÍ")).toBe(parseBooleano("SI"));
  });

  it("respeta booleanos y números tal cual", () => {
    expect(parseBooleano(true)).toBe(true);
    expect(parseBooleano(false)).toBe(false);
    expect(parseBooleano(1)).toBe(true);
    expect(parseBooleano(0)).toBe(false);
  });

  it("null y undefined son false", () => {
    // Una celda vaciada equivale a "no aplica".
    expect(parseBooleano(null)).toBe(false);
    expect(parseBooleano(undefined)).toBe(false);
  });

  it("rechaza lo que no sabe interpretar en vez de asumir false", () => {
    // Asumir `false` convertiría un typo en un cambio silencioso de la base
    // imponible. Mejor un error que el usuario ve.
    for (const v of ["quizá", "SIP", "verdadero", "??", "2"]) {
      expect(() => parseBooleano(v), `"${v}" debería lanzar`).toThrow(/no interpretable/i);
    }
  });
});

describe("campos editables del pivote", () => {
  it("solo esos tres", () => {
    expect([...CAMPOS_EDITABLES_ITEM].sort()).toEqual([
      "aplica_impuestos",
      "excluido",
      // No es un flag y no vive en el pivote sino en `liquidacion_tercero`.
      "porcentaje_admin",
    ]);
  });

  it("no deja colar un campo de otra entidad", () => {
    for (const f of ["valor_liquidar", "orden", "deleted_at", "id", "dias"]) {
      expect(CAMPOS_EDITABLES_ITEM.has(f), f).toBe(false);
    }
  });
});
