/**
 * Códigos de error del centro de cumplimiento PESV y su traducción a HTTP.
 *
 * Mismo patrón que `formularios-dinamicos/domain/errors.ts`: el código es lo
 * estable y lo que el cliente consume; el texto es para la persona. El mapa de
 * status vive junto a la lista y no repartido por los `catch` del controller,
 * que es de donde vienen las incoherencias del tipo «este 404 aquí y 500 allá».
 */

export const PESV_ERROR_CODES = [
  // No encontrado
  'CICLO_NO_ENCONTRADO',
  'REQUISITO_NO_ENCONTRADO',
  'EVIDENCIA_NO_ENCONTRADA',
  'META_NO_ENCONTRADA',
  'RIESGO_NO_ENCONTRADO',
  'PROGRAMA_NO_ENCONTRADO',
  'SINIESTRO_NO_ENCONTRADO',
  'MANTENIMIENTO_NO_ENCONTRADO',
  'CONTRATO_NO_ENCONTRADO',
  'FUEC_NO_ENCONTRADO',
  'INDICADOR_NO_ENCONTRADO',

  // Ciclo de vida
  'CICLO_YA_EXISTE',
  'CICLO_CERRADO',
  'PASO_FUERA_DE_RANGO',
  'TRANSICION_NO_PERMITIDA',
  'JUSTIFICACION_REQUERIDA',
  'EVIDENCIA_OBLIGATORIA_PENDIENTE',

  // Revisión de evidencias
  'REVISION_NO_AUTORIZADA',
  'AUTOAPROBACION_PROHIBIDA',
  'EVIDENCIA_YA_REVISADA',
  'EVIDENCIA_ANULADA',

  // Adjuntos
  'ARCHIVO_NO_SUBIDO',
  'ARCHIVO_HASH_NO_COINCIDE',
  'ARCHIVO_DEMASIADO_GRANDE',
  'ARCHIVO_TIPO_NO_PERMITIDO',

  // Contratos y FUEC
  'FUEC_ANULADO',
  'FUEC_SIN_CONTRATO',
  'CONSECUTIVO_OCUPADO',
  'IMPORTACION_FUENTE_AUSENTE',

  // Genéricos
  'DATOS_INVALIDOS',
  'PROHIBIDO',
] as const

export type PesvErrorCode = (typeof PESV_ERROR_CODES)[number]

const STATUS_POR_CODIGO: Record<PesvErrorCode, number> = {
  CICLO_NO_ENCONTRADO: 404,
  REQUISITO_NO_ENCONTRADO: 404,
  EVIDENCIA_NO_ENCONTRADA: 404,
  META_NO_ENCONTRADA: 404,
  RIESGO_NO_ENCONTRADO: 404,
  PROGRAMA_NO_ENCONTRADO: 404,
  SINIESTRO_NO_ENCONTRADO: 404,
  MANTENIMIENTO_NO_ENCONTRADO: 404,
  CONTRATO_NO_ENCONTRADO: 404,
  FUEC_NO_ENCONTRADO: 404,
  INDICADOR_NO_ENCONTRADO: 404,

  CICLO_YA_EXISTE: 409,
  CICLO_CERRADO: 409,
  PASO_FUERA_DE_RANGO: 422,
  TRANSICION_NO_PERMITIDA: 409,
  /// 422 y no 409: el estado del servidor admite la transición; lo que falta
  /// es un campo del payload. Es corregible por quien llama.
  JUSTIFICACION_REQUERIDA: 422,
  /// 409: declarar CUMPLE con soportes obligatorios sin aprobar no es un
  /// problema del payload, es que el expediente todavía no lo sostiene.
  EVIDENCIA_OBLIGATORIA_PENDIENTE: 409,

  REVISION_NO_AUTORIZADA: 403,
  /// Aparte de `REVISION_NO_AUTORIZADA` a propósito: quien aporta SÍ tiene
  /// permiso de revisión en general, lo que no puede es aprobar lo suyo. Un
  /// 403 genérico haría pensar que le falta el permiso y alguien se lo daría.
  AUTOAPROBACION_PROHIBIDA: 403,
  EVIDENCIA_YA_REVISADA: 409,
  EVIDENCIA_ANULADA: 409,

  ARCHIVO_NO_SUBIDO: 422,
  ARCHIVO_HASH_NO_COINCIDE: 422,
  ARCHIVO_DEMASIADO_GRANDE: 413,
  ARCHIVO_TIPO_NO_PERMITIDO: 415,

  FUEC_ANULADO: 409,
  FUEC_SIN_CONTRATO: 422,
  CONSECUTIVO_OCUPADO: 409,
  IMPORTACION_FUENTE_AUSENTE: 422,

  DATOS_INVALIDOS: 422,
  PROHIBIDO: 403,
}

export interface PesvErrorBody {
  success: false
  error: {
    code: PesvErrorCode
    message: string
    details?: unknown
  }
}

/**
 * Error de dominio con código estable.
 *
 * Lo lanza el service; el controller lo traduce. Así el service se prueba sin
 * levantar Fastify, que es la condición para que los calculadores de
 * indicadores tengan tests unitarios de verdad.
 */
export class PesvError extends Error {
  readonly code: PesvErrorCode
  readonly status: number
  readonly details?: unknown

  constructor(code: PesvErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'PesvError'
    this.code = code
    this.status = STATUS_POR_CODIGO[code]
    this.details = details
  }

  toBody(): PesvErrorBody {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    }
  }
}

export function esPesvError(error: unknown): error is PesvError {
  return error instanceof PesvError
}
