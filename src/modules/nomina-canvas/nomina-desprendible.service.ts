/**
 * Las tablas de recargo del desprendible, construidas DESDE EL CANVAS.
 *
 * ── EL PROBLEMA QUE RESUELVE ──────────────────────────────────────────
 *
 * El desprendible pintaba sus páginas de detalle con `recargos_preview`, que
 * lee las PLANILLAS. El canvas, en cambio, paga desde `liquidaciones_dias`: la
 * copia del corte que se hace al crear el borrador y que después se edita en
 * la hoja (el campo `horas|<tramo>|<codigo>`).
 *
 * En cuanto alguien corrige una hora en el canvas las dos fuentes se separan,
 * y el comprobante contradice al canvas sin que nada avise. Medido en WILSON
 * (corte 21-ago → 20-sep de 2026):
 *
 *            copia (lo que se paga)   planillas (lo que imprimía el PDF)
 *   horas            122,5                      107,17
 *   valor        $1.381.964                  $1.056.277
 *
 *   CORPORACIÓN MONTAÑAS · ago      $95.674  vs  $92.235
 *   FEPCO · ago                    $152.371  vs  $152.371   ← esta sí cuadraba
 *   FEPCO · sep                  $1.133.920  vs  $811.671
 *
 * Las 15,33 horas de diferencia están en ocho días concretos de septiembre
 * (el 6 con 15 en vez de 9, el 12 con 9 en vez de 5…), todos editados a mano
 * en la hoja. El PDF enseñaba los originales.
 *
 * ── CÓMO ──────────────────────────────────────────────────────────────
 *
 * Se devuelve LA MISMA FORMA que traía `recargos_preview`, así que el
 * renderizador de `pdfDesprendible.ts` no cambia: sigue esperando
 * `planillas[].dias[].recargos[]` con `tipo_codigo`, `horas`,
 * `valor_hora_base`, `valor_hora_calculada` y `valor_total`. Lo único que
 * cambia es de dónde salen los números.
 *
 * El agrupado es por EMPRESA · MES · VEHÍCULO, que es como el canvas arma sus
 * bloques y como se leen las planillas en papel.
 *
 * ── LA DISPONIBILIDAD NO SE RESTA AQUÍ ────────────────────────────────
 *
 * Solo se descuenta en la primera hoja, de las líneas OTROS / PAREX /
 * GEOPARK. Estas tablas son el respaldo de las horas trabajadas: si se les
 * restara, sus totales dejarían de cuadrar con sus propias filas y el
 * conductor no podría comprobar nada. Los días de standby se marcan —el
 * renderizador los pinta en rojo— y quedan fuera de los totales, que es otra
 * cosa distinta de restar un importe al final.
 */
import {
  CODIGOS_RECARGO,
  NOMBRE_RECARGO,
  type CodigoRecargo,
  type DiaHoja,
  type HojaNomina,
} from './nomina-canvas.types';

/** Una línea de recargo de un día, como la espera el renderizador del PDF. */
interface RecargoDiaDTO {
  tipo_codigo: CodigoRecargo;
  tipo_nombre: string;
  porcentaje: number;
  horas: number;
  valor_hora_base: number;
  valor_hora_calculada: number;
  valor_total: number;
  /** Las horas EXTRA se listan aparte de los recargos en el consolidado. */
  adicional: boolean;
}

interface DiaPlanillaDTO {
  dia: number;
  hora_inicio: number | null;
  hora_fin: number | null;
  total_horas: number;
  es_festivo: boolean;
  es_domingo: boolean;
  disponibilidad: boolean;
  recargos: RecargoDiaDTO[];
}

interface PlanillaDTO {
  planilla_id: string;
  numero_planilla: string | null;
  vehiculo: { placa: string } | null;
  empresa: { nombre: string } | null;
  mes: number;
  año: number;
  total_dias: number;
  total_horas: number;
  total_valor: number;
  configuracion_salarial: { valor_hora_trabajador: number };
  dias: DiaPlanillaDTO[];
}

export interface RecargosDataDesprendible {
  conductor_id: string;
  periodo: { desde: string; hasta: string };
  planillas: PlanillaDTO[];
  /** Lo que suman las tablas. Tiene que ser `totales.totalRecargos`. */
  total_recargos: number;
}

/** Las horas extra van en su propio bloque del consolidado. */
const ES_HORA_EXTRA: Record<CodigoRecargo, boolean> = {
  RN: false,
  RD: false,
  RNDF: false,
  HEN: true,
  HED: true,
  HEFD: true,
  HEFN: true,
} as Record<CodigoRecargo, boolean>;

/**
 * La tarifa que aplica a una fecha.
 *
 * Por TRAMO DE VIGENCIA, no una sola para todo el corte: el 15-jul-2026
 * cambiaron los porcentajes y las horas mensuales base, y un corte 21→20 que
 * cruce esa fecha paga cada mitad a su precio. Valorar el corte entero con una
 * tarifa única es exactamente lo que hacía pagar junio a precio de julio.
 */
function tarifaDeFecha(
  hoja: HojaNomina,
  fecha: string,
  codigo: CodigoRecargo,
): { porcentaje: number; valorHoraBase: number; valorHora: number } {
  let i = hoja.tramos.findIndex((t) => fecha >= t.desde && fecha <= t.hasta);
  if (i < 0) i = 0;
  const tramo = hoja.tramos[i];
  const tarifa = hoja.tarifas.find((t) => t.codigo === codigo && t.tramo === i);
  return {
    porcentaje: tarifa?.porcentaje ?? 0,
    valorHoraBase: tramo?.valorHora ?? hoja.valorHora ?? 0,
    valorHora: tarifa?.valorHora ?? 0,
  };
}

const redondear2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Agrupa los días del corte en «planillas» por EMPRESA · MES · VEHÍCULO.
 *
 * La clave lleva el vehículo porque un mismo cliente en un mismo mes puede
 * haberse trabajado con dos placas, y la tabla de la planilla es de UNA placa:
 * mezclarlas daría una cabecera que miente sobre con qué se condujo.
 */
export function construirRecargosDataDesdeHoja(
  hoja: HojaNomina,
  periodo: { desde: string; hasta: string },
): RecargosDataDesprendible {
  const grupos = new Map<string, PlanillaDTO>();

  for (const d of hoja.dias as DiaHoja[]) {
    const [anioStr, mesStr, diaStr] = d.fecha.split('-');
    const anio = Number(anioStr);
    const mes = Number(mesStr);
    const clave = `${d.empresaId ?? 'sin-empresa'}|${anio}-${mes}|${d.vehiculoId ?? 'sin-placa'}`;

    let g = grupos.get(clave);
    if (!g) {
      g = {
        planilla_id: clave,
        numero_planilla: null,
        vehiculo: { placa: d.placa ?? 'SIN-PLACA' },
        empresa: { nombre: d.empresa ?? 'SIN EMPRESA' },
        mes,
        año: anio,
        total_dias: 0,
        total_horas: 0,
        total_valor: 0,
        configuracion_salarial: {
          valor_hora_trabajador: tarifaDeFecha(hoja, d.fecha, CODIGOS_RECARGO[0]).valorHoraBase,
        },
        dias: [],
      };
      grupos.set(clave, g);
    }

    const recargos: RecargoDiaDTO[] = [];
    for (const codigo of CODIGOS_RECARGO) {
      const horas = d.horas?.[codigo] ?? 0;
      if (!horas) continue;
      const { porcentaje, valorHoraBase, valorHora } = tarifaDeFecha(hoja, d.fecha, codigo);
      recargos.push({
        tipo_codigo: codigo,
        tipo_nombre: NOMBRE_RECARGO[codigo],
        porcentaje,
        horas: redondear2(horas),
        valor_hora_base: Math.round(valorHoraBase),
        valor_hora_calculada: Math.round(valorHora),
        valor_total: Math.round(horas * valorHora),
        adicional: !!ES_HORA_EXTRA[codigo],
      });
    }

    g.dias.push({
      dia: Number(diaStr),
      hora_inicio: d.horaInicio,
      hora_fin: d.horaFin,
      total_horas: redondear2(d.totalHoras),
      es_festivo: !!d.esFestivo,
      es_domingo: !!d.esDomingo,
      disponibilidad: !!d.disponibilidad,
      recargos,
    });

    g.total_dias++;
    g.total_horas = redondear2(g.total_horas + d.totalHoras);
    /**
     * Un día de standby NO suma al total de su tabla.
     *
     * Es la misma regla que aplica el canvas al repartir entre desprendible y
     * disponibilidad, y la que el renderizador anuncia en rojo sobre la tabla.
     * No tiene nada que ver con restar el importe de `disponibilidad`, que es
     * cosa de la primera hoja.
     */
    if (!d.disponibilidad) {
      g.total_valor += recargos.reduce((s, r) => s + r.valor_total, 0);
    }
  }

  /// Por empresa, mes y placa, que es el orden en que se leen en papel.
  const planillas = [...grupos.values()].sort(
    (a, b) =>
      a.año - b.año ||
      a.mes - b.mes ||
      (a.empresa?.nombre ?? '').localeCompare(b.empresa?.nombre ?? '', 'es') ||
      (a.vehiculo?.placa ?? '').localeCompare(b.vehiculo?.placa ?? '', 'es'),
  );
  for (const p of planillas) p.dias.sort((x, y) => x.dia - y.dia);

  return {
    conductor_id: hoja.conductorId,
    periodo,
    planillas,
    total_recargos: planillas.reduce((s, p) => s + p.total_valor, 0),
  };
}
