import { S3Client } from '@aws-sdk/client-s3'
import { GetObjectCommand, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || ''
  }
})

const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME || 'cotransmeq'

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
