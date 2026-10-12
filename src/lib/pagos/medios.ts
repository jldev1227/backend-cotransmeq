/**
 * Medios de pago, compartidos por los abonos de cartera (lo que entra) y los
 * pagos de cierres de terceros (lo que sale).
 *
 * Es la misma lista que fijan los CHECK de las migraciones 20261011120000 y
 * 20261011120100: si se añade uno aquí hay que añadirlo allí, o la base
 * rechazará lo que el esquema zod deja pasar. Espejo en el frontend:
 * `src/lib/pagos/medios.ts`.
 */
export const MEDIOS_PAGO = ['TRANSFERENCIA', 'CONSIGNACION', 'CHEQUE', 'EFECTIVO', 'OTRO'] as const

export type MedioPago = (typeof MEDIOS_PAGO)[number]

export const ETIQUETA_MEDIO: Record<MedioPago, string> = {
  TRANSFERENCIA: 'Transferencia',
  CONSIGNACION: 'Consignación',
  CHEQUE: 'Cheque',
  EFECTIVO: 'Efectivo',
  OTRO: 'Otro',
}

/** Hoy en Colombia como `YYYY-MM-DD`. El servidor corre en UTC. */
export function hoyColombia(ahora: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora)
}

/** `YYYY-MM-DD` de una columna `@db.Date` (Prisma la entrega a medianoche UTC). */
export function isoDia(d: Date | string | null | undefined): string | null {
  if (!d) return null
  if (typeof d === 'string') return d.slice(0, 10)
  return d.toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` → Date a medianoche UTC, que es como Prisma escribe `@db.Date`. */
export function aFechaDb(dia: string): Date {
  return new Date(`${dia}T00:00:00Z`)
}

/** Suma `dias` a un `YYYY-MM-DD` sin pasar por zonas horarias. */
export function sumarDias(dia: string, dias: number): string {
  const d = aFechaDb(dia)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

/** Días de `desde` a `hasta` (ambos `YYYY-MM-DD`); negativo si `hasta` es anterior. */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000)
}

/**
 * Prefijo de los comprobantes de pago de cierres de terceros en S3.
 *
 * El cliente sube el archivo antes de marcar PAGADA y luego manda la clave:
 * sin exigir este prefijo (y la forma exacta de la clave) cualquiera con
 * permiso de marcar pagada podría ligar al cierre una clave ajena —una
 * nómina, un documento de un conductor— y leerla luego por la URL firmada.
 */
export const PREFIJO_COMPROBANTE_PAGO_TERCERO = 'liquidaciones-terceros/pagos/'
export const CLAVE_COMPROBANTE_PAGO_TERCERO =
  /^liquidaciones-terceros\/pagos\/\d{4}-\d{2}\/[0-9a-f-]{36}\.(pdf|jpe?g|png|webp)$/

/** Tipos de archivo admitidos como comprobante (PDF o imagen). */
export const TIPOS_COMPROBANTE = /^(application\/pdf|image\/(png|jpe?g|webp))$/
export const MAX_BYTES_COMPROBANTE = 10 * 1024 * 1024
