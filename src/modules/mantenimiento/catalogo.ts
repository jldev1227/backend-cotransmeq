/**
 * Catálogo del módulo de mantenimiento de flota.
 *
 * Vive solo aquí: el frontend lo recibe de `GET /mantenimiento/opciones` y no
 * tiene una segunda copia que mantener. Las claves son las que se guardan en
 * `vehicle_maintenance_plan.categoria`; no se renombran.
 *
 * `sugerenciaKm` / `sugerenciaMeses` solo prellenan el formulario del plan. Son
 * intervalos habituales para buses y camionetas diésel de transporte especial;
 * el taller o el manual del fabricante mandan sobre ellos.
 */

export interface CategoriaMantenimiento {
  clave: string
  etiqueta: string
  sugerenciaKm: number | null
  sugerenciaMeses: number | null
}

export const CATEGORIAS_MANTENIMIENTO: CategoriaMantenimiento[] = [
  { clave: 'CAMBIO_ACEITE', etiqueta: 'Cambio de aceite', sugerenciaKm: 5_000, sugerenciaMeses: 3 },
  { clave: 'FILTROS', etiqueta: 'Filtros', sugerenciaKm: 10_000, sugerenciaMeses: 6 },
  { clave: 'FRENOS', etiqueta: 'Frenos', sugerenciaKm: 20_000, sugerenciaMeses: 6 },
  { clave: 'LLANTAS', etiqueta: 'Llantas', sugerenciaKm: 10_000, sugerenciaMeses: 6 },
  { clave: 'ALINEACION_BALANCEO', etiqueta: 'Alineación y balanceo', sugerenciaKm: 10_000, sugerenciaMeses: 6 },
  { clave: 'SINCRONIZACION', etiqueta: 'Sincronización', sugerenciaKm: 20_000, sugerenciaMeses: 12 },
  /// La revisión preventiva bimestral que exige la norma para transporte
  /// especial es un DOCUMENTO del vehículo (`REVISION_PREVENTIVA`, con su
  /// certificado y vencimiento); esto es el plan de taller que la produce.
  { clave: 'REVISION_GENERAL', etiqueta: 'Revisión general', sugerenciaKm: null, sugerenciaMeses: 2 },
  { clave: 'OTRO', etiqueta: 'Otro', sugerenciaKm: null, sugerenciaMeses: null },
]

export const CATEGORIA_MANT_POR_CLAVE = new Map(CATEGORIAS_MANTENIMIENTO.map((c) => [c.clave, c]))
export const CLAVES_CATEGORIA = CATEGORIAS_MANTENIMIENTO.map((c) => c.clave) as [string, ...string[]]

export function etiquetaCategoria(clave: string | null | undefined): string {
  return (clave && CATEGORIA_MANT_POR_CLAVE.get(clave)?.etiqueta) || 'Otro'
}

/** Soportes que se adjuntan a una orden. */
export const TIPOS_ADJUNTO = ['FACTURA', 'FOTO', 'OTRO'] as const
export type TipoAdjunto = (typeof TIPOS_ADJUNTO)[number]
