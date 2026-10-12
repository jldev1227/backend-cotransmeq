/**
 * Cálculo de cartera: saldo, estado y edad de cada factura, y su agregado por
 * cliente.
 *
 * Puro a propósito (sin Prisma ni fechas del reloj): el servicio le pasa `hoy`
 * y los montos ya leídos, y los tests fijan los tramos sin base de datos. Es
 * la ÚNICA fuente de estas reglas; el frontend pinta lo que sale de aquí.
 *
 * Todo se suma en centavos enteros. Los montos llegan como `Decimal(14,2)` y
 * sumados en coma flotante un saldo de 0,01 podía quedar en 0,009999 y la
 * factura salir «abonada» cuando estaba pagada.
 */
import { diasEntre } from '../../lib/pagos/medios'

export type EstadoCartera = 'pendiente' | 'abonada' | 'pagada' | 'vencida'

/** Tramos de edad de la deuda vencida. `corriente` = aún no vence. */
export type TramoEdad = 'corriente' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_mas'

export const TRAMOS: readonly TramoEdad[] = ['corriente', 'd1_30', 'd31_60', 'd61_90', 'd90_mas']

/** Lo que aporta un abono al saldo. Acepta `Decimal` de Prisma o números. */
export interface MontosAbono {
  valor?: unknown
  retefuente?: unknown
  reteica?: unknown
  reteiva?: unknown
  otros_descuentos?: unknown
}

export interface SituacionFactura {
  valor: number
  /** Lo que entró al banco. */
  recibido: number
  /** Retenciones y descuentos aplicados por el cliente. */
  retenciones: number
  /** recibido + retenciones: lo que baja el saldo. */
  aplicado: number
  /** valor − aplicado. Negativo si se aplicó de más (p. ej. se rebajó el valor después). */
  saldo: number
  estado: EstadoCartera
  /** Días desde el vencimiento con saldo pendiente; 0 si no está vencida. */
  dias_vencida: number
  /** `null` cuando no queda nada por cobrar. */
  tramo: TramoEdad | null
}

const centavos = (n: unknown): number => {
  const v = Number(n ?? 0)
  return Number.isFinite(v) ? Math.round(v * 100) : 0
}
const pesos = (c: number): number => c / 100

/** Retenciones de un abono, en centavos. */
function retencionesC(a: MontosAbono): number {
  return centavos(a.retefuente) + centavos(a.reteica) + centavos(a.reteiva) + centavos(a.otros_descuentos)
}

/** Lo que un abono descuenta del saldo (valor + retenciones), en pesos. */
export function aplicadoDeAbono(a: MontosAbono): number {
  return pesos(centavos(a.valor) + retencionesC(a))
}

/**
 * Tramo de edad según los días vencidos.
 *
 * Los cortes son los de la circular de cartera habitual: 1–30, 31–60, 61–90
 * y más de 90. El día del vencimiento todavía es corriente.
 */
export function tramoEdad(diasVencida: number): TramoEdad {
  if (diasVencida <= 0) return 'corriente'
  if (diasVencida <= 30) return 'd1_30'
  if (diasVencida <= 60) return 'd31_60'
  if (diasVencida <= 90) return 'd61_90'
  return 'd90_mas'
}

/**
 * Situación de una factura a la fecha `hoy` (`YYYY-MM-DD`, hora de Colombia).
 *
 * El estado es derivado, nunca se guarda: guardarlo obligaría a un proceso
 * nocturno que pasara a «vencida» las que cumplen plazo, y el día que fallara
 * la cartera mentiría.
 *  - pagada: no queda saldo (aunque haya vencido).
 *  - vencida: queda saldo y ya pasó la fecha de vencimiento.
 *  - abonada: queda saldo, no ha vencido y hay algún abono.
 *  - pendiente: no ha vencido y no se ha abonado nada.
 */
export function situacionFactura(
  f: { valor_total: unknown; fecha_vencimiento: string; abonos: MontosAbono[] },
  hoy: string,
): SituacionFactura {
  const valorC = centavos(f.valor_total)
  let recibidoC = 0
  let retC = 0
  for (const a of f.abonos) {
    recibidoC += centavos(a.valor)
    retC += retencionesC(a)
  }
  const aplicadoC = recibidoC + retC
  const saldoC = valorC - aplicadoC
  const base = {
    valor: pesos(valorC),
    recibido: pesos(recibidoC),
    retenciones: pesos(retC),
    aplicado: pesos(aplicadoC),
    saldo: pesos(saldoC),
  }

  if (saldoC <= 0) return { ...base, estado: 'pagada', dias_vencida: 0, tramo: null }

  const dias = diasEntre(f.fecha_vencimiento, hoy)
  if (dias > 0) return { ...base, estado: 'vencida', dias_vencida: dias, tramo: tramoEdad(dias) }

  return { ...base, estado: aplicadoC > 0 ? 'abonada' : 'pendiente', dias_vencida: 0, tramo: 'corriente' }
}

export type MontosPorTramo = Record<TramoEdad, number>

const tramosEnCero = (): MontosPorTramo => ({ corriente: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_mas: 0 })

export interface FacturaParaAgrupar {
  cliente_id: string | null
  cliente_nombre: string | null
  cliente_nit: string | null
  fecha_vencimiento: string
  situacion: SituacionFactura
}

export interface FilaCliente {
  cliente_id: string | null
  nombre: string
  nit: string | null
  /** Facturas con saldo. */
  facturas: number
  facturas_vencidas: number
  saldo: number
  vencido: number
  edades: MontosPorTramo
  /** La factura más atrasada del cliente, en días. */
  max_dias_vencida: number
}

/**
 * Edades por cliente: el saldo de cada factura abierta cae en su tramo.
 *
 * Solo cuentan las facturas con saldo positivo; una pagada no aporta nada y
 * una con saldo a favor tampoco resta (sería esconder deuda de otra factura).
 * Orden: más vencido primero, que es por donde empieza quien cobra.
 */
export function agruparPorCliente(facturas: FacturaParaAgrupar[]): FilaCliente[] {
  const mapa = new Map<string, { fila: FilaCliente; edadesC: MontosPorTramo; saldoC: number; vencidoC: number }>()

  for (const f of facturas) {
    const s = f.situacion
    if (s.saldo <= 0 || !s.tramo) continue
    const clave = f.cliente_id ?? 'sin-cliente'
    let acc = mapa.get(clave)
    if (!acc) {
      acc = {
        fila: {
          cliente_id: f.cliente_id,
          nombre: f.cliente_nombre?.trim() || 'Sin cliente',
          nit: f.cliente_nit ?? null,
          facturas: 0,
          facturas_vencidas: 0,
          saldo: 0,
          vencido: 0,
          edades: tramosEnCero(),
          max_dias_vencida: 0,
        },
        edadesC: tramosEnCero(),
        saldoC: 0,
        vencidoC: 0,
      }
      mapa.set(clave, acc)
    }
    const saldoC = centavos(s.saldo)
    acc.fila.facturas += 1
    acc.saldoC += saldoC
    acc.edadesC[s.tramo] += saldoC
    if (s.estado === 'vencida') {
      acc.fila.facturas_vencidas += 1
      acc.vencidoC += saldoC
      acc.fila.max_dias_vencida = Math.max(acc.fila.max_dias_vencida, s.dias_vencida)
    }
  }

  const filas = [...mapa.values()].map(({ fila, edadesC, saldoC, vencidoC }) => ({
    ...fila,
    saldo: pesos(saldoC),
    vencido: pesos(vencidoC),
    edades: Object.fromEntries(TRAMOS.map((t) => [t, pesos(edadesC[t])])) as MontosPorTramo,
  }))

  return filas.sort((a, b) => b.vencido - a.vencido || b.saldo - a.saldo || a.nombre.localeCompare(b.nombre, 'es'))
}

export interface ResumenCartera {
  /** Saldo de todas las facturas abiertas. */
  por_cobrar: number
  vencido: number
  /** Saldo que aún no vence. */
  corriente: number
  /** Saldo sin vencer cuyo vencimiento cae entre hoy y el fin de este mes. */
  por_vencer_mes: number
  facturas_abiertas: number
  facturas_vencidas: number
  clientes_con_saldo: number
  edades: MontosPorTramo
}

/** Último día del mes de `hoy`, como `YYYY-MM-DD`. */
export function finDeMes(hoy: string): string {
  const [a, m] = hoy.split('-').map(Number)
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate()
  return `${hoy.slice(0, 7)}-${String(ultimo).padStart(2, '0')}`
}

export function resumirCartera(facturas: FacturaParaAgrupar[], hoy: string): ResumenCartera {
  const fin = finDeMes(hoy)
  let porCobrarC = 0
  let vencidoC = 0
  let porVencerMesC = 0
  let abiertas = 0
  let vencidas = 0
  const edadesC = tramosEnCero()
  const clientes = new Set<string>()

  for (const f of facturas) {
    const s = f.situacion
    if (s.saldo <= 0 || !s.tramo) continue
    const saldoC = centavos(s.saldo)
    abiertas += 1
    porCobrarC += saldoC
    edadesC[s.tramo] += saldoC
    clientes.add(f.cliente_id ?? 'sin-cliente')
    if (s.estado === 'vencida') {
      vencidas += 1
      vencidoC += saldoC
    } else if (f.fecha_vencimiento >= hoy && f.fecha_vencimiento <= fin) {
      porVencerMesC += saldoC
    }
  }

  return {
    por_cobrar: pesos(porCobrarC),
    vencido: pesos(vencidoC),
    corriente: pesos(porCobrarC - vencidoC),
    por_vencer_mes: pesos(porVencerMesC),
    facturas_abiertas: abiertas,
    facturas_vencidas: vencidas,
    clientes_con_saldo: clientes.size,
    edades: Object.fromEntries(TRAMOS.map((t) => [t, pesos(edadesC[t])])) as MontosPorTramo,
  }
}
