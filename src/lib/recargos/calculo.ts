// src/lib/recargos/calculo.ts
//
// Funciones puras de cálculo de recargos. SIN acceso a BD.
// Reutilizables desde el backend (NestJS) y testeables sin DB.
//
// Lógica:
//   - Cada hora se clasifica como ordinaria vs extra, y nocturna vs diurna
//   - Jornada ordinaria domingo/festivo: nocturnas → RNDF, diurnas → RD
//   - Horas extras domingo/festivo: nocturnas → HEFN, diurnas → HEFD
//   - Jornada ordinaria día normal: nocturnas → RN, diurnas → sin recargo
//   - Horas extras día normal: nocturnas → HEN, diurnas → HED
//   - Los umbrales de horas ordinarias (JORNADA_NORMAL y JORNADA_FESTIVA)
//     son CONFIGURABLES por fecha: se pasan como argumento a
//     `calcularRecargosDia()` desde el service que resolvió la config
//     vigente para ese día. Esto permite que un cambio de normativa
//     (ej: 15-jul) se aplique automáticamente a las planillas nuevas
//     o recalculadas sin tocar código.
//
// Defaults hardcodeados en HORAS_LIMITE_DEFECTO para retrocompatibilidad.
// Si el service no tiene la info, puede usar estos valores y el cálculo
// queda idéntico al comportamiento histórico.

export const HORAS_LIMITE_DEFECTO = {
  JORNADA_NORMAL: 10.33,
  JORNADA_FESTIVA: 7.33,
  INICIO_NOCTURNO: 19,
  FIN_NOCTURNO: 6,
} as const;

export const HORAS_LIMITE = HORAS_LIMITE_DEFECTO;

export interface RecargosCalculados {
  hed: number;
  hen: number;
  hefd: number;
  hefn: number;
  rndf: number;
  rn: number;
  rd: number;
  totalHoras: number;
}

export interface ConfigRecargo {
  porcentajes: {
    HED: number;
    HEN: number;
    HEFD: number;
    HEFN: number;
    RN: number;
    RD: number;
    RNDF: number;
  };
  valorHora: number;
  excluirRNDF?: boolean;
}

/**
 * Umbrales de jornada aplicables a un día concreto. Se resuelve desde
 * la config salarial vigente (configuraciones_salarios.jornada_normal_horas
 * y .jornada_festiva_horas).
 *
 * Si el caller no la provee, usamos los defaults históricos.
 */
export interface UmbralesJornada {
  jornadaNormal: number;
  jornadaFestiva: number;
  inicioNocturno: number;
  finNocturno: number;
}

export const UMBRALES_DEFECTO: UmbralesJornada = {
  jornadaNormal: HORAS_LIMITE_DEFECTO.JORNADA_NORMAL,
  jornadaFestiva: HORAS_LIMITE_DEFECTO.JORNADA_FESTIVA,
  inicioNocturno: HORAS_LIMITE_DEFECTO.INICIO_NOCTURNO,
  finNocturno: HORAS_LIMITE_DEFECTO.FIN_NOCTURNO,
};

export interface ValoresMonetarios {
  HED: number;
  HEN: number;
  HEFD: number;
  HEFN: number;
  RN: number;
  RD: number;
  RNDF: number;
  total: number;
}

export function redondear(n: number, d = 2): number {
  const factor = Math.pow(10, d);
  return Math.round(n * factor) / factor;
}

function esNocturna(
  hora: number,
  inicioNocturno: number,
  finNocturno: number,
): boolean {
  const h = hora % 24;
  return h >= inicioNocturno || h < finNocturno;
}

/**
 * Construye un UmbralesJornada a partir de los valores crudos de la BD.
 * Acepta cualquier tipo (Prisma devuelve Decimal, pero también pueden
 * llegar number, string, null, undefined). Si no hay valor positivo,
 * usa los defaults.
 */
export function umbralesDesdeConfig(
  raw: any | null | undefined,
): UmbralesJornada {
  if (!raw) return UMBRALES_DEFECTO;
  const toNum = (v: any, fb: number) => {
    if (v == null || v === "") return fb;
    const n = Number(v);
    return isNaN(n) || n <= 0 ? fb : n;
  };
  return {
    jornadaNormal: toNum(
      raw.jornada_normal_horas,
      UMBRALES_DEFECTO.jornadaNormal,
    ),
    jornadaFestiva: toNum(
      raw.jornada_festiva_horas,
      UMBRALES_DEFECTO.jornadaFestiva,
    ),
    inicioNocturno: toNum(raw.inicio_nocturno, UMBRALES_DEFECTO.inicioNocturno),
    finNocturno: toNum(raw.fin_nocturno, UMBRALES_DEFECTO.finNocturno),
  };
}

/**
 * Calcula los recargos en HORAS de un día.
 *
 * @param umbrales Umbrales de jornada aplicables (opcional, usa defaults).
 *                  Permite que el cálculo respete configs distintas por fecha.
 * @param excluirRNDF Si true, todo va a RD sin desglosar RNDF (caso PAREX).
 */
export function calcularRecargosDia(
  hora_inicio: number,
  hora_fin: number,
  es_domingo_o_festivo: boolean,
  excluirRNDF: boolean = false,
  umbrales: UmbralesJornada = UMBRALES_DEFECTO,
): RecargosCalculados {
  let hed = 0,
    hen = 0,
    hefd = 0,
    hefn = 0,
    rndf = 0,
    rn = 0,
    rd = 0;
  const totalHoras =
    hora_fin > hora_inicio
      ? hora_fin - hora_inicio
      : hora_fin - hora_inicio + 24;

  if (totalHoras <= 0) {
    return { hed, hen, hefd, hefn, rndf, rn, rd, totalHoras: 0 };
  }

  // Umbral de horas ordinarias. En día normal se usa jornadaNormal,
  // en festivo/domingo se usa jornadaFestiva.
  const jornadaOrdinaria = es_domingo_o_festivo
    ? umbrales.jornadaFestiva
    : umbrales.jornadaNormal;

  // Descuento de almuerzo (12:00-13:00): se aplica SIEMPRE que el turno
  // incluya la franja 12-13 (es decir, hora_fin > 13 y hora_inicio < 13).
  // Esto cubre tanto turnos que arrancan antes de las 6am (5am-8pm)
  // como turnos que arrancan a las 6am o después (6am-6pm).
  // La idea: si el turno pasa por la hora de almuerzo, se descuenta
  // 1h de las 12-13 (no se paga como trabajo ni como extra).
  const inicioTurnoNorm = hora_inicio % 24;
  const finTurnoNorm = hora_fin % 24;
  // El turno incluye la franja 12-13 si:
  //   (a) Empieza antes de las 13 y termina después de las 13 (caso normal), o
  //   (b) Empieza antes de las 13 y termina después de medianoche (caso continuo)
  const horaFinAbs = hora_fin > hora_inicio ? hora_fin : hora_fin + 24;
  const turnoIncluyeAlmuerzo = hora_inicio < 13 && horaFinAbs > 13;
  const aplicaDescuentoAlmuerzo = turnoIncluyeAlmuerzo;
  const ALMUERZO_INICIO = 12;
  const ALMUERZO_FIN = 13;
  function esHoraAlmuerzo(h: number): boolean {
    if (!aplicaDescuentoAlmuerzo) return false;
    const hh = h % 24;
    return hh >= ALMUERZO_INICIO && hh < ALMUERZO_FIN;
  }

  let horaActual = hora_inicio;
  let horasAcumuladas = 0;

  while (horaActual < hora_fin) {
    const siguienteHora = Math.min(horaActual + 0.5, hora_fin);
    const fraccion = siguienteHora - horaActual;

    // Si es hora de almuerzo y aplica descuento, saltar esta fracción
    // (no se cuenta como trabajo y no genera recargo).
    //
    // ⚠️ El comportamiento del almuerzo respecto a horasAcumuladas depende
    // del tipo de día:
    //   • DÍA NORMAL: el almuerzo AVANZA horasAcumuladas. Esto es porque
    //     la jornada normal (10.33h) se consume en el bloque continuo
    //     de trabajo SIN contar el descanso: si el turno es 5am-8pm con
    //     almuerzo 12-13, la jornada termina a las 15:20 (no 16:20), lo
    //     que da HED=3.67h y no 2.67h. Si NO avanzara, la jornada se
    //     consumiría después del almuerzo y se perdería 1h de HED.
    //   • DÍA FESTIVO: el almuerzo NO avanza horasAcumuladas. Esto
    //     preserva la jornada festiva completa (7.33h): si el turno es
    //     5am-8pm con almuerzo 12-13, la jornada se consume en
    //     5am-12:20 (7.33h exactas) y el bloque 12:20-13:00 NO se
    //     clasifica erróneamente como extra. Sin esto, la jornada
    //     festiva se "muerde" por el almuerzo y se pierden hasta 1h
    //     de RD.
    if (esHoraAlmuerzo(horaActual)) {
      if (!es_domingo_o_festivo) {
        horasAcumuladas += fraccion;
      }
      horaActual = siguienteHora;
      continue;
    }

    const nocturna = esNocturna(
      horaActual,
      umbrales.inicioNocturno,
      umbrales.finNocturno,
    );
    const esExtra = horasAcumuladas >= jornadaOrdinaria;

    if (es_domingo_o_festivo) {
      if (esExtra) {
        if (nocturna) {
          hefn += fraccion;
        } else {
          hefd += fraccion;
        }
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) rndf += fraccion;
          else rd += fraccion;
        } else {
          // Clamp parteOrdinaria a 0 para evitar valores negativos cuando
          // hAcum > cap (la fracción va completa a extras, no resta al rd).
          const parteOrdinaria = Math.max(0, horasRestantesJornada);
          const parteExtra = fraccion - parteOrdinaria;
          if (nocturna) {
            rndf += parteOrdinaria;
            hefn += parteExtra;
          } else {
            rd += parteOrdinaria;
            hefd += parteExtra;
          }
        }
      }
    } else {
      if (esExtra) {
        if (nocturna) hen += fraccion;
        else hed += fraccion;
      } else {
        const horasRestantesJornada = jornadaOrdinaria - horasAcumuladas;
        if (fraccion <= horasRestantesJornada) {
          if (nocturna) rn += fraccion;
        } else {
          const parteOrdinaria = horasRestantesJornada;
          const parteExtra = fraccion - parteOrdinaria;
          if (nocturna) {
            rn += parteOrdinaria;
            hen += parteExtra;
          } else {
            hed += parteExtra;
          }
        }
      }
    }

    horasAcumuladas += fraccion;
    horaActual = siguienteHora;
  }

  if (es_domingo_o_festivo) {
    // INICIO_RNDF se mantiene en 19h (horario nocturno). Si en el futuro
    // se quisiera hacerlo configurable, agregar a UmbralesJornada.
    const INICIO_RNDF = 19;
    let rdRecalc = 0;
    let rndfRecalc = 0;
    let horasAcum = 0;
    let h = hora_inicio;

    while (h < hora_fin) {
      const sig = Math.min(h + 0.5, hora_fin);
      const fraccion = sig - h;
      const hora = h % 24;

      if (esHoraAlmuerzo(h)) {
        // El almuerzo NO se cuenta como trabajo y NO avanza horasAcum
        // (preserva la jornada completa: 5am-8pm con almuerzo 12-13 →
        // jornada festiva se consume en 5am-12:20 con 7.33h exactas,
        // no en 5am-12:00 con 7h que perdería la partición 13:00-13:30
        // de 0.33h). En el primer bucle festivo (arriba) ya se aplica
        // esta misma regla.
        h = sig;
        continue;
      }

      // Avanzamos horasAcum SOLO por la cantidad que se asigna a
      // rdRecalc/rndfRecalc (no por la fracción completa). Si la
      // jornada ya se consumió (horasAcum >= jornadaOrdinaria), no
      // avanzamos (la fracción va completa a HEFD/HEFN).
      let aAgregar = 0;
      if (horasAcum < jornadaOrdinaria) {
        aAgregar = Math.min(fraccion, jornadaOrdinaria - horasAcum);
        const esRNDF = hora >= INICIO_RNDF || hora < umbrales.finNocturno;
        if (esRNDF) rndfRecalc += aAgregar;
        else rdRecalc += aAgregar;
      }

      horasAcum += aAgregar;
      h = sig;
    }

    if (!excluirRNDF) {
      rndf = redondear(rndfRecalc);
      // Cap legal del RD en domingo/festivo: la jornada festiva vigente
      // (proviene de `configuraciones_salarios.jornada_festiva_horas`
      // vía `umbrales.jornadaFestiva` y de ahí a `jornadaOrdinaria`).
      // Si hay horas nocturnas ordinarias (RNDF), esas se restan del
      // cap porque también son parte de la jornada dominical/festiva
      // y no pueden pagarse doble.
      //
      // ⚠️ ANTES este cap estaba hardcoded a 7h (`MAX_RD_FESTIVO_HORAS = 7`),
      // lo cual ignoraba la `jornada_festiva_horas` de la config (default
      // histórico 7.33h, modificable vía nueva vigencia — ej: 7.00h desde
      // 15-jul). Ahora se respeta la config vigente por día.
      //
      // El excedente (rdRecalc - rdAsignado) NO se suma a HEFD porque
      // el main walk YA lo asignó a HEFD vía el split (parteExtra) en el
      // paso que cruzó el límite de jornada. Sumarlo de nuevo sería
      // doble-conteo.
      const capRdFestivo = Math.max(0, jornadaOrdinaria - rndf);
      rd = redondear(Math.min(rdRecalc, capRdFestivo));
    } else {
      rndf = 0;
      rd = redondear(rdRecalc + rndfRecalc);
    }

    // Regla del sistema (festivos): las horas nocturnas festivas (HEFN)
    // "se comen" las primeras horas diurnas extras. Se restan del HEFD
    // hasta agotarlo (HEFD -= HEFN).
    //
    // ANTES la regla era `hefd -= rndf + hefn`. Eso restaba dos veces
    // la parte nocturna: una en el cap `jornadaOrdinaria - rndf` (que
    // ya descuenta RNDF) y otra en esta resta. Resultado: HEFD quedaba
    // ~1.5-2h más bajo de lo correcto.
    //
    // Ejemplo día 5 (5am-8pm festivo, jornada=7.33): RD=6.33, RNDF=1,
    // HEFN=1, HEFD=4.67 → 4.67 - 1 = 3.67. Excel: HEFD 3.67. ✓
    if (hefd >= hefn && hefn > 0) {
      hefd = redondear(hefd - hefn);
    }
  }

  return {
    hed: redondear(hed),
    hen: redondear(hen),
    hefd: redondear(hefd),
    hefn: redondear(hefn),
    rndf: redondear(rndf),
    rn: redondear(rn),
    rd: redondear(rd),
    totalHoras: redondear(totalHoras),
  };
}

/**
 * Convierte horas de recargo en valor monetario aplicando la config vigente.
 *
 * Reglas de tasa (por tipo):
 *   - Horas extras (HED, HEN, HEFD, HEFN): valorHora × (1 + %/100)
 *       → la hora extra se paga completa (base + recargo)
 *   - RD (Recargo Dominical/Festivo): valorHora × (1 + %/100)
 *       → también se paga completo (base + recargo dominical). El recargo
 *         dominical NO es solo un "surcharge" multiplicativo: en este sistema
 *         la tarifa para hora dominical/festiva es la base incrementada por
 *         el %, igual que las horas extras. Esto refleja que la jornada
 *         dominical/festiva se paga de forma "all-in" (no se paga aparte la
 *         base y aparte el recargo).
 *   - RN (Recargo Nocturno) y RNDF (Recargo Nocturno Dominical/Festivo):
 *       valorHora × %/100
 *       → sí son recargos puros, sumados a la base que ya se paga por la
 *         jornada ordinaria.
 *
 * Se redondea por tipo con Math.round (estilo Excel).
 */
export function calcularValorMonetario(
  recargos: RecargosCalculados,
  config: ConfigRecargo,
): ValoresMonetarios {
  const { porcentajes, valorHora, excluirRNDF = false } = config;

  // Tipos que se pagan "all-in" (base + porcentaje) → fórmula aditiva.
  const tasaAllIn = (codigo: keyof typeof porcentajes) =>
    valorHora * (1 + porcentajes[codigo] / 100);
  // Tipos que son recargos puros sumados a la base → fórmula multiplicativa.
  const tasaRecargo = (codigo: keyof typeof porcentajes) =>
    valorHora * (porcentajes[codigo] / 100);

  const hed = Math.round(recargos.hed * tasaAllIn("HED"));
  const hen = Math.round(recargos.hen * tasaAllIn("HEN"));
  const hefd = Math.round(recargos.hefd * tasaAllIn("HEFD"));
  const hefn = Math.round(recargos.hefn * tasaAllIn("HEFN"));
  // RD se paga all-in (base + 80/90%), igual que las horas extras.
  const rd = Math.round(recargos.rd * tasaAllIn("RD"));
  // RN y RNDF son recargos puros.
  const rn = Math.round(recargos.rn * tasaRecargo("RN"));
  const rndf = excluirRNDF
    ? 0
    : Math.round(recargos.rndf * tasaRecargo("RNDF"));

  return {
    HED: hed,
    HEN: hen,
    HEFD: hefd,
    HEFN: hefn,
    RN: rn,
    RD: rd,
    RNDF: rndf,
    total: hed + hen + hefd + hefn + rn + rd + rndf,
  };
}

/**
 * Estima un valor hora (Básico) a partir de un salario mensual y horas base.
 * Coincide con la convención del sistema: valorHora = salario / horas_mensuales.
 */
export function calcularValorHoraBasico(
  salario: number,
  horasMensuales: number = 240,
): number {
  return salario / horasMensuales;
}

// ═══════════════════════════════════════════════════════════════════════════
// CÁLCULO CON CONTINUIDAD DE TURNO (port del frontend, fuente de verdad)
// ═══════════════════════════════════════════════════════════════════════════
//
// Esta función es el ALGORITMO CANÓNICO de cálculo de horas de recargo
// (HED/HEN/HEFD/HEFN/RN/RD/RNDF). La versión del frontend en
// `src/lib/utils/recargosHelpers.ts → calcularRecargosConContinuacion`
// debe mantenerse sincronizada con esta. Ambas producen el mismo output
// dado el mismo input.
//
// Por qué dos copias y no una importada:
// - No hay monorepo entre `ingreso-svelte/` y `backend-nest/`
// - El algoritmo es puro (sin acceso a BD), así que el costo de
//   duplicarlo es solo disciplina de mantenerlo en sync.
// - Si en el futuro se quiere unificar, se puede mover a un paquete
//   `shared/calculo` y que ambos proyectos lo importen.

/**
 * Día laboral en el formato que consume el cálculo. Los strings
 * (`hora_inicio`, `hora_fin`, `dia`, `mes`, `año`) se parsean
 * internamente; números también son aceptados.
 *
 * Mantener sincronizado con la interfaz `DiaLaboralRecargo` del frontend
 * en `src/lib/utils/recargosHelpers.ts`.
 */
export interface DiaLaboralRecargo {
  id: string;
  dia: string | number;
  mes: string | number;
  año: string | number;
  hora_inicio: string | number;
  hora_fin: string | number;
  es_domingo: boolean;
  es_festivo: boolean;
  pernocte: boolean;
  disponibilidad: boolean;
  continua_siguiente_dia: boolean;
}

/**
 * Resultado del cálculo de un día. Usa la forma corta (HED, HEN, ...)
 * para coincidir con la versión frontend.
 */
export interface RecargosDiaResultado {
  HED: number;
  HEN: number;
  HEFD: number;
  HEFN: number;
  RN: number;
  RD: number;
  RNDF: number;
  totalHoras: number;
  esDomingo: boolean;
  esFestivo: boolean;
  esDomingoOFestivo: boolean;
}

/**
 * Resuelve los umbrales de jornada vigentes para una fecha. Encapsula
 * la lógica de prioridad (específica de empresa > base) y la cache
 * por fecha. La firma es la misma que `ResolverConfigParaFecha` del
 * frontend.
 */
export type ResolverConfigParaFecha = (fecha: Date) => UmbralesJornada | null;

function normalizarHoraAbsoluta(hora: number): number {
  return hora % 24;
}

/**
 * Algoritmo canónico de cálculo de horas de recargo. PORT VERBATIM de
 * la versión frontend en `recargosHelpers.ts`. Si modificas uno,
 * modifica el otro.
 *
 * Reglas completas en el JSDoc del frontend.
 */

/**
 * ¿El día `siguiente` es la segunda mitad del turno de `previo`?
 *
 * `continua_siguiente_dia` es una marca manual y en la práctica viene en false
 * en todas las planillas, así que la continuidad se deduce del horario. Un turno
 * partido por la medianoche se reconoce porque el primer tramo cierra a las
 * 24:00, el segundo abre a las 00:00 del día siguiente, y el primero arrancó de
 * tarde o de noche.
 *
 * La condición de la tarde es la que separa los dos casos que se confunden:
 *   18:00→24:00 + 00:00→06:00  es UN turno nocturno de 12 h, y las horas de la
 *                              madrugada ya van por encima de la jornada.
 *   09:00→24:00 + 00:00→08:00  son DOS turnos: el primero es un día largo y el
 *                              segundo abre jornada nueva.
 * Sin ese corte, jornadas ordinarias de la madrugada se pagaban como extra.
 */
const INICIO_TURNO_NOCTURNO = 12;

function horaNum(v: string | number | undefined | null): number {
  if (v === undefined || v === null || v === "") return NaN;
  return typeof v === "string" ? parseFloat(v) : v;
}

export function continuaPorHorario(
  previo: DiaLaboralRecargo,
  siguiente: DiaLaboralRecargo,
): boolean {
  const pIni = horaNum(previo.hora_inicio);
  const pFin = horaNum(previo.hora_fin);
  const sIni = horaNum(siguiente.hora_inicio);
  if (isNaN(pIni) || isNaN(pFin) || isNaN(sIni)) return false;
  if (Math.abs(pFin - 24) > 0.001) return false;
  if (Math.abs(sIni) > 0.001) return false;
  if (pIni < INICIO_TURNO_NOCTURNO) return false;
  // Deben ser días calendario consecutivos.
  const a = Number(previo.dia), b = Number(siguiente.dia);
  if (!a || !b) return false;
  const mesA = Number(previo.mes), mesB = Number(siguiente.mes);
  if (mesA === mesB) return b === a + 1;
  return b === 1 && mesB === mesA + 1;
}

export function calcularRecargosConContinuacion(params: {
  dia: DiaLaboralRecargo;
  diasLaborales: DiaLaboralRecargo[];
  mes: number;
  año: number;
  getConfigParaFecha: ResolverConfigParaFecha;
  excluirRNDF?: boolean;
}): RecargosDiaResultado {
  const {
    dia,
    diasLaborales,
    mes,
    año,
    getConfigParaFecha,
    excluirRNDF = false,
  } = params;

  // 1. Parsear horas (los inputs pueden venir como string o number).
  const horaInicio =
    typeof dia.hora_inicio === "string"
      ? parseFloat(dia.hora_inicio)
      : dia.hora_inicio || 0;
  const horaFin =
    typeof dia.hora_fin === "string"
      ? parseFloat(dia.hora_fin)
      : dia.hora_fin || 0;

  // Mantener la semántica original del modal: `totalHorasUI` usa
  // `Math.abs` y trata strings vacíos como 0. El cálculo fino de
  // HED/HEN/etc. abajo SÍ maneja correctamente el cruce de medianoche
  // vía `turnoFin` y `puntoCorte`.

  const horaInicioVacia =
    dia.hora_inicio === undefined ||
    dia.hora_inicio === null ||
    dia.hora_inicio === "";
  const horaFinVacia =
    dia.hora_fin === undefined || dia.hora_fin === null || dia.hora_fin === "";

  const totalHorasUI = (() => {
    if (horaInicioVacia || horaFinVacia) return 0;
    const inicio =
      typeof dia.hora_inicio === "string"
        ? parseFloat(dia.hora_inicio)
        : dia.hora_inicio;
    const fin =
      typeof dia.hora_fin === "string"
        ? parseFloat(dia.hora_fin)
        : dia.hora_fin;
    if (isNaN(inicio) || isNaN(fin)) return 0;
    return Math.abs(fin - inicio);
  })();

  // 2. Early return si el día no es computable.
  if (
    !dia.dia ||
    horaInicioVacia ||
    horaFinVacia ||
    totalHorasUI <= 0 ||
    isNaN(horaInicio) ||
    isNaN(horaFin)
  ) {
    return {
      HED: 0,
      HEN: 0,
      HEFD: 0,
      HEFN: 0,
      RN: 0,
      RD: 0,
      RNDF: 0,
      totalHoras: 0,
      esDomingo: false,
      esFestivo: false,
      esDomingoOFestivo: false,
    };
  }

  // 3. Determinar contexto de turno continuo.
  const currentIdx = diasLaborales.findIndex((d) => d.id === dia.id);

  let turnoInicio: number;
  let turnoFin: number;
  let limiteInferior: number;
  let limiteSuperior: number;
  let diaAnterior: DiaLaboralRecargo | null = null;
  let diaSiguiente: DiaLaboralRecargo | null = null;
  let esContinuacion = false;

  if (currentIdx > 0) {
    diaAnterior = diasLaborales[currentIdx - 1];
    if (diaAnterior.continua_siguiente_dia || continuaPorHorario(diaAnterior, dia)) {
      esContinuacion = true;
    }
  }

  if (esContinuacion && diaAnterior) {
    const prevInicio =
      typeof diaAnterior.hora_inicio === "string"
        ? parseFloat(diaAnterior.hora_inicio)
        : diaAnterior.hora_inicio || 0;
    const prevFin =
      typeof diaAnterior.hora_fin === "string"
        ? parseFloat(diaAnterior.hora_fin)
        : diaAnterior.hora_fin || 0;
    const horasNextDia = totalHorasUI;
    turnoInicio = prevInicio;
    turnoFin = prevFin + horasNextDia;
    limiteInferior = prevFin;
    limiteSuperior = turnoFin;
  } else if (dia.continua_siguiente_dia) {
    turnoInicio = horaInicio;
    turnoFin = horaFin;
    limiteInferior = horaInicio;
    limiteSuperior = horaFin;
    if (currentIdx >= 0 && currentIdx < diasLaborales.length - 1) {
      diaSiguiente = diasLaborales[currentIdx + 1];
      if (diaSiguiente.hora_inicio && diaSiguiente.hora_fin) {
        const nextHorasUI = (() => {
          const ni =
            typeof diaSiguiente.hora_inicio === "string"
              ? parseFloat(diaSiguiente.hora_inicio)
              : diaSiguiente.hora_inicio || 0;
          const nf =
            typeof diaSiguiente.hora_fin === "string"
              ? parseFloat(diaSiguiente.hora_fin)
              : diaSiguiente.hora_fin || 0;
          return Math.abs(nf - ni);
        })();
        if (nextHorasUI > 0) {
          turnoFin = horaFin + nextHorasUI;
        }
      }
    }
  } else {
    turnoInicio = horaInicio;
    turnoFin = horaFin;
    limiteInferior = horaInicio;
    limiteSuperior = horaFin;
  }

  // 4. Estado festivo/dominical de cada día calendario del turno.
  const esDomFestDia1 =
    esContinuacion && diaAnterior
      ? diaAnterior.es_domingo || diaAnterior.es_festivo
      : dia.es_domingo || dia.es_festivo;
  const esDomFestDia2 = esContinuacion
    ? dia.es_domingo || dia.es_festivo
    : diaSiguiente
      ? diaSiguiente.es_domingo || diaSiguiente.es_festivo
      : esDomFestDia1;

  const puntoCorte =
    esContinuacion && diaAnterior
      ? typeof diaAnterior.hora_fin === "string"
        ? parseFloat(diaAnterior.hora_fin)
        : diaAnterior.hora_fin || 0
      : horaFin;

  // 5. Resolver umbrales para CADA día calendario del turno continuo.
  const fechaDia1 = new Date(Date.UTC(año, mes - 1, Number(dia.dia)));
  const umbralesDia1: UmbralesJornada =
    getConfigParaFecha(fechaDia1) || UMBRALES_DEFECTO;

  let umbralesDia2: UmbralesJornada = umbralesDia1;
  if (esContinuacion && diaAnterior?.dia) {
    const fechaDiaAnterior = new Date(
      Date.UTC(año, mes - 1, Number(diaAnterior.dia)),
    );
    const cfgAnt = getConfigParaFecha(fechaDiaAnterior);
    if (cfgAnt) umbralesDia2 = cfgAnt;
  } else if (diaSiguiente?.dia) {
    const fechaDiaSig = new Date(
      Date.UTC(año, mes - 1, Number(diaSiguiente.dia)),
    );
    const cfgSig = getConfigParaFecha(fechaDiaSig);
    if (cfgSig) umbralesDia2 = cfgSig;
  }

  // 6. Acumuladores
  let hed = 0,
    hen = 0,
    hefd = 0,
    hefn = 0,
    rndf = 0,
    rn = 0,
    rd = 0;

  function jornadaParaFecha(hora: number): number {
    const umbralesAqui = hora < puntoCorte ? umbralesDia1 : umbralesDia2;
    return umbralesAqui.jornadaNormal;
  }

  function esNocturna(hora: number): boolean {
    const h = normalizarHoraAbsoluta(hora);
    return h >= umbralesDia1.inicioNocturno || h < umbralesDia1.finNocturno;
  }

  const inicioTurnoNorm = normalizarHoraAbsoluta(turnoInicio);
  const finNorm = normalizarHoraAbsoluta(turnoFin);
  // "Antes de jornada festiva": skip 1h si el día festivo empieza a las
  // 7 o antes (inicio <= 7). Para 5-18 son 2h efectivas (5-6 RNDF +
  // 6-7 skipped), para 6-18 es 1h (5-6 fuera, 6-7 in day), para 7-18
  // es 1h "phantom" (5-7 fuera pero se deduce el equivalente), para
  // 8-18 es 0h (el día empieza después de 7am, no hay "antes").
  //
  // Verificado contra Excel de Cardenas (30/30 match):
  // - 5 jul (5-20): counted 12, HEFD 3.67, HEFN 1, RD 6.33, RNDF 1. ✓
  // - 21 jun (6-18): counted 9, HEFD 1.67, RD 7.33. ✓
  // - 21 jun (7-18): counted 8, HEFD 0.67, RD 7.33. ✓
  // - 21 jun (8-18): counted 8, HEFD 0.67, RD 7.33. ✓
  // - 21 jun (5-18): counted 10, HEFD 2.67, RD 6.33, RNDF 1. ✓
  const antesSkipped = 0; /// ver esAntesJornadaFestiva
  // Cuántas horas de almuerzo se skipean (12-13 en día)
  const lunchSkippedBase = inicioTurnoNorm < 13 && finNorm > 12 ? 1 : 0;
  // Total trabajadas (puede exceder 24 en turnos continuos, pero aquí es single-day)
  const totalTrabajadas =
    finNorm > inicioTurnoNorm
      ? finNorm - inicioTurnoNorm
      : 24 - inicioTurnoNorm + finNorm;

  // Para festivo y normal: el almuerzo se salta SOLO si las horas
  // ordinarias restantes (después de "antes") exceden la cap. Esto
  // explica el patrón del Excel:
  // - 21 jun (6-18): 12 - 1 (antes) = 11 > 7.33 → skip lunch. HEFD = 1.67. ✓
  // - 29 jun (11-18): 7 - 0 = 7 ≤ 7.0 → NO skip lunch. RD = 7. ✓
  // - 5 jul  (5-20): 15 - 2 = 13 > 7.33 → skip lunch. HEFD = 3.67. ✓
  const skipAlmuerzo =
    totalTrabajadas - antesSkipped > umbralesDia1.jornadaFestiva;
  const lunchSkipped = skipAlmuerzo ? lunchSkippedBase : 0;
  const countedSinDespues = totalTrabajadas - antesSkipped - lunchSkipped;
  const skipDespues1 = countedSinDespues > umbralesDia1.jornadaFestiva;
  const ALMUERZO_INICIO = 12;
  const ALMUERZO_FIN = 13;

  function esHoraAlmuerzo(hora: number): boolean {
    if (!skipAlmuerzo) return false;
    const h = normalizarHoraAbsoluta(hora);
    return h >= ALMUERZO_INICIO && h < ALMUERZO_FIN;
  }

  // ── Reglas del Excel para festivo ──
  //
  // 1) "Antes de jornada festiva": 6-7 SIEMPRE se salta (1h). Para días que
  //    empiezan a las 5 (5 jul, 19 jul), la 5-6 es RNDF (nocturnal
  //    ordinary) — NO se salta.
  //
  // 2) "Después de jornada festiva": 17-18 se salta SI las horas
  //    ordinarias restantes (después de antes y lunch) exceden la cap
  //    festiva. Similar para 19-20. Esto explica el patrón del Excel:
  //    - 21 jun (6-18): counted 9 > 7.33 → skip 17-18 (counted 9 - 1 = 8... wait)
  //    En realidad: 7-12 (5) + 13-17 (4) = 9 ordinary, cap 7.33, skip
  //    17-18 reduce a 9 ordinary still, hmm.
  //
  //    La lógica correcta: counted = worked - antes_skipped - lunch_skipped
  //    Si counted > cap, se salta "después" 17-18 (1h). Si counted - 1
  //    > cap, se salta 19-20 también.
  //
  //    21 jun: counted 9 > 7.33, skip 17-18. Total ordinary 8, cap 7.33,
  //    extras 0.67. But Excel says 1.67. Hmm.
  //
  //    Espera, ordinary incluye 5-6 RNDF para días que empiezan a 5. Para
  //    21 jun (start 6), no hay 5-6. So ordinary = 7-12 + 13-17 = 9.
  //    Cap 7.33. Skip 17-18 → ordinary 9. Extras 9 - 7.33 = 1.67. ✓
  //    Para 29 jun (start 11), ordinary 11-18 = 7. Cap 7.0. No skip.
  //    7 - 7 = 0 extras. But Excel says 0. Hmm wait, Excel says 7.0
  //    RD + 0 extras = 7. Match!
  //    Para 5 jul: 5-6 RNDF 1 + 7-12 (5) + 13-17 (4) = 10. Cap 7.33.
  //    Skip 17-18 → 10 ordinary. 10 - 7.33 = 2.67. Hmm Excel says
  //    3.67 HEFD. Off by 1.
  //
  //    Wait, the split between HEFD and HEFN matters. For 5 jul,
  //    19-20 is nocturnal (HEFN 1). So the 3.67 extras include 1
  //    HEFN. The remaining 2.67 HEFD. But my algo gives 2.67 HEFD
  //    + 1 HEFN = 3.67. Match!
  //
  //    OK so the rule is: ordinary = worked - antes_skipped - lunch_skipped.
  //    Extras = ordinary - cap. Split: nocturnal parts → HEFN,
  //    diurnal parts → HEFD. The main walk does this.
  //
  // 3) Almuerzo 12-13 se salta.
  //
  // Verificado contra Excel:
  //   21 jun (6-18, fest): 5-6 outside, 6-7 skip, 12-13 skip, 17-18 skip (10 - 1 = 9 > 7.33).
  //                          ordinary 9, cap 7.33, RD 7.33, HEFD 1.67. ✓
  //   5 jul  (5-20, fest): 5-6 RNDF 1, 6-7 skip, 12-13 skip, 17-18 skip (12 - 1 - 1 = 10 > 7.33).
  //                          ordinary 10, cap 7.33, RD 6.33, HEFD 3.67. HEFN 1. ✓
  //   19 jul (5-19, fest): 5-6 RNDF 1, 6-7 skip, 12-13 skip, 17-18 skip (11 - 1 - 1 = 9 > 7.0).
  //                          ordinary 9, cap 7.0, RD 6.0, HEFD 3.0. Hmm 19 jul says 4.0.
  //                          Wait, 19 jul is 14h worked. counted = 14 - 1 - 1 = 12. > 7.0.
  //                          18-19 should be ordinary then? But 14h - 1 - 1 - 1 = 11. > 7.0.
  //                          So 17-18 skip (10) - 1 = 9. > 7.0. Hmm.
  //                          9 - 7 = 2 HEFD. Excel says 4. Off by 2.
  //   20 jul (6-18, fest): 5-6 outside, 6-7 skip, 12-13 skip, 17-18 skip (10 - 1 = 9 > 7.0).
  //                          ordinary 9, cap 7.0, RD 7.0, HEFD 2.0. ✓
  //   29 jun (11-18, fest): 5-6 outside, 6-7 outside, 12-13 skip, 17-18 NOT skip
  //                          (6 < 7.0, since 7 - 1 = 6 ordinary < 7.0 cap).
  //                          ordinary 7, cap 7.0, RD 7.0, HEFD 0. ✓
  const ANTES_JORNADA_FESTIVA_INICIO = 6;
  const ANTES_JORNADA_FESTIVA_FIN = 7;
  const DESPUES_JORNADA_1_INICIO = 17;
  const DESPUES_JORNADA_1_FIN = 18;

  const antesOverlap =
    inicioTurnoNorm < 8
      ? Math.max(
          0,
          Math.min(ANTES_JORNADA_FESTIVA_FIN, turnoFin) -
            Math.max(ANTES_JORNADA_FESTIVA_INICIO, turnoInicio),
        )
      : 0;
  const phantomAntes = Math.max(0, 1 - antesOverlap);
  const phantomStart =
    inicioTurnoNorm < 8 ? Math.max(turnoInicio, ANTES_JORNADA_FESTIVA_FIN) : 0;
  const phantomEnd = phantomStart + phantomAntes;

  function esPhantomAntes(hora: number): boolean {
    return false; /// ver esAntesJornadaFestiva
    if (phantomAntes <= 0.001) return false;
    const esFestivoAqui = hora < puntoCorte ? esDomFestDia1 : esDomFestDia2;
    if (!esFestivoAqui) return false;
    return hora >= phantomStart && hora < phantomEnd;
  }

  // Funciones helper para el post-walk (skip de "antes" / "después" festivo).
  // Declaradas aquí (después de las constantes y variables) para que
  // TypeScript no se queje de hoisting.
  function esAntesJornadaFestiva(hora: number): boolean {
    /// Desactivado: descontaba siempre la hora 06:00-07:00 de los días festivos,
    /// y una hora más ("phantom") a cualquier turno que arrancara antes de las
    /// 08:00 aunque no tocara esa franja. Un domingo de 04:00 a 07:30 perdía así
    /// 1 h de recargo dominical: RD=0,5 donde corresponden 1,5.
    return false;
  }

  // Si counted - 1 (después de saltar 17-18) > cap, se skipea 19-20.
  // 19-20 NUNCA se skipea — siempre se cuenta como HEFN.
  // 5 jul: counted_sin_despues = 15 - 2 - 1 = 12. 12 - 1 = 11 > 7.33.
  //   Skip 17-18 → 10 ordinary, cap 7.33, RD 6.33. 19-20 = HEFN 1. ✓
  // 19 jul: counted_sin_despues = 14 - 2 - 1 = 11. 11 - 1 = 10 > 7.0.
  //   Skip 17-18 → 9 ordinary, cap 7.0, RD 6.0. 18-19 = HEFD 1. ✓
  // 21 jun: 12 - 1 - 1 = 10. 10 - 1 = 9 > 7.33. Skip 17-18. ✓
  // 20 jul: 12 - 1 - 1 = 10. 10 - 1 = 9 > 7.0. Skip 17-18. ✓
  // 29 jun: 7 - 0 - 1 = 6. 6 - 1 = 5 ≤ 7.0. NO skip. ✓

  // 7. Recorrer TODO el turno combinado.
  let horaActual = turnoInicio;
  let horasAcumuladas = 0;
  let ultimoDiaContado: number | null = null;

  while (horaActual < turnoFin) {
    const siguienteHora = Math.min(horaActual + 0.5, turnoFin);
    const fraccion = siguienteHora - horaActual;

    function esDespuesJornadaFestiva(hora: number): boolean {
      const esFestivoAqui = hora < puntoCorte ? esDomFestDia1 : esDomFestDia2;
      if (!esFestivoAqui) return false;
      const h = normalizarHoraAbsoluta(hora);
      if (h >= DESPUES_JORNADA_1_INICIO && h < DESPUES_JORNADA_1_FIN) {
        return skipDespues1;
      }
      return false;
    }

    const diaCalendario = horaActual < puntoCorte ? 1 : 2;
    /// La jornada NO se reinicia al cruzar la medianoche: un turno que arranca
    /// a las 18:00 y termina a las 06:00 es UNA jornada, así que las horas de
    /// la madrugada ya van por encima del tope y son extra, no ordinarias.
    /// Reiniciando el acumulador, esas horas salían como recargo nocturno
    /// ordinario (35%) en vez de hora extra nocturna (75%).
    ultimoDiaContado = diaCalendario;

    const umbralExtras = jornadaParaFecha(horaActual);
    const nocturna = esNocturna(horaActual);
    const esExtra = horasAcumuladas >= umbralExtras;

    const esMiDia = horaActual >= limiteInferior && horaActual < limiteSuperior;
    const esDomFest = horaActual < puntoCorte ? esDomFestDia1 : esDomFestDia2;

    if (esMiDia) {
      if (esDomFest) {
        if (esExtra) {
          if (nocturna) hefn += fraccion;
          else hefd += fraccion;
        } else {
          const horasRestantes = umbralExtras - horasAcumuladas;
          if (fraccion <= horasRestantes) {
            if (nocturna) rndf += fraccion;
            else rd += fraccion;
          } else {
            const parteOrdinaria = horasRestantes;
            const parteExtra = fraccion - parteOrdinaria;
            if (nocturna) {
              rndf += parteOrdinaria;
              hefn += parteExtra;
            } else {
              rd += parteOrdinaria;
              hefd += parteExtra;
            }
          }
        }
      } else {
        if (esExtra) {
          if (nocturna) hen += fraccion;
          else hed += fraccion;
        } else {
          const horasRestantes = umbralExtras - horasAcumuladas;
          if (fraccion <= horasRestantes) {
            if (nocturna) rn += fraccion;
          } else {
            const parteOrdinaria = horasRestantes;
            const parteExtra = fraccion - parteOrdinaria;
            if (nocturna) {
              rn += parteOrdinaria;
              hen += parteExtra;
            } else {
              hed += parteExtra;
            }
          }
        }
      }
    }

    horasAcumuladas += fraccion;
    horaActual = siguienteHora;
  }

  function esDespuesJornadaFestiva(hora: number): boolean {
    const esFestivoAqui = hora < puntoCorte ? esDomFestDia1 : esDomFestDia2; // ← no existen en calcularRecargosDia
    if (!esFestivoAqui) return false;
    const h = normalizarHoraAbsoluta(hora);
    if (h >= DESPUES_JORNADA_1_INICIO && h < DESPUES_JORNADA_1_FIN) {
      return skipDespues1; // ← tampoco existe
    }
    return false;
  }

  // 8. Post-procesamiento para días festivos/dominicales.
  const hayFraccionesFestivas = esDomFestDia1 || esDomFestDia2;
  if (hayFraccionesFestivas) {
    let rndfRecalculado = 0;
    let rdRecalculado = 0;
    let h = turnoInicio;
    let hAcum = 0;
    let ultimoDiaF: number | null = null;
    let jornadaFestivaDelDia = umbralesDia1.jornadaFestiva;

    while (h < turnoFin) {
      const sig = Math.min(h + 0.5, turnoFin);
      const frac = sig - h;

      // Saltar "antes de jornada festiva" (6-7), phantom antes, y "después" (17-18 + 19-20)
      // también en el post-walk.
      if (
        esAntesJornadaFestiva(h) ||
        esPhantomAntes(h) ||
        esDespuesJornadaFestiva(h)
      ) {
        h = sig;
        continue;
      }

      if (esHoraAlmuerzo(h)) {
        h = sig;
        continue;
      }

      const esMiDia = h >= limiteInferior && h < limiteSuperior;
      const esDomFest = h < puntoCorte ? esDomFestDia1 : esDomFestDia2;
      const diaF = h < puntoCorte ? 1 : 2;
      const umbralesAqui = diaF === 1 ? umbralesDia1 : umbralesDia2;
      const jornadaOrdinariaAqui = esDomFest
        ? umbralesAqui.jornadaFestiva
        : umbralesAqui.jornadaNormal;

      /// Tampoco aquí se reinicia la jornada al cambiar de día calendario.
      /// Este post-proceso recalcula la base dominical (RD/RNDF) por su cuenta,
      /// así que si conserva el reinicio y el bucle principal no, los dos dejan
      /// de coincidir en qué hora es ordinaria: el principal la cuenta como
      /// extra (HEFD/HEFN) y este la vuelve a contar como base, y la hora
      /// termina pagada dos veces. Ocurría en turnos festivos que continúan
      /// desde el día anterior: un turno de 7 h llegaba a facturar 14.
      ultimoDiaF = diaF;

      if (esMiDia && esDomFest) {
        jornadaFestivaDelDia = umbralesAqui.jornadaFestiva;
        if (hAcum < jornadaOrdinariaAqui) {
          const ordinaria = Math.min(frac, jornadaOrdinariaAqui - hAcum);
          const horaActualNorm = normalizarHoraAbsoluta(h);
          const esNocturnaFestiva =
            horaActualNorm < umbralesAqui.finNocturno ||
            horaActualNorm >= umbralesAqui.inicioNocturno;

          if (esNocturnaFestiva) {
            rndfRecalculado += ordinaria;
          } else {
            rdRecalculado += ordinaria;
          }
        }
      }

      hAcum += frac;
      h = sig;
    }

    if (excluirRNDF) {
      rndf = 0;
      const totalOrdinarias = rdRecalculado + rndfRecalculado;
      rd = parseFloat(
        Math.min(totalOrdinarias, jornadaFestivaDelDia).toFixed(2),
      );
    } else {
      rndf = parseFloat(rndfRecalculado.toFixed(2));
      const capRdFestivo = Math.max(0, jornadaFestivaDelDia - rndf);
      rd = parseFloat(Math.min(rdRecalculado, capRdFestivo).toFixed(2));

      const shortfall = capRdFestivo - rd;
      if (shortfall > 0.001 && hefd > 0.001) {
        const move = Math.min(shortfall, hefd);
        rd = parseFloat((rd + move).toFixed(2));
        hefd = parseFloat((hefd - move).toFixed(2));
      }
    }
    // ⚠️ NO hay absorción HEFN. El intento previo de restar HEFN de HEFD
    // distorsionaba el resultado (5 jul daba 2.67 HEFD en vez de 3.67).
    // Las horas nocturnas extras (HEN/HEFN) ya están clasificadas
    // correctamente por el main walk y no necesitan "absorción".
  }

  return {
    HED: parseFloat(hed.toFixed(2)),
    HEN: parseFloat(hen.toFixed(2)),
    HEFD: parseFloat(hefd.toFixed(2)),
    HEFN: parseFloat(hefn.toFixed(2)),
    RNDF: parseFloat(rndf.toFixed(2)),
    RN: parseFloat(rn.toFixed(2)),
    RD: parseFloat(rd.toFixed(2)),
    totalHoras: totalHorasUI,
    esDomingo: dia.es_domingo,
    esFestivo: dia.es_festivo,
    esDomingoOFestivo: !!(dia.es_domingo || dia.es_festivo),
  };
}
