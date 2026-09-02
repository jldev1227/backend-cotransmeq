/**
 * Paridad ESTRUCTURAL entre el PDF y su preview.
 *
 * No comprueba píxeles —eso exigiría levantar Chromium y comparar
 * imágenes—, sino lo que de verdad se rompe en la práctica: que una de las
 * dos vistas gane o pierda una columna, que cambie el orden de las
 * secciones, o que los anchos del `colgroup` dejen de sumar 100% y la tabla
 * se descuadre solo en una de ellas.
 *
 * Frontend y backend NO tienen que ser idénticos: el preview muestra además
 * columnas de uso interno (`col-internal`) que el documento que se entrega
 * al tercero no lleva. Lo que sí tiene que cumplirse es que las columnas
 * comunes sean las mismas y en el mismo orden.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { describe, it, expect } from "vitest";

const TEMPLATE = resolve(__dirname, "liquidaciones-terceros-pdf.template.ts");
const PREVIEW = resolve(
  __dirname,
  "../../../../ingreso-svelte/src/lib/components/PreviewTerceroPDF.svelte",
);

/** Cabeceras de la tabla de items, en orden, y si son de uso interno. */
function cabecerasItems(src: string): Array<{ texto: string; interna: boolean }> {
  // El primer `<thead>` del fichero es el de la tabla de items en ambos.
  const thead = src.match(/<thead>([\s\S]*?)<\/thead>/);
  if (!thead) throw new Error("No se encontró el thead de la tabla de items");
  return [...thead[1].matchAll(/<th([^>]*)>([\s\S]*?)<\/th>/g)].map((m) => ({
    texto: m[2].replace(/\s+/g, " ").trim(),
    interna: /col-internal/.test(m[1]),
  }));
}

/** Anchos del primer `colgroup`, en porcentaje. */
function anchosColgroup(src: string): number[] {
  const cg = src.match(/<colgroup>([\s\S]*?)<\/colgroup>/);
  if (!cg) throw new Error("No se encontró el colgroup de la tabla de items");
  return [...cg[1].matchAll(/width:\s*([\d.]+)%/g)].map((m) => Number(m[1]));
}

const hayPreview = existsSync(PREVIEW);
const conPreview = hayPreview ? it : it.skip;

describe("tabla de items", () => {
  const tpl = readFileSync(TEMPLATE, "utf8");

  it("el colgroup del PDF suma 100%", () => {
    const anchos = anchosColgroup(tpl);
    const suma = anchos.reduce((a, b) => a + b, 0);
    // Tolerancia mínima: los porcentajes se escriben con un decimal.
    expect(Math.abs(suma - 100), `suma ${suma}%`).toBeLessThan(0.5);
  });

  it("hay un ancho por columna", () => {
    expect(anchosColgroup(tpl)).toHaveLength(cabecerasItems(tpl).length);
  });

  conPreview("el colgroup del preview suma 100%", () => {
    const anchos = anchosColgroup(readFileSync(PREVIEW, "utf8"));
    const suma = anchos.reduce((a, b) => a + b, 0);
    expect(Math.abs(suma - 100), `suma ${suma}%`).toBeLessThan(0.5);
  });

  conPreview("las columnas comunes coinciden en texto y orden", () => {
    const pdf = cabecerasItems(tpl).map((c) => c.texto);
    const preview = cabecerasItems(readFileSync(PREVIEW, "utf8"))
      .filter((c) => !c.interna)
      .map((c) => c.texto);

    // Si esto falla, una de las dos vistas ganó o perdió una columna y el
    // usuario verá un documento distinto al que descarga.
    expect(preview).toEqual(pdf);
  });

  conPreview("solo el preview muestra columnas internas", () => {
    const internasPreview = cabecerasItems(readFileSync(PREVIEW, "utf8")).filter(
      (c) => c.interna,
    );
    const internasPdf = cabecerasItems(tpl).filter((c) => c.interna);

    expect(internasPreview.length).toBeGreaterThan(0);
    // El documento que se entrega al tercero no lleva columnas internas.
    expect(internasPdf).toEqual([]);
  });
});

describe("orden de las secciones", () => {
  /**
   * Posición de cada hito, para comprobar que van en el mismo orden.
   *
   * Solo se mira la zona de MARCADO: en el template el bloque de CSS va
   * antes que los render, así que buscar en el fichero entero encontraba
   * `.desc-block-gastos` en su regla de estilo y daba un orden inventado.
   */
  function soloMarcado(src: string): string {
    const i = src.indexOf("\n`;\n");
    return i >= 0 ? src.slice(i) : src;
  }

  function orden(src: string, hitos: Array<[string, RegExp]>): string[] {
    return hitos
      .map(([nombre, re]) => [nombre, src.search(re)] as const)
      .filter(([, i]) => i >= 0)
      .sort((a, b) => a[1] - b[1])
      .map(([nombre]) => nombre);
  }

  const HITOS_PDF: Array<[string, RegExp]> = [
    ["items", /class="items-tbl"/],
    ["descuentos", /class="desc-section-title"/],
    ["gastos", /desc-block-gastos/],
    ["anticipos", /desc-block-anticipos/],
    ["impuestos", /desc-block-impuestos/],
    ["copropietarios", /class="cards-grid"/],
    ["resumen", /class="resumen"/],
    ["firmas", /class="sigs"/],
  ];

  const HITOS_PREVIEW: Array<[string, RegExp]> = [
    ["items", /class="terc-prev-tbl"/],
    ["descuentos", /class="desc-section-title"/],
    ["gastos", /desc-block-gastos/],
    ["anticipos", /desc-block-anticipos/],
    ["impuestos", /desc-block-impuestos/],
    ["copropietarios", /class="liq-cards-grid"/],
    ["firmas", /class="sigs"/],
  ];

  conPreview("las secciones aparecen en el mismo orden en ambos", () => {
    const pdf = orden(soloMarcado(readFileSync(TEMPLATE, "utf8")), HITOS_PDF);
    // El preview tiene el marcado ANTES del bloque de estilos, así que el
    // fichero entero ya sirve.
    const preview = orden(readFileSync(PREVIEW, "utf8"), HITOS_PREVIEW);

    // El PDF tiene además el bloque de resumen global; se descuenta para
    // comparar secuencias comparables.
    expect(preview).toEqual(pdf.filter((s) => preview.includes(s)));
  });
});

describe("higiene del CSS", () => {
  const tpl = readFileSync(TEMPLATE, "utf8");
  const css = tpl.slice(tpl.indexOf("const CSS = `"), tpl.indexOf("\n`;\n"));

  it("no quedan degradados", () => {
    // Chromium los rasteriza con bandeado visible al imprimir. El documento
    // es plano a propósito.
    expect(css).not.toMatch(/linear-gradient|radial-gradient/);
  });

  it("no quedan sombras", () => {
    expect(css).not.toMatch(/box-shadow/);
  });

  it("no quedan bordes redondeados en las tablas", () => {
    // `border-radius` sobre una tabla con `border-collapse` recorta el
    // borde de las celdas de las esquinas en Chromium.
    const conRadio = [...css.matchAll(/([^{}]+)\{[^}]*border-radius[^}]*\}/g)]
      .map((m) => m[1].trim())
      .filter((sel) => /tbl|table/.test(sel));
    expect(conRadio).toEqual([]);
  });

  it("los colores van por token, no a mano", () => {
    // Se permiten `#fff` (texto sobre verde) y los tokens. Cualquier otro
    // hex es un color que se escapó de `pdf-tokens.ts`.
    const hex = [...css.matchAll(/#[0-9a-fA-F]{3,6}/g)].map((m) => m[0].toLowerCase());
    const sueltos = hex.filter((h) => h !== "#fff" && h !== "#ffffff");
    expect(sueltos, `hex sin tokenizar: ${[...new Set(sueltos)].join(", ")}`).toEqual([]);
  });
});
