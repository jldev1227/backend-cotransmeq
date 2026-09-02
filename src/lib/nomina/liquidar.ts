// src/lib/nomina/liquidar.ts
//
// Cálculo puro de la liquidación de nómina de un conductor. SIN acceso a BD,
// SIN dependencias de Prisma ni de Fastify: todo entra por parámetro y todo
// sale en el resultado. Así se puede testear en Node y, sobre todo, así se
// puede contrastar contra los Excel de agosto 2026 sin levantar la app.
//
// PROCEDENCIA. Esto es el port de `calcularTotales()`, que hasta ahora vivía
// en el navegador (`ingreso-svelte/src/lib/components/nomina/
// LiquidacionFormComplete.svelte:1165-1520`) y cuyo resultado el backend
// persistía sin recalcular ni validar. El formulario sigue usando su copia:
// esta no lo reemplaza todavía, la consume el canvas de nómina.
//
// QUÉ CAMBIA RESPECTO AL ORIGINAL. Solo una cosa: lo que allí eran
// constantes escritas a mano —los UUID de PAREX y Geopark y el 8 % del
// ajuste— aquí son parámetros (`ParametrosNomina`). En el original esos
// literales aparecen en tres archivos distintos y hay que acordarse de
// cambiarlos en los tres.
//
// QUÉ NO CAMBIA. La aritmética, incluidas dos rarezas que se han portado a
// propósito y están marcadas abajo con `⚠ FIEL AL ORIGINAL`. Cambiarlas aquí
// haría que el canvas y el formulario dieran cifras distintas para la misma
// liquidación, que es exactamente el problema que este módulo viene a cerrar.
// Se corrigen cuando la comparación contra los Excel diga cuál de las dos
// versiones es la buena, y se corrigen en los dos sitios a la vez.

/** Porcentajes y valores que hoy se leen de `configuraciones_liquidacion`. */
export interface ParametrosNomina {
  /** Config "Auxilio de transporte": valor mensual, se prorratea /30. */
  auxilioTransporteMensual: number;
  /** Config "Salario villanueva": salario de referencia del ajuste. */
  salarioVillanueva: number;
  /** Config "Salud": porcentaje EN UNIDADES DE 100 (4 = 4 %). */
  porcentajeSalud: number;
  /** Config "Pensión": porcentaje EN UNIDADES DE 100 (4 = 4 %). */
  porcentajePension: number;
  /** UUID del cliente PAREX. Antes literal `cfb258a6-…` en el componente. */
  empresaParexId: string | null;
  /** UUID del cliente Geopark. Antes literal `eea5eda5-…` en el componente. */
  empresaGeoparkId: string | null;
  /** Fracción, no porcentaje: 0.08. Antes literal `* 0.08`. */
  fraccionAjusteRecargos: number;
}

export const PARAMETROS_DEFECTO: Omit<
  ParametrosNomina,
  'auxilioTransporteMensual' | 'salarioVillanueva' | 'porcentajeSalud' | 'porcentajePension'
> = {
  empresaParexId: null,
  empresaGeoparkId: null,
  fraccionAjusteRecargos: 0.08,
};

/** Un recargo cargado a mano sobre la liquidación (tabla `recargos`). */
export interface RecargoManual {
  valor: number;
  empresa_id: string | null;
  es_automatico?: boolean;
  es_override?: boolean;
  origen_planilla_id?: string | null;
}

/**
 * Un grupo de recargos derivado de las planillas (lo que devuelve
 * `previewRecargos()`).
 *
 * Ojo con la forma: el preview llega EXPANDIDO, con una entrada por cada
 * `origen_planilla_id` que compone el grupo y todas con el mismo `valor`,
 * que es el total del grupo entero. Sumarlas sin deduplicar por `key`
 * multiplica el grupo por su número de planillas.
 */
export interface GrupoRecargoPreview {
  key: string;
  valor: number;
  empresa_id: string | null;
  origen_planilla_id?: string | null;
  incluir?: boolean;
}

export interface BonoLiquidacion {
  /** `[{ mes, quantity }]` — se paga `quantity × value` por cada entrada. */
  values: { quantity: number }[];
  value: number;
}

export interface PernoteLiquidacion {
  cantidad: number;
  valor: number;
}

export interface DetalleVehiculo {
  bonos: BonoLiquidacion[];
  pernotes: PernoteLiquidacion[];
  recargos: RecargoManual[];
}

export interface EntradaLiquidacion {
  /** `conductores.salario_base`. */
  salarioBase: number;
  diasLaborados: number;
  diasLaboradosVillanueva: number;

  detallesVehiculos: DetalleVehiculo[];
  previewRecargosGrupos: GrupoRecargoPreview[];
  anticipos: { valor: number }[];
  conceptosAdicionales: { valor: number }[];

  /** Vacaciones tecleadas a mano. Si es > 0, manda sobre el cálculo por fechas. */
  valorVacaciones: number;
  vacacionesInicio?: string | Date | null;
  vacacionesFin?: string | Date | null;
  interesCesantias: number;
  disponibilidad: number;

  // Interruptores del formulario
  descontarTransporte: boolean;
  aplicaAjusteVillanueva: boolean;
  ajusteVillanuevaPorDia: boolean;
  aplicaAjusteParex: boolean;
  aplicaAjusteGeopark: boolean;
  /** El 8 % se calcula sobre TODOS los recargos, no solo los de PAREX. */
  ajusteRecargosCompletos: boolean;
  aplicaIncapacidad: boolean;
  /** Prorratea el ajuste teórico sobre estos días para el IBC. `null` = 30/30. */
  diasAjusteDeducciones: number | null;
  noDescontarSalud: boolean;
  noDescontarPension: boolean;
  /** El IBC de salud pasa a ser el salario base pelado. */
  descontarSaludSalario: boolean;
  descontarPensionSalario: boolean;
}

export interface ResultadoLiquidacion {
  salarioDevengado: number;
  auxilioTransporte: number;
  totalBonificaciones: number;
  totalPernotes: number;
  totalRecargos: number;
  totalRecargosParex: number;
  totalRecargosGeopark: number;
  totalVacaciones: number;
  bonificacionVillanueva: number;
  valorIncapacidad: number;
  ajusteParex: number;
  ajusteGeopark: number;
  interesCesantias: number;
  disponibilidad: number;
  sueldoBruto: number;
  baseCalculo: number;
  baseCalculoSalud: number;
  baseCalculoPension: number;
  salud: number;
  pension: number;
  totalAnticipos: number;
  totalAjustesAdicionales: number;
  totalDeducciones: number;
  sueldoTotal: number;
}

export const RESULTADO_VACIO: ResultadoLiquidacion = {
  salarioDevengado: 0,
  auxilioTransporte: 0,
  totalBonificaciones: 0,
  totalPernotes: 0,
  totalRecargos: 0,
  totalRecargosParex: 0,
  totalRecargosGeopark: 0,
  totalVacaciones: 0,
  bonificacionVillanueva: 0,
  valorIncapacidad: 0,
  ajusteParex: 0,
  ajusteGeopark: 0,
  interesCesantias: 0,
  disponibilidad: 0,
  sueldoBruto: 0,
  baseCalculo: 0,
  baseCalculoSalud: 0,
  baseCalculoPension: 0,
  salud: 0,
  pension: 0,
  totalAnticipos: 0,
  totalAjustesAdicionales: 0,
  totalDeducciones: 0,
  sueldoTotal: 0,
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Grupos del preview que están COMPLETAMENTE sobreescritos a mano.
 *
 * Un recargo manual con `es_override` reemplaza al automático que lleva ese
 * mismo `origen_planilla_id`; si el automático siguiera sumando, el valor se
 * contaría dos veces. Pero el razonamiento va a nivel de GRUPO, no de
 * planilla: un grupo solo se descarta si TODAS sus planillas están
 * sobreescritas. Si queda una sin sobreescribir el grupo aporta su valor
 * íntegro, porque el preview no guarda el desglose por planilla y no hay de
 * dónde sacar la parte proporcional.
 */
function gruposSobreescritos(
  detallesVehiculos: DetalleVehiculo[],
  previewRecargosGrupos: GrupoRecargoPreview[],
): Set<string> {
  const origenesConOverride = new Set<string>(
    detallesVehiculos
      .flatMap((d) => d.recargos || [])
      .filter((r) => r.es_override && r.origen_planilla_id)
      .map((r) => r.origen_planilla_id as string),
  );

  const origenesPorGrupo = new Map<string, Set<string>>();
  for (const g of previewRecargosGrupos || []) {
    if (!g?.key || !g.origen_planilla_id) continue;
    let set = origenesPorGrupo.get(g.key);
    if (!set) {
      set = new Set<string>();
      origenesPorGrupo.set(g.key, set);
    }
    set.add(g.origen_planilla_id);
  }

  const completos = new Set<string>();
  for (const [key, set] of origenesPorGrupo) {
    let todos = true;
    for (const origen of set) {
      if (!origenesConOverride.has(origen)) {
        todos = false;
        break;
      }
    }
    if (todos) completos.add(key);
  }
  return completos;
}

/**
 * Suma los grupos del preview deduplicando por `key`. `filtroEmpresa`
 * restringe a una empresa; `null` suma todas.
 */
function sumarPreview(
  grupos: GrupoRecargoPreview[],
  sobreescritos: Set<string>,
  filtroEmpresa: string | null,
): number {
  const vistos = new Set<string>();
  let total = 0;
  for (const g of grupos || []) {
    if (!g) continue;
    if (g.incluir === false) continue;
    if (filtroEmpresa !== null && g.empresa_id !== filtroEmpresa) continue;
    if (sobreescritos.has(g.key)) continue;
    if (vistos.has(g.key)) continue;
    vistos.add(g.key);
    total += num(g.valor);
  }
  return total;
}

/** Suma los recargos manuales de una empresa (los automáticos van por su canal). */
function sumarManuales(
  detallesVehiculos: DetalleVehiculo[],
  filtroEmpresa: string | null,
): number {
  return detallesVehiculos
    .flatMap((d) => d.recargos || [])
    .filter((r) => (filtroEmpresa === null ? !r.es_automatico : r.empresa_id === filtroEmpresa))
    .reduce((sum, r) => sum + num(r.valor), 0);
}

function diasEntre(inicio: string | Date, fin: string | Date): number {
  const a = inicio instanceof Date ? inicio : new Date(inicio);
  const b = fin instanceof Date ? fin : new Date(fin);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  return Math.ceil((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}

export function liquidarNomina(
  entrada: EntradaLiquidacion,
  parametros: ParametrosNomina,
): ResultadoLiquidacion {
  const salarioBase = num(entrada.salarioBase);
  const diasLaborados = num(entrada.diasLaborados);
  const detalles = entrada.detallesVehiculos || [];
  const preview = entrada.previewRecargosGrupos || [];

  const salarioDevengado = (salarioBase / 30) * diasLaborados;

  const auxilioTransporte = entrada.descontarTransporte
    ? 0
    : (num(parametros.auxilioTransporteMensual) / 30) * diasLaborados;

  const totalBonificaciones = detalles.reduce(
    (acc, d) =>
      acc +
      (d.bonos || []).reduce(
        (t, bono) =>
          t + (bono.values || []).reduce((s, v) => s + num(v.quantity) * num(bono.value), 0),
        0,
      ),
    0,
  );

  const totalPernotes = detalles.reduce(
    (acc, d) =>
      acc + (d.pernotes || []).reduce((t, p) => t + num(p.cantidad) * num(p.valor), 0),
    0,
  );

  const sobreescritos = gruposSobreescritos(detalles, preview);
  const totalRecargos =
    sumarManuales(detalles, null) + sumarPreview(preview, sobreescritos, null);

  // ── Ajuste salarial Villanueva ────────────────────────────────────────
  // `ajusteSalarialCompleto` es la diferencia teórica a 30 días. Se guarda
  // aparte de `bonificacionVillanueva` porque el IBC se calcula siempre
  // sobre el ajuste completo del mes, no sobre los días realmente
  // trabajados en Villanueva.
  let bonificacionVillanueva = 0;
  let ajusteSalarialCompleto = 0;
  if (entrada.aplicaAjusteVillanueva) {
    ajusteSalarialCompleto = num(parametros.salarioVillanueva) - salarioBase;
    const diasVillanueva = num(entrada.diasLaboradosVillanueva);
    if (!entrada.ajusteVillanuevaPorDia && diasVillanueva >= 17) {
      bonificacionVillanueva = ajusteSalarialCompleto;
    } else {
      bonificacionVillanueva = (ajusteSalarialCompleto / 30) * diasVillanueva;
    }
  }

  // ── Ajustes del 8 % ───────────────────────────────────────────────────
  const fraccion = num(parametros.fraccionAjusteRecargos);

  let totalRecargosParex = 0;
  let ajusteParex = 0;
  if (entrada.aplicaAjusteParex || entrada.ajusteRecargosCompletos) {
    if (entrada.ajusteRecargosCompletos) {
      ajusteParex = totalRecargos * fraccion;
    } else if (parametros.empresaParexId) {
      totalRecargosParex =
        sumarManuales(detalles, parametros.empresaParexId) +
        sumarPreview(preview, sobreescritos, parametros.empresaParexId);
      ajusteParex = totalRecargosParex * fraccion;
    }
  }

  let totalRecargosGeopark = 0;
  let ajusteGeopark = 0;
  if (entrada.aplicaAjusteGeopark && parametros.empresaGeoparkId) {
    totalRecargosGeopark =
      sumarManuales(detalles, parametros.empresaGeoparkId) +
      sumarPreview(preview, sobreescritos, parametros.empresaGeoparkId);
    ajusteGeopark = totalRecargosGeopark * fraccion;
  }

  // ── Incapacidad ───────────────────────────────────────────────────────
  // Lo que se deja de devengar por los días no trabajados, nunca negativo.
  let valorIncapacidad = 0;
  if (entrada.aplicaIncapacidad) {
    const diferencia = salarioBase - salarioDevengado;
    valorIncapacidad = diferencia > 0 ? diferencia : 0;
  }

  // ── Vacaciones ────────────────────────────────────────────────────────
  const valorVacacionesManual = num(entrada.valorVacaciones);
  let totalVacaciones = 0;
  if (valorVacacionesManual > 0) {
    totalVacaciones = valorVacacionesManual;
  } else if (entrada.vacacionesInicio && entrada.vacacionesFin) {
    totalVacaciones =
      (salarioBase / 30) * diasEntre(entrada.vacacionesInicio, entrada.vacacionesFin);
  }

  // ── Base prestacional (IBC) ───────────────────────────────────────────
  // Entran: salario devengado, vacaciones, la fracción del ajuste Villanueva
  // y el 100 % de los recargos de PAREX/Geopark cuando su interruptor está
  // activo. NO entran auxilio de transporte, bonificaciones ni conceptos
  // adicionales: suman al bruto pero no cotizan.
  const ajusteParaBase =
    entrada.diasAjusteDeducciones !== null && entrada.diasAjusteDeducciones !== undefined
      ? (ajusteSalarialCompleto / 30) * num(entrada.diasAjusteDeducciones)
      : ajusteSalarialCompleto;

  const totalAjustesAdicionales = (entrada.conceptosAdicionales || []).reduce(
    (s, c) => s + num(c.valor),
    0,
  );

  const recargosAjusteParaBase =
    entrada.aplicaAjusteParex || entrada.ajusteRecargosCompletos
      ? entrada.ajusteRecargosCompletos
        ? totalRecargos
        : totalRecargosParex
      : 0;
  const recargosGeoparkParaBase = entrada.aplicaAjusteGeopark ? totalRecargosGeopark : 0;

  const baseIbc =
    salarioDevengado +
    totalVacaciones +
    ajusteParaBase +
    recargosAjusteParaBase +
    recargosGeoparkParaBase;

  // Cada deducción lleva su propio interruptor: una puede ir por IBC y la
  // otra por salario base pelado.
  const baseCalculoSalud = entrada.descontarSaludSalario ? salarioBase : baseIbc;
  const baseCalculoPension = entrada.descontarPensionSalario ? salarioBase : baseIbc;
  const baseCalculo = Math.max(baseCalculoSalud, baseCalculoPension);

  const salud = entrada.noDescontarSalud
    ? 0
    : baseCalculoSalud * (num(parametros.porcentajeSalud) / 100);
  const pension = entrada.noDescontarPension
    ? 0
    : baseCalculoPension * (num(parametros.porcentajePension) / 100);

  const totalAnticipos = (entrada.anticipos || []).reduce((s, a) => s + num(a.valor), 0);
  const totalDeducciones = salud + pension + totalAnticipos;

  // ── Bruto y neto ──────────────────────────────────────────────────────
  //
  // ⚠ FIEL AL ORIGINAL (1): el bruto suma `valorVacacionesManual`, NO
  // `totalVacaciones`. Las vacaciones deducidas de las fechas cotizan (están
  // en el IBC de arriba) pero no se pagan. Parece un descuido, pero
  // corregirlo aquí y no en el formulario haría que las dos pantallas
  // dieran netos distintos.
  //
  // ⚠ FIEL AL ORIGINAL (2): `ajusteParex` y `ajusteGeopark` NO entran al
  // bruto. Se calculan, se devuelven y se guardan en sus columnas de
  // `liquidaciones`, pero no se pagan. Lo que sí entra en el IBC es el
  // 100 % de los recargos de esas empresas, que es otra cosa.
  //
  // Las dos quedan pendientes de la comparación contra los Excel de agosto.
  const sueldoBruto =
    salarioDevengado +
    auxilioTransporte +
    totalBonificaciones +
    totalPernotes +
    totalRecargos +
    valorVacacionesManual +
    bonificacionVillanueva +
    valorIncapacidad +
    num(entrada.interesCesantias) +
    totalAjustesAdicionales;

  const sueldoTotal = sueldoBruto - totalDeducciones;

  return {
    salarioDevengado,
    auxilioTransporte,
    totalBonificaciones,
    totalPernotes,
    totalRecargos,
    totalRecargosParex,
    totalRecargosGeopark,
    totalVacaciones,
    bonificacionVillanueva,
    valorIncapacidad,
    ajusteParex,
    ajusteGeopark,
    interesCesantias: num(entrada.interesCesantias),
    disponibilidad: num(entrada.disponibilidad),
    sueldoBruto,
    baseCalculo,
    baseCalculoSalud,
    baseCalculoPension,
    salud,
    pension,
    totalAnticipos,
    totalAjustesAdicionales,
    totalDeducciones,
    sueldoTotal,
  };
}

/**
 * Derivados que el backend ya calculaba al persistir
 * (`liquidaciones.service.ts:259-265`). Se replican aquí para que el canvas
 * enseñe exactamente lo mismo que se guarda.
 */
export function derivadosLiquidacion(r: ResultadoLiquidacion) {
  return {
    total_devengado: r.sueldoTotal + r.salud + r.pension + r.totalAnticipos,
    total_deducido: r.salud + r.pension + r.totalAnticipos,
    neto_pagado: r.sueldoTotal,
  };
}
