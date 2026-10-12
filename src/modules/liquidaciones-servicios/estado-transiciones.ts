/**
 * Máquina de estados de una liquidación de servicios
 * (`PATCH /api/liquidaciones-servicios/:id/estado`).
 *
 * Hasta oct-2026 la ruta escribía en `estado` lo que llegara: con
 * `liquidaciones-servicios:full` se podía poner FACTURADA sin factura, sacar
 * una ANULADA directo a APROBADA, y un valor fuera del enum salía como 500 con
 * el volcado de Prisma. Las transiciones de aquí son las que ofrecen la lista
 * y el canvas de `dashboard/liquidaciones-servicios` y las que ya probaba
 * `tests/liquidaciones-servicios-flujo.test.ts`.
 *
 * Archivo sin Prisma a propósito: la tabla se prueba sin base.
 */

export const ESTADOS_LIQUIDACION_SERVICIO = [
  'BORRADOR',
  'LIQUIDADA',
  'APROBADA',
  'FACTURADA',
  'ANULADA',
] as const

export type EstadoLiquidacionServicio = (typeof ESTADOS_LIQUIDACION_SERVICIO)[number]

/**
 * Destinos permitidos desde cada estado por ESTA ruta.
 *
 * - FACTURADA no es destino de nadie: la pone la facturación
 *   (`facturacion-liquidaciones`) al meter la liquidación en una factura, con
 *   la factura de por medio. Ponerla aquí dejaba una «facturada» sin factura.
 * - Desde FACTURADA solo se vuelve a APROBADA (el «Devolver a aprobada» de la
 *   lista), y solo si no queda factura activa: eso lo comprueba el
 *   controlador antes (409 `FACTURA_ACTIVA`).
 * - ANULADA solo se reactiva a BORRADOR: así vuelve a pasar por liquidar y
 *   aprobar, con sus firmas, en vez de reaparecer aprobada.
 * - APROBADA → BORRADOR existe (lo usa la suite de flujo y limpia las dos
 *   firmas); como toda salida de APROBADA, es de Administración.
 */
export const TRANSICIONES_LIQUIDACION_SERVICIO: Record<
  EstadoLiquidacionServicio,
  readonly EstadoLiquidacionServicio[]
> = {
  BORRADOR: ['LIQUIDADA', 'ANULADA'],
  LIQUIDADA: ['APROBADA', 'BORRADOR', 'ANULADA'],
  APROBADA: ['LIQUIDADA', 'BORRADOR', 'ANULADA'],
  FACTURADA: ['APROBADA'],
  ANULADA: ['BORRADOR'],
}

export function esEstadoLiquidacionServicio(valor: unknown): valor is EstadoLiquidacionServicio {
  return (
    typeof valor === 'string' &&
    (ESTADOS_LIQUIDACION_SERVICIO as readonly string[]).includes(valor)
  )
}

export type CodigoErrorEstadoLiquidacion =
  | 'ESTADO_INVALIDO'
  | 'TRANSICION_INVALIDA'
  | 'FALTA_MOTIVO'
  | 'LIQUIDACION_NO_ENCONTRADA'
  | 'ESTADO_CAMBIADO'

/** Error de dominio del cambio de estado; el controlador lo traduce a HTTP. */
export class ErrorEstadoLiquidacion extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 404 | 409,
    readonly codigo: CodigoErrorEstadoLiquidacion,
  ) {
    super(message)
  }
}

const NOMBRE: Record<EstadoLiquidacionServicio, string> = {
  BORRADOR: 'borrador',
  LIQUIDADA: 'liquidada',
  APROBADA: 'aprobada',
  FACTURADA: 'facturada',
  ANULADA: 'anulada',
}

/**
 * Valida valor, transición y motivo. Lanza `ErrorEstadoLiquidacion` (400/409)
 * o devuelve el destino ya tipado. Las reglas de ÁREA (Administración para
 * aprobar, para salir de APROBADA/FACTURADA y para reactivar una ANULADA)
 * van en el controlador, que es quien conoce al usuario.
 */
export function validarTransicionLiquidacion(
  estadoActual: string,
  destino: unknown,
  motivo?: unknown,
): EstadoLiquidacionServicio {
  if (!esEstadoLiquidacionServicio(destino)) {
    throw new ErrorEstadoLiquidacion(
      `Estado inválido: ${String(destino ?? '(vacío)')}. Válidos: ${ESTADOS_LIQUIDACION_SERVICIO.join(', ')}.`,
      400,
      'ESTADO_INVALIDO',
    )
  }
  if (destino === 'FACTURADA') {
    throw new ErrorEstadoLiquidacion(
      'Una liquidación pasa a facturada al incluirla en una factura, desde Facturación; no por cambio de estado.',
      409,
      'TRANSICION_INVALIDA',
    )
  }
  const actual = esEstadoLiquidacionServicio(estadoActual) ? estadoActual : null
  if (actual === destino) {
    throw new ErrorEstadoLiquidacion(
      `La liquidación ya está ${NOMBRE[destino]}.`,
      409,
      'TRANSICION_INVALIDA',
    )
  }
  const permitidos: readonly EstadoLiquidacionServicio[] = actual
    ? TRANSICIONES_LIQUIDACION_SERVICIO[actual]
    : []
  if (!permitidos.includes(destino)) {
    const opciones = permitidos.map((e) => NOMBRE[e]).join(', ')
    throw new ErrorEstadoLiquidacion(
      `Una liquidación ${actual ? NOMBRE[actual] : `en estado ${estadoActual}`} no puede pasar a ${NOMBRE[destino]}.` +
        (opciones ? ` Desde ahí solo puede pasar a: ${opciones}.` : ''),
      409,
      'TRANSICION_INVALIDA',
    )
  }
  if (destino === 'ANULADA' && !(typeof motivo === 'string' && motivo.trim())) {
    throw new ErrorEstadoLiquidacion('Indica el motivo de la anulación.', 400, 'FALTA_MOTIVO')
  }
  return destino
}
