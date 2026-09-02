/**
 * Paridad de los tokens del PDF entre backend y frontend.
 *
 * El PDF descargado lo renderiza este módulo con Puppeteer; el preview lo
 * dibuja un componente Svelte. Son dos implementaciones del mismo
 * documento, y si sus colores o bordes divergen NADA se rompe: el preview
 * se ve de un verde y el PDF de otro, y no se descubre hasta que alguien
 * los pone uno al lado del otro.
 *
 * Por eso este test lee el fichero del frontend del disco —no se puede
 * importar, es otro build— y compara mapa contra mapa.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";
import { PDF_TOKENS, pdfCssVars } from "./pdf-tokens";

const ESPEJO = resolve(
  __dirname,
  "../../../../ingreso-svelte/src/lib/styles/pdf-tokens.ts",
);

/**
 * Extrae el mapa `PDF_TOKENS` del fichero del frontend.
 *
 * Los valores pueden contener comas (las pilas de fuentes), así que se
 * parsea línea a línea y se recortan las comillas exteriores en vez de
 * partir por comas.
 */
function tokensDelEspejo(src: string): Record<string, string> {
  const bloque = src.match(
    /export const PDF_TOKENS: Record<string, string> = \{([\s\S]*?)\n\};/,
  );
  if (!bloque) throw new Error("No se encontró PDF_TOKENS en el espejo");

  const out: Record<string, string> = {};
  for (const linea of bloque[1].split("\n")) {
    const limpia = linea.trim();
    if (!limpia || limpia.startsWith("//") || limpia.startsWith("/*") || limpia.startsWith("*")) {
      continue;
    }
    const m = limpia.match(/^'?([\w-]+)'?:\s*(.+?),?$/);
    if (!m) continue;
    out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

function escalablesDelEspejo(src: string): string[] {
  const m = src.match(/const CLAVES_ESCALABLES = new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("No se encontró CLAVES_ESCALABLES en el espejo");
  return m[1]
    .split(",")
    .map((v) => v.trim().replace(/['"]/g, ""))
    .filter(Boolean);
}

describe("pdf-tokens", () => {
  const hay = existsSync(ESPEJO);
  const test = hay ? it : it.skip;

  test("el mapa de tokens es idéntico al del frontend", () => {
    const espejo = tokensDelEspejo(readFileSync(ESPEJO, "utf8"));
    // Comparar el objeto entero y no clave a clave: así también se detecta
    // una clave AÑADIDA en un solo lado, que es el caso más frecuente.
    expect(espejo).toEqual(PDF_TOKENS);
  });

  test("la lista de claves escalables es idéntica", () => {
    const espejo = escalablesDelEspejo(readFileSync(ESPEJO, "utf8"));
    const propias = Object.keys(PDF_TOKENS).filter((k) => k.startsWith("fs-"));
    expect(espejo.sort()).toEqual(propias.sort());
  });

  it("toda clave escalable existe en el mapa", () => {
    for (const k of Object.keys(PDF_TOKENS).filter((k) => k.startsWith("fs-"))) {
      expect(PDF_TOKENS[k], `${k} debe ser una medida en pt`).toMatch(/^[\d.]+pt$/);
    }
  });

  it("no quedan colores sin tokenizar en el mapa", () => {
    // Todo lo que parezca color debe ser hex de 6 dígitos: los `rgb()` y los
    // hex de 3 se colaban antes y hacían imposible comparar a ojo.
    for (const [k, v] of Object.entries(PDF_TOKENS)) {
      if (!v.startsWith("#")) continue;
      expect(v, `${k}`).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("pdfCssVars", () => {
  it("emite una custom property por token", () => {
    const css = pdfCssVars();
    for (const k of Object.keys(PDF_TOKENS)) {
      expect(css).toContain(`--tpdf-${k}:`);
    }
  });

  it("escala solo las medidas tipográficas", () => {
    const uno = pdfCssVars(1);
    const doble = pdfCssVars(2);

    expect(uno).toContain(`--tpdf-fs-body:${PDF_TOKENS["fs-body"]}`);
    expect(doble).toContain("--tpdf-fs-body:14.8pt");

    // Colores, bordes y paddings NO cambian con la escala.
    expect(doble).toContain(`--tpdf-verde:${PDF_TOKENS.verde}`);
    expect(doble).toContain(`--tpdf-borde-rejilla:${PDF_TOKENS["borde-rejilla"]}`);
    expect(doble).toContain(`--tpdf-pad-y:${PDF_TOKENS["pad-y"]}`);
  });

  it("redondea a un decimal", () => {
    // Sin redondeo salen cuerpos como `9.99999998pt`, que además cambian
    // con cualquier reajuste mínimo de la escala.
    const css = pdfCssVars(1.35);
    const medidas = [...css.matchAll(/--tpdf-fs-[\w-]+:([\d.]+)pt/g)].map((m) => m[1]);
    expect(medidas.length).toBeGreaterThan(0);
    for (const v of medidas) {
      expect(v, `${v} tiene más de un decimal`).toMatch(/^\d+(\.\d)?$/);
    }
  });
});
