/**
 * Arma el libro de nómina de un periodo a partir de lo que YA hay en la base.
 *
 * Esta es la pieza que quita el doble trabajo. Hoy alguien monta un Excel por
 * conductor y después se re-teclea lo mismo en la app; pero la app ya tiene
 * los días, las horas y los recargos en `recargos_planillas →
 * dias_laborales_planillas → detalles_recargos_dias`, que es exactamente lo
 * que la hoja calcula a mano. Aquí se leen y se devuelven con la forma que
 * necesita el canvas.
 *
 * OJO CON EL PERIODO. La nómina va del 21 del mes anterior al 20 del actual,
 * pero las planillas se indexan por mes natural. Un periodo cruza siempre dos
 * meses de planilla y hay que unirlos — ver `lib/nomina/periodo.ts`.
 */
import { prisma } from '../../config/prisma';
import {
  diasDelPeriodo,
  semanasDelPeriodo,
  mesesDePlanilla,
  etiquetaPeriodo,
  textoDias,
  CORTE_DEFECTO,
  type DiaPeriodo,
  expandirDias,
} from '../../lib/nomina/periodo';
import {
  liquidarNomina,
  type EntradaLiquidacion,
  type ParametrosNomina,
  RESULTADO_VACIO,
} from '../../lib/nomina/liquidar';
import {
  CODIGOS_RECARGO,
  COLOR_RECARGO,
  NOMBRE_RECARGO,
  colorDeCliente,
  type ClienteNomina,
  type BloqueEmpresa,
  type CodigoRecargo,
  type ConceptoDesprendible,
  type DiaHoja,
  type HojaNomina,
  type NominaPeriodoDTO,
  type TarifaRecargo,
} from './nomina-canvas.types';

/** Topes legales que el Excel lleva escritos a mano en el bloque N24:S37. */
const TOPES = { horasSemanales: 42, horasMensuales: 210, horasExtrasMes: 44 };

/**
 * Las dos constantes de la fila 10 (`horas del día − 7 − 3`). De dónde salen
 * no está documentado en ninguna parte, así que viajan como dato editable y
 * no como columna del esquema.
 */
const DISPONIBILIDAD_DEFECTO = { horasBase: 7, horasDescuento: 3 };

/**
 * RN es el único recargo puro: se suma sobre la base que la jornada ya paga.
 * Los demás son «all-in» (base + %). Es la misma regla que
 * `calcularValorMonetario()` en `lib/recargos/calculo.ts`, que en la base es
 * `tipos_recargos.es_hora_extra || .adicional`.
 */
function valorHoraDeRecargo(valorHora: number, codigo: CodigoRecargo, porcentaje: number): number {
  return codigo === 'RN'
    ? valorHora * (porcentaje / 100)
    : valorHora * (1 + porcentaje / 100);
}

const dec = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const decOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export interface OpcionesPeriodo {
  anio: number;
  mes: number;
  corte?: number;
  /** Restringe a estos conductores; por defecto, todos los de nómina. */
  conductorIds?: string[];
}

export class NominaCanvasService {
  /**
   * El libro entero del periodo: una hoja por conductor, en orden alfabético.
   */
  static async construirPeriodo(opts: OpcionesPeriodo): Promise<NominaPeriodoDTO> {
    const { anio, mes } = opts;
    const corte = opts.corte ?? CORTE_DEFECTO;
    // El calendario a secas: un día, una columna. Se expande más abajo, cuando
    // ya se sabe qué días tienen más de un servicio.
    const calendario = diasDelPeriodo(anio, mes, corte);
    const avisos: string[] = [];

    const ventana = mesesDePlanilla(anio, mes, corte);
    const primera = calendario[0];
    const ultima = calendario[calendario.length - 1];
    const fechaInicio = new Date(`${primera.fecha}T00:00:00.000Z`);
    const fechaFin = new Date(`${ultima.fecha}T23:59:59.999Z`);

    // `liquidaciones.periodo_start` y `.periodo_end` son VarChar, no Date: son
    // fechas que el usuario teclea en el formulario. Se filtran con
    // comparación de cadena —que ordena bien mientras sean ISO, con o sin
    // hora— y después se vuelve a comprobar en memoria, por si alguna vieja
    // se guardó con otro formato y el filtro la dejó pasar.
    const desdeISO = primera.fecha;
    const hastaISO = `${ultima.fecha}T23:59:59`;

    const [conductores, planillas, tipos, configsSalario, configsLiq, liquidaciones] =
      await Promise.all([
        // OJO con `conductores.estado`: NO es un estado laboral, es
        // OPERATIVO (activo / programado / servicio / disponible / inactivo /
        // desvinculado). Un conductor `programado` o `en servicio` está
        // trabajando y cobra igual; filtrar por `activo` dejaba fuera a 18 de
        // los 27 de la nómina.
        //
        // La regla es: entra todo el que esté en nómina. A los que ya no
        // están (desvinculado / inactivo) se les exige tener datos DEL
        // PERIODO — si alguien se fue a mitad de mes hay que liquidarle lo
        // trabajado, y dejarlo fuera sería perderle dinero en silencio; pero
        // si no trabajó nada, no tiene por qué aparecer.
        prisma.conductores.findMany({
          where: {
            nomina: true,
            ...(opts.conductorIds?.length ? { id: { in: opts.conductorIds } } : {}),
            OR: [
              { estado: { notIn: ['desvinculado', 'inactivo'] } },
              {
                recargos_planillas: {
                  some: {
                    deleted_at: null,
                    OR: ventana.map((v) => ({ a_o: v.anio, mes: v.mes })),
                  },
                },
              },
              {
                liquidaciones: {
                  some: { periodo_start: { lte: hastaISO }, periodo_end: { gte: desdeISO } },
                },
              },
            ],
          },
          select: {
            id: true,
            nombre: true,
            apellido: true,
            numero_identificacion: true,
            cargo: true,
            salario_base: true,
            sede_trabajo: true,
          },
        }),

        prisma.recargos_planillas.findMany({
          where: {
            deleted_at: null,
            OR: ventana.map((v) => ({ a_o: v.anio, mes: v.mes })),
            ...(opts.conductorIds?.length ? { conductor_id: { in: opts.conductorIds } } : {}),
          },
          include: {
            clientes: { select: { id: true, nombre: true } },
            vehiculos: { select: { id: true, placa: true, clase_vehiculo: true } },
            dias_laborales_planillas: {
              where: { deleted_at: null },
              include: {
                detalles_recargos_dias: {
                  where: { activo: true, deleted_at: null },
                  include: { tipos_recargos: { select: { codigo: true, porcentaje: true } } },
                },
              },
            },
          },
        }),

        // Tipos vigentes al CIERRE del periodo. Los porcentajes cambiaron el
        // 15-jul-2026 (Ley 2466); los `detalles_recargos_dias` ya guardan el
        // % con el que se calculó cada día, así que esto es solo el rótulo de
        // la tabla de configuración.
        prisma.tipos_recargos.findMany({
          where: {
            activo: true,
            deleted_at: null,
            vigencia_desde: { lte: fechaFin },
            OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaFin } }],
          },
          select: { codigo: true, porcentaje: true, vigencia_desde: true },
          orderBy: { vigencia_desde: 'desc' },
        }),

        prisma.configuraciones_salarios.findMany({
          where: {
            activo: true,
            deleted_at: null,
            vigencia_desde: { lte: fechaFin },
            OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaFin } }],
          },
          orderBy: { vigencia_desde: 'desc' },
        }),

        prisma.configuraciones_liquidacion.findMany({
          where: { activo: true, deleted_at: null, OR: [{ anio }, { anio: null }] },
          select: { nombre: true, valor: true },
        }),

        prisma.liquidaciones.findMany({
          where: {
            deleted_at: null,
            periodo_start: { lte: hastaISO },
            periodo_end: { gte: desdeISO },
            ...(opts.conductorIds?.length ? { conductor_id: { in: opts.conductorIds } } : {}),
          },
          include: {
            bonificaciones: { where: { deleted_at: null } },
            pernotes: { where: { deleted_at: null } },
            anticipos: { where: { deleted_at: null } },
            recargos: { where: { deleted_at: null } },
          },
        }),
      ]);

    // El primero de cada código gana: vienen ordenados por vigencia desc.
    const porcentajePorCodigo = new Map<string, number>();
    for (const t of tipos) {
      if (!porcentajePorCodigo.has(t.codigo)) porcentajePorCodigo.set(t.codigo, dec(t.porcentaje));
    }
    for (const c of CODIGOS_RECARGO) {
      if (!porcentajePorCodigo.has(c)) {
        avisos.push(`No hay tarifa vigente para el recargo ${c} al ${ultima.fecha}.`);
      }
    }

    const configGeneral = configsSalario.find((c) => !c.empresa_id) ?? configsSalario[0] ?? null;
    if (!configGeneral) avisos.push('No hay ninguna configuración salarial vigente para el periodo.');

    const parametros = this.parametrosDesdeConfig(configsLiq);

    // ── Rejilla de columnas ────────────────────────────────────────────
    //
    // Cuántos servicios hay como máximo en cada fecha, mirando a TODOS los
    // conductores: es lo que decide si un día abre una o dos columnas. Se
    // cuenta aquí y no dentro de cada hoja porque la rejilla es común al
    // libro entero.
    const repeticiones = new Map<string, number>();
    for (const p of planillas) {
      const porFecha = new Map<string, number>();
      for (const dl of p.dias_laborales_planillas ?? []) {
        const f = `${p.a_o}-${String(p.mes).padStart(2, '0')}-${String(dl.dia).padStart(2, '0')}`;
        porFecha.set(f, (porFecha.get(f) ?? 0) + 1);
      }
      // Se acumula POR CONDUCTOR: dos planillas del mismo día del mismo
      // conductor son dos servicios y piden dos columnas; el mismo día de dos
      // conductores distintos comparte columna, que es lo normal.
      for (const [f, n] of porFecha) {
        const clave = `${p.conductor_id}|${f}`;
        repeticiones.set(clave, (repeticiones.get(clave) ?? 0) + n);
      }
    }
    const maxPorFecha = new Map<string, number>();
    for (const [clave, n] of repeticiones) {
      const f = clave.split('|')[1];
      maxPorFecha.set(f, Math.max(maxPorFecha.get(f) ?? 1, n));
    }

    const dias = expandirDias(calendario, maxPorFecha);
    const semanas = semanasDelPeriodo(dias);

    /// `fecha ISO → columnas de esa fecha`, en orden. Antes era una sola
    /// columna por fecha; ahora puede haber más de una y el reparto lo hace
    /// cada hoja según su propio número de servicios.
    const columnasPorFecha = new Map<string, DiaPeriodo[]>();
    for (const d of dias) {
      const lista = columnasPorFecha.get(d.fecha) ?? [];
      lista.push(d);
      columnasPorFecha.set(d.fecha, lista);
    }

    const planillasPorConductor = new Map<string, typeof planillas>();
    for (const p of planillas) {
      const lista = planillasPorConductor.get(p.conductor_id) ?? [];
      lista.push(p);
      planillasPorConductor.set(p.conductor_id, lista);
    }
    // Segunda pasada del filtro, ahora sí parseando: la de arriba compara
    // cadenas y confía en que el formato sea ISO.
    const solapa = (inicio: string, fin: string): boolean => {
      const a = new Date(inicio);
      const b = new Date(fin);
      if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return true; // ilegible: no descartar
      return a <= fechaFin && b >= fechaInicio;
    };
    const liquidacionPorConductor = new Map<string, (typeof liquidaciones)[number]>();
    for (const l of liquidaciones) {
      if (!l.conductor_id) continue;
      if (!solapa(l.periodo_start, l.periodo_end)) continue;
      const previa = liquidacionPorConductor.get(l.conductor_id);
      // Si hubiera más de una solapando, gana la más reciente: es la que el
      // usuario está trabajando.
      if (!previa || new Date(l.updated_at) > new Date(previa.updated_at)) {
        liquidacionPorConductor.set(l.conductor_id, l);
      }
    }
    const duplicadas = liquidaciones.length - liquidacionPorConductor.size;
    if (duplicadas > 0) {
      avisos.push(`${duplicadas} liquidación(es) solapan el periodo y no se usaron; se tomó la más reciente de cada conductor.`);
    }

    const ordenados = [...conductores].sort((a, b) =>
      `${a.nombre} ${a.apellido}`.localeCompare(`${b.nombre} ${b.apellido}`, 'es', {
        sensitivity: 'base',
      }),
    );

    const usados = new Set<string>();
    const hojas: HojaNomina[] = ordenados.map((c) =>
      this.construirHoja({
        conductor: c,
        planillas: planillasPorConductor.get(c.id) ?? [],
        liquidacion: liquidacionPorConductor.get(c.id) ?? null,
        columnasPorFecha,
        totalDias: dias.length,
        ventanaCanvas: { desde: primera.fecha, hasta: ultima.fecha },
        porcentajePorCodigo,
        configGeneral,
        parametros,
        nombresUsados: usados,
      }),
    );

    return {
      anio,
      mes,
      corte,
      etiqueta: etiquetaPeriodo(anio, mes, corte),
      periodo: { dias, semanas },
      disponibilidad: DISPONIBILIDAD_DEFECTO,
      topes: TOPES,
      hojas,
      clientes: [
        ...new Map(hojas.flatMap((h) => h.clientes).map((c) => [c.id, c])).values(),
      ].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
      avisos,
    };
  }

  /**
   * Traduce `configuraciones_liquidacion` a los parámetros del cálculo.
   *
   * La búsqueda es por NOMBRE porque así está montado hoy el módulo de nómina
   * (`configuracion.find(c => c.nombre === 'Auxilio de transporte')`). Es
   * frágil ante renombres, y por eso lo que no aparece se avisa en vez de
   * quedarse en cero silenciosamente.
   */
  private static parametrosDesdeConfig(
    configs: { nombre: string; valor: unknown }[],
  ): ParametrosNomina {
    const buscar = (nombre: string): number => {
      const c = configs.find((x) => x.nombre.trim().toLowerCase() === nombre.toLowerCase());
      return c ? dec(c.valor) : 0;
    };
    return {
      auxilioTransporteMensual: buscar('Auxilio de transporte'),
      salarioVillanueva: buscar('Salario villanueva'),
      porcentajeSalud: buscar('Salud'),
      porcentajePension: buscar('Pensión'),
      // Los UUID de PAREX y Geopark no están en `configuraciones_liquidacion`
      // (esa tabla es clave→número). Hasta que se modelen, el canvas los
      // recibe del cliente o se quedan sin ajuste; nunca hardcodeados aquí.
      empresaParexId: process.env.NOMINA_EMPRESA_PAREX_ID ?? null,
      empresaGeoparkId: process.env.NOMINA_EMPRESA_GEOPARK_ID ?? null,
      fraccionAjusteRecargos: Number(process.env.NOMINA_FRACCION_AJUSTE ?? 0.08),
    };
  }

  private static construirHoja(args: {
    conductor: {
      id: string;
      nombre: string;
      apellido: string;
      numero_identificacion: string | null;
      cargo: string;
      salario_base: unknown;
    };
    planillas: any[];
    liquidacion: any | null;
    columnasPorFecha: Map<string, DiaPeriodo[]>;
    totalDias: number;
    ventanaCanvas: { desde: string; hasta: string };
    porcentajePorCodigo: Map<string, number>;
    configGeneral: any | null;
    parametros: ParametrosNomina;
    nombresUsados: Set<string>;
  }): HojaNomina {
    const {
      conductor,
      planillas,
      liquidacion,
      columnasPorFecha,
      ventanaCanvas,
      porcentajePorCodigo,
      configGeneral,
      parametros,
      nombresUsados,
    } = args;
    const avisos: string[] = [];

    const salarioBasico = dec(configGeneral?.salario_basico);
    const horasMensualesBase = Number(configGeneral?.horas_mensuales_base ?? 240) || 240;
    const valorHora = horasMensualesBase ? salarioBasico / horasMensualesBase : 0;

    // ── Días ───────────────────────────────────────────────────────────
    // Se indexan por fecha, no por posición: una planilla de julio y otra de
    // agosto aportan días al mismo periodo y hay que mezclarlas.
    const porIndice = new Map<number, DiaHoja>();
    /** `empresaId|mes|codigo → { dias, horas }` para el desglose por empresa. */
    const porEmpresa = new Map<
      string,
      { empresaId: string; empresa: string; mes: number; anio: number; dias: Set<number>; horas: Map<CodigoRecargo, number>; diasPorTipo: Map<CodigoRecargo, Set<number>> }
    >();
    const placas = new Set<string>();
    let tipoVehiculo: string | null = null;

    /// Cuántos servicios de ESTA hoja se han colocado ya en cada fecha. Es lo
    /// que decide a qué columna va el siguiente: el primero a la suya, el
    /// segundo a la contigua.
    const usadasPorFecha = new Map<string, number>();

    for (const p of planillas) {
      if (p.vehiculos?.placa) placas.add(p.vehiculos.placa);
      if (!tipoVehiculo && p.vehiculos?.clase_vehiculo) tipoVehiculo = p.vehiculos.clase_vehiculo;
      const empresaId: string = p.empresa_id;
      const empresa: string = p.clientes?.nombre ?? 'SIN EMPRESA';

      for (const dl of p.dias_laborales_planillas ?? []) {
        const fecha = `${p.a_o}-${String(p.mes).padStart(2, '0')}-${String(dl.dia).padStart(2, '0')}`;
        const columnas = columnasPorFecha.get(fecha);
        if (!columnas?.length) continue; // día de la planilla fuera del periodo

        // Cada servicio del día va a su propia columna. Si por lo que sea hay
        // más servicios que columnas —no debería, la rejilla se dimensionó
        // contando estos mismos días—, el sobrante cae en la última y se
        // avisa, en vez de perderse en silencio como pasaba antes.
        const yaUsadas = usadasPorFecha.get(fecha) ?? 0;
        const dp = columnas[Math.min(yaUsadas, columnas.length - 1)];
        usadasPorFecha.set(fecha, yaUsadas + 1);
        if (yaUsadas >= columnas.length) {
          avisos.push(`El ${fecha} tiene más servicios que columnas; se agruparon los últimos.`);
        }

        // El bloque de la empresa y el día se registran SIEMPRE, aunque el
        // día no haya dado un solo recargo. Antes esto vivía dentro del
        // bucle de `detalles_recargos_dias`, así que un día trabajado cuya
        // jornada cabe en la ordinaria —6 h, 7 h: sin HED, sin RN, sin
        // detalles— no entraba en `bloque.dias` y desaparecía del desglose;
        // y una empresa cuyos días fueran todos así no producía bloque
        // ninguno. El caso extremo es la planilla de disponibilidad, que por
        // definición no genera recargos: sus días no se veían en ninguna
        // parte del desprendible.
        //
        // Las HORAS siguen sumándose solo desde los detalles, así que un
        // bloque sin recargos sale con sus líneas en cero: dice qué días se
        // trabajaron para esa empresa, y que no hubo recargo que cobrar.
        const clave = `${empresaId}|${p.mes}|${p.a_o}`;
        let bloque = porEmpresa.get(clave);
        if (!bloque) {
          bloque = {
            empresaId, empresa, mes: p.mes, anio: p.a_o,
            dias: new Set(), horas: new Map(), diasPorTipo: new Map(),
          };
          porEmpresa.set(clave, bloque);
        }
        bloque.dias.add(dl.dia);

        const horas: Partial<Record<CodigoRecargo, number>> = {};
        for (const det of dl.detalles_recargos_dias ?? []) {
          const cod = det.tipos_recargos?.codigo as CodigoRecargo | undefined;
          if (!cod || !CODIGOS_RECARGO.includes(cod)) continue;
          const h = dec(det.horas);
          if (h <= 0) continue;
          horas[cod] = (horas[cod] ?? 0) + h;

          bloque.horas.set(cod, (bloque.horas.get(cod) ?? 0) + h);
          const set = bloque.diasPorTipo.get(cod) ?? new Set<number>();
          set.add(dl.dia);
          bloque.diasPorTipo.set(cod, set);
        }

        // Ya no se fusiona. Antes, dos planillas del mismo día caían en la
        // misma columna: se sumaban las horas —hasta 24 en un día— y el
        // horario y la empresa de la segunda se perdían. Peor aún, el aviso
        // solo saltaba si eran de empresas distintas, así que el caso normal
        // —dos servicios del mismo cliente— desaparecía sin decir nada.
        const existente = porIndice.get(dp.indice);
        if (existente) {
          for (const [k, v] of Object.entries(horas)) {
            const cod = k as CodigoRecargo;
            existente.horas[cod] = (existente.horas[cod] ?? 0) + (v ?? 0);
          }
          existente.totalHoras += dec(dl.total_horas);
          continue;
        }

        porIndice.set(dp.indice, {
          indice: dp.indice,
          fecha,
          ocurrencia: dp.ocurrencia,
          horaInicio: decOrNull(dl.hora_inicio),
          horaFin: decOrNull(dl.hora_fin),
          totalHoras: dec(dl.total_horas),
          esFestivo: !!dl.es_festivo,
          esDomingo: !!dl.es_domingo,
          disponibilidad: !!dl.disponibilidad,
          pernocte: !!dl.pernocte,
          continuaSiguienteDia: !!dl.continua_siguiente_dia,
          horas,
          empresa,
          empresaId,
          empresaColor: colorDeCliente(empresaId),
        });
      }
    }

    const diasHoja = [...porIndice.values()].sort((a, b) => a.indice - b.indice);

    // ── Tarifas y acumulado por tipo ───────────────────────────────────
    const horasPorCodigo = new Map<CodigoRecargo, number>();
    for (const d of diasHoja) {
      for (const [k, v] of Object.entries(d.horas)) {
        const cod = k as CodigoRecargo;
        horasPorCodigo.set(cod, (horasPorCodigo.get(cod) ?? 0) + (v ?? 0));
      }
    }

    const tarifas: TarifaRecargo[] = CODIGOS_RECARGO.map((codigo) => {
      const porcentaje = porcentajePorCodigo.get(codigo) ?? 0;
      const vh = valorHoraDeRecargo(valorHora, codigo, porcentaje);
      const horas = horasPorCodigo.get(codigo) ?? 0;
      return {
        codigo,
        nombre: NOMBRE_RECARGO[codigo],
        color: COLOR_RECARGO[codigo],
        porcentaje,
        valorHora: vh,
        horas,
        valor: Math.round(horas * vh),
      };
    });
    const tarifaPorCodigo = new Map(tarifas.map((t) => [t.codigo, t]));

    // ── Bloques por empresa ────────────────────────────────────────────
    // Uno por (empresa, mes), como en el Excel: FEPCO aparece dos veces, una
    // con los días de julio y otra con los de agosto.
    const bloquesEmpresa: BloqueEmpresa[] = [...porEmpresa.values()]
      .sort((a, b) => a.anio - b.anio || a.mes - b.mes || a.empresa.localeCompare(b.empresa, 'es'))
      .map((b) => {
        const lineas = CODIGOS_RECARGO.map((codigo) => {
          const horas = b.horas.get(codigo) ?? 0;
          const vh = tarifaPorCodigo.get(codigo)?.valorHora ?? 0;
          return { codigo, nombre: NOMBRE_RECARGO[codigo], horas, valor: Math.round(horas * vh) };
        });
        const diasOrdenados = [...b.dias].sort((x, y) => x - y);
        return {
          empresaId: b.empresaId,
          empresa: b.empresa,
          color: colorDeCliente(b.empresaId),
          mes: b.mes,
          anio: b.anio,
          textoDias: textoDias(diasOrdenados, b.mes, b.anio),
          dias: diasOrdenados,
          lineas,
          totalHoras: lineas.reduce((s, l) => s + l.horas, 0),
          totalValor: lineas.reduce((s, l) => s + l.valor, 0),
        };
      });

    // ── Reparto desprendible / disponibilidad ──────────────────────────
    // El Excel separa las horas que se pagan como recargo en el desprendible
    // de las que se imputan a disponibilidad. El criterio es el día: si está
    // marcado como standby, sus horas van a disponibilidad.
    const repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[] = [];
    const repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[] = [];
    for (const codigo of CODIGOS_RECARGO) {
      let hDesp = 0;
      let hDisp = 0;
      for (const d of diasHoja) {
        const h = d.horas[codigo] ?? 0;
        if (!h) continue;
        if (d.disponibilidad) hDisp += h;
        else hDesp += h;
      }
      const vh = tarifaPorCodigo.get(codigo)?.valorHora ?? 0;
      repartoDesprendible.push({ codigo, horas: hDesp, valor: Math.round(hDesp * vh) });
      repartoDisponibilidad.push({ codigo, horas: hDisp, valor: Math.round(hDisp * vh) });
    }

    // Los `recargos` de la liquidación son AGREGADOS POR PLANILLA (un mes
    // entero), mientras que esta hoja los reconstruye día a día desde
    // `detalles_recargos_dias` y solo con los días de la ventana. Cuando las
    // dos cifras no coinciden hay algo que mirar, y es dinero: medido en
    // agosto de 2026, de 10,4 M en recargos había 2,75 M en recargos con días
    // fuera del 21→20 o colgados de planillas sin ningún día laboral.
    //
    // El canvas no lo corrige por su cuenta —no sabe cuál de las dos cifras
    // es la buena— pero tampoco lo esconde.
    //
    // Se compara contra `total_recargos` y NO contra la suma de las filas de
    // `recargos`: no todos los recargos son filas. Los que vienen del preview
    // se calculan al leer y solo quedan en ese total, así que sumar las filas
    // daba cero y avisaba de una diferencia que no existía.
    const recargosLiquidacion = dec(liquidacion?.total_recargos);
    const recargosCalculados = repartoDesprendible.reduce((sum, r) => sum + r.valor, 0);
    // Un peso arriba o abajo es redondeo; a partir de ahí es otra cosa.
    if (liquidacion && Math.abs(recargosLiquidacion - recargosCalculados) > 10) {
      const fmt = (n: number) => Math.round(n).toLocaleString('es-CO');
      avisos.push(
        `Los recargos de las planillas de este periodo suman ${fmt(recargosCalculados)}, ` +
          `pero la liquidación guardada tiene ${fmt(recargosLiquidacion)}. ` +
          'Suele ser un recargo cuyos días caen fuera del periodo, o uno colgado de una planilla sin días laborales.',
      );
    }

    // ── Desprendible ───────────────────────────────────────────────────
    const { devengos, deducciones, totales } = this.construirDesprendible({
      conductor,
      liquidacion,
      repartoDesprendible,
      repartoDisponibilidad,
      parametros,
      diasConPlanilla: diasHoja.length,
    });

    if (!dec(conductor.salario_base)) {
      avisos.push('El conductor no tiene salario base; el devengado sale en cero.');
    }
    if (!planillas.length) {
      avisos.push('No hay planillas de este conductor en el periodo.');
    }

    // Cuando la liquidación guardada cubre otras fechas que la ventana del
    // canvas, las cifras NO van a coincidir con lo que se pagó, y hay que
    // decirlo: el canvas reparte cada día en su periodo, mientras que los
    // `recargos` de la liquidación son agregados por planilla (mes entero).
    // Medido en agosto de 2026: 14 de 16 liquidaciones usan exactamente
    // 21→20 y cuadran al peso; las dos que no, difieren por esto.
    if (liquidacion) {
      const dia = (v: unknown) => String(v ?? '').slice(0, 10);
      const li = dia(liquidacion.periodo_start);
      const lf = dia(liquidacion.periodo_end);
      if (li && lf && (li !== ventanaCanvas.desde || lf !== ventanaCanvas.hasta)) {
        avisos.push(
          `La liquidación guardada cubre del ${li} al ${lf}, no del ${ventanaCanvas.desde} al ${ventanaCanvas.hasta}. ` +
            'Los recargos de esta hoja son los de la ventana del canvas, así que pueden no cuadrar con lo que se pagó.',
        );
      }
    }

    // Nombre de pestaña único: Univer no admite duplicados y hay homónimos.
    const base = `${conductor.nombre} ${conductor.apellido}`.trim().toUpperCase();
    let nombreHoja = base.slice(0, 28);
    let n = 2;
    while (nombresUsados.has(nombreHoja)) nombreHoja = `${base.slice(0, 25)} (${n++})`;
    nombresUsados.add(nombreHoja);

    // La leyenda lista SOLO los clientes de esta hoja, no los del periodo
    // entero: en una hoja con dos empresas, una leyenda de veinte no se lee.
    // El color sí es del periodo, así que comparar entre hojas sigue valiendo.
    const clientesHoja = new Map<string, ClienteNomina>();
    for (const d of diasHoja) {
      if (!d.empresaId || clientesHoja.has(d.empresaId)) continue;
      clientesHoja.set(d.empresaId, {
        id: d.empresaId,
        nombre: d.empresa ?? 'SIN EMPRESA',
        color: colorDeCliente(d.empresaId),
      });
    }
    const clientes = [...clientesHoja.values()].sort((a, b) =>
      a.nombre.localeCompare(b.nombre, 'es'),
    );

    return {
      conductorId: conductor.id,
      liquidacionId: liquidacion?.id ?? null,
      version: Number(liquidacion?.version ?? 1),
      // `estado_flujo` es el del canvas (BORRADOR/LIQUIDADA/…); `estado` es
      // el enum viejo de dos valores, que se mantiene sincronizado pero no
      // sirve para la barra de acciones.
      estado: String(liquidacion?.estado_flujo ?? 'BORRADOR'),
      nombre: base,
      cedula: conductor.numero_identificacion,
      cargo: conductor.cargo,
      nombreHoja,
      tipoVehiculo,
      placas: [...placas],
      dias: diasHoja,
      tarifas,
      bloquesEmpresa,
      salarioBasico,
      valorHora,
      horasMensualesBase,
      jornadaNormalHoras: dec(configGeneral?.jornada_normal_horas) || 10.33,
      jornadaFestivaHoras: dec(configGeneral?.jornada_festiva_horas) || 7.33,
      totalHorasMes: diasHoja.reduce((s, d) => s + d.totalHoras, 0),
      repartoDesprendible,
      repartoDisponibilidad,
      devengos,
      deducciones,
      totales,
      clientes,
      avisos: [...new Set(avisos)],
    };
  }

  /**
   * Las líneas del desprendible y sus totales.
   *
   * Las cantidades y los importes salen de la `liquidacion` cuando existe;
   * los recargos, del reparto que se acaba de calcular con las planillas. Eso
   * es el autocompletado: lo que antes se copiaba a mano del Excel a la app.
   */
  private static construirDesprendible(args: {
    conductor: { salario_base: unknown };
    liquidacion: any | null;
    repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[];
    repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[];
    parametros: ParametrosNomina;
    diasConPlanilla: number;
  }): {
    devengos: ConceptoDesprendible[];
    deducciones: ConceptoDesprendible[];
    totales: ReturnType<typeof liquidarNomina>;
  } {
    const { conductor, liquidacion: l, repartoDesprendible, repartoDisponibilidad, parametros } = args;
    const salarioBase = dec(conductor.salario_base);
    const diasLaborados = Number(l?.dias_laborados ?? args.diasConPlanilla) || 0;

    const totalRecargos = repartoDesprendible.reduce((s, r) => s + r.valor, 0);
    const totalDisponibilidad = repartoDisponibilidad.reduce((s, r) => s + r.valor, 0);

    const bonos = (l?.bonificaciones ?? []).map((b: any) => {
      // `values` es un string JSON con `[{ mes, quantity }]`.
      let values: { quantity: number }[] = [];
      try {
        const parsed = JSON.parse(b.values ?? '[]');
        if (Array.isArray(parsed)) values = parsed.map((v: any) => ({ quantity: dec(v?.quantity) }));
      } catch {
        values = [];
      }
      return { values, value: dec(b.value) };
    });
    const pernotes = (l?.pernotes ?? []).map((p: any) => ({
      cantidad: dec(p.cantidad),
      valor: dec(p.valor),
    }));
    const anticipos = (l?.anticipos ?? []).map((a: any) => ({ valor: dec(a.valor) }));

    // `conceptos_adicionales` es Json libre `[{ nombre, valor }]`. Aquí vive
    // también el AJUSTE A NETO PACTADO, que antes era una celda sin rótulo.
    let conceptosAdicionales: { nombre: string; valor: number }[] = [];
    if (Array.isArray(l?.conceptos_adicionales)) {
      conceptosAdicionales = (l.conceptos_adicionales as any[]).map((c) => ({
        nombre: String(c?.nombre ?? 'CONCEPTO ADICIONAL'),
        valor: dec(c?.valor),
      }));
    }

    const entrada: EntradaLiquidacion = {
      salarioBase,
      diasLaborados,
      diasLaboradosVillanueva: Number(l?.dias_laborados_villanueva ?? 0) || 0,
      detallesVehiculos: [
        { bonos, pernotes, recargos: [{ valor: totalRecargos, empresa_id: null }] },
      ],
      previewRecargosGrupos: [],
      anticipos,
      conceptosAdicionales,
      valorVacaciones: dec(l?.total_vacaciones),
      vacacionesInicio: l?.periodo_start_vacaciones ?? null,
      vacacionesFin: l?.periodo_end_vacaciones ?? null,
      interesCesantias: dec(l?.interes_cesantias),
      disponibilidad: totalDisponibilidad,
      descontarTransporte: !dec(l?.auxilio_transporte) && !!l,
      aplicaAjusteVillanueva: dec(l?.ajuste_salarial) > 0,
      ajusteVillanuevaPorDia: !!l?.ajuste_salarial_por_dia,
      aplicaAjusteParex: dec(l?.ajuste_parex) > 0,
      aplicaAjusteGeopark: dec(l?.ajuste_geopark) > 0,
      ajusteRecargosCompletos: !!l?.ajuste_parex_recargos_completos,
      aplicaIncapacidad: !!l?.periodo_start_incapacidad,
      diasAjusteDeducciones:
        l?.dias_ajuste_deducciones === null || l?.dias_ajuste_deducciones === undefined
          ? null
          : Number(l.dias_ajuste_deducciones),
      noDescontarSalud: false,
      noDescontarPension: false,
      descontarSaludSalario: !!l?.descontar_salud_salario,
      descontarPensionSalario: !!l?.descontar_pension_salario,
    };

    const totales = salarioBase || l ? liquidarNomina(entrada, parametros) : RESULTADO_VACIO;

    const devengos: ConceptoDesprendible[] = [
      { clave: 'salario', nombre: 'SALARIO', cantidad: diasLaborados, valor: totales.salarioDevengado, editable: true },
      { clave: 'vacaciones', nombre: 'VACACIONES', cantidad: null, valor: totales.totalVacaciones, editable: true },
      { clave: 'auxilio_transporte', nombre: 'AUXILIO DE TRANSPORTE', cantidad: diasLaborados, valor: totales.auxilioTransporte, editable: true },
      ...(totales.bonificacionVillanueva
        ? [{ clave: 'ajuste_salarial', nombre: 'BONO NIVELACION DE SALARIO', cantidad: entrada.diasLaboradosVillanueva, valor: totales.bonificacionVillanueva, editable: true }]
        : []),
      // OJO: la línea lleva `cantidad × valor`, no el valor unitario.
      // `bonificaciones.value` es el precio de UNA unidad y las cantidades
      // están en `values` (`[{ mes, quantity }]`), que es como las suma
      // `liquidarNomina`. Poner aquí `b.value` hacía que el desprendible
      // listara el precio unitario y su total no cuadrara con el neto.
      ...(l?.bonificaciones ?? []).map((b: any, i: number) => {
        let cantidad = 0;
        try {
          const parsed = JSON.parse(b.values ?? '[]');
          if (Array.isArray(parsed)) cantidad = parsed.reduce((s, v: any) => s + dec(v?.quantity), 0);
        } catch {
          cantidad = 0;
        }
        return {
          clave: `bono:${b.id ?? i}`,
          nombre: String(b.name ?? 'BONO').toUpperCase(),
          cantidad,
          valor: cantidad * dec(b.value),
          editable: true,
        };
      }),
      ...(l?.pernotes ?? []).map((p: any, i: number) => ({
        clave: `pernote:${p.id ?? i}`,
        nombre: 'PERNOTES',
        cantidad: dec(p.cantidad),
        valor: dec(p.cantidad) * dec(p.valor),
        editable: true,
      })),
      // Las siete filas de recargo, ya autocompletadas desde las planillas.
      ...repartoDesprendible.map((r) => ({
        clave: `recargo:${r.codigo}`,
        nombre: NOMBRE_RECARGO[r.codigo],
        cantidad: r.horas,
        valor: r.valor,
        editable: false,
      })),
      { clave: 'disponibilidad', nombre: 'DISPONIBILIDAD MES', cantidad: null, valor: totalDisponibilidad, editable: false },
      ...conceptosAdicionales.map((c, i) => ({
        clave: `adicional:${i}`,
        nombre: c.nombre.toUpperCase(),
        cantidad: null,
        valor: c.valor,
        editable: true,
      })),
    ];

    const deducciones: ConceptoDesprendible[] = [
      { clave: 'salud', nombre: 'SALUD', cantidad: null, valor: totales.salud, editable: false },
      { clave: 'pension', nombre: 'PENSION', cantidad: null, valor: totales.pension, editable: false },
      { clave: 'anticipos', nombre: 'ANTICIPOS', cantidad: null, valor: totales.totalAnticipos, editable: true },
    ];

    return { devengos, deducciones, totales };
  }
}
