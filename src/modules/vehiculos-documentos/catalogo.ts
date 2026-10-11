/**
 * Documentos de la hoja de vida de un vehículo.
 *
 * Las claves son las que ya usa la tabla `documento` (la carga de 2025 y la
 * sección «Mantenimiento» del panel), así que no se renombra ninguna. El
 * front recibe este catálogo en la respuesta del listado: no hay una segunda
 * copia que mantener.
 *
 * `vence`: lleva fecha de vencimiento y entra al control de vigencias.
 * `puedeNoAplicar`: un vehículo nuevo no está obligado todavía (la
 * tecnomecánica de los primeros años se reemplaza por el certificado RUNT).
 * `cicloMeses`: periodicidad habitual, solo para sugerir la fecha al subir.
 */
export type GrupoDocumento = 'vigencias' | 'legales' | 'operacion'

export interface CategoriaDocumento {
  clave: string
  etiqueta: string
  grupo: GrupoDocumento
  vence: boolean
  puedeNoAplicar?: boolean
  cicloMeses?: number
  /** Lo que se le muestra al conductor en la app móvil (lo que piden en vía). */
  paraConductor?: boolean
}

export const CATEGORIAS_DOCUMENTO: CategoriaDocumento[] = [
  // ── Vigencias: alimentan el panel y los avisos ──
  { clave: 'SOAT', etiqueta: 'SOAT', grupo: 'vigencias', vence: true, cicloMeses: 12, paraConductor: true },
  { clave: 'TECNOMECANICA', etiqueta: 'Revisión tecnomecánica', grupo: 'vigencias', vence: true, cicloMeses: 12, puedeNoAplicar: true, paraConductor: true },
  { clave: 'TARJETA_DE_OPERACION', etiqueta: 'Tarjeta de operación', grupo: 'vigencias', vence: true, cicloMeses: 24, paraConductor: true },
  { clave: 'POLIZA_CONTRACTUAL', etiqueta: 'Póliza RC contractual', grupo: 'vigencias', vence: true, cicloMeses: 12, paraConductor: true },
  { clave: 'POLIZA_EXTRACONTRACTUAL', etiqueta: 'Póliza RC extracontractual', grupo: 'vigencias', vence: true, cicloMeses: 12, paraConductor: true },
  { clave: 'POLIZA_TODO_RIESGO', etiqueta: 'Póliza todo riesgo', grupo: 'vigencias', vence: true, cicloMeses: 12 },
  { clave: 'REVISION_PREVENTIVA', etiqueta: 'Revisión preventiva', grupo: 'vigencias', vence: true, cicloMeses: 2, paraConductor: true },
  { clave: 'CERTIFICADO_GPS', etiqueta: 'Certificado GPS', grupo: 'vigencias', vence: true, cicloMeses: 12 },
  // ── Legales: sin vencimiento, hoja de vida ──
  { clave: 'TARJETA_DE_PROPIEDAD', etiqueta: 'Tarjeta de propiedad', grupo: 'legales', vence: false, paraConductor: true },
  { clave: 'RUNT', etiqueta: 'Certificado RUNT', grupo: 'legales', vence: false },
  { clave: 'CAPACIDAD_TRANSPORTADORA', etiqueta: 'Capacidad transportadora', grupo: 'legales', vence: false },
  { clave: 'CONTRATO_ADMINISTRACION', etiqueta: 'Convenio de administración de flota', grupo: 'legales', vence: false },
  { clave: 'CONTRATO_PRESTACION', etiqueta: 'Contrato de prestación de servicios', grupo: 'legales', vence: false },
  { clave: 'RUT_PROPIETARIO', etiqueta: 'RUT del propietario', grupo: 'legales', vence: false },
  { clave: 'HOJA_DE_VIDA', etiqueta: 'Hoja de vida (HSEQ-FR-11)', grupo: 'legales', vence: false },
  // ── Operación: consultas y soportes ──
  { clave: 'PERITAJE', etiqueta: 'Peritaje', grupo: 'operacion', vence: false },
  { clave: 'SIMIT', etiqueta: 'Estado de cuenta SIMIT', grupo: 'operacion', vence: false },
  { clave: 'REVISION_DIJIN', etiqueta: 'Verificación SIJIN / DIJIN', grupo: 'operacion', vence: false },
  { clave: 'PAZ_Y_SALVO_MOVILIDAD', etiqueta: 'Paz y salvo de movilidad', grupo: 'operacion', vence: false },
  { clave: 'IMPUESTO_VEHICULAR', etiqueta: 'Pago de impuesto vehicular', grupo: 'operacion', vence: false },
  { clave: 'SENALIZACION', etiqueta: 'Señalización y calcomanías', grupo: 'operacion', vence: false },
  { clave: 'MANUAL', etiqueta: 'Manual del vehículo', grupo: 'operacion', vence: false, paraConductor: true },
]

export const CATEGORIA_POR_CLAVE = new Map(CATEGORIAS_DOCUMENTO.map((c) => [c.clave, c]))

/** Días antes del vencimiento en que un documento pasa a «por vencer». */
export const DIAS_POR_VENCER = 30

/// Estados de la fila en `documento.estado`. `vigente` es el valor que ya usa
/// el panel; una versión nueva deja la anterior como `reemplazado`.
export const ESTADO_VIGENTE = 'vigente'
export const ESTADO_REEMPLAZADO = 'reemplazado'
export const ESTADO_NO_APLICA = 'no_aplica'
