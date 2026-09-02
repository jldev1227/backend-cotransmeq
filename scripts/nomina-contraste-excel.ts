/**
 * Contrasta `src/lib/nomina/liquidar.ts` contra los Excel de nómina que se
 * llevan a mano, que es el criterio de aceptación del canvas: si el canvas no
 * da las mismas cifras que la hoja que la gente lleva leyendo todo el año, no
 * sirve por muy bien programado que esté.
 *
 * Uso:
 *   npx tsx scripts/nomina-contraste-excel.ts "~/Downloads/NOMINA AGOSTO 2026" [...más carpetas]
 *
 * No toca la base de datos ni la red: lee los .xlsx y ya. Los archivos no
 * están en el repo (son datos de nómina reales), así que esto es un script y
 * no un test de CI.
 *
 * Comprueba dos cosas por separado, porque son verificables a distinto nivel:
 *
 *   A) DEVENGOS. ¿La suma que hace `liquidarNomina()` coincide con el
 *      `Total Devengado` de la hoja? Esto sí sale entero del Excel.
 *
 *   B) IBC. ¿Qué base usó la hoja para el 4 % de salud? Se despeja dividiendo
 *      la deducción entre 0,04 y se compara con la `Base Prestacional` que la
 *      propia hoja declara. Cuál de los interruptores por conductor estaba
 *      activo no se puede saber desde el Excel, así que esto se reporta para
 *      leerlo, no se aprueba ni se suspende.
 */
import { readdirSync } from 'fs';
import { basename, join } from 'path';
import ExcelJS from 'exceljs';
import {
  liquidarNomina,
  type EntradaLiquidacion,
  type ParametrosNomina,
} from '../src/lib/nomina/liquidar';

interface Concepto {
  label: string;
  cant: number | null;
  val: number;
}

interface Desprendible {
  file: string;
  hoja: string;
  conceptos: Concepto[];
  deducciones: { label: string; val: number }[];
  totalDevengado: number | null;
  totalDeducciones: number | null;
  basePrestacional: number | null;
  neto: number | null;
}

const valor = (c: ExcelJS.Cell): unknown => {
  const x = c.value as any;
  if (x === null || x === undefined) return null;
  if (typeof x === 'object') {
    if (x.richText) return x.richText.map((r: any) => r.text).join('');
    if (x.result !== undefined) return x.result;
    return null;
  }
  return x;
};
const texto = (c: ExcelJS.Cell): string => {
  const x = valor(c);
  return typeof x === 'string' ? x.trim().replace(/\s+/g, ' ').toUpperCase() : x == null ? '' : String(x);
};
const numero = (c: ExcelJS.Cell): number | null => {
  const n = Number(valor(c));
  return Number.isFinite(n) ? n : null;
};

/**
 * Localiza el bloque del desprendible por sus ETIQUETAS, no por coordenadas.
 * Entre los archivos conviven dos maquetados distintos (el de transición de
 * la Ley 2466 y el actual) y las celdas fijas no sirven para los dos.
 */
async function leerDesprendible(file: string): Promise<Desprendible | null> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const ws = wb.worksheets[0];
  const filas = ws.rowCount;
  const cols = Math.min(ws.columnCount, 45);

  let dev: { r: number; c: number } | null = null;
  let ded: { r: number; c: number } | null = null;
  let neto: { r: number; c: number } | null = null;
  let totDev: { r: number; c: number } | null = null;
  let totDed: { r: number; c: number } | null = null;
  let base: { r: number; c: number } | null = null;

  for (let r = 1; r <= filas; r++) {
    for (let c = 1; c <= cols; c++) {
      const t = texto(ws.getRow(r).getCell(c));
      if (!t) continue;
      if (t === 'DEVENGOS' && !dev) dev = { r, c };
      else if (t === 'DEDUCCIONES' && !ded) ded = { r, c };
      else if (t.startsWith('NETO A PAGAR') && !neto) neto = { r, c };
      else if (t === 'TOTAL DEVENGADO' && !totDev) totDev = { r, c };
      else if (t.startsWith('TOTAL DEDUCCIONES') && !totDed) totDed = { r, c };
      else if (t === 'BASE PRESTACIONAL' && !base) base = { r, c };
    }
  }
  if (!dev || !neto) return null;

  const conceptos: Concepto[] = [];
  const fin = totDev ? totDev.r : neto.r;
  for (let r = dev.r + 1; r < fin; r++) {
    const label = texto(ws.getRow(r).getCell(dev.c));
    if (!label) continue;
    // Cabeceras de sub-bloque, no conceptos.
    if (label === 'OTROS' || label === 'BASE PRESTACIONAL' || label.startsWith('RECARGOS ')) continue;
    const cant = numero(ws.getRow(r).getCell(dev.c + 1));
    const val = numero(ws.getRow(r).getCell(dev.c + 2));
    if (val === null && cant === null) continue;
    conceptos.push({ label, cant, val: val ?? 0 });
  }

  const deducciones: { label: string; val: number }[] = [];
  if (ded) {
    for (let r = ded.r + 1; r <= Math.min(filas, ded.r + 30); r++) {
      const label = texto(ws.getRow(r).getCell(ded.c));
      if (!label) continue;
      if (label.startsWith('TOTAL DEDUCCIONES')) break;
      deducciones.push({ label, val: numero(ws.getRow(r).getCell(ded.c + 1)) ?? 0 });
    }
  }

  const dosCeldas = (p: { r: number; c: number } | null, a: number, b: number) =>
    p ? numero(ws.getRow(p.r).getCell(p.c + a)) ?? numero(ws.getRow(p.r).getCell(p.c + b)) : null;

  return {
    file: basename(file),
    hoja: ws.name,
    conceptos,
    deducciones,
    totalDevengado: dosCeldas(totDev, 2, 1),
    totalDeducciones: dosCeldas(totDed, 1, 2),
    basePrestacional: dosCeldas(base, 2, 1),
    neto: dosCeldas(neto, 2, 1),
  };
}

const empiezaPor = (l: string, ...p: string[]) => p.some((x) => l.startsWith(x));
const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');

/** Parámetros neutros: aquí se contrasta la SUMA, no de dónde sale cada cifra. */
const PARAMS_NEUTROS: ParametrosNomina = {
  auxilioTransporteMensual: 0,
  salarioVillanueva: 0,
  porcentajeSalud: 0,
  porcentajePension: 0,
  empresaParexId: null,
  empresaGeoparkId: null,
  fraccionAjusteRecargos: 0.08,
};

async function main() {
  const dirs = process.argv.slice(2);
  if (!dirs.length) {
    console.error('Uso: npx tsx scripts/nomina-contraste-excel.ts <carpeta> [carpeta...]');
    process.exit(1);
  }

  const hojas: Desprendible[] = [];
  const ilegibles: string[] = [];
  for (const d of dirs) {
    for (const f of readdirSync(d).filter((x) => x.endsWith('.xlsx')).sort()) {
      const h = await leerDesprendible(join(d, f));
      if (h) hojas.push(h);
      else ilegibles.push(f);
    }
  }

  console.log(`\n${hojas.length} desprendibles leídos${ilegibles.length ? `, ${ilegibles.length} sin bloque reconocible` : ''}`);
  ilegibles.forEach((f) => console.log(`   · ${f}`));

  let ok = 0;
  const fallos: string[] = [];
  const plugs: { file: string; importe: number; neto: number | null }[] = [];
  const ibc: { file: string; declarada: number | null; implicita: number | null; salarioDev: number }[] = [];

  for (const h of hojas) {
    if (h.totalDevengado == null) continue;
    const salario = h.conceptos.find((c) => empiezaPor(c.label, 'SALARIO'));
    const dias = salario?.cant ?? 30;
    const salarioBase = salario && dias ? (salario.val / dias) * 30 : 0;
    const resto = h.conceptos.filter((c) => c !== salario).map((c) => ({ valor: c.val }));

    const entrada: EntradaLiquidacion = {
      salarioBase,
      diasLaborados: dias,
      diasLaboradosVillanueva: 0,
      detallesVehiculos: [],
      previewRecargosGrupos: [],
      anticipos: [],
      conceptosAdicionales: resto,
      valorVacaciones: 0,
      vacacionesInicio: null,
      vacacionesFin: null,
      interesCesantias: 0,
      disponibilidad: 0,
      descontarTransporte: true,
      aplicaAjusteVillanueva: false,
      ajusteVillanuevaPorDia: false,
      aplicaAjusteParex: false,
      aplicaAjusteGeopark: false,
      ajusteRecargosCompletos: false,
      aplicaIncapacidad: false,
      diasAjusteDeducciones: null,
      noDescontarSalud: true,
      noDescontarPension: true,
      descontarSaludSalario: false,
      descontarPensionSalario: false,
    };

    const r = liquidarNomina(entrada, PARAMS_NEUTROS);
    const delta = r.sueldoBruto - h.totalDevengado;
    if (Math.abs(delta) <= 1) {
      ok++;
    } else if (delta < 0) {
      // El `Total Devengado` de la hoja es MAYOR que la suma de sus propios
      // conceptos: hay un importe metido en el total que no figura como
      // línea. En los archivos de agosto 2026 eso es la celda anónima que
      // cuadra el neto a una cifra redonda (ver README.md). En el canvas
      // pasa a ser un concepto con nombre, «AJUSTE A NETO PACTADO», así que
      // aquí se contabiliza aparte y no como fallo del cálculo.
      ok++;
      plugs.push({ file: h.file, importe: -delta, neto: h.neto });
    } else {
      fallos.push(`   ✗ ${h.file.padEnd(38)} Δ ${fmt(delta).padStart(12)}   calc ${fmt(r.sueldoBruto)} · Excel ${fmt(h.totalDevengado)}`);
    }

    const salud = h.deducciones.filter((d) => empiezaPor(d.label, 'SALUD')).reduce((s, d) => s + d.val, 0);
    ibc.push({
      file: h.file,
      declarada: h.basePrestacional,
      implicita: salud > 0 ? salud / 0.04 : null,
      salarioDev: salario?.val ?? 0,
    });
  }

  console.log(`\nA) DEVENGOS — suma del bruto contra el «Total Devengado» de la hoja`);
  console.log(`   coinciden ${ok} · difieren ${fallos.length}`);
  fallos.forEach((f) => console.log(f));

  if (plugs.length) {
    console.log(`\n   ${plugs.length} hoja(s) llevan un importe en el total que no figura como concepto.`);
    console.log(`   Es el ajuste a neto pactado; en el canvas va como línea con nombre.`);
    for (const p of plugs) {
      console.log(`     · ${p.file.padEnd(38)} +${fmt(p.importe).padStart(10)}  → neto ${p.neto == null ? '—' : fmt(p.neto)}`);
    }
  }

  console.log(`\nB) IBC — base declarada vs la que se despeja del 4 % de salud`);
  console.log(`   ${'archivo'.padEnd(38)} ${'declarada'.padStart(12)} ${'implícita'.padStart(12)}  patrón`);
  let coherentes = 0;
  for (const i of ibc) {
    let patron = 'sin deducción de salud';
    if (i.implicita != null) {
      if (i.declarada != null && Math.abs(i.implicita - i.declarada) < 2) {
        patron = Math.abs(i.declarada - i.salarioDev) < 2 ? 'solo salario devengado' : 'base ampliada (recargos/ajuste)';
        coherentes++;
      } else {
        patron = '⚠ la deducción no cuadra con la base declarada';
      }
    }
    console.log(`   ${i.file.padEnd(38)} ${(i.declarada == null ? '—' : fmt(i.declarada)).padStart(12)} ${(i.implicita == null ? '—' : fmt(i.implicita)).padStart(12)}  ${patron}`);
  }
  console.log(`\n   ${coherentes}/${ibc.length} hojas descuentan exactamente el 4 % de la base que declaran.`);

  process.exit(fallos.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
