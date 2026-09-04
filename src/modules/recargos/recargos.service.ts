import { prisma } from "../../config/prisma";
import {
  type CreateRecargoDTO,
  type UpdateRecargoDTO,
} from "./recargos.schema";
import { randomUUID } from "crypto";
import PDFDocument from "pdfkit";
import {
  calcularRecargosDia,
  calcularRecargosConContinuacion as calcularRecargosConContinuacionBackend,
  calcularValorMonetario,
  redondear,
  umbralesDesdeConfig,
  type ConfigRecargo,
  type RecargosCalculados,
  type UmbralesJornada,
  type DiaLaboralRecargo,
} from "../../lib/recargos/calculo";
import { getIo } from "../../sockets";

/** Estado en memoria de un batch de recálculo bulk. */
interface BulkRecalcBatchState {
  batchId: string;
  userId: string;
  ids: string[];
  total: number;
  processed: number;
  status: "pending" | "running" | "completed" | "failed";
  results: Array<{
    id: string;
    ok: boolean;
    valor_pagar?: number;
    error?: string;
  }>;
  startedAt: string;
  completedAt?: string;
  cleanupTimer?: NodeJS.Timeout;
}

/**
 * Mapa de batches activos. Vive en memoria del proceso: si el server
 * se reinicia, los batches en curso se pierden (el cliente los detecta
 * porque `GET /recalcular-bulk/:batchId` retorna 404 y limpia el
 * localStorage). Los batches `completed` se purgan automáticamente
 * a la 1h.
 */
const bulkRecalcBatches: Map<string, BulkRecalcBatchState> = new Map();

/** Concurrencia: misma que usa `RecargosDesgloseModal.handleRecalcularTodas` (3). */
const BULK_RECALC_CONCURRENCY = 3;
/** Timeout por planilla. Si un recalcular individual tarda más, se
 *  marca como error y se continúa con el siguiente. */
const BULK_RECALC_TIMEOUT_MS = 60_000;


// Empresas que NO reconocen RNDF (Recargo Nocturno Dominical/Festivo)
const EMPRESAS_SIN_RNDF = [
  "cfb258a6-448c-4469-aa71-8eeafa4530ef", // PAREX RESOURCES (COLOMBIA) AG SUCURSAL
];

// Re-export redondear para mantener compatibilidad con el módulo PDF
export { redondear };

/**
 * Pre-procesa el array de días laborales para manejar `continua_siguiente_dia`.
 * Si un día tiene continua_siguiente_dia=true, se combinan sus horas con el día siguiente
 * y el día siguiente se marca para no generar recargos propios (como si fuera disponibilidad).
 * Retorna un Map: diaIndex → recargos calculados (ya con la lógica de merge).
 *
 * Recibe un resolver de umbrales para que la jornada se obtenga del día
 * en que ARRANCA el turno continuo (no del día siguiente, que ya está
 * cubierto por el merge).
 */
function calcularRecargosConContinuacion(
  diasLaborales: any[],
  resolverUmbrales: (index: number) => UmbralesJornada,
): Map<number, RecargosCalculados> {
  const resultados = new Map<number, RecargosCalculados>();
  const diasMerged = new Set<number>(); // Indices de días que ya fueron absorbidos

  const ceros = (): RecargosCalculados => ({
    hed: 0, hen: 0, hefd: 0, hefn: 0, rndf: 0, rn: 0, rd: 0, totalHoras: 0
  });

  for (let i = 0; i < diasLaborales.length; i++) {
    const dia = diasLaborales[i];

    // Si este día ya fue absorbido por el anterior, retornar ceros
    if (diasMerged.has(i)) {
      resultados.set(i, ceros());
      continue;
    }

    // Si está disponible, ceros
    if (dia.disponibilidad) {
      resultados.set(i, ceros());
      continue;
    }

    const hora_inicio = dia.hora_inicio || 0;
    let hora_fin = dia.hora_fin || 0;
    const es_domingo_o_festivo = dia.es_domingo || dia.es_festivo;

    // Si continua al siguiente día, combinar horas
    if (dia.continua_siguiente_dia && i < diasLaborales.length - 1) {
      const siguiente = diasLaborales[i + 1];
      if (siguiente && !siguiente.disponibilidad) {
        const horasNextDia =
          (siguiente.hora_fin || 0) - (siguiente.hora_inicio || 0);
        if (horasNextDia > 0) {
          hora_fin = hora_fin + horasNextDia;
          diasMerged.add(i + 1); // Marcar el siguiente como absorbido
        }
      }
    }

    const recargos = calcularRecargosDia(
      hora_inicio,
      hora_fin,
      es_domingo_o_festivo,
      false, // excluirRNDF lo maneja buildBulkDias con la config por día
      resolverUmbrales(i),
    );
    resultados.set(i, recargos);
  }

  return resultados;
}

/**
 * Construye los días y detalles con SNAPSHOTS de la config vigente por día.
 *
 * Para cada día:
 *   1. Resuelve la fecha real (año, mes, dia) → la usa para buscar:
 *      a. tipos_recargos vigentes para esa fecha (Map codigo -> {id, %})
 *      b. configuraciones_salarios vigentes para esa fecha (config salarial)
 *   2. Calcula los recargos en horas (función pura, independiente de %)
 *   3. Para cada tipo con horas > 0, crea un detalle con:
 *      - tipo_recargo_id (FK a la fila vigente de tipos_recargos)
 *      - porcentaje_aplicado (snapshot del %)
 *      - valor_hora_calculado (snapshot del valor hora)
 *      - valor_calculado (snapshot monetario: horas × tasa)
 *      - configuracion_salario_id (FK a la config salarial)
 *      - fecha_aplicacion (el día concreto)
 *
 * Esto garantiza que el registro es INMUTABLE: aunque cambien las vigencias a
 * futuro, los valores históricos se mantienen.
 *
 * NOTA: se hace una sola query para traer TODOS los tipos_recargos y TODAS las
 * configs vigentes en el rango de la planilla, no una query por día.
 */
async function buildBulkDias(
  diasLaborales: any[],
  recargoPlanillaId: string,
  empresaId: string,
  mes: number,
  año: number,
  excluirRNDF: boolean,
  userId: string | undefined,
  now: Date,
) {
  // ── 1. Determinar rango de fechas de la planilla ──
  // Incluir TODOS los días con `dia` válido, incluso los marcados como
  // `disponibilidad: true`. Si filtráramos disponibilidad aquí, una
  // planilla compuesta únicamente por días disponibles (caso real: el
  // conductor estuvo disponible esos días sin realizar recorridos)
  // terminaría con `fechasDias.length === 0` y se retornaría temprano
  // sin guardar NINGÚN día, perdiendo toda la planilla.
  //
  // El loop más abajo (`for (let idx = 0; idx < diasLaborales.length; idx++)`)
  // ya filtra correctamente los días disponibles al calcular los
  // recargos (`if (!fechaDia || dia.disponibilidad) continue;`),
  // simplemente no genera detalles monetarios para ellos. Pero la fila
  // base en `dias_laborales_planillas` SÍ se persiste con
  // `disponibilidad: true` para auditoría y para que el frontend la
  // muestre correctamente al recargar.
  const fechasDias = diasLaborales
    .filter((d: any) => d.dia)
    .map((d: any) => new Date(Date.UTC(año, mes - 1, d.dia)));

  if (fechasDias.length === 0) {
    return { diasRows: [], detallesRows: [] };
  }

  const fechaMin = new Date(Math.min(...fechasDias.map((d) => d.getTime())));
  const fechaMax = new Date(Math.max(...fechasDias.map((d) => d.getTime())));

  // ── 2. Cargar TODOS los tipos_recargos que podrían estar vigentes en el rango ──
  const tiposTodos = await prisma.tipos_recargos.findMany({
    where: {
      activo: true,
      deleted_at: null,
      vigencia_desde: { lte: fechaMax },
      OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaMin } }],
    },
    orderBy: { vigencia_desde: "desc" },
  });

  // ── 3. Cargar TODAS las configs salariales vigentes en el rango ──
  const configsTodas = await prisma.configuraciones_salarios.findMany({
    where: {
      activo: true,
      deleted_at: null,
      vigencia_desde: { lte: fechaMax },
      OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaMin } }],
    },
    orderBy: [{ empresa_id: "desc" }, { vigencia_desde: "desc" }],
  });

  // ── 4. Helpers locales ──
  /**
   * Score estable para elegir entre varias filas "vigentes" del mismo
   * codigo. Componentes aditivos, cada uno con peso estrictamente mayor
   * que el rango posible del siguiente:
   *   + (1 si tiene `vigencia_hasta` no nulo, 0 si no) × 1e18
   *     → 1e18 >> cualquier valor de timestamp en ms (~1.7e12 en 2026)
   *   + ms(desde)              → desempata por fecha de inicio más reciente
   *   + 0                       → (reservado, se podría usar updated_at en ms,
   *                                pero la diferencia no afecta el resultado
   *                                porque ya desempatamos por desde y por
   *                                presencia/ausencia de hasta)
   *
   * Siempte gana el que tiene `vigencia_hasta` (más específico). Entre
   * ellos, el de `vigencia_desde` más reciente.
   */
  const scoreVigencia = (desde: Date | string, hasta: Date | string | null) => {
    const desdeMs = new Date(desde).getTime();
    return (hasta ? 1 : 0) * 1e18 + desdeMs;
  };

  const tiposVigentesPara = (fecha: Date) => {
    const map = new Map<
      string,
      { id: string; porcentaje: number; es_hora_extra: boolean; score: number }
    >();
    for (const t of tiposTodos) {
      if (t.vigencia_desde > fecha) continue;
      if (t.vigencia_hasta && t.vigencia_hasta < fecha) continue;

      const score = scoreVigencia(t.vigencia_desde, t.vigencia_hasta);
      const current = map.get(t.codigo);
      if (!current || score > current.score) {
        map.set(t.codigo, {
          id: t.id,
          porcentaje: Number(t.porcentaje),
          es_hora_extra: t.es_hora_extra,
          score,
        });
      }
    }
    return map;
  };

  const configVigentePara = (fecha: Date) => {
    // Reglas:
    //   1. `vigencia_desde <= fecha`
    //   2. `vigencia_hasta IS NULL` o `vigencia_hasta >= fecha`
    // Prioridad:
    //   - específica de la empresa > base (empresa_id = null)
    //   - desempate por "más específica" (con `vigencia_hasta` no nulo) y
    //     `vigencia_desde` más reciente (consistente con tiposVigentesPara)
    const candidatas = configsTodas.filter((c) => {
      if (c.vigencia_desde > fecha) return false;
      if (c.vigencia_hasta && c.vigencia_hasta < fecha) return false;
      return true;
    });

    const mejorEmpresa = candidatas
      .filter((c) => c.empresa_id === empresaId)
      .sort(
        (a, b) =>
          scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
          scoreVigencia(a.vigencia_desde, a.vigencia_hasta),
      )[0];
    if (mejorEmpresa) return mejorEmpresa;

    const mejorBase = candidatas
      .filter((c) => c.empresa_id === null)
      .sort(
        (a, b) =>
          scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
          scoreVigencia(a.vigencia_desde, a.vigencia_hasta),
      )[0];
    return mejorBase || null;
  };

  // ── 5. Calcular recargos en horas usando el algoritmo canónico ──
  // Usar calcularRecargosConContinuacionBackend (importado de calculo.ts)
  // en vez de la función local, para que create/update use el mismo
  // algoritmo que recalcular (con phantom skip, shortfall fill, etc.)
  const diasFormateados: DiaLaboralRecargo[] = diasLaborales.map((d: any, idx: number) => ({
    id: d.id || String(idx),
    dia: String(d.dia || ''),
    mes: String(mes),
    año: String(año),
    hora_inicio: d.hora_inicio || 0,
    hora_fin: d.hora_fin || 0,
    es_domingo: !!d.es_domingo,
    es_festivo: !!d.es_festivo,
    pernocte: !!d.pernocte,
    disponibilidad: !!d.disponibilidad,
    continua_siguiente_dia: !!d.continua_siguiente_dia,
  }));

  const getConfigParaFecha = (fecha: Date) => {
    const cfg = configVigentePara(fecha);
    if (!cfg) return null;
    return {
      jornadaNormal: Number(cfg.jornada_normal_horas) || 10.33,
      jornadaFestiva: Number(cfg.jornada_festiva_horas) || 7.33,
      inicioNocturno: 19,
      finNocturno: 6,
    };
  };

  const recargosMap = new Map<number, RecargosCalculados>();
  for (let idx = 0; idx < diasFormateados.length; idx++) {
    const diaFmt = diasFormateados[idx];
    if (diaFmt.disponibilidad || !diaFmt.dia) {
      recargosMap.set(idx, { hed: 0, hen: 0, hefd: 0, hefn: 0, rndf: 0, rn: 0, rd: 0, totalHoras: 0 });
      continue;
    }
    const resultado = calcularRecargosConContinuacionBackend({
      dia: diaFmt,
      diasLaborales: diasFormateados,
      mes,
      año,
      getConfigParaFecha,
      excluirRNDF: false,
    });
    recargosMap.set(idx, {
      hed: resultado.HED,
      hen: resultado.HEN,
      hefd: resultado.HEFD,
      hefn: resultado.HEFN,
      rndf: resultado.RNDF,
      rn: resultado.RN,
      rd: resultado.RD,
      totalHoras: resultado.totalHoras,
    });
  }

  // ── 6. Construir filas ──
  const diasRows: any[] = [];
  const detallesRows: any[] = [];

  for (let idx = 0; idx < diasLaborales.length; idx++) {
    const dia = diasLaborales[idx];
    const hora_inicio = dia.hora_inicio || 0;
    const hora_fin = dia.hora_fin || 0;
    const total_horas = dia.total_horas || 0;

    const recargos = recargosMap.get(idx) ?? {
      hed: 0, hen: 0, hefd: 0, hefn: 0, rndf: 0, rn: 0, rd: 0, totalHoras: 0,
    };

    const diaId = randomUUID();

    // Resolver la fecha del día (UTC, para evitar drift por timezone)
    const fechaDia = dia.dia
      ? new Date(Date.UTC(año, mes - 1, dia.dia))
      : null;

    // Resolver umbrales de jornada y config salarial para este día.
    // Los snapshots se guardan para auditoría/inmutabilidad aunque
    // cambien las vigencias a futuro.
    const cfgDia = fechaDia ? configVigentePara(fechaDia) : null;
    const umbralesDia = umbralesDesdeConfig(cfgDia);

    diasRows.push({
      id: diaId,
      recargo_planilla_id: recargoPlanillaId,
      dia: dia.dia,
      hora_inicio,
      hora_fin,
      total_horas,
      // horas_ordinarias se computa con la jornada vigente del día
      // (festiva en domingos/festivos, normal en el resto)
      horas_ordinarias: Math.min(
        total_horas,
        dia.es_domingo || dia.es_festivo
          ? umbralesDia.jornadaFestiva
          : umbralesDia.jornadaNormal
      ),
      es_festivo: dia.es_festivo,
      es_domingo: dia.es_domingo,
      kilometraje_inicial: dia.kilometraje_inicial,
      kilometraje_final: dia.kilometraje_final,
      pernocte: dia.pernocte || false,
      disponibilidad: dia.disponibilidad || false,
      continua_siguiente_dia: dia.continua_siguiente_dia || false,
      observaciones: dia.observaciones,
      creado_por_id: userId,
      created_at: now,
      updated_at: now,
    });

    // Saltar días sin fecha o disponibles
    if (!fechaDia || dia.disponibilidad) continue;

    const tiposMap = tiposVigentesPara(fechaDia);
    const configSalario = configVigentePara(fechaDia);

    // Si no hay config salarial, no podemos calcular valor monetario.
    // Guardamos solo las horas con porcentaje NULL (compatible con registros viejos).
    if (!configSalario) {
      const tiposConValor: Array<[string, number]> = [
        ["HED", recargos.hed],
        ["HEN", recargos.hen],
        ["HEFD", recargos.hefd],
        ["HEFN", recargos.hefn],
        ["RN", recargos.rn],
        ["RD", recargos.rd],
        ["RNDF", excluirRNDF ? 0 : recargos.rndf],
      ];
      for (const [codigo, horas] of tiposConValor) {
        if (horas > 0 && tiposMap.has(codigo)) {
          const t = tiposMap.get(codigo)!;
          detallesRows.push({
            id: randomUUID(),
            dia_laboral_id: diaId,
            tipo_recargo_id: t.id,
            horas,
            porcentaje_aplicado: t.porcentaje,
            valor_hora_calculado: null,
            valor_calculado: null,
            configuracion_salario_id: null,
            fecha_aplicacion: fechaDia,
            // Snapshot de la jornada vigente en el momento del cálculo
            jornada_normal_horas: umbralesDia.jornadaNormal,
            jornada_festiva_horas: umbralesDia.jornadaFestiva,
            creado_por_id: userId,
            created_at: now,
            updated_at: now,
          });
        }
      }
      continue;
    }

    const salario = Number(configSalario.salario_basico);
    const horasMes = configSalario.horas_mensuales_base || 240;
    const valorHora = salario / horasMes; // estilo Excel

    // Map codigo -> tipo vigente
    const configRecargo: ConfigRecargo = {
      porcentajes: {
        HED: tiposMap.get('HED')?.porcentaje ?? 0,
        HEN: tiposMap.get('HEN')?.porcentaje ?? 0,
        HEFD: tiposMap.get('HEFD')?.porcentaje ?? 0,
        HEFN: tiposMap.get('HEFN')?.porcentaje ?? 0,
        RN: tiposMap.get('RN')?.porcentaje ?? 0,
        RD: tiposMap.get('RD')?.porcentaje ?? 0,
        RNDF: tiposMap.get('RNDF')?.porcentaje ?? 0
      },
      valorHora,
      excluirRNDF
    };

    // Calcular valores monetarios con la lib compartida
    const valores = calcularValorMonetario(recargos, configRecargo);

    // Detalles con snapshot completo
    const tiposConValor: Array<[string, number, keyof typeof valores, boolean]> = [
      ['HED', recargos.hed, 'HED', true],
      ['HEN', recargos.hen, 'HEN', true],
      ['HEFD', recargos.hefd, 'HEFD', true],
      ['HEFN', recargos.hefn, 'HEFN', true],
      ['RN', recargos.rn, 'RN', false],
      ['RD', recargos.rd, 'RD', false],
      ['RNDF', excluirRNDF ? 0 : recargos.rndf, 'RNDF', false]
    ];

    for (const [codigo, horas, valorKey] of tiposConValor) {
      if (horas <= 0) continue;
      const t = tiposMap.get(codigo);
      if (!t) continue;

      const valorCalculado = valores[valorKey];
      // Reglas de tasa por tipo (consistentes con lib/recargos/calculo.ts):
      //   - HED, HEN, HEFD, HEFN, RD: tarifa "all-in" → valorHora × (1 + %/100).
      //     RD (Recargo Dominical/Festivo) se paga completo (base + recargo),
      //     igual que las horas extras, no como surcharge multiplicativo.
      //   - RN, RNDF: recargos puros sumados a la base → valorHora × %/100.
      const tasa = codigo === 'RNDF' || codigo === 'RN'
        ? valorHora * (t.porcentaje / 100)
        : valorHora * (1 + t.porcentaje / 100);

      detallesRows.push({
        id: randomUUID(),
        dia_laboral_id: diaId,
        tipo_recargo_id: t.id,
        horas,
        valor_hora_base: Math.round(valorHora * 10000) / 10000,
        valor_calculado: valorCalculado,
        porcentaje_aplicado: t.porcentaje,
        valor_hora_calculado: Math.round(tasa * 10000) / 10000,
        configuracion_salario_id: configSalario.id,
        fecha_aplicacion: fechaDia,
        // Snapshot de la jornada vigente en el momento del cálculo
        jornada_normal_horas: umbralesDia.jornadaNormal,
        jornada_festiva_horas: umbralesDia.jornadaFestiva,
        creado_por_id: userId,
        created_at: now,
        updated_at: now,
      });
    }
  }

  return { diasRows, detallesRows };
}

/**
 * Calcula el breakdown (HED, HEN, ...) y el valor monetario de una planilla
 * EN VIVO, sin leer ni escribir en `detalles_recargos_dias`.
 *
 * Esta es la fuente de verdad para mostrar el breakdown después de un
 * cambio de config: si la config vigente para una fecha cambia, la
 * próxima llamada a este helper devolverá los valores nuevos sin
 * necesidad de "recalcular" manualmente.
 *
 * Usado por `RecargosService.recalcular()` (que es un wrapper que solo
 * bumpa `updated_at` y devuelve este breakdown). En el futuro se puede
 * usar también desde `findById` y `previewRecargos` para abandonar
 * definitivamente el modelo de snapshots.
 *
 * Mantener el formato de retorno compatible con el que el frontend
 * (`RecargosDesgloseModal.svelte`) espera.
 */
async function calcularBreakdownParaPlanilla(planillaId: string): Promise<{
  dias: Array<{
    dia: number;
    hora_inicio: number;
    hora_fin: number;
    total_horas: number;
    es_festivo: boolean;
    es_domingo: boolean;
    disponibilidad: boolean;
    recargos: Array<{
      tipo_codigo: string;
      tipo_nombre: string;
      es_hora_extra: boolean;
      adicional: boolean;
      porcentaje: number;
      horas: number;
      valor_hora_base: number;
      valor_hora_calculada: number;
      valor_total: number;
    }>;
    total_valor_dia: number;
  }>;
  total_horas: number;
  total_dias: number;
  total_valor: number;
}> {
  // 1. Leer la planilla y sus días
  const planilla = await prisma.recargos_planillas.findUnique({
    where: { id: planillaId },
    include: {
      dias_laborales_planillas: {
        where: { deleted_at: null },
        orderBy: { dia: "asc" }
      }
    }
  });
  if (!planilla) throw new Error("Recargo no encontrado");

  const empresaId = planilla.empresa_id;
  const mes = planilla.mes;
  const año = planilla.a_o;
  const excluirRNDF = EMPRESAS_SIN_RNDF.includes(empresaId);

  // 2. Leer todos los tipos_recargos (una sola query)
  const tiposTodos = await prisma.tipos_recargos.findMany({
    where: { activo: true, deleted_at: null }
  });
  const tiposMap = new Map(tiposTodos.map((t) => [t.codigo, t]));

  // 3. Leer las configs salariales vigentes en el rango
  const fechaMin = new Date(Date.UTC(año, mes - 1, 1));
  const fechaMax = new Date(Date.UTC(año, mes, 0));
  const configsTodas = await prisma.configuraciones_salarios.findMany({
    where: {
      activo: true,
      deleted_at: null,
      vigencia_desde: { lte: fechaMax },
      OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaMin } }]
    },
    orderBy: [{ empresa_id: "desc" }, { vigencia_desde: "desc" }]
  });

  // 4. Helpers para resolver config y tipos por fecha
  const scoreVigencia = (desde: Date | string, hasta: Date | string | null) =>
    (hasta ? 1 : 0) * 1e18 + new Date(desde).getTime();

  const tiposVigentesPara = (fecha: Date) => {
    const map = new Map<
      string,
      { id: string; porcentaje: number; es_hora_extra: boolean; score: number }
    >();
    for (const t of tiposTodos) {
      if (t.vigencia_desde > fecha) continue;
      if (t.vigencia_hasta && t.vigencia_hasta < fecha) continue;
      const score = scoreVigencia(t.vigencia_desde, t.vigencia_hasta);
      const current = map.get(t.codigo);
      if (!current || score > current.score) {
        map.set(t.codigo, {
          id: t.id,
          porcentaje: Number(t.porcentaje),
          es_hora_extra: t.es_hora_extra,
          score
        });
      }
    }
    return map;
  };

  const configVigentePara = (fecha: Date) => {
    const candidatas = configsTodas.filter((c) => {
      if (c.vigencia_desde > fecha) return false;
      if (c.vigencia_hasta && c.vigencia_hasta < fecha) return false;
      return true;
    });
    const emp = candidatas
      .filter((c) => c.empresa_id === empresaId)
      .sort(
        (a, b) =>
          scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
          scoreVigencia(a.vigencia_desde, a.vigencia_hasta)
      )[0];
    if (emp) return emp;
    const base = candidatas
      .filter((c) => c.empresa_id === null)
      .sort(
        (a, b) =>
          scoreVigencia(b.vigencia_desde, b.vigencia_hasta) -
          scoreVigencia(a.vigencia_desde, a.vigencia_hasta)
      )[0];
    return base || null;
  };

  // 5. Convertir los días al formato del algoritmo (DiaLaboralRecargo)
  const diasFormateados: DiaLaboralRecargo[] = planilla.dias_laborales_planillas.map(
    (d) => ({
      id: d.id,
      dia: String(d.dia),
      mes: String(mes),
      año: String(año),
      hora_inicio: Number(d.hora_inicio) || 0,
      hora_fin: Number(d.hora_fin) || 0,
      es_domingo: d.es_domingo,
      es_festivo: d.es_festivo,
      pernocte: d.pernocte,
      disponibilidad: d.disponibilidad,
      continua_siguiente_dia: d.continua_siguiente_dia || false
    })
  );

  // 6. Calcular breakdown por día
  let totalHoras = 0;
  let totalDias = 0;
  let totalValor = 0;

  const diasConBreakdown = planilla.dias_laborales_planillas.map((d) => {
    const fecha = new Date(Date.UTC(año, mes - 1, Number(d.dia)));
    const tiposMapFecha = tiposVigentesPara(fecha);
    const cfg = configVigentePara(fecha);

    const diaFormato = diasFormateados.find((df) => df.id === d.id)!;

    // Calcular las horas usando el algoritmo canónico (mismo que el modal)
    const recargosHoras = calcularRecargosConContinuacionBackend({
      dia: diaFormato,
      diasLaborales: diasFormateados,
      mes,
      año,
      getConfigParaFecha: (f: Date) => {
        const c = configVigentePara(f);
        if (!c) return null;
        return {
          jornadaNormal: Number(c.jornada_normal_horas) || 10.33,
          jornadaFestiva: Number(c.jornada_festiva_horas) || 7.33,
          inicioNocturno: 19,
          finNocturno: 6
        };
      },
      excluirRNDF
    });

    // Aplicar valor monetario con la config vigente
    const recargosConValor: Array<{
      tipo_codigo: string;
      tipo_nombre: string;
      es_hora_extra: boolean;
      adicional: boolean;
      porcentaje: number;
      horas: number;
      valor_hora_base: number;
      valor_hora_calculada: number;
      valor_total: number;
    }> = [];

    const valorHora = cfg
      ? Number(cfg.salario_basico) / (cfg.horas_mensuales_base || 240)
      : 0;

    const tiposConHoras: Array<[string, number]> = [
      ["HED", recargosHoras.HED],
      ["HEN", recargosHoras.HEN],
      ["HEFD", recargosHoras.HEFD],
      ["HEFN", recargosHoras.HEFN],
      ["RN", recargosHoras.RN],
      ["RD", recargosHoras.RD],
      ["RNDF", excluirRNDF ? 0 : recargosHoras.RNDF]
    ];

    for (const [codigo, horas] of tiposConHoras) {
      if (horas <= 0) continue;
      const tipo = tiposMap.get(codigo);
      if (!tipo) continue;
      const porcentaje = tiposMapFecha.get(codigo)?.porcentaje || 0;
      // "Adicional" (campo `tipos_recargos.adicional`): si es true, el
      // recargo suma la base (all-in: valorHora * (1 + %/100)). Si no,
      // es "puro" (valorHora * (%/100), se suma al pago total sin
      // duplicar la base). Las horas extra siempre se pagan completas.
      //
      // Mantener sincronizado con el preview (`previewRecargos` en
      // `liquidaciones.service.ts`).
      const esAllIn =
        tipo.es_hora_extra || tipo.adicional || tipo.codigo === "RD";
      const tasa = esAllIn
        ? valorHora * (1 + porcentaje / 100)
        : valorHora * (porcentaje / 100);
      const valorTotal = Math.round(horas * tasa);
      recargosConValor.push({
        tipo_codigo: tipo.codigo,
        tipo_nombre: tipo.nombre,
        es_hora_extra: tipo.es_hora_extra,
        adicional: tipo.adicional,
        porcentaje,
        horas,
        valor_hora_base: Math.round(valorHora * 10000) / 10000,
        valor_hora_calculada: Math.round(tasa * 10000) / 10000,
        valor_total: valorTotal
      });
    }

    const totalValorDia = recargosConValor.reduce((sum, r) => sum + r.valor_total, 0);

    if (!d.disponibilidad) {
      totalHoras += Number(d.total_horas) || 0;
      totalDias += 1;
    }
    totalValor += totalValorDia;

    return {
      dia: d.dia,
      hora_inicio: Number(d.hora_inicio) || 0,
      hora_fin: Number(d.hora_fin) || 0,
      total_horas: Number(d.total_horas) || 0,
      es_festivo: d.es_festivo,
      es_domingo: d.es_domingo,
      disponibilidad: d.disponibilidad,
      recargos: recargosConValor,
      total_valor_dia: totalValorDia
    };
  });

  return {
    dias: diasConBreakdown,
    total_horas: totalHoras,
    total_dias: totalDias,
    total_valor: totalValor
  };
}

export const RecargosService = {
  /**
   * Calcula el breakdown (HED, HEN, ...) y el valor monetario de una planilla
   * EN VIVO, sin leer ni escribir en `detalles_recargos_dias`.
   *
   * Esta es la fuente de verdad para mostrar el breakdown después de un
   * cambio de config: si la config vigente para una fecha cambia, la
   * próxima llamada a este método devolverá los valores nuevos sin
   * necesidad de "recalcular" manualmente.
   *
   * Usado por:
   *   - `RecargosService.recalcular()` (que es un wrapper que solo
   *     bumpa `updated_at` y devuelve este breakdown).
   *   - `LiquidacionesService.previewRecargos` (para que el desglose
   *     modal muestre el breakdown calculado con la config vigente,
   *     no los snapshots stale de `detalles_recargos_dias`).
   *
   * Mantener el formato de retorno compatible con el que el frontend
   * (`RecargosDesgloseModal.svelte`) espera.
   */
  async calcularBreakdown(planillaId: string) {
    return calcularBreakdownParaPlanilla(planillaId);
  },

  // Listar recargos con filtros (para canvas)
  async list(page: number, limit: number, filters: any) {
    const skip = (page - 1) * limit;

    const where: any = {
      deleted_at: filters.eliminados ? { not: null } : null,
    };

    if (filters.mes) where.mes = parseInt(filters.mes);
    if (filters.año) where.a_o = parseInt(filters.año);
    if (filters.conductor_id) where.conductor_id = filters.conductor_id;
    if (filters.vehiculo_id) where.vehiculo_id = filters.vehiculo_id;
    if (filters.empresa_id) where.empresa_id = filters.empresa_id;
    if (filters.estado) where.estado = filters.estado;
    if (filters.numero_planilla) {
      where.numero_planilla = {
        contains: filters.numero_planilla,
        mode: "insensitive",
      };
    }
    // Filtro "solo importados de Transmeralda". Valores:
    //   'si'  → imported_from_transmeralda_at IS NOT NULL
    //   'no'  → imported_from_transmeralda_at IS NULL
    //   'all' / undefined → no filtra
    if (filters.imported_from_transmeralda === 'si') {
      where.imported_from_transmeralda_at = { not: null }
    } else if (filters.imported_from_transmeralda === 'no') {
      where.imported_from_transmeralda_at = null
    }

    const [recargos, total, totalValorPagarAgg] = await Promise.all([
      prisma.recargos_planillas.findMany({
        where,
        skip,
        take: limit,
        // `select` explícito: solo los campos que el canvas del frontend
        // necesita. Evita arrastrar campos pesados (foto_url base64, archivo_*,
        // observaciones, vía/riesgos, etc.) que solo se usan en el modal
        // de detalle (que llama a `findById` con su propio `select`).
        select: {
          id: true,
          conductor_id: true,
          vehiculo_id: true,
          empresa_id: true,
          numero_planilla: true,
          mes: true,
          a_o: true,
          estado: true,
          planilla_s3key: true,
          servicio_id: true,
          deleted_at: true,
          imported_from_transmeralda_id: true,
          imported_from_transmeralda_at: true,
          conductores: {
            select: {
              id: true,
              nombre: true,
              apellido: true,
              numero_identificacion: true
            }
          },
          vehiculos: {
            select: {
              id: true,
              placa: true
            }
          },
          clientes: {
            select: {
              id: true,
              nombre: true
            }
          },
          servicio: {
            select: {
              id: true,
              fecha_realizacion: true,
              fecha_solicitud: true
            }
          },
          dias_laborales_planillas: {
            where: { deleted_at: filters.eliminados ? { not: null } : null },
            select: {
              id: true,
              dia: true,
              hora_inicio: true,
              hora_fin: true,
              total_horas: true,
              es_festivo: true,
              es_domingo: true,
              pernocte: true,
              disponibilidad: true,
              kilometraje_inicial: true,
              kilometraje_final: true,
              detalles_recargos_dias: {
                where: {
                  deleted_at: filters.eliminados ? { not: null } : null,
                  activo: true
                },
                select: {
                  horas: true,
                  tipos_recargos: {
                    select: { codigo: true }
                  }
                }
              }
            },
            orderBy: { dia: "asc" }
          }
        },
        orderBy: [{ created_at: "desc" }]
      }),
      prisma.recargos_planillas.count({ where }),
      // Suma TOTAL de `valor_calculado` de TODOS los detalles de las
      // planillas que matchean el filtro (no paginado). Alimenta el stat
      // card "Total a Pagar" del canvas de recargos, que de otro modo
      // solo vería el subtotal de los recargos de la página actual
      // (limit=50/100/200). Es filter-responsive: cambia con mes/año
      // y con cualquier filtro del query.
      prisma.detalles_recargos_dias.aggregate({
        where: {
          activo: true,
          deleted_at: null,
          valor_calculado: { not: null },
          dias_laborales_planillas: {
            deleted_at: null,
            recargos_planillas: {
              ...where
            }
          }
        },
        _sum: { valor_calculado: true }
      })
    ]);

    // Calcular totales por cada recargo
    const recargosConTotales = recargos.map((recargo) => {
      const totales = {
        total_hed: 0,
        total_hen: 0,
        total_hefd: 0,
        total_hefn: 0,
        total_rndf: 0,
        total_rn: 0,
        total_rd: 0,
        total_horas: 0,
        total_dias: 0
      };

      recargo.dias_laborales_planillas.forEach((dia) => {
        totales.total_horas += Number(dia.total_horas) || 0;
        totales.total_dias += 1;

        dia.detalles_recargos_dias.forEach((detalle) => {
          const codigo = detalle.tipos_recargos.codigo.toLowerCase();
          const horas = Number(detalle.horas) || 0;

          switch (codigo) {
            case "hed":
              totales.total_hed += horas;
              break;
            case "hen":
              totales.total_hen += horas;
              break;
            case "hefd":
              totales.total_hefd += horas;
              break;
            case "hefn":
              totales.total_hefn += horas;
              break;
            case "rndf":
              totales.total_rndf += horas;
              break;
            case "rn":
              totales.total_rn += horas;
              break;
            case "rd":
              totales.total_rd += horas;
              break;
          }
        });
      });

      // Mapeo final: solo los nombres que el frontend espera.
      // - Las relaciones Prisma (`conductores`, `vehiculos`, `clientes`,
      //   `dias_laborales_planillas`, `servicio`) NO se devuelven para
      //   evitar redundancia con `conductor`/`vehiculo`/`empresa`/
      //   `dias_laborales`/`servicio`.
      return {
        id: recargo.id,
        conductor_id: recargo.conductor_id,
        vehiculo_id: recargo.vehiculo_id,
        empresa_id: recargo.empresa_id,
        numero_planilla: recargo.numero_planilla,
        mes: recargo.mes,
        año: recargo.a_o,
        estado: recargo.estado,
        planilla_s3key: recargo.planilla_s3key,
        servicio_id: recargo.servicio_id,
        deleted_at: recargo.deleted_at,
        // Bandera derivada: true si esta planilla fue importada desde
        // Transmeralda. La UI usa esto para mostrar el badge "TM" en
        // la celda del N° Planilla.
        imported_from_transmeralda: !!recargo.imported_from_transmeralda_at,
        imported_from_transmeralda_id: recargo.imported_from_transmeralda_id,
        imported_from_transmeralda_at: recargo.imported_from_transmeralda_at,
        ...totales,
        conductor: recargo.conductores,
        vehiculo: recargo.vehiculos,
        empresa: recargo.clientes,
        servicio: recargo.servicio,
        dias_laborales: recargo.dias_laborales_planillas,
        tiene_documento: !!recargo.planilla_s3key
      }
    });

    return {
      recargos: recargosConTotales,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      /**
       * `meta` agrega valores que el frontend necesita para los stat
       * cards pero que NO puede calcular correctamente desde la página
       * actual (porque está limitada a `limit` registros).
       *
       * Por ahora solo incluimos `total_valor_pagar` (suma de
       * `valor_calculado` de todos los detalles de las planillas que
       * matchean el filtro). Si en el futuro se quieren agregar más
       * agregaciones (totales de HED/HEN, etc. sin límite), este es
       * el lugar.
       */
      meta: {
        total_valor_pagar: Number(totalValorPagarAgg._sum.valor_calculado || 0)
      }
    };
  },

  // Obtener un recargo por ID
  async findById(id: string) {
    const recargo = await prisma.recargos_planillas.findUnique({
      where: { id },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
        servicio: {
          include: {
            municipios_servicio_origen_idTomunicipios: true,
            municipios_servicio_destino_idTomunicipios: true,
            clientes: {
              select: { id: true, nombre: true, nit: true },
            },
          },
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          include: {
            detalles_recargos_dias: {
              where: { deleted_at: null, activo: true },
              include: {
                tipos_recargos: true,
              },
            },
          },
          orderBy: { dia: "asc" },
        },
        users_recargos_planillas_creado_por_idTousers: {
          select: {
            id: true,
            nombre: true,
          },
        },
        users_recargos_planillas_actualizado_por_idTousers: {
          select: {
            id: true,
            nombre: true,
          },
        },
      },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado");
    }

    return {
      ...recargo,
      conductor: recargo.conductores,
      conductores: undefined, // opcional quitarlom
      vehiculo: recargo.vehiculos,
      vehiculos: undefined,
    };
  },

  // Helper: Determinar estado del servicio basado en días laborales
  _determinarEstadoServicio(
    diasLaborales: { dia: number }[],
    mes: number,
    año: number,
  ): string {
    if (!diasLaborales || diasLaborales.length === 0) {
      return "solicitado";
    }

    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const hoyTime = hoy.getTime();

    const dias = diasLaborales.map((d) => {
      const fecha = new Date(año, mes - 1, d.dia);
      fecha.setHours(0, 0, 0, 0);
      return fecha.getTime();
    });

    const maxDia = Math.max(...dias);
    const minDia = Math.min(...dias);
    const incluyeHoy = dias.some((d) => d === hoyTime);

    if (maxDia < hoyTime) {
      // Todos los días son anteriores a hoy → realizado
      return "realizado";
    } else if (incluyeHoy || (minDia <= hoyTime && maxDia >= hoyTime)) {
      // Incluye el día actual o mezcla pasados y futuros → en_curso
      return "en_curso";
    } else {
      // Solo días futuros → planificado
      return "planificado";
    }
  },

  // Helper: normalizar propósito del servicio
  _normalizarProposito(proposito: string | null | undefined): any {
    if (!proposito) return "personal";
    if (proposito === "personal y herramienta") return "personal_y_herramienta";
    return proposito;
  },

   
  // ─────────────────────────────────────────────
  // CREATE — optimizado
  // ─────────────────────────────────────────────
  async create(data: CreateRecargoDTO, userId?: string) {
    const now = new Date();

    // 1. Calcular excluirRNDF según empresa (PAREX no lo reconoce)
    const excluirRNDF = EMPRESAS_SIN_RNDF.includes(data.empresa_id);

    // 2. Todo en una sola transacción interactiva
    const recargo = await prisma.$transaction(async (tx) => {

      // 2a. Crear servicio si hace falta (una sola escritura condicional)
      let servicioId = data.servicio_id ?? null;
      if (!servicioId && data.servicio_origen_id && data.servicio_destino_id) {
        const estadoServicio = this._determinarEstadoServicio(
          data.dias_laborales || [],
          data.mes,
          data.año,
        );
        const nuevoServicio = await tx.servicio.create({
          data: {
            id: randomUUID(),
            cliente_id: data.empresa_id,
            conductor_id: data.conductor_id,
            vehiculo_id: data.vehiculo_id,
            origen_id: data.servicio_origen_id,
            destino_id: data.servicio_destino_id,
            origen_especifico: data.servicio_origen_especifico || "",
            destino_especifico: data.servicio_destino_especifico || "",
            origen_latitud: data.servicio_origen_latitud,
            origen_longitud: data.servicio_origen_longitud,
            destino_latitud: data.servicio_destino_latitud,
            destino_longitud: data.servicio_destino_longitud,
            observaciones: data.servicio_observaciones,
            proposito_servicio: this._normalizarProposito(data.servicio_proposito) as any,
            estado: estadoServicio as any,
            fecha_solicitud: now,
            fecha_realizacion: data.servicio_fecha_realizacion
              ? new Date(data.servicio_fecha_realizacion)
              : undefined,
            valor: 0,
            created_at: now,
            updated_at: now,
          },
        });
        servicioId = nuevoServicio.id;
      }

      // 2b. Crear el recargo principal
      const recargoId = randomUUID();
      await tx.recargos_planillas.create({
        data: {
          id: recargoId,
          conductor_id: data.conductor_id,
          vehiculo_id: data.vehiculo_id,
          empresa_id: data.empresa_id,
          numero_planilla: data.numero_planilla,
          mes: data.mes,
          a_o: data.año,
          observaciones: data.observaciones,
          estado: "pendiente",
          version: 1,
          creado_por_id: userId,
          created_at: now,
          updated_at: now,
          servicio_id: servicioId,
          estado_conductor: data.estado_conductor as any,
          via_trocha: data.via_trocha,
          via_afirmado: data.via_afirmado,
          via_mixto: data.via_mixto,
          via_pavimentada: data.via_pavimentada,
          riesgo_desniveles: data.riesgo_desniveles,
          riesgo_deslizamientos: data.riesgo_deslizamientos,
          riesgo_sin_senalizacion: data.riesgo_sin_senalizacion,
          riesgo_animales: data.riesgo_animales,
          riesgo_peatones: data.riesgo_peatones,
          riesgo_trafico_alto: data.riesgo_trafico_alto,
          fuente_consulta: data.fuente_consulta as any,
          calificacion_servicio: data.calificacion_servicio as any,
          tiempo_disponibilidad_horas: data.tiempo_disponibilidad_horas,
          duracion_trayecto_horas: data.duracion_trayecto_horas,
          numero_dias_servicio: data.numero_dias_servicio,
        } as any,
      });

      // 2c. Construir filas en memoria con snapshots de la config vigente por día
      const { diasRows, detallesRows } = await buildBulkDias(
        data.dias_laborales || [],
        recargoId,
        data.empresa_id,
        data.mes,
        data.año,
        excluirRNDF,
        userId,
        now,
      );

      // 2d. Insertar días en una sola query (createMany)
      if (diasRows.length > 0) {
        await tx.dias_laborales_planillas.createMany({ data: diasRows });
      }

      // 2e. Insertar detalles de recargos (HED/HEN/RD/etc.) en una sola
      // query (createMany). Sin estas filas, `list` y `findById` (que
      // leen los totales de `detalles_recargos_dias`) devolverían 0
      // horas para todos los tipos. Cada `detallesRow` ya viene con
      // snapshot completo (id, dia_laboral_id, tipo_recargo_id, horas,
      // valor_hora_base, valor_calculado, porcentaje_aplicado,
      // valor_hora_calculado, configuracion_salario_id,
      // fecha_aplicacion, jornada_normal_horas, jornada_festiva_horas,
      // creado_por_id, created_at, updated_at).
      if (detallesRows.length > 0) {
        await tx.detalles_recargos_dias.createMany({ data: detallesRows });
      }

      return recargoId;
    });

    // 3. Actualizar totales (fuera de la tx para no bloquearla más)
    await this.actualizarTotales(recargo);

    return this.findById(recargo);
  },

  // ─────────────────────────────────────────────
  // UPDATE — optimizado
  // ─────────────────────────────────────────────
  async  update(id: string, data: UpdateRecargoDTO, userId?: string) {
  const now = new Date();

  // 1. Leer recargo existente (necesario para empresa_id si no viene en update)
  const recargoExistente = await prisma.recargos_planillas.findUnique({ where: { id } });
  if (!recargoExistente) throw new Error("Recargo no encontrado");

  // Determinar empresa efectiva y excluirRNDF
  const empresaId = data.empresa_id ?? recargoExistente.empresa_id;
  const excluirRNDF = EMPRESAS_SIN_RNDF.includes(empresaId);

  // 2. Construir updateData en memoria
  const updateData: any = {
    actualizado_por_id: userId,
    version: { increment: 1 },
    updated_at: now,
  };

  const camposEscalares: (keyof UpdateRecargoDTO)[] = [
    "numero_planilla", "observaciones", "estado", "mes",
    "conductor_id", "vehiculo_id", "empresa_id", "servicio_id",
    "estado_conductor", "via_trocha", "via_afirmado", "via_mixto",
    "via_pavimentada", "riesgo_desniveles", "riesgo_deslizamientos",
    "riesgo_sin_senalizacion", "riesgo_animales", "riesgo_peatones",
    "riesgo_trafico_alto", "fuente_consulta", "calificacion_servicio",
    "tiempo_disponibilidad_horas", "duracion_trayecto_horas", "numero_dias_servicio",
  ];

  for (const campo of camposEscalares) {
    if (data[campo] !== undefined) {
      // año → a_o mapping especial
      updateData[campo === "año" ? "a_o" : campo] = data[campo];
    }
  }
  if (data.año !== undefined) updateData.a_o = data.año;

  // 3. Transacción única para todo
  await prisma.$transaction(async (tx) => {

    // 3a. Servicio (crear o actualizar) — condicional
    const tieneServicioData = data.servicio_origen_id && data.servicio_destino_id;
    if (tieneServicioData) {
      const mesRecargo = data.mes ?? recargoExistente.mes;
      const añoRecargo = data.año ?? recargoExistente.a_o;
      const estadoServicio = this._determinarEstadoServicio(
        data.dias_laborales || [],
        mesRecargo,
        añoRecargo,
      );
      const servicioData: any = {
        origen_id: data.servicio_origen_id,
        destino_id: data.servicio_destino_id,
        origen_especifico: data.servicio_origen_especifico || "",
        destino_especifico: data.servicio_destino_especifico || "",
        origen_latitud: data.servicio_origen_latitud,
        origen_longitud: data.servicio_origen_longitud,
        destino_latitud: data.servicio_destino_latitud,
        destino_longitud: data.servicio_destino_longitud,
        observaciones: data.servicio_observaciones,
        proposito_servicio: this._normalizarProposito(data.servicio_proposito) as any,
        estado: estadoServicio as any,
        conductor_id: data.conductor_id || recargoExistente.conductor_id,
        vehiculo_id: data.vehiculo_id || recargoExistente.vehiculo_id,
        fecha_realizacion: data.servicio_fecha_realizacion
          ? new Date(data.servicio_fecha_realizacion)
          : undefined,
        updated_at: now,
      };

      if (recargoExistente.servicio_id) {
        await tx.servicio.update({ where: { id: recargoExistente.servicio_id }, data: servicioData });
      } else {
        const nuevoServicio = await tx.servicio.create({
          data: {
            id: randomUUID(),
            cliente_id: empresaId,
            fecha_solicitud: now,
            valor: 0,
            created_at: now,
            ...servicioData,
          },
        });
        updateData.servicio_id = nuevoServicio.id;
      }
    }

    // 3b. Actualizar recargo principal
    await tx.recargos_planillas.update({ where: { id }, data: updateData });

    // 3c. Días laborales — reemplazar en bulk con snapshots
    if (data.dias_laborales && data.dias_laborales.length > 0) {
      // Se MARCAN los anteriores, no se borran.
      //
      // Antes esto era un `deleteMany` cuya cascada arrastraba también los
      // detalles: cada edición de una planilla destruía la anterior sin dejar
      // rastro, sobre dos tablas que YA tenían `deleted_at` y quince lecturas
      // que ya lo filtraban. Es el mismo patrón que se llevó por delante los
      // ítems de las liquidaciones.
      //
      // Los detalles van primero y explícitamente: al no borrar el día, la
      // cascada ya no se dispara y quedarían colgando de un día retirado.
      const ahoraBorrado = new Date();
      await tx.detalles_recargos_dias.updateMany({
        where: {
          deleted_at: null,
          dias_laborales_planillas: { recargo_planilla_id: id }
        },
        data: { deleted_at: ahoraBorrado }
      });
      await tx.dias_laborales_planillas.updateMany({
        where: { recargo_planilla_id: id, deleted_at: null },
        data: { deleted_at: ahoraBorrado }
      });

      // Mes/año efectivos (pueden venir en el update o quedarse igual)
      const mesEfectivo = data.mes ?? recargoExistente.mes;
      const añoEfectivo = data.año ?? recargoExistente.a_o;

      // Construir filas en memoria con snapshots
      const { diasRows, detallesRows } = await buildBulkDias(
        data.dias_laborales,
        id,
        empresaId,
        mesEfectivo,
        añoEfectivo,
        excluirRNDF,
        userId,
        now,
      );

      // 1 query para insertar los días
      if (diasRows.length > 0) {
        await tx.dias_laborales_planillas.createMany({ data: diasRows });
      }

      // Insertar detalles de recargos (HED/HEN/RD/etc.) en una sola
      // query. El `deleteMany` de más arriba sobre `dias_laborales_planillas`
      // hace cascade a `detalles_recargos_dias`, así que no hace falta
      // borrar nada extra. Sin estas filas, `list` y `findById` (que
      // leen los totales de `detalles_recargos_dias`) devolverían 0
      // horas para todos los tipos.
      if (detallesRows.length > 0) {
        await tx.detalles_recargos_dias.createMany({ data: detallesRows });
      }
    }
  });

  // 4. Totales fuera de la tx
  await this.actualizarTotales(id);

  return this.findById(id);
},
 

  // Liquidar recargo
  async liquidar(id: string, userId?: string) {
    const recargo = await prisma.recargos_planillas.update({
      where: { id },
      data: {
        estado: "liquidada",
        actualizado_por_id: userId,
        version: { increment: 1 },
      },
      include: {
        conductores: true,
        vehiculos: true,
        clientes: true,
      },
    });

    return recargo;
  },

  // Duplicar recargo
  async duplicar(id: string, userId?: string) {
    const original = await this.findById(id);

    const nuevoRecargo = await this.create(
      {
        conductor_id: original.conductor_id,
        vehiculo_id: original.vehiculo_id,
        empresa_id: original.empresa_id,
        numero_planilla: original.numero_planilla
          ? `${original.numero_planilla}-COPIA`
          : null,
        mes: original.mes,
        año: original.a_o,
        observaciones: original.observaciones,
        dias_laborales: original.dias_laborales_planillas.map((dia) => ({
          dia: dia.dia,
          hora_inicio: Number(dia.hora_inicio),
          hora_fin: Number(dia.hora_fin),
          total_horas: Number(dia.total_horas),
          es_festivo: dia.es_festivo,
          es_domingo: dia.es_domingo,
          kilometraje_inicial: dia.kilometraje_inicial
            ? Number(dia.kilometraje_inicial)
            : null,
          kilometraje_final: dia.kilometraje_final
            ? Number(dia.kilometraje_final)
            : null,
          pernocte: dia.pernocte,
          disponibilidad: dia.disponibilidad,
          continua_siguiente_dia: dia.continua_siguiente_dia || false,
          observaciones: dia.observaciones,
        })),
      },
      userId,
    );

    return nuevoRecargo;
  },

  // Actualizar totales calculados
  async actualizarTotales(recargoId: string) {
    const recargo = await prisma.recargos_planillas.findUnique({
      where: { id: recargoId },
      include: {
        dias_laborales_planillas: {
          where: { deleted_at: null },
          select: {
            total_horas: true,
            horas_ordinarias: true,
            disponibilidad: true,
          },
        },
      },
    });

    if (!recargo) return;

    // Los totales del recargo reflejan SOLO los días efectivamente
    // trabajados. Los días marcados como `disponibilidad: true` (el
    // conductor estuvo disponible pero no realizó recorridos) NO suman
    // a `total_dias_laborados` ni a las horas trabajadas/ordinarias.
    // Esto es consistente con:
    //   - El frontend (ModalFormRecargo y TablaDiasLaborados) que ya
    //     excluye disponibilidad del cálculo de horas.
    //   - El cálculo de recargos (los días disponibles no generan
    //     HED/HEN/RD/etc. en `detalles_recargos_dias`).
    const diasTrabajados = recargo.dias_laborales_planillas.filter(
      (d) => !d.disponibilidad
    );

    const total_dias_laborados = diasTrabajados.length;
    const total_horas_trabajadas = diasTrabajados.reduce(
      (sum, dia) => sum + Number(dia.total_horas),
      0,
    );
    const total_horas_ordinarias = diasTrabajados.reduce(
      (sum, dia) => sum + Number(dia.horas_ordinarias),
      0,
    );

    await prisma.recargos_planillas.update({
      where: { id: recargoId },
      data: {
        total_dias_laborados,
        total_horas_trabajadas,
        total_horas_ordinarias,
      },
    });
  },

  /**
   * Suma el `valor_calculado` de todos los `detalles_recargos_dias` activos
   * y no eliminados de una planilla. Es el "Valor a Pagar" que muestra el
   * canvas de recargos en la columna final.
   *
   * Usado por el controller para incluir `valor_pagar` en el payload del
   * socket (`recargo-creado` / `recargo-actualizado` / `recargo-recalculado`)
   * y que el frontend pueda inyectar el valor directo en su mapa sin tener
   * que esperar al endpoint de preview.
   *
   * Devuelve 0 si la planilla no tiene detalles monetarios (caso válido:
   * todos los días marcados como `disponibilidad`).
   */
  async calcularValorAPagar(recargoId: string): Promise<number> {
    const result = await prisma.detalles_recargos_dias.aggregate({
      where: {
        activo: true,
        deleted_at: null,
        valor_calculado: { not: null },
        dias_laborales_planillas: {
          recargo_planilla_id: recargoId,
          deleted_at: null,
        },
      },
      _sum: { valor_calculado: true },
    });
    return Number(result._sum.valor_calculado || 0);
  },

  // Obtener tipos de recargo activos
  async getTiposRecargo() {
    return prisma.tipos_recargos.findMany({
      where: { activo: true },
      orderBy: { codigo: "asc" },
    });
  },

  // Recalcular un recargo_planilla con la config vigente por día.
  //
  // Modelo "sin snapshots": el breakdown (HED/HEN/RD/etc.) NO está
  // persistido en la BD — es una función pura de (días, config vigente).
  // Por lo tanto, este endpoint en realidad solo bumpea `updated_at` y
  // devuelve el breakdown calculado en vivo con la config actual.
  //
  // Razón de ser:
  //   - Notificar al usuario que "se aplicó la config vigente" (UX).
  //   - Bumpear `updated_at` para auditoría (paper trail).
  //   - Devolver el breakdown actualizado (otros clientes pueden usarlo
  //     para re-renderizar con la config nueva).
  //   - En el futuro, si el cálculo requiere resolver un caso especial
  //     (p.ej. reglas de negocio que no están en el algoritmo puro),
  //     este endpoint es el hook para hacerlo.
  //
  // NO escribe en `detalles_recargos_dias`: la tabla queda como legacy
  // desde la introducción de este modelo.
  async recalcular(id: string, userId?: string) {
    const now = new Date();

    // 1. Validar que la planilla existe y no está eliminada
    const planilla = await prisma.recargos_planillas.findUnique({
      where: { id },
      select: {
        id: true,
        deleted_at: true,
        conductor_id: true,
        empresa_id: true,
        mes: true,
        a_o: true
      }
    });
    if (!planilla) throw new Error("Recargo no encontrado");
    if (planilla.deleted_at) throw new Error("Recargo eliminado");

    // 2. Calcular el breakdown en vivo con la config vigente
    const breakdown = await calcularBreakdownParaPlanilla(id);

    // 3. Persistir el breakdown en `detalles_recargos_dias` para que
    //    `previewRecargos` (que lee de esta tabla) muestre los nuevos
    //    valores sin cambiar su código. El algoritmo de cálculo es el
    //    mismo que usa el modal de edición del frontend (festivo deduces
    //    5-7, 12-13, 17-18 según el Excel de Cardenas: 30/30 match).
    const planillaCompleta = await prisma.recargos_planillas.findUnique({
      where: { id },
      include: {
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: 'asc' }
        }
      }
    });
    if (planillaCompleta) {
      const diasIds = planillaCompleta.dias_laborales_planillas.map((d) => d.id);
      if (diasIds.length > 0) {
        /// Se marcan, no se borran: este recálculo corre sobre planillas ya
        /// guardadas y destruía los detalles anteriores en cada pasada. La
        /// tabla ya tenía `deleted_at` y las lecturas ya lo filtraban.
        await prisma.detalles_recargos_dias.updateMany({
          where: { dia_laboral_id: { in: diasIds }, deleted_at: null },
          data: { deleted_at: new Date() }
        });
      }

      const excluirRNDF = EMPRESAS_SIN_RNDF.includes(planillaCompleta.empresa_id);
      for (const dia of planillaCompleta.dias_laborales_planillas) {
        if (dia.disponibilidad) continue;
        const breakdownDelDia = breakdown.dias.find((b) => b.dia === dia.dia);
        if (!breakdownDelDia) continue;
        for (const r of breakdownDelDia.recargos) {
          if (r.horas <= 0) continue;
          const tipoRecargo = await prisma.tipos_recargos.findFirst({
            where: { codigo: r.tipo_codigo, activo: true, deleted_at: null }
          });
          if (!tipoRecargo) continue;
          await prisma.detalles_recargos_dias.create({
            data: {
              id: randomUUID(),
              dia_laboral_id: dia.id,
              tipo_recargo_id: tipoRecargo.id,
              horas: r.horas,
              valor_hora_base: r.valor_hora_base,
              valor_calculado: r.valor_total,
              porcentaje_aplicado: r.porcentaje,
              valor_hora_calculado: r.valor_hora_calculada,
              configuracion_salario_id: null,
              fecha_aplicacion: new Date(Date.UTC(planillaCompleta.a_o, planillaCompleta.mes - 1, dia.dia)),
              jornada_normal_horas: 10.00,
              jornada_festiva_horas: 7.00,
              calculado_automaticamente: true,
              activo: true,
              version: 1,
              creado_por_id: userId,
              created_at: now,
              updated_at: now
            }
          });
        }
      }
    }

    // 4. Bumpear `updated_at` y totales (los totales vienen del cálculo
    //    en vivo, NO de los detalles persistidos)
    await prisma.recargos_planillas.update({
      where: { id },
      data: {
        actualizado_por_id: userId,
        version: { increment: 1 },
        updated_at: now,
        total_dias_laborados: breakdown.total_dias,
        total_horas_trabajadas: breakdown.total_horas
      }
    });

    return {
      planilla: {
        id: planilla.id,
        conductor_id: planilla.conductor_id,
        empresa_id: planilla.empresa_id,
        mes: planilla.mes,
        a_o: planilla.a_o
      },
      breakdown
    };
  },

  // ═══════════════════════════════════════════════════════════
  // BULK RECALCULAR — Procesa N planillas en background con
  // progress events al room del usuario. Permite reanudar
  // visibilidad tras recarga de página consultando el batchId.
  // ═══════════════════════════════════════════════════════════

  /**
   * Lanza un recálculo bulk en background. Retorna inmediatamente con
   * el `batchId` (uuid) que el cliente usa para escuchar los eventos
   * `recargos-bulk-recalc:progress` y `recargos-bulk-recalc:done` en su
   * room `user-${userId}`.
   *
   * El cliente persiste el `batchId` en localStorage para poder
   * reanudar la visibilidad si recarga la página (consultando
   * `GET /recalcular-bulk/:batchId`).
   */
  async recalcularBulk(ids: string[], userId: string): Promise<{ batchId: string; total: number }> {
    const batchId = randomUUID();
    const validIds = Array.isArray(ids) ? ids.filter(Boolean) : [];
    const total = validIds.length;

    if (total === 0) {
      throw new Error("Debe proporcionar al menos un id de recargo");
    }

    const state: BulkRecalcBatchState = {
      batchId,
      userId,
      ids: validIds,
      total,
      processed: 0,
      status: "running",
      results: [],
      startedAt: new Date().toISOString()
    };
    bulkRecalcBatches.set(batchId, state);

    console.log(
      `[recalcularBulk] 🚀 Batch iniciado: id=${batchId} userId=${userId} ` +
      `total=${total} room=user-${userId}`
    );

    // Procesar en background (fire-and-forget). El cliente hace polling
    // o escucha sockets para saber el progreso.
    void this._ejecutarBulkRecalc(state).catch((err) => {
      console.error(`[recalcularBulk] Batch ${batchId} crashed:`, err);
      state.status = "failed";
      this._emitBulkRecalcEvent(userId, "recargos-bulk-recalc:done", {
        batchId,
        status: "failed",
        processed: state.processed,
        total: state.total,
        results: state.results,
        error: err?.message || "Error interno"
      });
    });

    return { batchId, total };
  },

  /**
   * Worker interno: itera los ids con concurrencia limitada, llama a
   * `recalcular` por cada uno con timeout, y emite progress + done.
   */
  async _ejecutarBulkRecalc(state: BulkRecalcBatchState): Promise<void> {
    const { batchId, userId, ids } = state;
    const io = getIo();
    const room = `user-${userId}`;
    const emit = async (event: string, payload: any) => {
      try {
        // Verificar cuántos sockets hay en el room ANTES de emitir.
        // Si es 0, el cliente no se unió al room y los eventos se
        // perderán. Logueamos para diagnóstico y emitimos un fallback
        // global con `targetUserId` para que el cliente pueda filtrar.
        const socketsInRoom = await io.in(room).allSockets();
        if (socketsInRoom.size === 0) {
          console.warn(
            `[recalcularBulk] ⚠️ Room ${room} VACÍO al emitir ${event} ` +
            `(batchId=${batchId}). El cliente probablemente no hizo join-dashboard. ` +
            `Fallback: emitiendo global con targetUserId=${userId}.`
          );
          io.emit(event, { ...payload, targetUserId: userId });
        } else {
          console.log(
            `[recalcularBulk] 📡 Emit ${event} → room=${room} ` +
            `(${socketsInRoom.size} socket(s)), batchId=${batchId}`
          );
          io.to(room).emit(event, payload);
        }
      } catch (e) {
        console.warn(`[recalcularBulk] No se pudo emitir ${event}:`, e);
      }
    };

    for (let i = 0; i < ids.length; i += BULK_RECALC_CONCURRENCY) {
      const batch = ids.slice(i, i + BULK_RECALC_CONCURRENCY);
      await Promise.allSettled(
        batch.map(async (id) => {
          const startedAt = Date.now();
          let result: { id: string; ok: boolean; valor_pagar?: number; error?: string };
          try {
            // Timeout por planilla para no trabar el batch si un
            // recalcular individual cuelga (ej: BD lenta).
            const recalcPromise = this.recalcular(id, userId);
            const recalcResult = await this._withTimeout(
              recalcPromise,
              BULK_RECALC_TIMEOUT_MS,
              `Timeout (${BULK_RECALC_TIMEOUT_MS / 1000}s) recalculando ${id}`
            );
            const valorPagar = await this.calcularValorAPagar(id);
            result = { id, ok: true, valor_pagar: valorPagar };
            // Emitir el mismo evento que el recalcular individual
            // (`recargo-recalculado`) para que el canvas actualice la
            // columna "Valor a Pagar" en paralelo al progress.
            try {
              io.to(`user-${userId}`).emit("recargo-recalculado", {
                recargoId: id,
                conductorId: recalcResult.planilla.conductor_id,
                empresaId: recalcResult.planilla.empresa_id,
                mes: recalcResult.planilla.mes,
                año: recalcResult.planilla.a_o,
                recargo: recalcResult,
                valor_pagar: valorPagar,
                timestamp: new Date().toISOString()
              });
            } catch (e) {
              console.warn(`[recalcularBulk] No se pudo emitir recargo-recalculado:`, e);
            }
          } catch (err: any) {
            console.error(`[recalcularBulk] Error en ${id}:`, err?.message || err);
            result = {
              id,
              ok: false,
              error: err?.message || "Error desconocido"
            };
          }

          state.processed += 1;
          state.results.push(result);

          // Progress event (incluye `ok` para que el cliente sepa
          // si este id específico falló sin esperar al done final).
          emit("recargos-bulk-recalc:progress", {
            batchId,
            processed: state.processed,
            total: state.total,
            currentId: id,
            ok: result.ok,
            valor_pagar: result.valor_pagar,
            error: result.error,
            elapsedMs: Date.now() - startedAt
          });
        })
      );
    }

    const okCount = state.results.filter((r) => r.ok).length;
    const errCount = state.results.length - okCount;
    state.status = errCount === state.results.length && state.results.length > 0 ? "failed" : "completed";
    state.completedAt = new Date().toISOString();

    emit("recargos-bulk-recalc:done", {
      batchId,
      status: state.status,
      processed: state.processed,
      total: state.total,
      okCount,
      errCount,
      results: state.results,
      timestamp: state.completedAt
    });

    // Auto-purga del state en memoria después de 1h. Si el cliente
    // consulta después de eso, recibe 404 (lo cual dispara limpieza
    // de localStorage del lado del cliente).
    state.cleanupTimer = setTimeout(() => {
      bulkRecalcBatches.delete(batchId);
    }, 60 * 60 * 1000);
  },

  /**
   * Promise.race con timeout. Útil para que un recalcular individual
   * no bloquee el batch entero si la BD está lenta.
   */
  _withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(message)), ms);
      promise
        .then((v) => {
          clearTimeout(t);
          resolve(v);
        })
        .catch((e) => {
          clearTimeout(t);
          reject(e);
        });
    });
  },

  /**
   * Wrapper interno para emitir un evento al room del usuario sin
   * propagar errores que puedan tumbar el batch.
   */
  _emitBulkRecalcEvent(userId: string, event: string, payload: any) {
    try {
      const io = getIo();
      const room = `user-${userId}`;
      io.in(room).allSockets().then((sockets) => {
        if (sockets.size === 0) {
          console.warn(
            `[recalcularBulk] ⚠️ Room ${room} VACÍO al emitir ${event} (fallback global)`
          );
          io.emit(event, { ...payload, targetUserId: userId });
        } else {
          io.to(room).emit(event, payload);
        }
      }).catch((e) => {
        console.warn(`[recalcularBulk] No se pudo emitir ${event}:`, e);
      });
    } catch (e) {
      console.warn(`[recalcularBulk] No se pudo emitir ${event}:`, e);
    }
  },

  /**
   * Devuelve el estado actual de un batch. Lo usa el cliente al
   * recargar la página para reanudar la UI de progreso.
   *
   * Filtra por `userId` para que un usuario no pueda consultar el
   * batch de otro (sería un information leak menor, pero lo cerramos).
   */
  getBatchStatus(
    batchId: string,
    userId: string
  ): {
    batchId: string;
    status: "pending" | "running" | "completed" | "failed";
    processed: number;
    total: number;
    okCount: number;
    errCount: number;
    results: Array<{ id: string; ok: boolean; valor_pagar?: number; error?: string }>;
    startedAt: string;
    completedAt?: string;
  } | null {
    const state = bulkRecalcBatches.get(batchId);
    if (!state) return null;
    if (state.userId !== userId) return null; // No leak entre usuarios

    const okCount = state.results.filter((r) => r.ok).length;
    return {
      batchId: state.batchId,
      status: state.status,
      processed: state.processed,
      total: state.total,
      okCount,
      errCount: state.results.length - okCount,
      results: state.results,
      startedAt: state.startedAt,
      completedAt: state.completedAt
    };
  },


  // Obtener estadísticas
  async getEstadisticas(filters: any) {
    const where: any = { deleted_at: null };

    if (filters.mes) where.mes = parseInt(filters.mes);
    if (filters.año) where.a_o = parseInt(filters.año);
    if (filters.empresa_id) where.empresa_id = filters.empresa_id;

    const [total, porEstado] = await Promise.all([
      prisma.recargos_planillas.count({ where }),
      prisma.recargos_planillas.groupBy({
        by: ["estado"],
        where,
        _count: true,
      }),
    ]);

    return {
      total,
      por_estado: porEstado.map((e) => ({
        estado: e.estado,
        cantidad: e._count,
      })),
    };
  },

  // Soft delete de recargo
  async softDelete(id: string, userId?: string) {
    const now = new Date();

    // Verificar que el recargo existe y no está eliminado
    const recargo = await prisma.recargos_planillas.findFirst({
      where: {
        id,
        deleted_at: null,
      },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado o ya está eliminado");
    }

    // Soft delete del recargo (cascade soft delete en días laborales y detalles)
    await prisma.$transaction([
      // Marcar detalles de recargos como eliminados
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: {
            in: (
              await prisma.dias_laborales_planillas.findMany({
                where: { recargo_planilla_id: id },
                select: { id: true },
              })
            ).map((d) => d.id),
          },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar días laborales como eliminados
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: id,
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar recargo como eliminado
      prisma.recargos_planillas.update({
        where: { id },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return { success: true, message: "Recargo eliminado correctamente" };
  },

  // Soft delete múltiple de recargos
  async softDeleteMany(ids: string[], userId?: string) {
    const now = new Date();

    // Verificar que todos los recargos existen y no están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: null,
      },
      select: { id: true },
    });

    if (recargos.length === 0) {
      throw new Error("No se encontraron recargos válidos para eliminar");
    }

    const validIds = recargos.map((r) => r.id);

    // Obtener todos los IDs de días laborales
    const diasLaboralesIds = (
      await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: { in: validIds } },
        select: { id: true },
      })
    ).map((d) => d.id);

    // Soft delete en cascada
    await prisma.$transaction([
      // Marcar detalles de recargos como eliminados
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar días laborales como eliminados
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: { in: validIds },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Marcar recargos como eliminados
      prisma.recargos_planillas.updateMany({
        where: {
          id: { in: validIds },
          deleted_at: null,
        },
        data: {
          deleted_at: now,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return {
      success: true,
      message: `${validIds.length} recargo(s) eliminado(s) correctamente`,
      eliminados: validIds.length,
    };
  },

  // Restaurar recargo (quitar soft delete)
  async restored(id: string, userId?: string) {
    const now = new Date();

    // Verificar que el recargo existe y está eliminado
    const recargo = await prisma.recargos_planillas.findFirst({
      where: {
        id,
        deleted_at: {
          not: null,
        },
      },
    });

    if (!recargo) {
      throw new Error("Recargo no encontrado o ya está restaurado");
    }

    // Obtener IDs de días laborales eliminados del recargo
    const diasLaboralesIds = (
      await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: id },
        select: { id: true },
      })
    ).map((d) => d.id);

    // Restaurar en cascada
    await prisma.$transaction([
      // Restaurar detalles de recargos
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar días laborales
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: id,
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar recargo
      prisma.recargos_planillas.update({
        where: { id },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return { success: true, message: "Recargo restaurado correctamente" };
  },

  // Restaurar múltiples recargos (quitar soft delete)
  async restoredMany(ids: string[], userId?: string) {
    const now = new Date();

    // Verificar que todos los recargos existen y están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: { not: null },
      },
      select: { id: true },
    });

    if (recargos.length === 0) {
      throw new Error("No se encontraron recargos válidos para restaurar");
    }

    const validIds = recargos.map((r) => r.id);

    // Obtener todos los IDs de días laborales
    const diasLaboralesIds = (
      await prisma.dias_laborales_planillas.findMany({
        where: { recargo_planilla_id: { in: validIds } },
        select: { id: true },
      })
    ).map((d) => d.id);

    // Restaurar en cascada
    await prisma.$transaction([
      // Restaurar detalles de recargos
      prisma.detalles_recargos_dias.updateMany({
        where: {
          dia_laboral_id: { in: diasLaboralesIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar días laborales
      prisma.dias_laborales_planillas.updateMany({
        where: {
          recargo_planilla_id: { in: validIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),

      // Restaurar recargos
      prisma.recargos_planillas.updateMany({
        where: {
          id: { in: validIds },
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          actualizado_por_id: userId,
          updated_at: now,
        },
      }),
    ]);

    return {
      success: true,
      message: `${validIds.length} recargo(s) restaurado(s) correctamente`,
      restaurados: validIds.length,
    };
  },

  async cambiarEstadoMultiple(ids: string[], estado: string, userId?: string) {
    const now = new Date();

    // Verificar que todos los recargos existen y no están eliminados
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        id: { in: ids },
        deleted_at: null,
      },
      select: { id: true, estado: true },
    });

    if (recargos.length === 0) {
      throw new Error("No se encontraron recargos válidos para actualizar");
    }

    const validIds = recargos.map((r) => r.id);

    // Actualizar estado de todos los recargos válidos
    await prisma.recargos_planillas.updateMany({
      where: {
        id: { in: validIds },
        deleted_at: null,
      },
      data: {
        estado: estado as any,
        actualizado_por_id: userId,
        updated_at: now,
      },
    });

    return {
      success: true,
      message: `${validIds.length} recargo(s) actualizado(s) al estado "${estado}"`,
      actualizados: validIds.length,
      estado,
    };
  },

  async reporteServiciosporPlaca(mes: string, año: string) {
    const recargos = await prisma.recargos_planillas.findMany({
      where: {
        deleted_at: null,
        mes: parseInt(mes),
        a_o: parseInt(año),
        conductores: {
          nomina: true, // 👈 filtro aquí
        },
      },
      select: {
        conductores: {
          select: {
            nombre: true,
            apellido: true,
            numero_identificacion: true,
          },
        },
        vehiculos: {
          select: { placa: true },
        },
        clientes: {
          select: { nombre: true },
        },
        dias_laborales_planillas: {
          where: { deleted_at: null },
          orderBy: { dia: "asc" },
          select: { dia: true },
        },
      },
    });

    return recargos;
  },

  /**
   * Devuelve el siguiente número de planilla disponible en formato PREFIX-XXXX.
   *
   * Usa SQL crudo (no Prisma findMany) porque:
   * 1. Prisma findMany trae TODAS las filas y parsea en JS — lento con miles
   *    de planillas y propenso a saltarse filas en casos raros de charset.
   * 2. Hacer MAX() en Postgres es O(1) gracias al índice y exacto.
   * 3. El regex a nivel SQL filtra variantes (espacios, mayúsculas, etc.)
   *    que la regex JS podía aceptar mal.
   *
   * Implementación: usa `regexp_replace(..., '^{PREFIX}-(\d+)$', '\1')` para
   * extraer el número. NO usa `SUBSTRING(string FROM n)` porque Prisma manda
   * el `n` como parámetro bigint y Postgres no puede resolver el overload
   * (error 42883 "function substring(character varying, bigint) does not exist").
   *
   * Considera TODOS los registros (incluyendo soft-deleted) para que el
   * consecutivo sea monotónico: si TM-7208 fue borrado, devolvemos TM-7209
   * si ese es el siguiente real, no TM-7208 otra vez.
   *
   * Configurable vía env PLANILLA_PREFIX (default "TM", Cotransmeq usa "CM").
   */
  async getNextNumeroPlanilla(): Promise<string> {
    // Importación lazy para evitar ciclos
    const { env } = await import("../../config/env");
    // El schema Zod valida 1-5 chars. Escapeamos cualquier char regex
    // especial (., *, +, etc.) para que el patrón sea literal.
    const rawPrefix = env.PLANILLA_PREFIX || "TM";
    const prefix = rawPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Construimos la query con $queryRawUnsafe: el prefijo es un valor
    // validado por el schema (1-5 chars alfanuméricos escapados) y
    // nunca viene de input del usuario. Inlinarlo evita el bug de
    // overload de SUBSTRING(... FROM $1).
    const sql = `
      SELECT MAX(
        CAST(regexp_replace(numero_planilla, '^${prefix}-(\\d+)$', '\\1') AS INTEGER)
      ) AS max
      FROM recargos_planillas
      WHERE numero_planilla ~ '^${prefix}-[0-9]+$'
    `;

    const result = await prisma.$queryRawUnsafe<{ max: number | null }[]>(sql);

    const maxNum = result[0]?.max ?? 0;
    const next = (maxNum + 1).toString().padStart(4, "0");
    return `${rawPrefix}-${next}`;
  },
};
interface RecargoRow {
  conductores: {
    nombre: string;
    apellido: string;
    numero_identificacion: string;
  };
  vehiculos: { placa: string };
  clientes: { nombre: string };
  dias_laborales_planillas: { dia: Date | string }[];
}

// ═══════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════

const MESES: Record<number, string> = {
  1: "Enero",
  2: "Febrero",
  3: "Marzo",
  4: "Abril",
  5: "Mayo",
  6: "Junio",
  7: "Julio",
  8: "Agosto",
  9: "Septiembre",
  10: "Octubre",
  11: "Noviembre",
  12: "Diciembre",
};

const C = {
  HEADER_BG: "#1E3A5F",
  HEADER_TEXT: "#FFFFFF",
  ROW_EVEN: "#EAF0FB",
  ROW_ODD: "#FFFFFF",
  BORDER: "#B0BEC5",
  TOTAL_BG: "#D0E4F7",
  TOTAL_TEXT: "#1E3A5F",
  FOOTER: "#90A4AE",
};

// A4 en puntos
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const CONTENT_W = PAGE_W - MARGIN * 2; // 523.28

// Columnas: Conductor | Placa | Servicios
const COL_CONDUCTOR = 210;
const COL_PLACA = 100;
const COL_SERVICIOS = 63; // ~63
const TABLE_W = COL_CONDUCTOR + COL_PLACA + COL_SERVICIOS; // 373 — ancho real de la tabla

const ROW_H = 20;
const TH_H = 22;
const HEADER_H = 36; // banda compacta 2 líneas
const TABLE_TOP = MARGIN + HEADER_H + 8;
const FOOTER_Y = PAGE_H - MARGIN - 18;
const USABLE_BOT = FOOTER_Y - 4;

// ═══════════════════════════════════════════════════════════════
// GENERADOR PDF
// ═══════════════════════════════════════════════════════════════

export function generarPDFReporteServicios(
  recargos: RecargoRow[],
  mes: string,
  anio: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // ── 1. Agrupación por conductor → placas ──────────────────
    const mapaGrupos = new Map<
      string,
      { conductor: string; placas: { placa: string; servicios: number }[] }
    >();

    for (const r of recargos) {
      const cedula = r.conductores.numero_identificacion;
      const nombre = `${r.conductores.nombre} ${r.conductores.apellido}`;
      const placa = r.vehiculos.placa;
      const dias = r.dias_laborales_planillas.length;

      if (!mapaGrupos.has(cedula)) {
        mapaGrupos.set(cedula, { conductor: nombre, placas: [] });
      }
      const grupo = mapaGrupos.get(cedula)!;
      const entry = grupo.placas.find((p) => p.placa === placa);
      if (entry) {
        entry.servicios += dias;
      } else {
        grupo.placas.push({ placa, servicios: dias });
      }
    }

    const grupos = Array.from(mapaGrupos.values()).sort((a, b) =>
      a.conductor.localeCompare(b.conductor, "es"),
    );
    grupos.forEach((g) =>
      g.placas.sort((a, b) => a.placa.localeCompare(b.placa)),
    );

    const totalServicios = grupos.reduce(
      (s, g) => s + g.placas.reduce((ps, p) => ps + p.servicios, 0),
      0,
    );

    const mesNombre = MESES[parseInt(mes)] ?? mes;
    const hoy = new Date().toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });

    // ── 2. Documento ───────────────────────────────────────────
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      bufferPages: true,
      info: {
        Title: `Reporte Servicios ${mesNombre} ${anio}`,
        Author: "Sistema de Gestión",
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    // ── 3. Helpers ─────────────────────────────────────────────

    const drawHeader = () => {
      doc.rect(0, 0, PAGE_W, HEADER_H).fill(C.HEADER_BG);

      doc
        .font("Helvetica-Bold")
        .fontSize(9.5)
        .fillColor(C.HEADER_TEXT)
        .text(
          `REPORTE DE SERVICIOS POR PLACA Y CONDUCTOR  —  ${mesNombre.toUpperCase()} ${anio}`,
          MARGIN,
          9,
          { width: CONTENT_W, align: "left", lineBreak: false },
        );

      doc
        .font("Helvetica")
        .fontSize(7.5)
        .fillColor("#90CAF9")
        .text(`Generado el ${hoy}`, MARGIN, 22, {
          width: CONTENT_W,
          align: "left",
          lineBreak: false,
        });
    };

    const drawTableHeader = (y: number): number => {
      doc.rect(MARGIN, y, TABLE_W, TH_H).fill(C.HEADER_BG);

      const cols = [
        {
          label: "CONDUCTOR",
          x: MARGIN,
          w: COL_CONDUCTOR,
          align: "left" as const,
        },
        {
          label: "PLACA",
          x: MARGIN + COL_CONDUCTOR,
          w: COL_PLACA,
          align: "center" as const,
        },
        {
          label: "SERVICIOS",
          x: MARGIN + COL_CONDUCTOR + COL_PLACA,
          w: COL_SERVICIOS,
          align: "center" as const,
        },
      ];

      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.HEADER_TEXT);
      for (const col of cols) {
        doc.text(col.label, col.x + 4, y + 7, {
          width: col.w - 8,
          align: col.align,
          lineBreak: false,
        });
      }
      return y + TH_H;
    };

    const SUB_H = 18; // alto del subheader de conductor

    /** Subheader con nombre del conductor — ocupa toda la fila */
    const drawConductorSubheader = (nombre: string, y: number) => {
      doc.rect(MARGIN, y, TABLE_W, SUB_H).fill("#E8EEF7");
      // Línea superior remarcada
      doc
        .moveTo(MARGIN, y)
        .lineTo(MARGIN + TABLE_W, y)
        .strokeColor("#1E3A5F")
        .lineWidth(1)
        .stroke();
      doc
        .font("Helvetica-Bold")
        .fontSize(8)
        .fillColor("#1E3A5F")
        .text(nombre.toUpperCase(), MARGIN + 6, y + 5, {
          width: TABLE_W - 12,
          align: "left",
          lineBreak: false,
        });
    };

    /** Fila de placa/servicios (sin columna conductor) */
    const drawPlacaRow = (
      placa: string,
      servicios: number,
      y: number,
      idx: number,
    ) => {
      doc
        .rect(MARGIN, y, TABLE_W, ROW_H)
        .fill(idx % 2 === 0 ? C.ROW_ODD : C.ROW_EVEN);
      doc.font("Helvetica").fontSize(8).fillColor("#263238");
      // Celda conductor vacía (identación visual)
      doc.text("", MARGIN + 4, y + 5, {
        width: COL_CONDUCTOR - 8,
        lineBreak: false,
      });
      doc.text(placa, MARGIN + COL_CONDUCTOR + 4, y + 5, {
        width: COL_PLACA - 8,
        align: "center",
        lineBreak: false,
      });
      doc.text(
        String(servicios),
        MARGIN + COL_CONDUCTOR + COL_PLACA + 4,
        y + 5,
        { width: COL_SERVICIOS - 8, align: "center", lineBreak: false },
      );
      doc
        .moveTo(MARGIN, y + ROW_H)
        .lineTo(MARGIN + TABLE_W, y + ROW_H)
        .strokeColor(C.BORDER)
        .lineWidth(0.25)
        .stroke();
    };

    const drawTotalRow = (y: number) => {
      doc.rect(MARGIN, y, TABLE_W, ROW_H).fill(C.TOTAL_BG);
      doc.font("Helvetica-Bold").fontSize(8).fillColor(C.TOTAL_TEXT);
      doc.text("TOTAL", MARGIN + 4, y + 5, {
        width: COL_CONDUCTOR + COL_PLACA - 8,
        align: "right",
        lineBreak: false,
      });
      doc.text(
        String(totalServicios),
        MARGIN + COL_CONDUCTOR + COL_PLACA + 4,
        y + 5,
        { width: COL_SERVICIOS - 8, align: "center", lineBreak: false },
      );
    };

    const drawTableBorder = (yTop: number, yBot: number) => {
      doc
        .rect(MARGIN, yTop, TABLE_W, yBot - yTop)
        .strokeColor(C.BORDER)
        .lineWidth(0.5)
        .stroke();

      for (const offset of [COL_CONDUCTOR, COL_CONDUCTOR + COL_PLACA]) {
        doc
          .moveTo(MARGIN + offset, yTop)
          .lineTo(MARGIN + offset, yBot)
          .strokeColor(C.BORDER)
          .lineWidth(0.3)
          .stroke();
      }
    };

    const drawFooter = (pageNum: number, totalPages: number) => {
      doc
        .moveTo(MARGIN, FOOTER_Y)
        .lineTo(MARGIN + CONTENT_W, FOOTER_Y)
        .strokeColor(C.BORDER)
        .lineWidth(0.4)
        .stroke();

      doc.font("Helvetica").fontSize(7).fillColor(C.FOOTER);
      doc.text(
        "Sistema de Gestión  •  Documento generado automáticamente",
        MARGIN,
        FOOTER_Y + 4,
        { width: CONTENT_W * 0.7, align: "left", lineBreak: false },
      );
      doc.text(`Página ${pageNum} de ${totalPages}`, MARGIN, FOOTER_Y + 4, {
        width: CONTENT_W,
        align: "right",
        lineBreak: false,
      });
    };

    // ── 4. Renderizado ─────────────────────────────────────────
    drawHeader();

    let curY = TABLE_TOP;
    let tableTop = curY;
    curY = drawTableHeader(curY);
    let pageNum = 1;
    let rowIdx = 0; // para alternar color de filas globalmente

    const checkPage = (needed: number) => {
      if (curY + needed > USABLE_BOT) {
        drawTableBorder(tableTop, curY);
        doc.addPage();
        pageNum++;
        drawHeader();
        tableTop = TABLE_TOP;
        curY = drawTableHeader(tableTop);
      }
    };

    for (let gi = 0; gi < grupos.length; gi++) {
      const grupo = grupos[gi];
      const isLast = gi === grupos.length - 1;

      // Espacio mínimo: subheader + al menos 1 fila de placa (evitar huérfanos)
      checkPage(SUB_H + ROW_H);

      drawConductorSubheader(grupo.conductor, curY);
      curY += SUB_H;

      for (let pi = 0; pi < grupo.placas.length; pi++) {
        const p = grupo.placas[pi];
        const isLastPlaca = pi === grupo.placas.length - 1;
        const spaceNeeded = ROW_H + (isLast && isLastPlaca ? ROW_H : 0);

        checkPage(spaceNeeded);
        drawPlacaRow(p.placa, p.servicios, curY, rowIdx++);
        curY += ROW_H;
      }
    }

    // Fila total global
    checkPage(ROW_H);
    drawTotalRow(curY);
    curY += ROW_H;
    drawTableBorder(tableTop, curY);

    // Footers con página real
    const totalPages = doc.bufferedPageRange().count;
    for (let p = 0; p < totalPages; p++) {
      doc.switchToPage(p);
      drawFooter(p + 1, totalPages);
    }

    doc.end();
  });
}
