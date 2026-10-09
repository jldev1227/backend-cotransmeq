/**
 * Firma de un extracto emitido.
 *
 * Cada extracto lleva un HMAC-SHA512 del contenido impreso. El secreto vive
 * solo en el servidor, así que nadie puede fabricar un extracto que pase la
 * validación de la página pública sin él, y cualquier cambio al contenido
 * guardado (una fecha, una placa) deja de cuadrar con la firma. En el PDF se
 * imprime la «huella» (los primeros 16 hex de la firma) junto al QR, para que
 * quien valida compare lo que tiene en la mano con lo que muestra la página.
 */
import { createHmac, randomBytes } from 'crypto'
import { env } from '../../config/env'

/** Lo que se firma: exactamente lo que se imprime, sin ids ni fechas de auditoría. */
export interface SnapshotFuec {
  numero: string
  consecutivo: number
  empresa: { razon_social: string; nit: string }
  contrato_numero: string
  contratante: { nombre: string; nit: string | null }
  objeto_contrato: string
  origen_destino: string
  convenio: string
  vigencia_desde: string
  vigencia_hasta: string
  vehiculo: {
    placa: string
    modelo: string | null
    marca: string | null
    clase: string | null
    numero_interno: string | null
    tarjeta_operacion: string | null
  }
  conductores: Array<{ nombre: string; cedula: string | null; licencia_vigencia: string | null }>
  responsable: { nombre: string | null; cedula: string | null; telefono: string | null; direccion: string | null }
  emitido_at: string
}

function secreto(): string {
  const s = (process.env.FUEC_FIRMA_SECRET || env.JWT_SECRET || '').trim()
  if (!s) throw new Error('Falta FUEC_FIRMA_SECRET (o JWT_SECRET) para firmar extractos')
  return s
}

/** JSON con las claves ordenadas en todos los niveles: el mismo objeto siempre da el mismo texto. */
export function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`
  if (valor && typeof valor === 'object') {
    const claves = Object.keys(valor as Record<string, unknown>).sort()
    return `{${claves.map((k) => `${JSON.stringify(k)}:${canonico((valor as Record<string, unknown>)[k])}`).join(',')}}`
  }
  return JSON.stringify(valor ?? null)
}

export function firmarSnapshot(snapshot: SnapshotFuec): string {
  return createHmac('sha512', secreto()).update(canonico(snapshot)).digest('hex')
}

export function firmaValida(snapshot: SnapshotFuec, firma: string | null | undefined): boolean {
  if (!firma) return false
  const esperada = firmarSnapshot(snapshot)
  if (esperada.length !== firma.length) return false
  let diff = 0
  for (let i = 0; i < esperada.length; i++) diff |= esperada.charCodeAt(i) ^ firma.charCodeAt(i)
  return diff === 0
}

/** Huella corta para imprimir junto al QR. */
export function huella(firma: string | null | undefined): string | null {
  if (!firma) return null
  return firma.slice(0, 16).toUpperCase().replace(/(.{4})(?=.)/g, '$1-')
}

/// Sin 0/O/1/I para que se pueda teclear desde el papel si el QR no lee.
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function nuevoCodigoVerificacion(): string {
  const bytes = randomBytes(12)
  let out = ''
  for (let i = 0; i < 12; i++) out += ALFABETO[bytes[i] % ALFABETO.length]
  return out
}
