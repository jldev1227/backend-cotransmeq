import { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
})

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'transmeralda'

/**
 * Genera una URL firmada para acceder a un objeto en S3
 * @param key - La clave (path) del objeto en S3
 * @param expiresIn - Tiempo de expiración en segundos (default: 3600 = 1 hora)
 * @returns URL firmada para acceder al objeto
 */
export async function getS3SignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    })

    const signedUrl = await getSignedUrl(s3Client, command, { expiresIn })
    return signedUrl
  } catch (error) {
    console.error('Error generando signed URL:', error)
    throw error
  }
}

/**
 * Verifica si una clave existe en S3 (intenta obtener su URL)
 * @param key - La clave del objeto en S3
 * @returns true si existe, false si no
 */
export async function checkS3ObjectExists(key: string): Promise<boolean> {
  try {
    await getS3SignedUrl(key, 60) // URL temporal de 1 minuto solo para verificar
    return true
  } catch {
    return false
  }
}

/**
 * Sube un archivo a S3
 * @param key - La clave (path) donde se guardará el archivo
 * @param buffer - El contenido del archivo como Buffer
 * @param contentType - El tipo MIME del archivo
 * @returns La clave del objeto subido
 */
export async function uploadToS3(key: string, buffer: Buffer, contentType: string): Promise<string> {
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: contentType
    })

    await s3Client.send(command)
    return key
  } catch (error) {
    console.error('Error subiendo archivo a S3:', error)
    throw error
  }
}

/**
 * Elimina un archivo de S3
 * @param key - La clave del objeto a eliminar
 */
export async function deleteFromS3(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    })

    await s3Client.send(command)
  } catch (error) {
    console.error('Error eliminando archivo de S3:', error)
    throw error
  }
}

export { s3Client, BUCKET_NAME }

/**
 * Descarga un objeto de S3 como stream (Body de @aws-sdk).
 * @param key - La clave (path) del objeto en S3
 * @returns Stream legible o `null` si el objeto no existe
 */
export async function getS3ObjectStream(key: string): Promise<NodeJS.ReadableStream | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    })
    const response = await s3Client.send(command)
    if (!response.Body) return null
    return response.Body as NodeJS.ReadableStream
  } catch (error: any) {
    // NoSuchKey / NoSuchBucket: tratar como no encontrado
    if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NoSuchKey') {
      return null
    }
    console.error('Error descargando objeto de S3 como stream:', error)
    throw error
  }
}

/**
 * Descarga un objeto de S3 y lo retorna como data URL base64
 * @param key - La clave (path) del objeto en S3
 * @returns Data URL base64 (ej: "data:image/png;base64,iVBOR...")
 */
export async function getS3ObjectAsBase64(key: string): Promise<string> {
  try {
    const command = new GetObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key
    })

    const response = await s3Client.send(command)
    const byteArray = await response.Body?.transformToByteArray()
    if (!byteArray) throw new Error('No se pudo leer el objeto de S3')

    const base64 = Buffer.from(byteArray).toString('base64')
    const contentType = response.ContentType || 'image/png'
    return `data:${contentType};base64,${base64}`
  } catch (error) {
    console.error('Error descargando objeto de S3 como base64:', error)
    throw error
  }
}

/**
 * URL firmada de SUBIDA (PUT) para que el cliente escriba directo en S3.
 *
 * Existe para el módulo de formularios dinámicos: el conductor sube fotos y
 * firmas desde el teléfono, a veces varias por envío. Pasarlas por el backend
 * significaría subir dos veces el mismo archivo (teléfono → API → S3) y
 * bloquear un worker de Fastify mientras dura una subida por datos móviles.
 *
 * `contentType` y `contentLength` se firman: la URL solo sirve para escribir
 * EXACTAMENTE ese tipo y tamaño, así que un enlace filtrado no se puede usar
 * para subir otra cosa.
 *
 * @param expiresIn segundos. Corto a propósito: la outbox del portal renueva
 *                  la URL si el intento anterior expiró.
 */
export async function getS3UploadUrl(
  key: string,
  contentType: string,
  contentLength: number,
  /**
   * SHA-256 de los bytes, en base64 de los 32 bytes CRUDOS del digest (no base64
   * del texto hexadecimal).
   *
   * Al firmarlo, S3 lo exige como cabecera `x-amz-checksum-sha256` y RECHAZA la
   * subida si los bytes recibidos no producen ese digest. Eso es lo que convierte
   * la verificación en real: sin esto, el backend solo puede comparar el hash que
   * el cliente declaró contra el hash que el cliente volvió a declarar.
   *
   * `null` desactiva el checksum nativo, para proveedores compatibles con S3 que
   * no lo implementan; en ese caso la verificación se hace leyendo el objeto.
   */
  checksumSha256Base64: string | null = null,
  expiresIn: number = 900
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
    ...(checksumSha256Base64 ? { ChecksumSHA256: checksumSha256Base64 } : {})
  })
  return getSignedUrl(s3Client, command, { expiresIn })
}

/**
 * Convierte un SHA-256 hexadecimal al base64 que exige S3.
 *
 * S3 espera el base64 de los 32 bytes del digest. Enviar el base64 del TEXTO
 * hexadecimal es el error clásico: son 64 bytes ASCII y S3 lo rechaza con un
 * mensaje que no menciona la causa.
 */
export function sha256HexToBase64(hex: string): string {
  if (!/^[0-9a-f]{64}$/.test(hex)) {
    throw new Error(`SHA-256 hexadecimal inválido: se esperaban 64 caracteres [0-9a-f], llegó "${hex}"`)
  }
  return Buffer.from(hex, 'hex').toString('base64')
}

/**
 * Metadata de un objeto sin descargarlo.
 *
 * Devuelve `null` si no existe. Es lo que permite verificar que una subida
 * directa a S3 terminó de verdad —y con el tamaño esperado— antes de aceptar
 * el envío que la referencia.
 */
export interface S3ObjectMetadata {
  contentLength: number
  contentType: string | null
  /**
   * NO sirve para verificar integridad.
   *
   * Es MD5 solo en subidas simples y sin cifrado con clave gestionada; con
   * multipart es un hash de hashes con sufijo `-N`, y con SSE-KMS es un valor
   * opaco. Se devuelve para diagnóstico, nunca para decidir.
   */
  etag: string | null
  /**
   * SHA-256 confirmado por S3, en base64, o `null` si el objeto no se subió con
   * checksum nativo o el proveedor no lo implementa.
   */
  checksumSha256: string | null
}

export async function headS3Object(key: string): Promise<S3ObjectMetadata | null> {
  try {
    /// `ChecksumMode: 'ENABLED'` es obligatorio: sin él S3 NO devuelve
    /// `ChecksumSHA256` aunque el objeto se haya subido con checksum, y la
    /// verificación fallaría siempre por «no hay checksum».
    const response = await s3Client.send(
      new HeadObjectCommand({ Bucket: BUCKET_NAME, Key: key, ChecksumMode: 'ENABLED' })
    )
    return {
      contentLength: Number(response.ContentLength ?? 0),
      contentType: response.ContentType ?? null,
      etag: response.ETag ?? null,
      checksumSha256: response.ChecksumSHA256 ?? null
    }
  } catch (error: any) {
    if (
      error?.$metadata?.httpStatusCode === 404 ||
      error?.name === 'NotFound' ||
      error?.name === 'NoSuchKey'
    ) {
      return null
    }
    console.error('Error consultando metadata de objeto S3:', error)
    throw error
  }
}

/**
 * Calcula el SHA-256 de un objeto de S3 leyéndolo en streaming.
 *
 * Es el plan B de la verificación de integridad, para proveedores compatibles con
 * S3 que no exponen `ChecksumSHA256`. Cuesta descargar el objeto, así que solo se
 * usa cuando el checksum nativo no está disponible.
 *
 * Se hashea de forma INCREMENTAL y nunca se acumula el archivo en memoria: veinte
 * conductores subiendo un PDF de 25 MB a la vez serían 500 MB de heap si se
 * bufferizara.
 *
 * `maxBytes` corta la lectura si el objeto es mayor de lo esperado: sin ese tope,
 * un objeto manipulado para ser enorme convertiría la verificación en una
 * denegación de servicio contra el propio backend.
 *
 * @returns el digest en hexadecimal, o `null` si el objeto no existe.
 */
export async function computeS3ObjectSha256(
  key: string,
  maxBytes: number
): Promise<{ sha256Hex: string; byteLength: number } | null> {
  const stream = await getS3ObjectStream(key)
  if (!stream) return null

  const { createHash } = await import('crypto')
  const hash = createHash('sha256')
  let total = 0

  for await (const chunk of stream as AsyncIterable<Buffer | Uint8Array>) {
    total += chunk.length
    if (total > maxBytes) {
      /// El objeto es mayor de lo declarado: no se sigue leyendo. El llamador lo
      /// interpreta como incompleto/manipulado, que es lo que es.
      throw new Error(`El objeto ${key} supera los ${maxBytes} bytes esperados.`)
    }
    hash.update(chunk)
  }

  return { sha256Hex: hash.digest('hex'), byteLength: total }
}
