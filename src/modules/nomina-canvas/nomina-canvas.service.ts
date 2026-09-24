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
  textoRangoFechas,
  CORTE_DEFECTO,
  type DiaPeriodo,
  expandirDias,
} from '../../lib/nomina/periodo';
import { vigenteEn, tramosPorClave } from '../../lib/nomina/vigencias';
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
  colorDePlaca,
  type ClienteNomina,
  type PlacaNomina,
  type PlacaBono,
  type MatrizBonos,
  type BloqueEmpresa,
  type CodigoRecargo,
  type ConceptoDesprendible,
  type DiaHoja,
  type HojaNomina,
  type NominaPeriodoDTO,
  type TarifaRecargo,
  type TramoVigencia,
  type VacacionesHoja,
  type BaseSalarial,
} from './nomina-canvas.types';

/**
 * Un bono marcado en el canvas de RECORRIDOS, ya aplanado.
 *
 * Una marca por tramo: la cantidad del periodo es el número de estas filas,
 * no un campo. El nombre viene de `configuraciones_liquidacion` porque es lo
 * único con lo que se puede casar contra `bonificaciones`, que no guarda a qué
 * configuración pertenece cada bono que paga.
 */
interface BonoRecorrido {
  vehiculoId: string | null;
  nombre: string;
  valor: number;
  /** `YYYY-MM` del día en que se marcó: es la subcolumna donde cae. */
  mes: string;
}

const MESES_LARGO = [
  'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

/**
 * Etiqueta de cada trozo del corte: `21 AL 31 DE AGOSTO DE 2026`.
 *
 * El desprendible lista los bonos y los pernotes POR SUBPERIODO, con sus fechas
 * escritas, que es como los leen quienes vienen de los Excel: un corte 21→20
 * cruza dos meses y «12 bonos» no dice cuántos cayeron en cada uno. La cantidad
 * ya se guarda así en `bonificaciones.values`; esto solo le pone nombre.
 */
function etiquetasDeSubperiodo(desde: string, hasta: string): Map<string, string> {
  const salida = new Map<string, string>();
  const [aD, mD, dD] = desde.split('-').map(Number);
  const [aH, mH, dH] = hasta.split('-').map(Number);
  const mesDe = (a: number, m: number) => `${a}-${String(m).padStart(2, '0')}`;

  if (aD === aH && mD === mH) {
    salida.set(mesDe(aD, mD), `${dD} AL ${dH} DE ${MESES_LARGO[mD - 1]} DE ${aD}`);
    return salida;
  }
  /// Último día del primer mes: el día 0 del siguiente.
  const finPrimero = new Date(Date.UTC(aD, mD, 0)).getUTCDate();
  salida.set(mesDe(aD, mD), `${dD} AL ${finPrimero} DE ${MESES_LARGO[mD - 1]} DE ${aD}`);
  salida.set(mesDe(aH, mH), `01 AL ${dH} DE ${MESES_LARGO[mH - 1]} DE ${aH}`);
  return salida;
}

/**
 * Días de un mes comercial. Es la base sobre la que se prorratea el sueldo y el
 * auxilio (`salario / 30 * días`), y el valor con el que nace un borrador.
 */
const DIAS_MES_COMERCIAL = 30;

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

/**
 * Horas con dos decimales.
 *
 * Las horas se acumulan sumando decimales (1.67 + 4.67 + 3.34…) y en coma
 * flotante eso arrastra basura: 43,71 sale como `43.71000000000001` y se
 * imprimía tal cual en el desprendible, porque esa cifra viaja como CANTIDAD y
 * no como texto formateado. Se corta en el DTO y no en cada vista: la misma
 * cifra la pintan el canvas, el PDF, el Excel y el snapshot, y redondear en
 * cuatro sitios es garantizar que uno se quede sin redondear.
 *
 * Dos decimales porque es la precisión con la que se registran las jornadas
 * (media hora, un cuarto de hora); no se pierde nada real.
 */
const horas2 = (n: number): number => Math.round(n * 100) / 100;

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
  /**
   * Ignora la COPIA de días y deriva todo de las planillas.
   *
   * Lo usa «Actualizar días»: sin esto, el refresco lee la copia que va a
   * reemplazar y se copia a sí misma —un no-op silencioso que parece que el
   * botón no hace nada—. Es una lectura, no un modo: no borra la copia, solo
   * no la mira.
   */
  ignorarCopia?: boolean;
  /**
   * Incluye también a quien NO tiene marcado `conductores.nomina`.
   *
   * El canvas NO lo usa: su libro es la nómina del periodo y meter ahí una
   * hoja por cada conductor de la empresa lo haría ilegible. Lo usa la lista
   * previa de «Generar borradores», donde la pregunta es otra —«¿a quién puedo
   * generarle?»— y esconder a un conductor que trabajó porque tiene un flag a
   * `false` obliga a ir a editarlo a otra pantalla para poder pagarle.
   *
   * El flag está desactualizado en la práctica: en cotransmeq había 15
   * conductores no inactivos con `nomina = false`, 14 de ellos con planillas
   * del año y dos con liquidaciones ya hechas.
   */
  incluirFueraDeNomina?: boolean;
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

    const [
      conductores,
      planillas,
      tipos,
      configsSalario,
      configsLiq,
      liquidaciones,
      diasPropios,
      ajustesHoras,
      bonosRecorrido,
    ] = await Promise.all([
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
            /**
             * El flag solo filtra cuando NADIE ha nombrado a los conductores.
             *
             * Pedir ids explícitos ya es la decisión de incluirlos: si aquí se
             * siguiera exigiendo `nomina`, un conductor seleccionado a mano en
             * «Generar borradores» no traería hoja, y el generador lo daría por
             * «omitido» sin decir por qué. `incluirFueraDeNomina` abre lo mismo
             * para el LISTADO previo, que necesita enseñar a quién se puede
             * generar antes de que nadie haya elegido.
             */
            ...(opts.incluirFueraDeNomina || opts.conductorIds?.length ? {} : { nomina: true }),
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
            /// Para que el modal de envío pueda decir QUIÉN no tiene correo
            /// antes de encolar el lote, en vez de descubrirlo cuando el envío
            /// falla y hay que ir a buscar el fallo en la bitácora.
            email: true,
            /// Para que la lista previa pueda MARCAR a quien está fuera de
            /// nómina en vez de esconderlo o de mezclarlo con el resto.
            nomina: true,
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

        // Tipos que SOLAPAN el periodo, no los vigentes a su cierre.
        //
        // El corte 21→20 cruza cualquier cambio que entre en vigor a mitad de
        // mes, y el del 15-jul-2026 (Ley 2466) lo hace: RD 80→90, HEFD
        // 105→115, HEFN 155→165, RNDF 115→125. Pidiendo solo lo vigente al
        // cierre se traía una única tarifa y se aplicaba también a los días
        // de junio. Ahora vienen las dos y cada día resuelve la suya.
        prisma.tipos_recargos.findMany({
          where: {
            activo: true,
            deleted_at: null,
            vigencia_desde: { lte: fechaFin },
            OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaInicio } }],
          },
          select: { codigo: true, porcentaje: true, vigencia_desde: true, vigencia_hasta: true },
          orderBy: { vigencia_desde: 'desc' },
        }),

        // Igual que arriba, y aquí importa todavía más: el 15-jul-2026 no
        // cambiaron solo los porcentajes, cambió `horas_mensuales_base` de
        // 220 a 210. Como es el divisor del valor hora, a partir de esa fecha
        // TODOS los códigos valen distinto, incluidos RN, HED y HEN, que no
        // tocaron su porcentaje.
        prisma.configuraciones_salarios.findMany({
          where: {
            activo: true,
            deleted_at: null,
            vigencia_desde: { lte: fechaFin },
            OR: [{ vigencia_hasta: null }, { vigencia_hasta: { gte: fechaInicio } }],
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

        // La COPIA de días de cada liquidación del periodo. Cuando existe,
        // sustituye por completo a lo que dicen las planillas: el borrador es
        // editable y no se valida contra el documento de origen.
        opts.ignorarCopia
          ? Promise.resolve([] as any[])
          : prisma.liquidaciones_dias.findMany({
          where: {
            deleted_at: null,
            liquidacion: {
              deleted_at: null,
              periodo_start: { lte: hastaISO },
              periodo_end: { gte: desdeISO },
              ...(opts.conductorIds?.length ? { conductor_id: { in: opts.conductorIds } } : {}),
            },
          },
          orderBy: [{ fecha: 'asc' }, { ocurrencia: 'asc' }],
        }),

        // Horas de recargo corregidas a mano. Se traen del periodo entero y
        // se reparten por liquidación, igual que los bonos: una consulta por
        // hoja serían 27 en un corte normal.
        prisma.ajustes_horas_recargo.findMany({
          where: {
            deleted_at: null,
            liquidacion: {
              deleted_at: null,
              periodo_start: { lte: hastaISO },
              periodo_end: { gte: desdeISO },
              ...(opts.conductorIds?.length ? { conductor_id: { in: opts.conductorIds } } : {}),
            },
          },
          select: { liquidacion_id: true, codigo: true, tramo: true, horas: true },
        }),

        // Los bonos MARCADOS EN EL CANVAS DE RECORRIDOS, que son otra tabla y
        // otra historia: `bonificaciones` es lo que la liquidación paga y esto
        // es lo que se registró tramo a tramo. No hay puente automático entre
        // las dos, así que el canvas las enseña juntas y señala dónde no
        // coinciden.
        //
        // El `deleted_at` del propio bono no basta: un tramo retirado deja sus
        // bonos vivos —el soft-delete no cascadea—, así que hace falta mirar
        // también el del segmento. Se trae la columna y se filtra en memoria
        // porque un `segmento: { deleted_at: null }` en el `where` descartaría
        // además los bonos SIN segmento, que son los de días sin recorridos.
        prisma.registro_dia_laboral_bono.findMany({
          where: {
            deleted_at: null,
            registro_dia: {
              deleted_at: null,
              fecha: { gte: fechaInicio, lte: fechaFin },
              ...(opts.conductorIds?.length
                ? { conductor_id: { in: opts.conductorIds } }
                : {}),
            },
          },
          select: {
            valor: true,
            registro_dia: { select: { conductor_id: true, fecha: true } },
            segmento: { select: { vehiculo_id: true, deleted_at: true } },
            config_liquidacion: { select: { nombre: true, valor: true } },
          },
        }),
      ]);

    /**
     * `empresa_id → nombre`, sacado de TODAS las planillas del periodo.
     *
     * Hace falta para los días que vienen de la copia: la copia guarda el id
     * del cliente pero no su nombre, y el nombre lo pinta la hoja. Se toma de
     * las planillas —que es de donde salió el día— en vez de consultar
     * `clientes`: una consulta más por algo que ya está en memoria.
     */
    const nombreCliente = new Map<string, string>();
    for (const p of planillas) {
      if (p.empresa_id && p.clientes?.nombre) nombreCliente.set(p.empresa_id, p.clientes.nombre);
    }

    /** `liquidacion_id → sus días propios`. */
    const diasPropiosPorLiquidacion = new Map<string, typeof diasPropios>();
    for (const d of diasPropios) {
      const lista = diasPropiosPorLiquidacion.get(d.liquidacion_id) ?? [];
      lista.push(d);
      diasPropiosPorLiquidacion.set(d.liquidacion_id, lista);
    }

    /**
     * Nombre de las empresas con configuración salarial propia.
     *
     * `configuraciones_salarios` guarda el `empresa_id` pero no el nombre, y en
     * la tabla de tarifas una columna rotulada con un UUID no dice nada.
     */
    const idsConConfig = [...new Set(configsSalario.map((c) => c.empresa_id).filter(Boolean))] as string[];
    const nombreEmpresa = new Map<string, string>();
    if (idsConConfig.length) {
      const empresas = await prisma.clientes.findMany({
        where: { id: { in: idsConConfig } },
        select: { id: true, nombre: true },
      });
      for (const e of empresas) nombreEmpresa.set(e.id, String(e.nombre ?? '').trim() || 'EMPRESA');
    }

    /// `liquidacion_id → { "tramo|codigo" → horas }`.
    const ajustesPorLiquidacion = new Map<string, Map<string, number>>();
    for (const a of ajustesHoras) {
      const m = ajustesPorLiquidacion.get(a.liquidacion_id) ?? new Map<string, number>();
      m.set(`${a.tramo}|${a.codigo}`, dec(a.horas));
      ajustesPorLiquidacion.set(a.liquidacion_id, m);
    }

    // ── Bonos de recorridos, agrupados por conductor ───────────────────
    //
    // El `valor` del bono es el que tenía la config AL MARCARLO; si falta se
    // cae al de la config vigente. El precio unitario que se enseña sigue
    // siendo el de la liquidación cuando el bono existe en las dos fuentes:
    // aquí solo hace falta para las filas que únicamente están en recorridos.
    const bonosRecorridoPorConductor = new Map<string, BonoRecorrido[]>();
    let bonosDeTramoRetirado = 0;
    for (const b of bonosRecorrido) {
      if (b.segmento?.deleted_at) {
        bonosDeTramoRetirado++;
        continue;
      }
      const conductorId = b.registro_dia?.conductor_id;
      if (!conductorId) continue;
      const lista = bonosRecorridoPorConductor.get(conductorId) ?? [];
      /// `fecha` es `@db.Date`, así que el ISO ya viene en UTC a medianoche y
      /// los diez primeros caracteres son el día tal cual se guardó. Construir
      /// el mes con `getMonth()` lo correría un día en zonas al oeste de UTC.
      const iso = b.registro_dia.fecha.toISOString().slice(0, 7);
      lista.push({
        vehiculoId: b.segmento?.vehiculo_id ?? null,
        nombre: String(b.config_liquidacion?.nombre ?? 'BONO'),
        valor: dec(b.valor ?? b.config_liquidacion?.valor),
        mes: iso,
      });
      bonosRecorridoPorConductor.set(conductorId, lista);
    }
    if (bonosDeTramoRetirado > 0) {
      avisos.push(
        `${bonosDeTramoRetirado} bono(s) de recorridos cuelgan de un tramo retirado y no se contaron.`,
      );
    }

    // ── Tramos de vigencia del corte ───────────────────────────────────
    //
    // Se resuelve la configuración DÍA A DÍA y después se agrupan los días
    // consecutivos que comparten tarifa. Casi siempre sale un tramo; salen
    // dos cuando el corte cruza un cambio de vigencia, y entonces el bloque
    // de tarifas de la hoja se parte en dos sub-tablas en vez de mentir con
    // una sola.
    //
    // La config por empresa se sigue ignorando —el canvas siempre ha usado la
    // general— pero ahora la general se busca dentro de las vigentes ESE día,
    // no entre todas.
    const tiposPorCodigo = new Map<string, (typeof tipos)[number][]>();
    for (const t of tipos) {
      const lista = tiposPorCodigo.get(t.codigo) ?? [];
      lista.push(t);
      tiposPorCodigo.set(t.codigo, lista);
    }

    const porcentajeEn = (codigo: string, fecha: string): number | null => {
      const fila = vigenteEn(tiposPorCodigo.get(codigo) ?? [], fecha);
      return fila ? dec(fila.porcentaje) : null;
    };
    const configEn = (fecha: string) => {
      const delDia = configsSalario.filter(
        (c) => vigenteEn([c], fecha) !== null,
      );
      return delDia.find((c) => !c.empresa_id) ?? delDia[0] ?? null;
    };

    const fechasCalendario = calendario.map((d) => d.fecha);
    const cortes = tramosPorClave(fechasCalendario, (f) => {
      const cfg = configEn(f);
      const pcts = CODIGOS_RECARGO.map((c) => porcentajeEn(c, f) ?? 'x').join(',');
      return `${cfg?.id ?? '-'}|${pcts}`;
    });

    const tramos: TramoVigencia[] = cortes.map((t) => {
      const cfg = configEn(t.desde);
      const salarioBasico = dec(cfg?.salario_basico);
      const horasMensualesBase = Number(cfg?.horas_mensuales_base ?? 240) || 240;
      const valorHora = horasMensualesBase ? salarioBasico / horasMensualesBase : 0;

      /// La general primero —es la que usa la liquidación— y después las de
      /// empresa, por nombre para que el orden de las columnas no dependa de
      /// en qué orden respondió la base.
      const delTramo = configsSalario.filter((c) => vigenteEn([c], t.desde) !== null);
      const bases: BaseSalarial[] = [
        { empresaId: null, nombre: 'BÁSICO', salarioBasico, valorHora },
      ];
      for (const c of delTramo.filter((x) => x.empresa_id)) {
        const sb = dec(c.salario_basico);
        const hb = Number(c.horas_mensuales_base ?? horasMensualesBase) || horasMensualesBase;
        bases.push({
          empresaId: c.empresa_id,
          nombre: nombreEmpresa.get(c.empresa_id!) ?? 'EMPRESA',
          salarioBasico: sb,
          valorHora: hb ? sb / hb : 0,
        });
      }
      bases.sort((a, b) =>
        a.empresaId === null ? -1 : b.empresaId === null ? 1 : a.nombre.localeCompare(b.nombre, 'es'),
      );

      return {
        desde: t.desde,
        hasta: t.hasta,
        etiqueta: textoRangoFechas(t.desde, t.hasta),
        salarioBasico,
        horasMensualesBase,
        valorHora,
        jornadaNormalHoras: dec(cfg?.jornada_normal_horas) || 10.33,
        jornadaFestivaHoras: dec(cfg?.jornada_festiva_horas) || 7.33,
        bases,
      };
    });
    /** `fecha ISO → índice dentro de `tramos``. */
    const tramoPorFecha = new Map<string, number>();
    cortes.forEach((t, i) => t.fechas.forEach((f) => tramoPorFecha.set(f, i)));
    /** `índice de tramo → código → %`. */
    const porcentajesPorTramo = cortes.map((t) => {
      const m = new Map<CodigoRecargo, number>();
      for (const c of CODIGOS_RECARGO) {
        const p = porcentajeEn(c, t.desde);
        if (p !== null) m.set(c, p);
      }
      return m;
    });

    for (const [i, t] of cortes.entries()) {
      for (const c of CODIGOS_RECARGO) {
        if (!porcentajesPorTramo[i].has(c)) {
          avisos.push(`No hay tarifa vigente para el recargo ${c} entre el ${t.desde} y el ${t.hasta}.`);
        }
      }
      if (!configEn(t.desde)) {
        avisos.push(`No hay configuración salarial vigente entre el ${t.desde} y el ${t.hasta}.`);
      }
    }
    if (tramos.length > 1) {
      avisos.push(
        `El corte cruza ${tramos.length - 1} cambio(s) de vigencia: ` +
          tramos.map((t) => `${t.etiqueta} (${t.horasMensualesBase} h base)`).join(' · ') +
          '. Cada día se valora con la tarifa de su fecha.',
      );
    }

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
        bonosRecorrido: bonosRecorridoPorConductor.get(c.id) ?? [],
        diasPropios:
          diasPropiosPorLiquidacion.get(liquidacionPorConductor.get(c.id)?.id ?? '') ?? [],
        nombreCliente,
        ajustesHoras:
          ajustesPorLiquidacion.get(liquidacionPorConductor.get(c.id)?.id ?? '') ?? new Map(),
        /// Los meses que cruza el corte, que son las subcolumnas de la matriz
        /// de bonos. Salen del periodo y no de los bonos guardados: un mes sin
        /// ninguno necesita su columna igual para poder escribir en ella.
        mesesCorte: ventana.map((v) => `${v.anio}-${String(v.mes).padStart(2, '0')}`),
        columnasPorFecha,
        totalDias: dias.length,
        ventanaCanvas: { desde: primera.fecha, hasta: ultima.fecha },
        tramos,
        tramoPorFecha,
        porcentajesPorTramo,
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
      email?: string | null;
      /// `conductores.nomina`. Solo lo mira la lista previa de «Generar
      /// borradores», para rotular a quien trabaja sin estar marcado.
      nomina?: boolean;
    };
    planillas: any[];
    liquidacion: any | null;
    /** Bonos marcados en el canvas de recorridos para ESTE conductor. */
    bonosRecorrido: BonoRecorrido[];
    /** La copia de días de la liquidación. Vacía mientras no se haya hecho. */
    diasPropios: any[];
    /** `empresa_id → nombre`, para los días que vienen de la copia. */
    nombreCliente: Map<string, string>;
    /** Horas corregidas a mano: `"tramo|codigo" → horas`. */
    ajustesHoras: Map<string, number>;
    /** Meses `YYYY-MM` que cruza el corte, en orden. */
    mesesCorte: string[];
    columnasPorFecha: Map<string, DiaPeriodo[]>;
    totalDias: number;
    ventanaCanvas: { desde: string; hasta: string };
    tramos: TramoVigencia[];
    tramoPorFecha: Map<string, number>;
    porcentajesPorTramo: Map<CodigoRecargo, number>[];
    parametros: ParametrosNomina;
    nombresUsados: Set<string>;
  }): HojaNomina {
    const {
      conductor,
      planillas,
      liquidacion,
      bonosRecorrido,
      diasPropios,
      nombreCliente,
      ajustesHoras,
      mesesCorte,
      columnasPorFecha,
      ventanaCanvas,
      tramos,
      tramoPorFecha,
      porcentajesPorTramo,
      parametros,
      nombresUsados,
    } = args;
    const avisos: string[] = [];

    // El último tramo es el vigente al cierre: es lo que se expone en los
    // campos sueltos de la hoja, que necesitan un solo número. El DINERO no
    // sale de aquí — sale de `tarifaEn()`, que resuelve por fecha.
    const tramoCierre = tramos[tramos.length - 1] ?? {
      desde: ventanaCanvas.desde,
      hasta: ventanaCanvas.hasta,
      etiqueta: '',
      salarioBasico: 0,
      horasMensualesBase: 240,
      valorHora: 0,
      jornadaNormalHoras: 10.33,
      jornadaFestivaHoras: 7.33,
    };
    const salarioBasico = tramoCierre.salarioBasico;
    const horasMensualesBase = tramoCierre.horasMensualesBase;
    const valorHora = tramoCierre.valorHora;

    /** Índice de tramo de una fecha del corte. */
    const indiceTramo = (fecha: string): number =>
      tramoPorFecha.get(fecha) ?? Math.max(0, tramos.length - 1);
    /** Lo que vale una hora de `codigo` trabajada el día `fecha`. */
    const tarifaEn = (fecha: string, codigo: CodigoRecargo): number => {
      const i = indiceTramo(fecha);
      const t = tramos[i] ?? tramoCierre;
      return valorHoraDeRecargo(t.valorHora, codigo, porcentajesPorTramo[i]?.get(codigo) ?? 0);
    };

    // ── Días ───────────────────────────────────────────────────────────
    // Se indexan por fecha, no por posición: una planilla de julio y otra de
    // agosto aportan días al mismo periodo y hay que mezclarlas.
    const porIndice = new Map<number, DiaHoja>();
    /**
     * `empresaId|mes|codigo → { dias, horas, valores }` para el desglose por
     * empresa.
     *
     * `valores` se acumula AQUÍ, día a día, y no al cerrar el bloque: los días
     * de un mismo bloque pueden caer a un lado y a otro de un cambio de
     * vigencia —INDEPENDENCE DRILLING, del 2 al 20 de julio de 2026, cruza el
     * día 15— y multiplicar las horas del bloque por una única tarifa pagaba
     * los días viejos a precio nuevo.
     */
    const porEmpresa = new Map<
      string,
      { empresaId: string; empresa: string; mes: number; anio: number; dias: Set<number>; horas: Map<CodigoRecargo, number>; valores: Map<CodigoRecargo, number>; diasPorTipo: Map<CodigoRecargo, Set<number>> }
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
            dias: new Set(), horas: new Map(), valores: new Map(), diasPorTipo: new Map(),
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
          horas[cod] = horas2((horas[cod] ?? 0) + h);

          bloque.horas.set(cod, (bloque.horas.get(cod) ?? 0) + h);
          // La tarifa es la del día que se está recorriendo, no la del cierre.
          bloque.valores.set(cod, (bloque.valores.get(cod) ?? 0) + h * tarifaEn(fecha, cod));
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
            existente.horas[cod] = horas2((existente.horas[cod] ?? 0) + (v ?? 0));
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
          /// La placa sale de la planilla de ESE día, no del conjunto de la
          /// hoja: un conductor que rota de vehículo tiene una distinta cada
          /// semana y el agregado no permite saber cuál tocaba cada día.
          placa: p.vehiculos?.placa ?? null,
          vehiculoId: p.vehiculo_id ?? null,
          placaColor: p.vehiculos?.placa ? colorDePlaca(p.vehiculos.placa) : null,
          /// Derivado de la planilla mientras no haya copia propia.
          propio: false,
        });
      }
    }

    /**
     * LA COPIA MANDA sobre las planillas.
     *
     * Si la liquidación tiene días propios se usan esos y lo derivado se
     * descarta entero, sin mezclar: mezclar dejaría medio borrador editable y
     * medio no, y nadie sabría cuál es cuál. Cuando la copia está vacía —toda
     * liquidación anterior a esto, y las hojas sin borrador— se sigue
     * derivando como siempre.
     *
     * `indice` se recalcula contra la rejilla de columnas del periodo, no se
     * guarda: la rejilla es global al libro y cambia cuando OTRO conductor
     * abre una columna nueva. Un índice guardado apuntaría a la columna
     * equivocada en cuanto eso pasara.
     */
    const diasHoja: DiaHoja[] = diasPropios.length
      ? diasPropios
          .map((d: any) => {
            const fecha = d.fecha.toISOString().slice(0, 10);
            const columnas = columnasPorFecha.get(fecha) ?? [];
            const col = columnas[d.ocurrencia] ?? columnas[0];
            if (!col) return null;
            const horas = (d.horas ?? {}) as Record<string, number>;
            const empresa = d.empresa_id ? (nombreCliente.get(d.empresa_id) ?? 'SIN EMPRESA') : null;
            return {
              indice: col.indice,
              fecha,
              ocurrencia: d.ocurrencia,
              horaInicio: decOrNull(d.hora_inicio),
              horaFin: decOrNull(d.hora_fin),
              totalHoras: dec(d.total_horas),
              esFestivo: !!d.es_festivo,
              esDomingo: !!d.es_domingo,
              disponibilidad: !!d.disponibilidad,
              pernocte: !!d.pernocte,
              continuaSiguienteDia: !!d.continua_siguiente_dia,
              horas: Object.fromEntries(
                CODIGOS_RECARGO.filter((c) => dec(horas[c])).map((c) => [c, dec(horas[c])]),
              ) as Partial<Record<CodigoRecargo, number>>,
              empresa,
              empresaId: d.empresa_id ?? null,
              empresaColor: d.empresa_id ? colorDeCliente(d.empresa_id) : null,
              placa: d.placa ?? null,
              vehiculoId: d.vehiculo_id ?? null,
              placaColor: d.placa ? colorDePlaca(d.placa) : null,
              propio: true,
            } as DiaHoja;
          })
          .filter((d): d is DiaHoja => d !== null)
          .sort((a, b) => a.indice - b.indice)
      : [...porIndice.values()].sort((a, b) => a.indice - b.indice);

    /// Placa → vehículo, que es el sentido contrario al de
    /// `placaPorVehiculoId` (declarado más abajo, de ahí que se recorran las
    /// planillas otra vez y no se invierta aquél). Hace falta porque la matriz
    /// de bonos ahora se EDITA: la celda tiene que saber a qué vehículo
    /// pertenece la fila de `bonificaciones` que escribe, y la placa es un
    /// rótulo, no una clave.
    const vehiculoIdPorPlaca = new Map<string, string>();
    for (const p of planillas) {
      const placa = p.vehiculos?.placa;
      if (p.vehiculo_id && placa && !vehiculoIdPorPlaca.has(placa)) {
        vehiculoIdPorPlaca.set(placa, p.vehiculo_id);
      }
    }
    const placasUsadas: PlacaBono[] = [...placas].map((placa) => ({
      placa,
      color: colorDePlaca(placa),
      vehiculoId: vehiculoIdPorPlaca.get(placa) ?? null,
    }));
    /// `bonificaciones` apunta al vehículo por id, no por placa. El índice sale
    /// de las propias planillas del conductor: son los mismos vehículos.
    const placaPorVehiculoId = new Map<string, string>();
    for (const p of planillas) {
      if (p.vehiculo_id && p.vehiculos?.placa) placaPorVehiculoId.set(p.vehiculo_id, p.vehiculos.placa);
    }

    // ── Tarifas y acumulado por tipo ───────────────────────────────────
    //
    // Las horas se acumulan POR TRAMO DE VIGENCIA, no en un solo montón: con
    // un corte que cruza el 15-jul-2026 hacen falta dos filas de RD —7,33 h
    // al 80 % y 6 h al 90 %— porque una sola no puede decir la verdad sobre
    // las dos. Con un tramo único, que es lo normal, salen las siete filas de
    // siempre y la tabla se ve igual que antes.
    const horasPorTramo = tramos.map(() => new Map<CodigoRecargo, number>());
    for (const d of diasHoja) {
      const i = indiceTramo(d.fecha);
      const acum = horasPorTramo[i] ?? horasPorTramo[horasPorTramo.length - 1];
      if (!acum) continue;
      for (const [k, v] of Object.entries(d.horas)) {
        const cod = k as CodigoRecargo;
        acum.set(cod, (acum.get(cod) ?? 0) + (v ?? 0));
      }
    }

    const tarifas: TarifaRecargo[] = tramos.flatMap((t, i) =>
      CODIGOS_RECARGO.map((codigo) => {
        const porcentaje = porcentajesPorTramo[i]?.get(codigo) ?? 0;
        const vh = valorHoraDeRecargo(t.valorHora, codigo, porcentaje);
        const horasPlanilla = horas2(horasPorTramo[i]?.get(codigo) ?? 0);
        /// El ajuste REEMPLAZA a la planilla, no se suma: quien lo escribe está
        /// diciendo cuántas horas se pagan, no cuántas añadir.
        const ajuste = ajustesHoras.get(`${i}|${codigo}`);
        const ajustada = ajuste !== undefined;
        const horas = ajustada ? horas2(ajuste) : horasPlanilla;
        /// El mismo recargo sobre cada base del tramo. `valorHoraDeRecargo` es
        /// quien sabe que un RECARGO es solo el % y una HORA EXTRA es 1 + %;
        /// repetir esa regla aquí sería duplicarla.
        const valorHoraPorBase = t.bases.map((b) =>
          valorHoraDeRecargo(b.valorHora, codigo, porcentaje),
        );
        return {
          codigo,
          nombre: NOMBRE_RECARGO[codigo],
          color: COLOR_RECARGO[codigo],
          porcentaje,
          valorHora: vh,
          valorHoraPorBase,
          valorPorBase: valorHoraPorBase.map((v) => Math.round(horas * v)),
          horas,
          horasPlanilla,
          ajustada,
          valor: Math.round(horas * vh),
          tramo: i,
        };
      }),
    );

    // ── Bloques por empresa ────────────────────────────────────────────
    // Uno por (empresa, mes), como en el Excel: FEPCO aparece dos veces, una
    // con los días de julio y otra con los de agosto.
    const bloquesEmpresa: BloqueEmpresa[] = [...porEmpresa.values()]
      .sort((a, b) => a.anio - b.anio || a.mes - b.mes || a.empresa.localeCompare(b.empresa, 'es'))
      .map((b) => {
        const lineas = CODIGOS_RECARGO.map((codigo) => {
          const horas = horas2(b.horas.get(codigo) ?? 0);
          // Ya viene sumado día a día con la tarifa de cada fecha.
          return {
            codigo,
            nombre: NOMBRE_RECARGO[codigo],
            horas,
            valor: Math.round(b.valores.get(codigo) ?? 0),
          };
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
          totalHoras: horas2(lineas.reduce((s, l) => s + l.horas, 0)),
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
      let vDesp = 0;
      let vDisp = 0;
      for (const d of diasHoja) {
        const h = d.horas[codigo] ?? 0;
        if (!h) continue;
        // Cada columna es una fecha, y por tanto un tramo: la tarifa sale de
        // ahí. Sumar las horas primero y multiplicar después por una tarifa
        // única era lo que pagaba junio a precio de julio.
        const v = h * tarifaEn(d.fecha, codigo);
        if (d.disponibilidad) {
          hDisp += h;
          vDisp += v;
        } else {
          hDesp += h;
          vDesp += v;
        }
      }
      repartoDesprendible.push({ codigo, horas: horas2(hDesp), valor: Math.round(vDesp) });
      repartoDisponibilidad.push({ codigo, horas: horas2(hDisp), valor: Math.round(vDisp) });
    }

    /**
     * Las horas corregidas a mano tienen que llegar AL DINERO, no solo a la
     * tabla de tarifas.
     *
     * `repartoDesprendible` se calcula día a día —es lo que permite valorar
     * cada fecha con la tarifa de SU tramo— mientras que el ajuste es un
     * agregado por código y tramo. Sin este paso, el canvas enseñaría 32 horas
     * en la tabla de recargos y seguiría pagando 30: exactamente la clase de
     * mentira que el bloque de ajustes existe para evitar.
     *
     * La diferencia se aplica al DESPRENDIBLE y no a disponibilidad porque lo
     * que alguien corrige es lo que se paga; «disponibilidad» es una propiedad
     * del día (standby) y un agregado no sabe a qué día tocarla. Si el ajuste
     * dejara las horas pagadas en negativo se queda en cero: no existe pagar
     * horas negativas, y es mejor un cero visible que un importe que resta.
     */
    if (ajustesHoras.size) {
      const tarifaPorClave = new Map(tarifas.map((x) => [`${x.tramo}|${x.codigo}`, x]));
      for (const [clave, horasAjustadas] of ajustesHoras) {
        const tarifa = tarifaPorClave.get(clave);
        if (!tarifa) continue;
        const [tramoStr, codigo] = clave.split('|');
        const iTramo = Number(tramoStr);
        const planilla = horas2(horasPorTramo[iTramo]?.get(codigo as CodigoRecargo) ?? 0);
        const delta = horas2(horasAjustadas) - planilla;
        if (!delta) continue;
        const fila = repartoDesprendible.find((r) => r.codigo === codigo);
        if (!fila) continue;
        const horas = Math.max(0, horas2(fila.horas + delta));
        fila.valor = Math.round(fila.valor + (horas - fila.horas) * tarifa.valorHora);
        fila.horas = horas;
      }
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
      /// Con horas ajustadas a mano la diferencia es ESPERADA —la acaba de
      /// causar quien las corrigió— y el texto de siempre («suele ser un
      /// recargo cuyos días caen fuera del periodo») mandaría a investigar algo
      /// que no ha pasado.
      avisos.push(
        ajustesHoras.size
          ? `Los recargos de este periodo suman ${fmt(recargosCalculados)} con las horas ajustadas a mano, ` +
              `y la liquidación guardada tiene ${fmt(recargosLiquidacion)}. ` +
              'El total guardado no se reescribe solo: sigue siendo el de las planillas.'
          : `Los recargos de las planillas de este periodo suman ${fmt(recargosCalculados)}, ` +
              `pero la liquidación guardada tiene ${fmt(recargosLiquidacion)}. ` +
              'Suele ser un recargo cuyos días caen fuera del periodo, o uno colgado de una planilla sin días laborales.',
      );
    }

    // ── Desprendible ───────────────────────────────────────────────────
    const { devengos, deducciones, totales, vacaciones } = this.construirDesprendible({
      conductor,
      liquidacion,
      repartoDesprendible,
      repartoDisponibilidad,
      parametros,
      diasConPlanilla: diasHoja.length,
      subperiodos: etiquetasDeSubperiodo(ventanaCanvas.desde, ventanaCanvas.hasta),
      bonosRecorrido,
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
      correo: conductor.email ?? null,
      /// Viaja para que la lista previa pueda rotular a quien está fuera de
      /// nómina. El canvas no lo mira: allí todas las hojas ya son de nómina.
      enNomina: conductor.nomina !== false,
      cargo: conductor.cargo,
      nombreHoja,
      tipoVehiculo,
      placas: [...placas],
      placasUsadas,
      matrizBonos: this.matrizDeBonos(liquidacion, placasUsadas, placaPorVehiculoId, bonosRecorrido, mesesCorte),
      tipoNomina: this.tipoDeNomina([...porEmpresa.values()].map((b) => b.empresa)),
      dias: diasHoja,
      tarifas,
      tramos,
      bloquesEmpresa,
      salarioBasico,
      valorHora,
      horasMensualesBase,
      jornadaNormalHoras: tramoCierre.jornadaNormalHoras,
      jornadaFestivaHoras: tramoCierre.jornadaFestivaHoras,
      totalHorasMes: horas2(diasHoja.reduce((s, d) => s + d.totalHoras, 0)),
      repartoDesprendible,
      repartoDisponibilidad,
      vacaciones,
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
  /**
   * Cruza los bonos de la liquidación con las placas del periodo.
   *
   * Una fila por tipo de bono, una columna por placa. El total de cada fila es
   * lo que el desprendible ya paga por ese bono, así que la matriz DESGLOSA lo
   * que había, no lo recalcula: si las dos cifras se separaran, la de arriba
   * seguiría siendo la que manda.
   *
   * Un bono sin vehículo —los hay: `vehiculo_id` es opcional— no se pierde;
   * cae en una columna «sin placa» que se añade al final solo si hace falta.
   */
  /**
   * A qué nómina pertenece el conductor en el periodo.
   *
   * Se decide por el NOMBRE de la empresa y no por un id de configuración: los
   * `NOMINA_EMPRESA_PAREX_ID` / `..._GEOPARK_ID` que usa el ajuste de recargos
   * no están puestos en ningún entorno, y además en la tabla conviven dos
   * «GEOPARK COLOMBIA S.A.S» —uno con punto final y otro sin él—, que por id
   * serían dos empresas distintas y por nombre son la misma nómina.
   */
  private static tipoDeNomina(empresas: Iterable<string>): string {
    let parex = false;
    let geopark = false;
    for (const nombre of empresas) {
      const n = (nombre ?? '').toUpperCase();
      if (n.includes('PAREX')) parex = true;
      if (n.includes('GEOPARK')) geopark = true;
    }
    const marcas: string[] = [];
    if (parex) marcas.push('PAREX');
    if (geopark) marcas.push('GEOPARK');
    /// Ni una ni otra: Villanueva. Es el caso por defecto y NO una ausencia de
    /// dato — por eso se escribe y no se deja en blanco.
    return marcas.length ? marcas.join(', ') : 'VILLANUEVA';
  }

  /**
   * Los bonos del periodo, por placa y mes.
   *
   * REGLA: lo marcado en el canvas de recorridos ES el valor, salvo que la
   * liquidación ya tenga su propia fila para ese bono y ese vehículo.
   *
   * Antes esto enseñaba las dos cuentas y marcaba la diferencia. Con la
   * metodología nueva —los bonos se marcan en recorridos y de ahí salen— esa
   * comparación daba `0 → 11` en todas las celdas de cualquier conductor sin
   * liquidación todavía, que es ruido, no información: no hay dos cifras en
   * conflicto, hay una sola que aún no se ha materializado.
   *
   * La comparación se reserva para el caso en que sí hay conflicto de verdad:
   * la liquidación tiene una cantidad para ese bono y no coincide con lo
   * marcado. Eso sigue saliendo en ámbar, porque entonces alguien cambió una
   * de las dos a mano.
   *
   * Las filas se emparejan POR NOMBRE normalizado, que es lo único que hay:
   * `bonificaciones` guarda `name` y `value` y no referencia la
   * `configuraciones_liquidacion` de la que salió.
   */
  private static matrizDeBonos(
    liquidacion: any | null,
    placasUsadas: PlacaBono[],
    placaPorVehiculoId: Map<string, string>,
    bonosRecorrido: BonoRecorrido[],
    meses: string[],
  ): MatrizBonos {
    const bonos = (liquidacion?.bonificaciones ?? []) as any[];
    const hayRecorridos = bonosRecorrido.length > 0;
    if (!bonos.length && !hayRecorridos) {
      return { placas: [], meses, filas: [], hayRecorridos: false };
    }

    const SIN_PLACA = '—';
    const columnas = [...placasUsadas];
    const indiceDe = new Map(columnas.map((p, i) => [p.placa, i]));
    const indiceMes = new Map(meses.map((m, i) => [m, i]));

    interface Acumulado {
      nombre: string;
      valorUnitario: number;
      cantidades: number[][];
      cantidadesRecorridos: number[][];
      /**
       * Placas para las que la LIQUIDACIÓN tiene fila propia de este bono.
       *
       * Es lo que distingue «la liquidación dice 0» de «la liquidación no dice
       * nada»: en el primer caso alguien puso un cero y hay que respetarlo, en
       * el segundo el valor lo pone recorridos.
       */
      enLiquidacion: Set<number>;
    }
    /** `nombre normalizado → acumulado`. */
    const filas = new Map<string, Acumulado>();

    /// Trim, minúsculas y espacios colapsados. Es el emparejamiento más
    /// permisivo que sigue siendo predecible: «Bono  de Alimentación » y
    /// «bono de alimentación» son el mismo bono, y nadie escribió eso a mano
    /// esperando que fueran dos.
    const clave = (nombre: string) => nombre.trim().toLowerCase().replace(/\s+/g, ' ');

    const filaVacia = () => meses.map(() => 0);

    /** Abre la columna de una placa, o la de «sin placa» si no se conoce. */
    const columnaDe = (vehiculoId: string | null): number => {
      const placa = vehiculoId ? placaPorVehiculoId.get(vehiculoId) ?? null : null;
      const col = placa !== null ? indiceDe.get(placa) : undefined;
      if (col !== undefined) return col;
      // Vehículo que no aparece en ninguna planilla del periodo, o bono sin
      // vehículo: se le abre su propia columna en vez de sumarlo a otra. Sin
      // `vehiculoId` no se puede editar, y por eso no lleva binding.
      if (!indiceDe.has(SIN_PLACA)) {
        indiceDe.set(SIN_PLACA, columnas.length);
        columnas.push({ placa: SIN_PLACA, color: '#94A3B8', vehiculoId: null });
        for (const f of filas.values()) {
          f.cantidades.push(filaVacia());
          f.cantidadesRecorridos.push(filaVacia());
        }
      }
      return indiceDe.get(SIN_PLACA)!;
    };

    const filaDe = (nombre: string, valorUnitario: number): Acumulado => {
      const k = clave(nombre);
      let fila = filas.get(k);
      if (!fila) {
        fila = {
          nombre,
          valorUnitario,
          cantidades: columnas.map(filaVacia),
          cantidadesRecorridos: columnas.map(filaVacia),
          enLiquidacion: new Set<number>(),
        };
        filas.set(k, fila);
      }
      while (fila.cantidades.length < columnas.length) fila.cantidades.push(filaVacia());
      while (fila.cantidadesRecorridos.length < columnas.length) {
        fila.cantidadesRecorridos.push(filaVacia());
      }
      return fila;
    };

    /**
     * Reparte `values` por mes.
     *
     * Un mes que no es del corte se suma al ÚLTIMO del corte en vez de
     * perderse: son liquidaciones viejas cuyo periodo no coincide con la
     * ventana que se está mirando, y descartarlas haría que el canvas enseñara
     * menos bonos de los que la liquidación paga.
     */
    const repartir = (values: unknown, destino: number[]): void => {
      try {
        const parsed = JSON.parse(String(values ?? '[]'));
        if (!Array.isArray(parsed)) return;
        for (const v of parsed) {
          const i = indiceMes.get(String(v?.mes ?? ''));
          const j = i ?? destino.length - 1;
          if (j >= 0) destino[j] += dec(v?.quantity);
        }
      } catch {
        /* un `values` corrupto no debe tumbar la hoja entera */
      }
    };

    // ── Lo que paga la liquidación ────────────────────────────────────
    for (const b of bonos) {
      const col = columnaDe(b.vehiculo_id ?? null);
      const fila = filaDe(String(b.name ?? 'BONO'), dec(b.value));
      fila.enLiquidacion.add(col);
      repartir(b.values, fila.cantidades[col]);
    }

    // ── Lo que se marcó en recorridos ─────────────────────────────────
    //
    // Cada bono es UNA marca en un tramo, así que la cantidad es el conteo de
    // filas y no un campo. El precio unitario solo se pisa cuando la fila nace
    // aquí: si el bono también está en la liquidación, manda el de la
    // liquidación, que es el que se está pagando.
    for (const b of bonosRecorrido) {
      const col = columnaDe(b.vehiculoId);
      const fila = filaDe(b.nombre, b.valor);
      const j = indiceMes.get(b.mes) ?? meses.length - 1;
      if (j >= 0) fila.cantidadesRecorridos[col][j] += 1;
    }

    /**
     * Donde la liquidación no tiene fila, el valor ES el de recorridos.
     *
     * No se toca `cantidadesRecorridos`: sigue haciendo falta para saber si una
     * celda con cifra propia de la liquidación se ha separado de lo marcado.
     */
    for (const f of filas.values()) {
      for (let col = 0; col < columnas.length; col++) {
        if (f.enLiquidacion.has(col)) continue;
        f.cantidades[col] = [...f.cantidadesRecorridos[col]];
      }
    }

    const suma = (m: number[][]) => m.reduce((s, f) => s + f.reduce((x, n) => x + n, 0), 0);

    return {
      placas: columnas,
      meses,
      filas: [...filas.values()]
        .map((f) => {
          const total = suma(f.cantidades);
          const totalRecorridos = suma(f.cantidadesRecorridos);
          return {
            nombre: f.nombre,
            valorUnitario: f.valorUnitario,
            cantidades: f.cantidades,
            cantidadesRecorridos: f.cantidadesRecorridos,
            total,
            totalRecorridos,
            /// Celda a celda y no por total: dos meses que se compensan entre
            /// sí —uno con un bono de más y otro con uno de menos— dan el mismo
            /// total y son justamente el error que hay que ver.
            /// Solo hay descuadre donde la liquidación tiene cifra PROPIA y no
            /// coincide con lo marcado. Una celda que salió de recorridos no
            /// puede descuadrar consigo misma.
            descuadra:
              hayRecorridos &&
              f.cantidades.some(
                (fila, i) =>
                  f.enLiquidacion.has(i) &&
                  fila.some((n, j) => n !== f.cantidadesRecorridos[i][j]),
              ),
          };
        })
        /// Primero los que tienen algo: con cinco tipos de bono y tres en cero,
        /// ordenar alfabéticamente deja la tabla empezando por ceros.
        .sort(
          (a, b2) =>
            Math.max(b2.total, b2.totalRecorridos) - Math.max(a.total, a.totalRecorridos) ||
            a.nombre.localeCompare(b2.nombre, 'es'),
        ),
      hayRecorridos,
    };
  }

  private static construirDesprendible(args: {
    conductor: { salario_base: unknown };
    liquidacion: any | null;
    /** `YYYY-MM → "21 AL 31 DE AGOSTO DE 2026"`, para las líneas por subperiodo. */
    subperiodos: Map<string, string>;
    /** Bonos marcados en recorridos, para los que la liquidación no tiene. */
    bonosRecorrido: BonoRecorrido[];
    repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[];
    repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[];
    parametros: ParametrosNomina;
    diasConPlanilla: number;
  }): {
    devengos: ConceptoDesprendible[];
    deducciones: ConceptoDesprendible[];
    totales: ReturnType<typeof liquidarNomina>;
    vacaciones: VacacionesHoja;
  } {
    const { conductor, liquidacion: l, repartoDesprendible, repartoDisponibilidad, parametros, subperiodos } = args;

    /**
     * Los bonos que el desprendible debe REFLEJAR, vengan de donde vengan.
     *
     * Si la liquidación no tiene fila de un bono, manda lo marcado en
     * recorridos — la misma regla que ya aplica el bloque BONOS POR VEHÍCULO.
     * Sin esto, un conductor sin borrador todavía enseñaba «1 y 11» arriba y un
     * desprendible sin una sola línea de bonos abajo, que es la misma hoja
     * diciendo dos cosas distintas.
     *
     * Se construyen como si fueran filas de `bonificaciones` para que ALIMENTEN
     * TAMBIÉN el cálculo: si solo se pintaran, el total devengado de la hoja y
     * el que calcula el servidor dirían cifras distintas.
     *
     * `__deRecorridos` las marca como NO editables: no existe fila en la base a
     * la que escribir. Se vuelven reales al generar el borrador, que es quien
     * las siembra.
     */
    const claveBono = (s: unknown) =>
      String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    const bonificacionesLiq = (l?.bonificaciones ?? []) as any[];
    const nombresEnLiquidacion = new Set(bonificacionesLiq.map((b) => claveBono(b.name)));

    /** `nombre → { valor, porMes }` de lo marcado en recorridos y no liquidado. */
    const pendientes = new Map<string, { nombre: string; valor: number; porMes: Map<string, number> }>();
    for (const b of args.bonosRecorrido) {
      const k = claveBono(b.nombre);
      if (nombresEnLiquidacion.has(k)) continue;
      const item = pendientes.get(k) ?? { nombre: b.nombre, valor: b.valor, porMes: new Map<string, number>() };
      item.porMes.set(b.mes, (item.porMes.get(b.mes) ?? 0) + 1);
      pendientes.set(k, item);
    }

    const bonificaciones = [
      ...bonificacionesLiq,
      ...[...pendientes.values()].map((x) => ({
        id: `rec:${claveBono(x.nombre)}`,
        name: x.nombre,
        value: x.valor,
        values: JSON.stringify(
          [...x.porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([mes, quantity]) => ({ mes, quantity })),
        ),
        __deRecorridos: true,
      })),
    ];
    const salarioBase = dec(conductor.salario_base);
    /**
     * Días que se pagan: los de la liquidación, y si no la hay, el MES
     * COMERCIAL.
     *
     * El respaldo era `diasConPlanilla` —los días con planilla cargada— y de
     * ahí salía el sueldo de cualquier conductor que todavía no tuviera
     * borrador: el que tenía tres planillas en el corte aparecía cobrando 3/30
     * del básico, y el que no tenía ninguna, cero. Las planillas mandan sobre
     * los RECARGOS; el salario de alguien mensual no depende de cuántas hayan
     * llegado.
     *
     * `?? ` y no `||`: un cero guardado a propósito —un retiro a principio de
     * corte— es un dato y tiene que sobrevivir.
     */
    const diasLaborados = Number(l?.dias_laborados ?? DIAS_MES_COMERCIAL) || 0;

    const totalRecargos = repartoDesprendible.reduce((s, r) => s + r.valor, 0);
    const totalDisponibilidad = repartoDisponibilidad.reduce((s, r) => s + r.valor, 0);

    const bonos = bonificaciones.map((b: any) => {
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

    /**
     * `conceptos_adicionales` es Json libre. Aquí vive también el AJUSTE A
     * NETO PACTADO, que antes era una celda sin rótulo.
     *
     * EL RÓTULO ESTÁ EN `observaciones`, NO EN `nombre`. Es lo que escribe el
     * formulario de la liquidación —`{ valor, observaciones }`— y lo único
     * que hay en la base: leer `nombre` dejaba TODOS los conceptos rotulados
     * «CONCEPTO ADICIONAL», así que el importe se veía y su motivo no. Se
     * acepta `nombre` de respaldo por si alguna fila vieja lo trae.
     */
    let conceptosAdicionales: { nombre: string; valor: number }[] = [];
    if (Array.isArray(l?.conceptos_adicionales)) {
      conceptosAdicionales = (l.conceptos_adicionales as any[]).map((c) => ({
        nombre: String(c?.observaciones ?? c?.nombre ?? 'CONCEPTO ADICIONAL').trim() || 'CONCEPTO ADICIONAL',
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
      salarioVacaciones: l?.salario_vacaciones != null ? dec(l.salario_vacaciones) : null,
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

    /**
     * El bloque de vacaciones: dos fechas, los días que salen de ellas y el
     * salario con el que se liquidan.
     *
     * Los días se cuentan CON el día de inicio —del 1 al 15 son 15— y no se
     * guardan: se recalculan de las fechas cada vez, para que no pueda quedar
     * un número que contradiga a sus propias fechas.
     */
    const soloFecha = (v: unknown): string | null => {
      if (!v) return null;
      const s = v instanceof Date ? v.toISOString() : String(v);
      const iso = s.slice(0, 10);
      return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
    };
    const vacDesde = soloFecha(l?.periodo_start_vacaciones);
    const vacHasta = soloFecha(l?.periodo_end_vacaciones);
    const salarioVacacionesFijado = l?.salario_vacaciones != null ? dec(l.salario_vacaciones) : 0;
    const vacaciones: VacacionesHoja = {
      desde: vacDesde,
      hasta: vacHasta,
      dias:
        vacDesde && vacHasta
          ? Math.max(
              0,
              Math.round(
                (Date.parse(`${vacHasta}T00:00:00Z`) - Date.parse(`${vacDesde}T00:00:00Z`)) /
                  86400000,
              ) + 1,
            )
          : 0,
      salarioBase: salarioVacacionesFijado || salarioBase,
      salarioHeredado: !salarioVacacionesFijado,
    };

    const devengos: ConceptoDesprendible[] = [
      { clave: 'salario', nombre: 'SALARIO', cantidad: diasLaborados, valor: totales.salarioDevengado, editable: true },
      { clave: 'vacaciones', nombre: 'VACACIONES', cantidad: vacaciones.dias || null, valor: totales.totalVacaciones, editable: true },
      { clave: 'auxilio_transporte', nombre: 'AUXILIO DE TRANSPORTE', cantidad: diasLaborados, valor: totales.auxilioTransporte, editable: true },
      /**
       * Conceptos adicionales, PEGADOS AL BLOQUE FIJO.
       *
       * Estaban al final de todo, dentro de la sección OTROS, y ahí hacían
       * dos daños: se leían como un recargo más —que es justo lo que no
       * son— y el `TOTAL OTROS` se los tragaba, así que esa cifra decía
       * «recargos del periodo» y traía dentro un bono pactado a mano.
       *
       * Aquí arriba van con lo que tampoco sale de las planillas (salario,
       * vacaciones, auxilio) y quedan fuera de los dos subtotales.
       *
       * La clave LLEVA EL NOMBRE porque es la dirección de la celda: el
       * canvas la convierte en `adicional|<nombre>` para editarla y el
       * índice no sirve —se corre en cuanto se borra uno de en medio—.
       */
      ...conceptosAdicionales.map((c) => ({
        clave: `adicional:${c.nombre}`,
        nombre: c.nombre.toUpperCase(),
        /// `1` y no vacío: es la cantidad que ya imprime el desprendible en PDF
        /// y la que ve el conductor en el portal. Dejarla en blanco aquí haría
        /// que el canvas y el papel no dijeran lo mismo sobre la misma línea.
        cantidad: 1,
        valor: c.valor,
        editable: true,
      })),
      ...(totales.bonificacionVillanueva
        ? [{ clave: 'ajuste_salarial', nombre: 'BONO NIVELACION DE SALARIO', cantidad: entrada.diasLaboradosVillanueva, valor: totales.bonificacionVillanueva, editable: true }]
        : []),
      // OJO: la línea lleva `cantidad × valor`, no el valor unitario.
      // `bonificaciones.value` es el precio de UNA unidad y las cantidades
      // están en `values` (`[{ mes, quantity }]`), que es como las suma
      // `liquidarNomina`. Poner aquí `b.value` hacía que el desprendible
      // listara el precio unitario y su total no cuadrara con el neto.
      /**
       * Bonos y pernotes, AGRUPADOS POR SUBPERIODO.
       *
       * El orden es el del Excel: todo lo del primer trozo del corte junto
       * —sus bonos y sus pernotes— y después todo lo del segundo. Agrupar por
       * concepto en vez de por fechas obliga a ir saltando arriba y abajo para
       * cuadrar un mes, que es justo lo que se hace al revisar.
       *
       * Un bono o un pernote que está a cero en TODO el corte se queda en una
       * sola línea sin fechas, al final: partirlo daría dos filas mudas donde
       * había una, y una liquidación trae una fila por cada tipo de bono
       * configurado aunque no se haya otorgado ninguno.
       */
      ...(() => {
        const lineas: ConceptoDesprendible[] = [];
        const mudos: ConceptoDesprendible[] = [];

        /** `[{ mes, quantity }]` de una bonificación, tolerando basura. */
        const mesesDeBono = (crudo: unknown): { mes: string; quantity: number }[] => {
          try {
            const parsed = JSON.parse(String(crudo ?? '[]'));
            if (!Array.isArray(parsed)) return [];
            return parsed
              .filter((v: any) => typeof v?.mes === 'string')
              .map((v: any) => ({ mes: String(v.mes), quantity: dec(v?.quantity) }));
          } catch {
            return [];
          }
        };

        /** Meses de un pernote, contados desde sus fechas. */
        const mesesDePernote = (crudo: unknown): Map<string, number> => {
          const m = new Map<string, number>();
          try {
            const parsed = JSON.parse(String(crudo ?? '[]'));
            if (Array.isArray(parsed)) {
              for (const f of parsed) {
                const mes = String(f).slice(0, 7);
                m.set(mes, (m.get(mes) ?? 0) + 1);
              }
            }
          } catch {
            /* fila vieja sin fechas */
          }
          return m;
        };

        const bonos = bonificaciones;
        const pernotes = (l?.pernotes ?? []) as any[];

        /**
         * ¿Este corte va a pintar ALGUNA línea de pernote?
         *
         * Un pernote solo entra si tiene fechas (se reparte por subperiodo) o,
         * sin ellas, si tiene cantidad (va al bloque de los que no se pudieron
         * repartir). Cuando no se cumple ninguna de las dos —y el caso normal
         * es el más mudo de todos: la liquidación NO TIENE NI UNA FILA de
         * `pernotes`— el desprendible se quedaba sin rastro del concepto.
         *
         * Eso no se lee como «no hubo pernotes», se lee como que el canvas se
         * los comió: el resto de conceptos del corte sí están, cada uno con su
         * cero. Por eso abajo se pinta el concepto igual, a cero y por
         * subperiodo, como referencia de que se miró y no había.
         */
        const hayAlgunPernote = pernotes.some(
          (pn) => mesesDePernote(pn.fechas).size > 0 || dec(pn.cantidad) > 0,
        );

        for (const [mes, etiqueta] of subperiodos) {
          for (const [i, b] of bonos.entries()) {
            const porMes = mesesDeBono(b.values);
            if (!porMes.reduce((s, v) => s + v.quantity, 0)) continue;
            const cantidad = porMes.find((v) => v.mes === mes)?.quantity ?? 0;
            lineas.push({
              clave: `bono:${b.id ?? i}:${mes}`,
              nombre: `${String(b.name ?? 'BONO').toUpperCase()} (${etiqueta})`,
              cantidad,
              valor: cantidad * dec(b.value),
              editable: !b.__deRecorridos,
            });
          }
          for (const [i, pn] of pernotes.entries()) {
            const porMes = mesesDePernote(pn.fechas);
            if (!porMes.size) continue;
            const cantidad = porMes.get(mes) ?? 0;
            lineas.push({
              clave: `pernote:${pn.id ?? i}:${mes}`,
              nombre: `PERNOTES (${etiqueta})`,
              cantidad,
              valor: cantidad * dec(pn.valor),
              editable: true,
            });
          }

          /**
           * La referencia del pernote vacío, en el sitio que le tocaría.
           *
           * No es editable: detrás no hay ninguna fila de `pernotes` a la que
           * escribir —un pernote necesita empresa y vehículo, que esta celda
           * no sabe— así que se pinta como derivada. Dice «aquí van los
           * pernotes y este corte no trajo ninguno», que es justo lo que
           * faltaba; darlos de alta sigue siendo cosa del formulario.
           */
          if (!hayAlgunPernote) {
            lineas.push({
              clave: `pernote:vacio:${mes}`,
              nombre: `PERNOTES (${etiqueta})`,
              cantidad: 0,
              valor: 0,
              editable: false,
            });
          }
        }

        // ── Los que no se pudieron repartir ──────────────────────────────
        for (const [i, b] of bonos.entries()) {
          const porMes = mesesDeBono(b.values);
          const total = porMes.reduce((s, v) => s + v.quantity, 0);
          const fuera = porMes.filter((v) => !subperiodos.has(v.mes)).reduce((s, v) => s + v.quantity, 0);
          const nombre = String(b.name ?? 'BONO').toUpperCase();
          if (!total) {
            mudos.push({ clave: `bono:${b.id ?? i}`, nombre, cantidad: 0, valor: 0, editable: true });
          } else if (fuera) {
            mudos.push({
              clave: `bono:${b.id ?? i}:fuera`,
              nombre: `${nombre} (FUERA DEL CORTE)`,
              cantidad: fuera,
              valor: fuera * dec(b.value),
              editable: true,
            });
          }
        }
        for (const [i, pn] of pernotes.entries()) {
          const porMes = mesesDePernote(pn.fechas);
          const total = dec(pn.cantidad);
          if (!porMes.size) {
            // Fila vieja sin fechas: no hay cómo repartirla, pero su importe
            // cuenta y perderlo sería peor que no desglosarlo.
            if (total) {
              mudos.push({
                clave: `pernote:${pn.id ?? i}`,
                nombre: 'PERNOTES',
                cantidad: total,
                valor: total * dec(pn.valor),
                editable: true,
              });
            }
            continue;
          }
          const fuera = [...porMes.entries()]
            .filter(([mes]) => !subperiodos.has(mes))
            .reduce((s, [, n]) => s + n, 0);
          if (fuera) {
            mudos.push({
              clave: `pernote:${pn.id ?? i}:fuera`,
              nombre: 'PERNOTES (FUERA DEL CORTE)',
              cantidad: fuera,
              valor: fuera * dec(pn.valor),
              editable: true,
            });
          }
        }

        return [...lineas, ...mudos];
      })(),

      /// Rótulo de sección: debajo van los recargos, que no son conceptos
      /// fijos sino lo que salió de las planillas. Es la separación que hace
      /// el Excel y sin ella las dos clases de línea se leen como una lista.
      { clave: 'seccion:otros', nombre: 'OTROS', cantidad: null, valor: 0, editable: false, seccion: true },

      // Las siete filas de recargo, ya autocompletadas desde las planillas.
      ...repartoDesprendible.map((r) => ({
        clave: `recargo:${r.codigo}`,
        nombre: NOMBRE_RECARGO[r.codigo],
        cantidad: r.horas,
        valor: r.valor,
        editable: false,
      })),
      { clave: 'disponibilidad', nombre: 'DISPONIBILIDAD MES', cantidad: null, valor: totalDisponibilidad, editable: false },
    ];

    const deducciones: ConceptoDesprendible[] = [
      { clave: 'salud', nombre: 'SALUD', cantidad: null, valor: totales.salud, editable: false },
      { clave: 'pension', nombre: 'PENSION', cantidad: null, valor: totales.pension, editable: false },
      { clave: 'anticipos', nombre: 'ANTICIPOS', cantidad: null, valor: totales.totalAnticipos, editable: true },
    ];

    return { devengos, deducciones, totales, vacaciones };
  }
}
