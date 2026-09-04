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
  /** Horas acumuladas del conductor en el periodo. */
  horas: number;
  valor: number;
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

/** Una línea del desprendible. */
export interface ConceptoDesprendible {
  /** Clave estable para el binding de celda; el rótulo puede cambiar. */
  clave: string;
  nombre: string;
  cantidad: number | null;
  valor: number;
  /** `false` en los conceptos derivados que el usuario no debe teclear. */
  editable: boolean;
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
  cargo: string;
  /** Nombre de la pestaña, ya desambiguado. */
  nombreHoja: string;
  tipoVehiculo: string | null;
  placas: string[];

  dias: DiaHoja[];
  tarifas: TarifaRecargo[];
  bloquesEmpresa: BloqueEmpresa[];

  /** Config salarial vigente al cierre del periodo. */
  salarioBasico: number;
  valorHora: number;
  horasMensualesBase: number;
  jornadaNormalHoras: number;
  jornadaFestivaHoras: number;

  totalHorasMes: number;
  /** Horas repartidas entre lo que va al desprendible y lo que va a disponibilidad. */
  repartoDesprendible: { codigo: CodigoRecargo; horas: number; valor: number }[];
  repartoDisponibilidad: { codigo: CodigoRecargo; horas: number; valor: number }[];

  devengos: ConceptoDesprendible[];
  deducciones: ConceptoDesprendible[];
  totales: ResultadoLiquidacion;

  /** Clientes que aparecen en esta hoja, en orden alfabético. Es la leyenda. */
  clientes: ClienteNomina[];
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
