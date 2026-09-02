/**
 * Guards de la máquina de estados del cierre final.
 *
 * Lo que se protege aquí es el hallazgo H8: hasta ahora el único control
 * era de SALIDA de APROBADA, así que cualquier usuario autenticado podía
 * *entrar* en APROBADA o FACTURADA. La cadena de aprobación no existía.
 *
 * Además comprueba la paridad de la matriz con su espejo del frontend
 * (`ingreso-svelte/src/lib/editor/builders/cierres-finales-estado.ts`),
 * que se lee del disco: son dos builds distintos y no hay paquete común,
 * así que la única forma de detectar una divergencia es leyendo el fichero.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import {
  TRANSICIONES,
  ESTADOS_QUE_EXIGEN_ADMIN,
  esAdmin,
  transicionesPermitidas,
} from "./cierre-estado.service";

const ADMIN = { id: "u1", areas: ["administracion"] };
const OPERACIONES = { id: "u2", areas: ["operaciones"] };
const FACTURACION = { id: "u3", areas: ["facturacion"] };
const SIN_AREA = { id: "u4", areas: null };

describe("esAdmin", () => {
  it("reconoce el área sin importar mayúsculas ni forma", () => {
    expect(esAdmin(ADMIN)).toBe(true);
    expect(esAdmin({ id: "x", areas: "ADMINISTRACION" })).toBe(true);
    expect(esAdmin({ id: "x", areas: ["operaciones", "administracion"] })).toBe(true);
  });

  it("no reconoce a nadie más", () => {
    expect(esAdmin(OPERACIONES)).toBe(false);
    expect(esAdmin(FACTURACION)).toBe(false);
    expect(esAdmin(SIN_AREA)).toBe(false);
    expect(esAdmin(null)).toBe(false);
  });
});

describe("guard de ENTRADA a APROBADA / FACTURADA", () => {
  it("un no-administrador nunca ve APROBADA como destino", () => {
    // Es el estado desde el que se aprueba: si el guard fallara, aparecería.
    expect(transicionesPermitidas("LIQUIDADA", OPERACIONES)).not.toContain("APROBADA");
    expect(transicionesPermitidas("LIQUIDADA", ADMIN)).toContain("APROBADA");
  });

  it("FACTURADA solo es alcanzable por administración", () => {
    // Desde APROBADA, y un no-admin ni siquiera puede salir de APROBADA.
    expect(transicionesPermitidas("APROBADA", ADMIN)).toContain("FACTURADA");
    expect(transicionesPermitidas("APROBADA", OPERACIONES)).toEqual([]);
  });

  it("ningún estado ofrece a un no-admin un destino restringido", () => {
    for (const estado of Object.keys(TRANSICIONES)) {
      const permitidas = transicionesPermitidas(estado, OPERACIONES);
      for (const destino of ESTADOS_QUE_EXIGEN_ADMIN) {
        expect(permitidas, `desde ${estado}`).not.toContain(destino);
      }
    }
  });
});

describe("guard de SALIDA de APROBADA", () => {
  it("un no-administrador no puede mover un cierre aprobado", () => {
    expect(transicionesPermitidas("APROBADA", OPERACIONES)).toEqual([]);
    expect(transicionesPermitidas("APROBADA", FACTURACION)).toEqual([]);
  });

  it("administración sí puede devolverlo o anularlo", () => {
    const p = transicionesPermitidas("APROBADA", ADMIN);
    expect(p).toContain("LIQUIDADA");
    expect(p).toContain("ANULADA");
  });
});

describe("matriz de transiciones", () => {
  it("ANULADA es terminal", () => {
    expect(TRANSICIONES.ANULADA).toEqual([]);
    expect(transicionesPermitidas("ANULADA", ADMIN)).toEqual([]);
  });

  it("un estado desconocido no habilita nada", () => {
    expect(transicionesPermitidas("INVENTADO", ADMIN)).toEqual([]);
  });

  it("todo destino es a su vez un estado conocido", () => {
    const conocidos = new Set(Object.keys(TRANSICIONES));
    for (const [origen, destinos] of Object.entries(TRANSICIONES)) {
      for (const d of destinos) {
        expect(conocidos.has(d), `${origen} → ${d}`).toBe(true);
      }
    }
  });
});

// ─── Paridad con el espejo del frontend ──────────────────────────────

const ESPEJO = resolve(
  __dirname,
  "../../../../ingreso-svelte/src/lib/editor/builders/cierres-finales-estado.ts",
);

/**
 * Extrae la matriz del fichero del frontend por parsing textual.
 *
 * No se puede importar: es otro build, con `$lib` y sin transpilar aquí.
 * Parsear el literal es feo pero detecta exactamente lo que interesa —
 * que alguien toque una lista en un lado y no en el otro.
 */
function matrizDelEspejo(src: string): Record<string, string[]> {
  const bloque = src.match(
    /export const TRANSICIONES[^=]*=\s*\{([\s\S]*?)\n\};/,
  );
  if (!bloque) throw new Error("No se encontró TRANSICIONES en el espejo");

  const out: Record<string, string[]> = {};
  const filas = bloque[1].matchAll(/(\w+):\s*\[([^\]]*)\]/g);
  for (const [, clave, valores] of filas) {
    out[clave] = valores
      .split(",")
      .map((v) => v.trim().replace(/['"]/g, ""))
      .filter(Boolean);
  }
  return out;
}

describe("paridad con el frontend", () => {
  // El repo del frontend puede no estar presente (CI del backend a solas).
  const hay = existsSync(ESPEJO);
  const test = hay ? it : it.skip;

  test("la matriz de transiciones es idéntica", () => {
    const espejo = matrizDelEspejo(readFileSync(ESPEJO, "utf8"));
    expect(espejo).toEqual(
      Object.fromEntries(
        Object.entries(TRANSICIONES).map(([k, v]) => [k, [...v]]),
      ),
    );
  });

  test("la lista de estados que exigen admin es idéntica", () => {
    const src = readFileSync(ESPEJO, "utf8");
    const m = src.match(/ESTADOS_QUE_EXIGEN_ADMIN[^=]*=\s*\[([^\]]*)\]/);
    expect(m, "no se encontró ESTADOS_QUE_EXIGEN_ADMIN en el espejo").toBeTruthy();
    const espejo = m![1]
      .split(",")
      .map((v) => v.trim().replace(/['"]/g, ""))
      .filter(Boolean);
    expect(espejo).toEqual(ESTADOS_QUE_EXIGEN_ADMIN as string[]);
  });
});
