/**
 * Lee como número lo que llega desde una celda de la hoja.
 *
 * EL PROBLEMA QUE RESUELVE: el cliente manda el valor tal y como lo tiene
 * Univer, y en cuanto la celda lleva patrón de formato —todas las de dinero lo
 * llevan— eso NO es el número crudo sino el texto ya formateado: escribir 8303
 * en la columna VALOR viaja como `"$8,303"`.
 *
 * Con `Number("$8,303")` sale `NaN`, y los `isNaN(n) ? 0` de aquí lo
 * convertían en **cero**. El usuario veía su importe en pantalla, la base
 * guardaba 0, y al recargar la celda aparecía vacía: «valores fantasma».
 *
 * Devuelve `null` cuando el texto no representa un número, para que quien
 * llama decida. Confundir «no es un número» con «es cero» fue justo el fallo.
 */
export function numeroDeCelda(valor: unknown): number | null {
  if (valor == null) return null;
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "boolean") return null;

  // `\s` no cubre el espacio fino ni el duro, que es lo que meten algunos
  // patrones de separador de miles.
  const limpio = String(valor)
    .replace(/[$%\s  ]/g, "")
    .trim();
  if (limpio === "") return null;

  // Miles con coma y decimales con punto (1,088,233.5) → se quitan las comas.
  // Coma única como decimal (1088233,5) → pasa a punto.
  const normalizado = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(limpio)
    ? limpio.replace(/,/g, "")
    : limpio.replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(normalizado)) return null;

  const n = Number(normalizado);
  return Number.isFinite(n) ? n : null;
}
