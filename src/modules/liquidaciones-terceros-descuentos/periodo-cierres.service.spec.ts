/**
 * Clave de orden de las hojas del canvas de cierres finales.
 *
 * El servidor la calcula y la manda en `orden_alfabetico`; el cliente tiene
 * una copia para los casos en que construye una hoja desde un detalle
 * suelto (recarga de un cierre, alta desde la cola). Si divergen, esa hoja
 * se coloca en una posición distinta a la que ven los demás usuarios —y no
 * hay error visible, solo dos personas mirando pestañas en distinto orden.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { ordenAlfabetico } from "./periodo-cierres.service";

const ESPEJO = resolve(
  __dirname,
  "../../../../ingreso-svelte/src/lib/editor/builders/cierres-finales-identidad.ts",
);

describe("ordenAlfabetico", () => {
  it("ordena por placa, luego propietario, luego consecutivo", () => {
    const filas = [
      { placa: "ABC123", tercero_nombre: "ZULETA", consecutivo: "C-2" },
      { placa: "ABC123", tercero_nombre: "ALVAREZ", consecutivo: "C-1" },
      { placa: "AAA111", tercero_nombre: "PEREZ", consecutivo: "C-3" },
    ];
    const ordenadas = filas
      .map((f) => ({ f, k: ordenAlfabetico(f) }))
      .sort((a, b) => a.k.localeCompare(b.k, "es"))
      .map((x) => x.f.placa + "/" + x.f.tercero_nombre);

    expect(ordenadas).toEqual(["AAA111/PEREZ", "ABC123/ALVAREZ", "ABC123/ZULETA"]);
  });

  it("el cierre sin propietario va al final de su placa", () => {
    const conDuenio = ordenAlfabetico({
      placa: "ABC123",
      tercero_nombre: "ZZZZZZ",
      consecutivo: "C-1",
    });
    const sinDuenio = ordenAlfabetico({
      placa: "ABC123",
      tercero_nombre: null,
      consecutivo: "C-2",
    });
    // Es donde el usuario espera encontrar "lo que no tiene dueño asignado".
    expect(sinDuenio.localeCompare(conDuenio, "es")).toBeGreaterThan(0);
  });

  it("el consecutivo desempata dos cierres del mismo par", () => {
    // Pasa cuando un `force_new` deja dos cierres de la misma placa y
    // propietario en el mismo periodo.
    const a = ordenAlfabetico({ placa: "ABC123", tercero_nombre: "PEREZ", consecutivo: "C-1" });
    const b = ordenAlfabetico({ placa: "ABC123", tercero_nombre: "PEREZ", consecutivo: "C-2" });
    expect(a).not.toBe(b);
    expect(a.localeCompare(b, "es")).toBeLessThan(0);
  });
});

describe("paridad con el frontend", () => {
  const hay = existsSync(ESPEJO);
  const test = hay ? it : it.skip;

  test("usa el mismo relleno para el propietario ausente", () => {
    const src = readFileSync(ESPEJO, "utf8");
    const m = src.match(/tercero_nombre \|\| '(\\u[0-9A-Fa-f]{4}|.)'/);
    expect(m, "no se encontró el relleno en el espejo").toBeTruthy();

    const relleno = m![1].startsWith("\\u")
      ? String.fromCharCode(parseInt(m![1].slice(2), 16))
      : m![1];

    // U+FFFF, el mayor punto de código. Escrito literal es invisible en el
    // editor y se confunde con U+FFFD, que ordena ANTES y colocaría los
    // cierres sin dueño al principio de su placa en un solo lado.
    expect(relleno.codePointAt(0)).toBe(0xffff);
    expect(ordenAlfabetico({ placa: "X", tercero_nombre: null, consecutivo: "" })).toContain(
      relleno,
    );
  });

  test("el separador es el mismo", () => {
    const src = readFileSync(ESPEJO, "utf8");
    const m = src.match(/const SEPARADOR_ORDEN = '(\\u[0-9A-Fa-f]{4}|.)'/);
    expect(m, "no se encontró SEPARADOR_ORDEN en el espejo").toBeTruthy();

    const sep = m![1].startsWith("\\u")
      ? String.fromCharCode(parseInt(m![1].slice(2), 16))
      : m![1];

    expect(ordenAlfabetico({ placa: "A", tercero_nombre: "B", consecutivo: "C" })).toBe(
      ["A", "B", "C"].join(sep),
    );
  });
});
