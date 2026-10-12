/**
 * Condiciones de cobro de una factura: valor, emisión, plazo y vencimiento.
 *
 * Puro: lo usan `FacturacionLiquidacionesService.crear` (al facturar) y
 * `CarteraService.actualizarCondiciones` (al corregir después), y las dos
 * rutas tienen que aplicar exactamente las mismas reglas.
 */
import { diasEntre, sumarDias } from '../../lib/pagos/medios'

/** Error de cartera con su código HTTP. Lo traducen los controladores. */
export class ErrorCartera extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
    readonly code:
      | 'DATOS_INVALIDOS'
      | 'NO_ENCONTRADA'
      | 'FACTURA_ANULADA'
      | 'SUPERA_SALDO'
      | 'VALOR_MENOR_QUE_ABONADO'
      | 'TIENE_ABONOS' = 'DATOS_INVALIDOS',
  ) {
    super(message)
  }
}

/// Treinta días es el plazo con el que factura la empresa a casi todos sus
/// clientes. Se puede cambiar factura por factura.
export const PLAZO_POR_DEFECTO = 30
export const PLAZO_MAXIMO = 365
/// Tope de cordura para un valor digitado a mano (Decimal(14,2) admite más).
const VALOR_MAXIMO = 999_999_999_999

const DIA = /^\d{4}-\d{2}-\d{2}$/

/** `YYYY-MM-DD` que además es una fecha real (rechaza 2026-02-30). */
export function esDiaValido(v: unknown): v is string {
  if (typeof v !== 'string' || !DIA.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export interface EntradaCondiciones {
  valor_total?: number | string | null
  fecha_emision?: string | null
  plazo_dias?: number | string | null
  fecha_vencimiento?: string | null
}

export interface CondicionesActuales {
  /** Suma de las liquidaciones vivas de la factura. */
  suma: number
  fecha_emision: string
  plazo_dias: number
  ajuste_valor: number
}

export interface CondicionesResueltas {
  valor_total: number
  ajuste_valor: number
  fecha_emision: string
  plazo_dias: number
  fecha_vencimiento: string
}

const centavos = (n: number) => Math.round(n * 100)

/**
 * Funde lo que llega con lo que ya hay y valida.
 *
 * - El valor se guarda como AJUSTE sobre la suma de las liquidaciones (ver la
 *   migración 20261011120000): digitar el valor de la factura electrónica
 *   deja `ajuste = valor − suma`.
 * - Plazo y vencimiento son dos formas de decir lo mismo. Si llega el
 *   vencimiento, manda él y el plazo se recalcula; si no, vencimiento =
 *   emisión + plazo. Cambiar solo la emisión arrastra el vencimiento con el
 *   mismo plazo, que es lo que se espera al corregir una fecha mal digitada.
 */
export function resolverCondiciones(
  entrada: EntradaCondiciones,
  actual: CondicionesActuales,
): CondicionesResueltas {
  const emision = entrada.fecha_emision ?? actual.fecha_emision
  if (!esDiaValido(emision)) throw new ErrorCartera('La fecha de emisión no es válida (AAAA-MM-DD).')

  let plazo: number
  let vencimiento: string
  if (entrada.fecha_vencimiento != null && entrada.fecha_vencimiento !== '') {
    if (!esDiaValido(entrada.fecha_vencimiento)) {
      throw new ErrorCartera('La fecha de vencimiento no es válida (AAAA-MM-DD).')
    }
    vencimiento = entrada.fecha_vencimiento
    plazo = diasEntre(emision, vencimiento)
    if (plazo < 0) throw new ErrorCartera('El vencimiento no puede ser anterior a la emisión.')
    if (plazo > PLAZO_MAXIMO) {
      throw new ErrorCartera(`El vencimiento no puede pasar de ${PLAZO_MAXIMO} días tras la emisión.`)
    }
  } else {
    const crudo = entrada.plazo_dias ?? actual.plazo_dias
    plazo = typeof crudo === 'string' ? Number(crudo.trim()) : Number(crudo)
    if (!Number.isInteger(plazo) || plazo < 0 || plazo > PLAZO_MAXIMO) {
      throw new ErrorCartera(`El plazo debe ser un número entero de días entre 0 y ${PLAZO_MAXIMO}.`)
    }
    vencimiento = sumarDias(emision, plazo)
  }

  let ajusteC = centavos(actual.ajuste_valor)
  if (entrada.valor_total != null && entrada.valor_total !== '') {
    const valor = Number(entrada.valor_total)
    if (!Number.isFinite(valor) || valor < 0 || valor > VALOR_MAXIMO) {
      throw new ErrorCartera('El valor de la factura no es válido.')
    }
    ajusteC = centavos(valor) - centavos(actual.suma)
  }
  const valorC = centavos(actual.suma) + ajusteC
  if (valorC < 0) throw new ErrorCartera('El valor de la factura no puede ser negativo.')

  return {
    valor_total: valorC / 100,
    ajuste_valor: ajusteC / 100,
    fecha_emision: emision,
    plazo_dias: plazo,
    fecha_vencimiento: vencimiento,
  }
}
