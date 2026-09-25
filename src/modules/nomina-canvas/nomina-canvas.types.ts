/**
 * Forma de lo que el canvas de nómina recibe del servidor.
 *
 * Cada `HojaNomina` es una pestaña del libro: un conductor, un periodo. El
 * builder del frontend no consulta nada más — todo lo que necesita para
 * pintar las cinco zonas de la hoja está aquí.
 */
import type { DiaPeriodo, SemanaPeriodo } from '../../lib/nomina/periodo';
import type { ResultadoLiquidacion } from '../../lib/nomina/liquidar';

/** Los siete tipos, en el orden en que se pintan las filas 11-17. */
export const CODIGOS_RECARGO = ['RN', 'HEN', 'HED', 'HEFD', 'HEFN', 'RD', 'RNDF'] as const;
export type CodigoRecargo = (typeof CODIGOS_RECARGO)[number];

/**
 * Color de resalte de cada tipo, tomado de los propios Excel. Se define en el
 * servidor y no en el builder para que el PDF, el XLSX y el canvas usen el
 * mismo, sin tres listas que se desincronizan.
 */
export const COLOR_RECARGO: Record<CodigoRecargo, string> = {
  RN: '#9966FF',
  HEN: '#FFFF00',
  HED: '#F4B183',
  HEFD: '#00B050',
  HEFN: '#FF0000',
  RD: '#00B0F0',
  RNDF: '#7F6000',
};

/** Nombre largo tal y como aparece en el Excel. */
export const NOMBRE_RECARGO: Record<CodigoRecargo, string> = {
  RN: 'RECARGO NOCTURNO (RN)',
  HEN: 'HORA EXTRA NOCTURNA (HEN)',
  HED: 'HORA EXTRA DIURNA (HED)',
  HEFD: 'HORA EXTRA DOMINIC FESTIVA DIURNA (HEDF)',
  HEFN: 'HORA EXTRA DOMIC FESTIVA NOCT (HEDFN)',
  RD: 'RECARGO DOMINICAL FESTIVO - RDF',
  RNDF: 'RECARGO NOCTURNO DOMINICAL O FESTIVO - RNDF',
};

/**
 * Paleta de identificación de clientes.
 *
 * Elegida para no chocar con los colores de recargo (que ya ocupan el morado,
 * el amarillo, el naranja, el verde, el rojo, el cian y el ocre en su
 * versión saturada): estos son tonos medios, legibles con texto oscuro
 * encima y distinguibles entre sí de un vistazo.
 */
export const PALETA_CLIENTES = [
  '#1F77B4', '#FF7F0E', '#2CA02C', '#D62728',
  '#9467BD', '#8C564B', '#E377C2', '#7F7F7F',
  '#BCBD22', '#17BECF', '#AEC7E8', '#FFBB78',
  '#98DF8A', '#FF9896', '#C5B0D5', '#C49C94',
  '#F7B6D2', '#C7C7C7', '#DBDB8D', '#9EDAE5',
] as const;

/**
 * Color estable de un cliente.
 *
 * Se deriva del UUID y no de la posición en la lista: así el mismo cliente
 * tiene el mismo color en enero y en agosto, y en la hoja de un conductor y
 * en la de otro. Con un índice por orden de aparición, añadir un cliente
 * repintaría a todos los demás.
 */
export function colorDeCliente(empresaId: string): string {
  let h = 0;
  for (let i = 0; i < empresaId.length; i++) {
    h = (h * 31 + empresaId.charCodeAt(i)) >>> 0;
  }
  return PALETA_CLIENTES[h % PALETA_CLIENTES.length];
}

/**
 * Paleta de las PLACAS.
 *
 * Deliberadamente distinta de la de clientes: en la hoja conviven dos filas de
 * color —cliente del día y placa del día, una encima de la otra— y con la misma
 * paleta un verde en la fila de arriba y otro en la de abajo se leerían como lo
 * mismo. Estos son tonos más apagados y fríos; los de cliente son saturados.
 */
export const PALETA_PLACAS = [
  '#5B8DEF', '#E08D3C', '#57A773', '#C05B5B',
  '#8B72BE', '#A0744F', '#D07EA8', '#6E7B8B',
  '#B0A43C', '#4FA3A8', '#93AFD8', '#E0B487',
  '#9BC5A6', '#DBA0A0', '#BFAED8', '#C2A48C',
] as const;

/**
 * Color estable de una placa.
 *
 * Se deriva del TEXTO de la placa y no de su posición en la lista, por lo mismo
 * que el de cliente: así QLR098 es del mismo color en la hoja de enero y en la
 * de agosto, y en la de un conductor y en la de otro. Con un índice por orden de
 * aparición, un conductor que estrena vehículo repintaría a todos los demás.
 */
export function colorDePlaca(placa: string): string {
  let h = 0;
  for (let i = 0; i < placa.length; i++) {
    h = (h * 31 + placa.charCodeAt(i)) >>> 0;
  }
  return PALETA_PLACAS[h % PALETA_PLACAS.length];
}

/** Una placa del periodo con su color, para la leyenda y la fila de días. */
export interface PlacaNomina {
  placa: string;
  color: string;
}

/** Un cliente del periodo con su color, para pintar la leyenda. */
export interface ClienteNomina {
  id: string;
  nombre: string;
  color: string;
}

export interface DiaHoja {
  /** Índice dentro de `periodo.dias`: es la columna. */
  indice: number;
  fecha: string;
  /**
   * Repetición de la fecha, 0 para la primera del día.
   *
   * Un conductor con dos servicios en un día ocupa dos columnas contiguas de
   * la misma fecha; esto dice cuál de las dos es. El encabezado la usa para
   * no repetir el número del día dos veces sin explicación.
   */
  ocurrencia: number;
  /** Hora decimal (5.5 = 05:30), como se guarda en la planilla. */
  horaInicio: number | null;
  horaFin: number | null;
  totalHoras: number;
  esFestivo: boolean;
  esDomingo: boolean;
  /** Día de standby: en el Excel la celda dice DISPONIBLE. */
  disponibilidad: boolean;
  pernocte: boolean;
  continuaSiguienteDia: boolean;
  /** Horas por tipo. Solo lleva los tipos con horas > 0. */
  horas: Partial<Record<CodigoRecargo, number>>;
  /** Nombre de la empresa de ese día (fila 18 del Excel). */
  empresa: string | null;
  empresaId: string | null;
  /** Color identificativo del cliente. Es lo que se pinta en la fila 18. */
  empresaColor: string | null;
  /**
   * Placa con la que se trabajó ESE día.
   *
   * Estaba solo agregada en `placas`, así que la hoja decía «usó cinco
   * vehículos» pero no cuál en cada día — y eso es justo lo que se pregunta
   * cuando hay que cotejar un recargo contra la planilla del vehículo.
   */
  placa: string | null;
  /** Id del vehículo, para que la copia del borrador no dependa del rótulo. */
  vehiculoId: string | null;
  /** Color de esa placa. Es lo que se pinta en la fila 19. */
  placaColor: string | null;
  /**
   * `true` cuando este día viene de la COPIA de la liquidación y no de la
   * planilla.
   *
   * Es lo que permite que el canvas deje editarlo sin tocar el documento de
   * origen, y que el aviso sepa distinguir «esto es derivado» de «esto es tuyo».
   */
  propio: boolean;
}

/**
 * Un tramo del corte con una misma configuración salarial y unas mismas
 * tarifas.
 *
 * Casi siempre hay uno solo. Hay dos cuando el corte cruza un cambio de
 * vigencia: el 21-jun → 20-jul de 2026 se parte en «21 DE JUNIO AL 14 DE
 * JULIO» (220 h base, RD 80 %) y «15 AL 20 DE JULIO» (210 h base, RD 90 %),
 * porque la Ley 2466 entró a mitad de corte. Cada día se valora con el tramo
 * al que pertenece, no con el del cierre.
 */
export interface TramoVigencia {
  /** Primera y última fecha del corte que caen en este tramo. */
  desde: string;
  hasta: string;
  /** `21 DE JUNIO AL 14 DE JULIO DE 2026`. */
  etiqueta: string;
  salarioBasico: number;
  horasMensualesBase: number;
  valorHora: number;
  jornadaNormalHoras: number;
  jornadaFestivaHoras: number;
  /**
   * Las bases salariales vigentes en este tramo, la general primero.
   *
   * El mismo recargo vale distinto según con qué cliente se trabajó: hay
   * `configuraciones_salarios` con `empresa_id` y un salario básico propio
   * —2.358.897 frente a los 1.750.905 de la general—, y hasta ahora el canvas
   * usaba solo la general y las demás no se veían por ningún lado. El Excel del
   * que viene esta nómina sí las enseña, en columnas paralelas.
   *
   * Es una LISTA y no dos campos fijos porque el número de empresas con
   * configuración propia lo decide la tabla, no el código.
   */
  bases: BaseSalarial[];
}

/** Una base salarial del tramo: la general, o la de un cliente concreto. */
export interface BaseSalarial {
  /** `null` en la base general, que es la que usa la liquidación. */
  empresaId: string | null;
  /** `BÁSICO` para la general; el nombre del cliente para las demás. */
  nombre: string;
  salarioBasico: number;
  /** `salarioBasico / horasMensualesBase` del tramo. */
  valorHora: number;
}

/** Una fila del bloque de configuración (filas 27-33 del Excel). */
export interface TarifaRecargo {
  codigo: CodigoRecargo;
  nombre: string;
  color: string;
  /** En unidades de 100: 35 = 35 %. Sale de `tipos_recargos` vigente. */
  porcentaje: number;
  /** Valor de una hora de este recargo, ya con el % aplicado. */
  valorHora: number;
  /**
   * Lo mismo, calculado sobre cada una de las bases del tramo y alineado con
   * `TramoVigencia.bases`. El primero repite `valorHora` (la base general).
   */
  valorHoraPorBase: number[];
  /** `horas × valorHoraPorBase`, para no recalcularlo en tres sitios. */
  valorPorBase: number[];
  /**
   * Horas que se PAGAN: las de la planilla, o las corregidas a mano si hay
   * un ajuste vivo en `ajustes_horas_recargo`.
   */
  horas: number;
  /**
   * Lo que dicen las planillas, siempre.
   *
   * Cuando no hay ajuste vale lo mismo que `horas`. Viaja aparte para que el
   * canvas pueda enseñar «30 → 32» y para que deshacer el ajuste no tenga que
   * ir a buscar el valor original a ninguna parte.
   */
  horasPlanilla: number;
  /** `true` si estas horas están corregidas a mano. */
  ajustada: boolean;
  valor: number;
  /**
   * Índice dentro de `HojaNomina.tramos`. Con un solo tramo siempre es 0 y
   * la tabla se pinta igual que siempre; con dos, hay una fila por código y
   * tramo y el bloque se parte en dos sub-tablas.
   */
  tramo: number;
}

/** Un bloque del desglose por empresa (filas 39-47 y siguientes). */
export interface BloqueEmpresa {
  empresaId: string;
  empresa: string;
  color: string;
  mes: number;
  anio: number;
  /** «7, 13 AL 19 DE AGOSTO DE 2026». */
  textoDias: string;
  dias: number[];
  lineas: { codigo: CodigoRecargo; nombre: string; horas: number; valor: number }[];
  totalHoras: number;
  totalValor: number;
}

/**
 * Los bonos del periodo cruzados por placa.
 *
 * `bonificaciones` ya nace con `vehiculo_id`, así que el dato es una matriz
 * desde siempre —cuántos bonos de cada tipo se pagaron con cada vehículo—, pero
 * el desprendible solo enseñaba el total por tipo. Con cinco placas en un
 * periodo eso deja sin responder la pregunta de quién adjudica cada bono, que
 * es justo la que se hace al cuadrar contra los recorridos.
 *
 * Las cantidades se suman a lo largo de los meses que toca el corte: `values`
 * guarda `[{ mes, quantity }]` y un corte 21→20 cruza dos.
 */
/**
 * Una placa que es columna de la matriz de bonos.
 *
 * Lleva `vehiculoId` porque la celda AHORA SE EDITA, y una escritura tiene que
 * saber a qué fila de `bonificaciones` va: la placa es un rótulo y puede
 * repetirse o cambiar, el id no. `null` en la columna «sin placa», que agrupa
 * los bonos cuyo vehículo no está en ninguna planilla del periodo y que por eso
 * mismo no se puede editar desde aquí.
 */
export interface PlacaBono extends PlacaNomina {
  vehiculoId: string | null;
}

export interface FilaBono {
  /** «Bono de alimentación». */
  nombre: string;
  /** Precio unitario, que es igual para todas las placas. */
  valorUnitario: number;
  /**
   * Cantidad por PLACA y MES: `cantidades[iPlaca][iMes]`, alineado con
   * `placas` y `meses`.
   *
   * Es una matriz y no un total por placa porque la celda se edita, y un corte
   * 21→20 SIEMPRE cruza dos meses: con un solo número no se sabría a cuál de
   * los dos va lo que alguien teclea, y `bonificaciones.values` guarda
   * `[{ mes, quantity }]` mes a mes.
   */
  cantidades: number[][];
  /**
   * La misma cuenta, pero contando los bonos MARCADOS EN RECORRIDOS.
   *
   * Es la otra mitad del cuadre: `cantidades` dice lo que la liquidación paga
   * y esto lo que el canvas de recorridos registra. Son dos tablas distintas
   * (`bonificaciones` y `registro_dia_laboral_bono`) sin puente automático
   * entre ellas, así que pueden discrepar y nadie se entera.
   */
  cantidadesRecorridos: number[][];
  /** Suma de la fila: es lo que el desprendible paga de este bono. */
  total: number;
  totalRecorridos: number;
  /**
   * `true` si alguna celda no cuadra entre las dos fuentes.
   *
   * Se calcula aquí y no en el builder porque el PDF y el XLSX tienen que
   * resaltar exactamente las mismas celdas que el canvas.
   */
  descuadra: boolean;
}

export interface MatrizBonos {
  /** Placas que son columna, en el mismo orden que `placasUsadas`. */
  placas: PlacaBono[];
  /**
   * Meses del corte en `YYYY-MM`, en orden. Son las subcolumnas de cada placa.
   *
   * Salen del periodo y no de lo que traigan los bonos guardados: si un mes no
   * tiene ninguno, su columna tiene que existir igual para poder escribir en
   * ella.
   */
  meses: string[];
  filas: FilaBono[];
  /**
   * `true` si el conductor tiene ALGÚN bono marcado en recorridos en el
   * periodo.
   *
   * Cuando es `false` no se pinta la comparación: el caso normal de un
   * conductor al que nadie le ha marcado bonos en el canvas de recorridos
   * daría una columna entera de ceros frente a las cantidades de la
   * liquidación, y eso se lee como «todo está mal» cuando en realidad es
   * «aquí no hay nada con qué comparar».
   */
  hayRecorridos: boolean;
}

/** Una línea del desprendible. */
export interface ConceptoDesprendible {
  /** Clave estable para el binding de celda; el rótulo puede cambiar. */
  clave: string;
  nombre: string;
  cantidad: number | null;
  valor: number;
  /** `false` en los conceptos derivados que el usuario no debe teclear. */
  editable: boolean;
  /**
   * Importe MENSUAL que este concepto prorratea entre 30.
   *
   * Está para que la hoja pueda escribir el valor como FÓRMULA —«base entre
   * 30 por la cantidad»— en vez de como una cifra fija: así cambiar los días
   * en la columna CANT. mueve el importe en el acto, sin ir y volver al
   * servidor, y se ve de dónde sale el número.
   *
   * Ausente cuando el concepto NO prorratea: los que se teclean enteros
   * (vacaciones, bonos, conceptos adicionales) y el auxilio de transporte
   * cuando esta liquidación lo tiene descontado, donde la fórmula pintaría un
   * importe que no corresponde.
   */
  baseMensual?: number;
  /**
   * Cantidad desde la que el concepto se paga ENTERO, sin prorratear.
   *
   * Solo lo lleva la NIVELACIÓN DE SALARIO: con 17 días de Villanueva o más se
   * paga la diferencia completa del mes (ver `DIAS_VILLANUEVA_COMPLETO`). Viaja
   * con el concepto porque la hoja escribe el importe como fórmula sobre la
   * cantidad, y sin el tope la celda diría menos que el servidor.
   *
   * Ausente en todo lo demás, que prorratea siempre.
   */
  umbralCompleto?: number;
  /**
   * `true` en las filas que solo son un RÓTULO DE SECCIÓN, como «OTROS».
   *
   * No llevan cantidad ni valor y no suman: separan el bloque de conceptos
   * fijos del de recargos, igual que en los Excel de los que viene esta
   * nómina. El builder las pinta a lo ancho y centradas.
   */
  seccion?: boolean;
}

/**
 * El bloque de vacaciones que se teclea al lado del desprendible.
 *
 * Los días NO se guardan: salen de las dos fechas y se recalculan solos. Un día
 * guardado que no cuadre con sus fechas es un dato que miente, y aquí las
 * fechas son lo que alguien puede justificar.
 */
export interface VacacionesHoja {
  /** `YYYY-MM-DD`, o `null` si no hay vacaciones en el periodo. */
  desde: string | null;
  hasta: string | null;
  /**
   * Días disfrutados, CONTANDO EL DÍA DE INICIO.
   *
   * Del 1 al 15 son 15 días, no 14: el primer día se disfruta entero. Es la
   * cuenta que hace nómina y la que espera quien revisa.
   */
  dias: number;
  /**
   * Salario sobre el que se liquidan. Si la liquidación no lo fija, es el
   * básico del tramo.
   */
  salarioBase: number;
  /** `true` cuando `salarioBase` viene del tramo y no de la liquidación. */
  salarioHeredado: boolean;
}

export interface HojaNomina {
  conductorId: string;
  /** `liquidaciones.id` del periodo, si ya existe. */
  liquidacionId: string | null;
  /** Para el CAS de la edición celda a celda. */
  version: number;
  estado: string;
  nombre: string;
  cedula: string | null;
  /// `conductores.nomina`. `false` = trabaja pero no está marcado para nómina.
  enNomina?: boolean;
  /// Estado OPERATIVO del conductor (activo / programado / servicio /
  /// disponible / inactivo / desvinculado). NO es un estado laboral: un
  /// `programado` o `en servicio` está trabajando y cobra igual.
  estadoConductor?: string | null;
  /**
   * Básico con el que se liquida el DESPRENDIBLE (`salario_basico` de la
   * liquidación, o el del conductor mientras esté en null).
   *
   * Aparte de `salarioBasico`, que es el de `configuraciones_salario` y es de
   * donde salen el valor hora y los siete recargos.
   */
  salarioBasicoDesprendible?: number;
  /** `true` = lo fijó esta liquidación; `false` = viene del conductor. */
  salarioBasicoFijado?: boolean;
  /** Correo del conductor: es a donde va el desprendible. `null` si no tiene. */
  correo: string | null;
  cargo: string;
  /** Nombre de la pestaña, ya desambiguado. */
  nombreHoja: string;
  tipoVehiculo: string | null;
  /** Placas usadas en el periodo, en orden de aparición. */
  placas: string[];
  /** Las mismas, con su color, para la leyenda y la fila de días. */
  placasUsadas: PlacaNomina[];
  /** Bonos × placa. Vacío si la liquidación no tiene bonificaciones. */
  matrizBonos: MatrizBonos;
  /**
   * A qué nómina pertenece el conductor en ESTE periodo: `PAREX`, `GEOPARK`,
   * `PAREX, GEOPARK` o `VILLANUEVA`.
   *
   * Sale de las empresas con las que trabajó —las mismas que alimentan el
   * desglose por empresa—, no de un campo del conductor: alguien puede estar en
   * Parex en julio y en Villanueva en agosto, y el dato tiene que seguir al
   * periodo. `VILLANUEVA` es el caso por defecto: ni Parex ni Geopark.
   */
  tipoNomina: string;

  dias: DiaHoja[];
  /**
   * Una fila por código y por tramo de vigencia. Con un solo tramo son las
   * siete de siempre.
   */
  tarifas: TarifaRecargo[];
  /** Los tramos de vigencia que cruza el corte. Casi siempre uno. */
  tramos: TramoVigencia[];
  bloquesEmpresa: BloqueEmpresa[];

  /**
   * Config salarial vigente al CIERRE del periodo (el último tramo). Se
   * conserva para lo que necesita un único número; el dinero no sale de
   * aquí, sale de `tarifas`, que va por tramo.
   */
  salarioBasico: number;
  valorHora: number;
  horasMensualesBase: number;
  jornadaNormalHoras: number;
  jornadaFestivaHoras: number;

  totalHorasMes: number;
  /** Horas repartidas entre lo que va al desprendible y lo que va a disponibilidad. */
  repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[];
  repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[];

  /** Fechas, días y salario de las vacaciones del periodo. */
  vacaciones: VacacionesHoja;

  devengos: ConceptoDesprendible[];
  deducciones: ConceptoDesprendible[];
  totales: ResultadoLiquidacion;

  /** Clientes que aparecen en esta hoja, en orden alfabético. Es la leyenda. */
  clientes: ClienteNomina[];
  /**
   * La liquidación existe y tiene recargos, pero NINGUNA fila en `recargos`.
   *
   * El desprendible suma las filas, no la columna `total_recargos`, así que en
   * ese estado el comprobante del conductor sale con «Otros … $ 0». Lo enciende
   * el carril para ofrecer «Rehacer recargos».
   */
  sinFilasDeRecargos: boolean;
  /** Avisos por hoja: planilla sin config salarial, conductor sin salario… */
  avisos: string[];
}

export interface NominaPeriodoDTO {
  anio: number;
  mes: number;
  corte: number;
  etiqueta: string;
  periodo: { dias: DiaPeriodo[]; semanas: SemanaPeriodo[] };
  /**
   * Las dos constantes de la fila 10 del Excel (`horas − 7 − 3`). Se dejan
   * aquí, editables desde el canvas y guardadas en el snapshot, en vez de en
   * `configuraciones_salarios`: de dónde salen el 7 y el 3 no está escrito en
   * ninguna parte y no conviene fijarlo en el esquema hasta saberlo.
   */
  disponibilidad: { horasBase: number; horasDescuento: number };
  /** Topes legales que el Excel lleva a mano (42 h semanales, 210 mensuales, 44 extras). */
  topes: { horasSemanales: number; horasMensuales: number; horasExtrasMes: number };
  hojas: HojaNomina[];
  /** Todos los clientes del periodo con su color, para exportes y filtros. */
  clientes: ClienteNomina[];
  avisos: string[];
}
