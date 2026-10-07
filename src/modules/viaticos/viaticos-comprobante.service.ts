/**
 * Lectura del comprobante de un anticipo con Azure OpenAI.
 *
 * Operaciones sube la captura o el PDF de la transferencia y el modelo saca
 * valor, fecha y número de comprobante para prellenar el formulario. No decide
 * nada: quien registra el anticipo ve lo leído, lo corrige si hace falta y
 * guarda. Lo que devolvió el modelo se guarda aparte (`comprobante_lectura`)
 * para poder auditar luego si el valor registrado difiere del leído.
 *
 * Se usa el mismo despliegue que el asistente (`gpt-5-mini`), que acepta
 * imágenes y PDF en el mismo mensaje. Probado con un comprobante de
 * Bancolombia: ~4 s y los tres campos correctos.
 */

import { asistenteConfigurado, clienteAzure, deploymentAzure } from '../asistente/azure-openai'
import { getS3ObjectAsBase64 } from '../../config/aws'
import { logger } from '../../utils/logger'
import { ViaticosError } from './viaticos.service'

export interface LecturaComprobante {
  valor: number | null
  fecha: string | null
  numero_comprobante: string | null
  entidad: string | null
  cuenta_origen: string | null
  destinatario: string | null
  confianza: 'alta' | 'media' | 'baja'
}

const INSTRUCCIONES = `Extraes datos de comprobantes de pago colombianos (transferencias, consignaciones, retiros).
Responde SOLO un objeto JSON con estas claves:
{"valor": number|null, "fecha": "YYYY-MM-DD"|null, "numero_comprobante": string|null, "entidad": string|null, "cuenta_origen": string|null, "destinatario": string|null, "confianza": "alta"|"media"|"baja"}
Reglas:
- "valor": el monto transferido en pesos colombianos, como número entero sin separadores ni decimales ($ 341.110,00 → 341110). En Colombia el punto separa miles y la coma decimales.
- "fecha": la fecha de la operación. Si no hay año visible, null.
- "entidad": el banco o app que emitió el comprobante, si se reconoce.
- Si un dato no aparece o no se lee con seguridad, null. No inventes.
- "confianza": baja si la imagen no parece un comprobante de pago o está ilegible.`

const TIEMPO_MAXIMO_MS = 45_000

function limpiar(r: any): LecturaComprobante {
  const valor = typeof r?.valor === 'number' && Number.isFinite(r.valor) && r.valor > 0 ? Math.round(r.valor) : null
  const fecha = typeof r?.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha) ? r.fecha : null
  const texto = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)
  const confianza = ['alta', 'media', 'baja'].includes(r?.confianza) ? r.confianza : 'baja'
  return {
    valor,
    fecha,
    numero_comprobante: texto(r?.numero_comprobante, 60),
    entidad: texto(r?.entidad, 120),
    cuenta_origen: texto(r?.cuenta_origen, 60),
    destinatario: texto(r?.destinatario, 160),
    confianza
  }
}

/** Lee el comprobante ya subido a S3 (`key`). Lanza `ViaticosError` si no se puede. */
export async function leerComprobante(key: string, mimeType: string): Promise<LecturaComprobante> {
  if (!asistenteConfigurado()) {
    throw new ViaticosError(
      'La lectura automática no está configurada. Escribe los datos del comprobante a mano.',
      503,
      'LECTURA_NO_DISPONIBLE'
    )
  }
  let dataUrl: string
  try {
    dataUrl = await getS3ObjectAsBase64(key)
  } catch {
    throw new ViaticosError('El comprobante todavía no está disponible. Vuelve a intentarlo.', 409, 'ARCHIVO_NO_SUBIDO')
  }
  /// `getS3ObjectAsBase64` toma el tipo de S3; se fuerza el declarado por si
  /// el objeto quedó sin `Content-Type`.
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const contenido =
    mimeType === 'application/pdf'
      ? { type: 'file', file: { filename: 'comprobante.pdf', file_data: `data:application/pdf;base64,${base64}` } }
      : { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }

  const control = new AbortController()
  const temporizador = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS)
  const inicio = Date.now()
  try {
    const respuesta = await clienteAzure().chat.completions.create(
      {
        model: deploymentAzure(),
        reasoning_effort: 'low',
        max_completion_tokens: 2000,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: INSTRUCCIONES },
          { role: 'user', content: [contenido as any] }
        ]
      },
      { signal: control.signal }
    )
    const texto = respuesta.choices[0]?.message?.content ?? '{}'
    const lectura = limpiar(JSON.parse(texto))
    logger.info(
      { type: 'viatico-comprobante-leido', ms: Date.now() - inicio, confianza: lectura.confianza, con_valor: lectura.valor !== null },
      '[viaticos] comprobante leído'
    )
    return lectura
  } catch (error: any) {
    logger.warn({ err: error?.message, ms: Date.now() - inicio }, '[viaticos] no se pudo leer el comprobante')
    throw new ViaticosError(
      'No fue posible leer el comprobante automáticamente. Escribe los datos a mano.',
      502,
      'LECTURA_FALLIDA'
    )
  } finally {
    clearTimeout(temporizador)
  }
}
