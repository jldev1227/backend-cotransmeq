/**
 * Estados de la liquidación ocasional de terceros y sus transiciones por
 * `PATCH /api/liquidaciones-terceros-ocasional/:id/estado`.
 *
 * Hasta oct-2026 esa ruta escribía cualquier texto en `estado` (la columna es
 * VARCHAR, no enum), sin mirar el estado de origen ni el área, y también sobre
 * cabeceras eliminadas: con nivel `limited` se aprobaba o se «desanulaba» una
 * liquidación. Es la misma máquina que la de los cierres finales
 * (`liquidaciones-terceros-descuentos/cierre-estado.service.ts`) con dos
 * diferencias del ocasional:
 *
 * - FACTURADA sigue siendo su estado de cobro: PAGADA reemplazó a FACTURADA
 *   solo en los cierres finales (ver `cierre-estado.service.ts`).
 * - A LIQUIDADA se llega con `POST /:id/cerrar-y-distribuir`, que comprueba
 *   que cada placa tenga su cierre final y los asocia. Por esta ruta se
 *   saltaba esa comprobación, así que aquí no es destino.
 *
 * Archivo sin Prisma a propósito: la tabla se prueba sin base.
 */

export const ESTADOS_OCASIONAL = [
  'BORRADOR',
  'LIQUIDADA',
  'APROBADA',
  'FACTURADA',
  'ANULADA',
  /// Lo pone `crear` con `force_new` sobre una APROBADA/FACTURADA, junto con
  /// `deleted_at`. No se fija a mano.
  'REEMPLAZADA',
] as const

export type EstadoOcasional = (typeof ESTADOS_OCASIONAL)[number]

/** Flujo normal: lo que se puede fijar desde cada estado por la ruta de estado. */
export const TRANSICIONES_OCASIONAL: Record<EstadoOcasional, readonly EstadoOcasional[]> = {
  BORRADOR: ['ANULADA'],
  LIQUIDADA: ['APROBADA', 'BORRADOR', 'ANULADA'],
  APROBADA: ['LIQUIDADA', 'FACTURADA', 'ANULADA'],
  FACTURADA: ['ANULADA'],
  ANULADA: [],
  REEMPLAZADA: [],
}

/**
 * Puerta de atrás de Administración, como la de PAGADA → APROBADA en los
 * cierres: una liquidación se marca facturada por error como cualquier otra.
 */
export const TRANSICIONES_ADMIN_OCASIONAL: Partial<Record<EstadoOcasional, readonly EstadoOcasional[]>> = {
  FACTURADA: ['APROBADA'],
}

/** Entrar en estos estados es de Administración: congelan el documento. */
export const ESTADOS_ENTRADA_ADMIN_OCASIONAL: readonly EstadoOcasional[] = ['APROBADA', 'FACTURADA']

/** Salir de estos estados también es de Administración. */
export const ESTADOS_SALIDA_ADMIN_OCASIONAL: readonly EstadoOcasional[] = ['APROBADA', 'FACTURADA']

/**
 * Estados en los que la hoja no se edita: el servicio del ocasional ya los
 * usaba sueltos (`ESTADOS_OCASIONAL_BLOQUEADA`), más REEMPLAZADA. Revertir un
 * snapshot es editar, así que se niega en todos ellos.
 */
export const ESTADOS_OCASIONAL_NO_EDITABLES: readonly string[] = [
  'APROBADA',
  'FACTURADA',
  'ANULADA',
  'REEMPLAZADA',
]

export type CodigoErrorEstadoOcasional =
  | 'ESTADO_INVALIDO'
  | 'TRANSICION_INVALIDA'
  | 'SIN_PERMISO'
  | 'FALTA_MOTIVO'
  | 'NO_ENCONTRADO'
  | 'ESTADO_CAMBIADO'

export class ErrorEstadoOcasional extends Error {
  constructor(
    message: string,
    readonly statusCode: 400 | 403 | 404 | 409,
    readonly codigo: CodigoErrorEstadoOcasional,
  ) {
    super(message)
  }
}

/** Mismo criterio que `esAdmin` de los cierres: área ADMINISTRACION. */
export function esAdministracion(areas: unknown): boolean {
  const lista = !areas ? [] : Array.isArray(areas) ? areas : [areas]
  return lista.some((a) => String(a).toUpperCase() === 'ADMINISTRACION')
}

/** Destinos que este actor puede fijar desde `estadoActual`. */
export function destinosOcasional(estadoActual: string, admin: boolean): EstadoOcasional[] {
  const base: readonly EstadoOcasional[] = TRANSICIONES_OCASIONAL[estadoActual as EstadoOcasional] ?? []
  if (!admin) return [...base]
  const puertaAtras: readonly EstadoOcasional[] =
    TRANSICIONES_ADMIN_OCASIONAL[estadoActual as EstadoOcasional] ?? []
  return [...base, ...puertaAtras.filter((e) => !base.includes(e))]
}

/**
 * Valida valor, transición, área y motivo. Lanza `ErrorEstadoOcasional` o
 * devuelve el destino tipado.
 */
export function validarCambioEstadoOcasional(
  estadoActual: string | null | undefined,
  destino: unknown,
  opciones: { admin: boolean; motivo?: unknown },
): EstadoOcasional {
  const fijables = ESTADOS_OCASIONAL.filter((e) => e !== 'REEMPLAZADA')
  if (typeof destino !== 'string' || !(fijables as readonly string[]).includes(destino)) {
    throw new ErrorEstadoOcasional(
      `Estado inválido: ${String(destino ?? '(vacío)')}. Válidos: ${fijables.join(', ')}.`,
      400,
      'ESTADO_INVALIDO',
    )
  }
  const hacia = destino as EstadoOcasional
  const actual = estadoActual || 'BORRADOR'

  if (hacia === 'LIQUIDADA' && actual === 'BORRADOR') {
    throw new ErrorEstadoOcasional(
      'Para liquidar usa «Cerrar y distribuir»: comprueba que cada placa tenga su cierre final.',
      409,
      'TRANSICION_INVALIDA',
    )
  }

  const destinos = destinosOcasional(actual, opciones.admin)
  if (!destinos.includes(hacia)) {
    throw new ErrorEstadoOcasional(
      `Transición no válida de ${actual} a ${hacia}. Permitidas: ${destinos.join(', ') || 'ninguna'}.`,
      409,
      'TRANSICION_INVALIDA',
    )
  }

  if (!opciones.admin && ESTADOS_ENTRADA_ADMIN_OCASIONAL.includes(hacia)) {
    throw new ErrorEstadoOcasional(
      `Solo Administración puede pasar una liquidación a ${hacia}.`,
      403,
      'SIN_PERMISO',
    )
  }
  if (!opciones.admin && ESTADOS_SALIDA_ADMIN_OCASIONAL.includes(actual as EstadoOcasional)) {
    throw new ErrorEstadoOcasional(
      `La liquidación está ${actual}. Solo Administración puede modificar su estado.`,
      403,
      'SIN_PERMISO',
    )
  }

  if (hacia === 'ANULADA' && !(typeof opciones.motivo === 'string' && opciones.motivo.trim())) {
    throw new ErrorEstadoOcasional('Se requiere motivo para anular', 400, 'FALTA_MOTIVO')
  }

  return hacia
}
