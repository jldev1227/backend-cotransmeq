import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import {
  AbortMultipartUploadCommand, CompleteMultipartUploadCommand, CreateMultipartUploadCommand,
  GetObjectCommand, HeadObjectCommand, ListPartsCommand, PutObjectCommand, S3Client, UploadPartCommand
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import AdmZip from 'adm-zip'
import type { FastifyRequest } from 'fastify'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { CapError, type CapPersona } from './capacitaciones.service'

const TIPOS: Record<string, { ext: string[]; mime: string[]; max: number }> = {
  portada: { ext: ['.jpg', '.jpeg', '.png', '.webp', '.avif'], mime: ['image/jpeg', 'image/png', 'image/webp', 'image/avif'], max: 10_000_000 },
  video: { ext: ['.mp4', '.webm', '.mov'], mime: ['video/mp4', 'video/webm', 'video/quicktime'], max: 500_000_000 },
  audio: { ext: ['.mp3', '.m4a', '.wav', '.ogg'], mime: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/ogg'], max: 100_000_000 },
  pdf: { ext: ['.pdf'], mime: ['application/pdf'], max: 100_000_000 },
  pptx: { ext: ['.pptx'], mime: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'], max: 100_000_000 },
  readme: { ext: ['.md', '.txt'], mime: ['text/markdown', 'text/plain'], max: 5_000_000 },
  subtitulos: { ext: ['.vtt'], mime: ['text/vtt'], max: 5_000_000 },
  h5p: { ext: ['.h5p'], mime: ['application/zip', 'application/x-h5p', 'application/vnd.h5p', 'application/octet-stream'], max: 200_000_000 },
  scorm: { ext: ['.zip'], mime: ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'], max: 200_000_000 }
}
const ROOT = path.resolve(process.env.CAP_CONTENT_ROOT || path.join(process.cwd(), '.data', 'capacitaciones'))
const S3_MODE = process.env.CAP_CONTENT_MODE === 's3'
const BUCKET = process.env.CAP_S3_BUCKET || ''
const MULTIPART_THRESHOLD = 64 * 1024 * 1024
const MULTIPART_PART_SIZE = 8 * 1024 * 1024
const execFileAsync = promisify(execFile)

function s3() {
  const endpoint = process.env.CAP_S3_ENDPOINT
  const accessKeyId = process.env.CAP_S3_ACCESS_KEY
  const secretAccessKey = process.env.CAP_S3_SECRET_KEY
  if (!endpoint || !BUCKET || !accessKeyId || !secretAccessKey || !endpoint.startsWith('https://')) {
    throw new CapError('Configura endpoint HTTPS, bucket y credenciales del almacenamiento de cursos.', 503)
  }
  return new S3Client({
    endpoint, region: process.env.CAP_S3_REGION || 'us-east-1', forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    credentials: { accessKeyId, secretAccessKey }
  })
}

function validarId(id: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new CapError('Archivo inválido.')
  return id
}

function validarMeta(input: Record<string, unknown>) {
  const tipo = typeof input.tipo === 'string' ? input.tipo : ''
  const nombre = typeof input.nombre === 'string' ? path.basename(input.nombre).trim().slice(0, 255) : ''
  const mime = typeof input.mime === 'string' ? input.mime.trim().toLowerCase() : ''
  const tamano = Number(input.tamano)
  const reglas = TIPOS[tipo]
  if (!reglas || !nombre || !reglas.ext.includes(path.extname(nombre).toLowerCase()) ||
    !reglas.mime.includes(mime) || !Number.isInteger(tamano) || tamano < 1 || tamano > reglas.max) {
    throw new CapError('Tipo, formato o tamaño del archivo no permitido.')
  }
  return { tipo, nombre, mime, tamano }
}

function validarPaquete(ruta: string, tipo: string) {
  if (tipo !== 'h5p' && tipo !== 'scorm') return
  let entradas: AdmZip.IZipEntry[]
  try { entradas = new AdmZip(ruta).getEntries() }
  catch { throw new CapError('El paquete no es un ZIP válido.') }
  if (!entradas.length || entradas.length > 5_000) throw new CapError('El paquete contiene demasiados archivos o está vacío.')
  let expandido = 0
  for (const entrada of entradas) {
    const nombre = entrada.entryName.replaceAll('\\', '/')
    if (!nombre || nombre.startsWith('/') || nombre.split('/').includes('..') || nombre.includes('\0')) {
      throw new CapError('El paquete contiene rutas no permitidas.')
    }
    expandido += entrada.header.size
    if (expandido > 1_000_000_000) throw new CapError('El paquete expandido supera 1 GB.')
  }
  const manifiesto = tipo === 'h5p' ? 'h5p.json' : 'imsmanifest.xml'
  if (!entradas.some((e) => e.entryName.toLowerCase() === manifiesto)) {
    throw new CapError('El paquete no contiene ' + manifiesto + ' en la raíz.')
  }
}

export async function iniciarArchivo(cursoId: string, input: Record<string, unknown>) {
  validarId(cursoId)
  const curso = await prisma.capCurso.findUnique({ where: { id: cursoId }, select: { id: true } })
  if (!curso) throw new CapError('Curso no encontrado.', 404)
  const meta = validarMeta(input)
  if (!S3_MODE && meta.tamano > 200_000_000) throw new CapError('Para archivos de más de 200 MB configura el almacenamiento S3 de cursos.', 413)
  const id = randomUUID()
  const clave = 'capacitaciones/' + cursoId + '/' + id + path.extname(meta.nombre).toLowerCase()
  const archivo = await prisma.capArchivo.create({ data: { id, cursoId, clave, ...meta } })
  if (S3_MODE) {
    const cliente = s3()
    if (meta.tamano > MULTIPART_THRESHOLD) {
      let uploadId: string | undefined
      try {
        const inicio = await cliente.send(new CreateMultipartUploadCommand({
          Bucket: BUCKET, Key: clave, ContentType: meta.mime
        }))
        uploadId = inicio.UploadId
        if (!uploadId) throw new CapError('No se pudo iniciar la subida por partes.', 502)
        const totalPartes = Math.ceil(meta.tamano / MULTIPART_PART_SIZE)
        const uploadParts = await Promise.all(Array.from({ length: totalPartes }, async (_, index) => {
          const partNumber = index + 1
          const uploadUrl = await getSignedUrl(cliente, new UploadPartCommand({
            Bucket: BUCKET, Key: clave, UploadId: uploadId, PartNumber: partNumber
          }), { expiresIn: 3600 })
          return { partNumber, uploadUrl }
        }))
        return {
          archivo, modo: 's3-multipart', uploadId,
          partSize: MULTIPART_PART_SIZE, uploadParts
        }
      } catch (error) {
        if (uploadId) await cliente.send(new AbortMultipartUploadCommand({
          Bucket: BUCKET, Key: clave, UploadId: uploadId
        })).catch(() => undefined)
        await prisma.capArchivo.delete({ where: { id } }).catch(() => undefined)
        throw error
      }
    }
    const url = await getSignedUrl(cliente, new PutObjectCommand({
      Bucket: BUCKET, Key: clave, ContentType: meta.mime, ContentLength: meta.tamano
    }), { expiresIn: 900, signableHeaders: new Set(['content-type']) })
    return { archivo, modo: 's3', uploadUrl: url, headers: { 'Content-Type': meta.mime } }
  }
  return { archivo, modo: 'local', uploadUrl: '/api/capacitaciones/gestion/archivos/' + id + '/contenido' }
}

export async function subirArchivoLocal(id: string, request: FastifyRequest) {
  if (S3_MODE) throw new CapError('La subida directa está activa para este almacenamiento.', 409)
  const archivo = await prisma.capArchivo.findUnique({ where: { id: validarId(id) } })
  if (!archivo || archivo.estado !== 'pendiente') throw new CapError('Subida no encontrada.', 404)
  const part = await request.file({ limits: { fileSize: 200_000_000, files: 1 } })
  if (!part) throw new CapError('Selecciona un archivo.')
  if (part.mimetype?.toLowerCase() !== archivo.mime) throw new CapError('El tipo del archivo no coincide con la reserva.')
  const dir = path.dirname(path.join(ROOT, archivo.clave))
  await mkdir(dir, { recursive: true })
  const temporal = path.join(dir, '.' + archivo.id + '.tmp')
  const destino = path.join(ROOT, archivo.clave)
  try {
    await pipeline(part.file, createWriteStream(temporal, { flags: 'wx' }))
    const real = await stat(temporal)
    if (part.file.truncated || real.size !== archivo.tamano) throw new CapError('La subida quedó incompleta o cambió de tamaño.')
    validarPaquete(temporal, archivo.tipo)
    await rename(temporal, destino)
    if (archivo.tipo === 'pptx') await generarVistaPptx(archivo.clave).catch((error) => {
      request.log.warn({ err: error }, '[capacitaciones] vista previa PPTX no disponible')
    })
    return prisma.capArchivo.update({ where: { id }, data: { estado: 'listo' } })
  } catch (error) {
    await unlink(temporal).catch(() => undefined)
    throw error
  }
}

export async function confirmarArchivo(id: string, opciones: { multipartVerificado?: boolean } = {}) {
  const archivo = await prisma.capArchivo.findUnique({ where: { id: validarId(id) } })
  if (!archivo) throw new CapError('Archivo no encontrado.', 404)
  if (archivo.estado === 'listo') return archivo
  if (!S3_MODE) throw new CapError('El archivo aún no ha terminado de subir.', 409)
  if (!opciones.multipartVerificado) {
    const head = await s3().send(new HeadObjectCommand({ Bucket: BUCKET, Key: archivo.clave }))
    if (head.ContentLength !== archivo.tamano || head.ContentType?.toLowerCase() !== archivo.mime) {
      throw new CapError('El archivo subido no coincide con el tipo o tamaño declarado.', 409)
    }
  }
  if (archivo.tipo === 'h5p' || archivo.tipo === 'scorm') {
    const temporal = await mkdtemp(path.join(os.tmpdir(), 'cap-zip-'))
    try {
      const objeto = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: archivo.clave }))
      if (!objeto.Body) throw new CapError('El paquete no está disponible.', 409)
      const ruta = path.join(temporal, 'paquete.zip')
      await pipeline(objeto.Body as Readable, createWriteStream(ruta))
      if ((await stat(ruta)).size !== archivo.tamano) throw new CapError('El paquete llegó incompleto.', 409)
      validarPaquete(ruta, archivo.tipo)
    } finally { await rm(temporal, { recursive: true, force: true }) }
  }
  if (archivo.tipo === 'pptx') await generarVistaPptx(archivo.clave).catch(() => undefined)
  return prisma.capArchivo.update({ where: { id }, data: { estado: 'listo' } })
}

export async function completarArchivoMultipart(id: string, input: Record<string, unknown>) {
  const archivo = await prisma.capArchivo.findUnique({ where: { id: validarId(id) } })
  if (!archivo || archivo.estado !== 'pendiente') throw new CapError('Subida no encontrada.', 404)
  if (!S3_MODE) throw new CapError('La subida por partes requiere almacenamiento S3.', 409)
  const uploadId = typeof input.uploadId === 'string' ? input.uploadId : ''
  if (!uploadId || uploadId.length > 2048 || /\s/.test(uploadId)) throw new CapError('Subida multipart inválida.')
  if (!Array.isArray(input.parts)) throw new CapError('Faltan las partes de la subida.')
  const cliente = s3()
  const cargadas = await cliente.send(new ListPartsCommand({ Bucket: BUCKET, Key: archivo.clave, UploadId: uploadId }))
  const reales = cargadas.Parts ?? []
  const totalPartes = Math.ceil(archivo.tamano / MULTIPART_PART_SIZE)
  if (cargadas.IsTruncated || reales.length !== totalPartes || input.parts.length !== totalPartes) {
    throw new CapError('La subida está incompleta; vuelve a intentar los fragmentos faltantes.', 409)
  }
  const solicitadas = input.parts.map((parte: any) => ({
    PartNumber: Number(parte?.partNumber), ETag: typeof parte?.etag === 'string' ? parte.etag : ''
  })).sort((a, b) => a.PartNumber - b.PartNumber)
  let bytes = 0
  for (let index = 0; index < totalPartes; index++) {
    const numero = index + 1
    const solicitada = solicitadas[index]
    const real = reales.find((parte) => parte.PartNumber === numero)
    const tamanoEsperado = numero < totalPartes
      ? MULTIPART_PART_SIZE
      : archivo.tamano - MULTIPART_PART_SIZE * (totalPartes - 1)
    if (!solicitada || solicitada.PartNumber !== numero || !solicitada.ETag ||
      !real || real.ETag !== solicitada.ETag || real.Size !== tamanoEsperado) {
      throw new CapError('Una parte no coincide con el archivo reservado.', 409)
    }
    bytes += tamanoEsperado
  }
  if (bytes !== archivo.tamano) throw new CapError('El tamaño recibido no coincide con el archivo reservado.', 409)
  await cliente.send(new CompleteMultipartUploadCommand({
    Bucket: BUCKET, Key: archivo.clave, UploadId: uploadId,
    MultipartUpload: { Parts: solicitadas }
  }))
  return confirmarArchivo(id, { multipartVerificado: true })
}

export async function abortarArchivoMultipart(id: string, uploadIdInput: unknown) {
  const archivo = await prisma.capArchivo.findUnique({ where: { id: validarId(id) } })
  if (!archivo || archivo.estado !== 'pendiente') throw new CapError('Subida no encontrada.', 404)
  if (!S3_MODE) throw new CapError('La subida por partes requiere almacenamiento S3.', 409)
  const uploadId = typeof uploadIdInput === 'string' ? uploadIdInput : ''
  if (!uploadId || uploadId.length > 2048 || /\s/.test(uploadId)) throw new CapError('Subida multipart inválida.')
  await s3().send(new AbortMultipartUploadCommand({ Bucket: BUCKET, Key: archivo.clave, UploadId: uploadId }))
  await prisma.capArchivo.delete({ where: { id: archivo.id } })
  return { abortada: true }
}

async function generarVistaPptx(clave: string) {
  const temporal = await mkdtemp(path.join(os.tmpdir(), 'cap-pptx-'))
  try {
    const origen = path.join(temporal, 'presentacion.pptx')
    if (S3_MODE) {
      const objeto = await s3().send(new GetObjectCommand({ Bucket: BUCKET, Key: clave }))
      if (!objeto.Body) return
      await pipeline(objeto.Body as Readable, createWriteStream(origen))
    } else {
      const fuente = path.resolve(ROOT, clave)
      await copyFile(fuente, origen)
    }
    const perfil = path.join(temporal, 'perfil')
    await execFileAsync(process.env.CAP_SOFFICE_PATH || 'soffice', [
      '-env:UserInstallation=file://' + perfil,
      '--headless', '--convert-to', 'pdf', '--outdir', temporal, origen
    ], { timeout: 90_000 })
    const pdf = await readFile(path.join(temporal, 'presentacion.pdf'))
    if (S3_MODE) {
      await s3().send(new PutObjectCommand({
        Bucket: BUCKET, Key: clave + '.pdf', Body: pdf, ContentType: 'application/pdf'
      }))
    } else {
      await writeFile(path.resolve(ROOT, clave + '.pdf'), pdf)
    }
  } finally { await rm(temporal, { recursive: true, force: true }) }
}

export async function listarArchivos(cursoId: string) {
  return prisma.capArchivo.findMany({ where: { cursoId: validarId(cursoId), estado: 'listo' }, orderBy: { createdAt: 'desc' } })
}

function firma(id: string, expires: number) {
  return createHmac('sha256', env.JWT_SECRET).update('cap-archivo:' + id + ':' + expires).digest('hex')
}

export async function urlArchivo(id: string) {
  const archivo = await prisma.capArchivo.findUnique({ where: { id: validarId(id), estado: 'listo' } })
  if (!archivo) throw new CapError('Archivo no disponible.', 404)
  if (S3_MODE) {
    const cliente = s3()
    const url = await getSignedUrl(cliente,
      new GetObjectCommand({ Bucket: BUCKET, Key: archivo.clave }), { expiresIn: 3600 })
    let previewUrl: string | null = null
    if (archivo.tipo === 'pptx') {
      try {
        await cliente.send(new HeadObjectCommand({ Bucket: BUCKET, Key: archivo.clave + '.pdf' }))
        previewUrl = await getSignedUrl(cliente,
          new GetObjectCommand({ Bucket: BUCKET, Key: archivo.clave + '.pdf' }), { expiresIn: 3600 })
      } catch { /* conversión pendiente o no disponible */ }
    }
    return { archivo, url, previewUrl }
  }
  const expires = Math.floor(Date.now() / 1000) + 3600
  const base = '/api/capacitaciones/archivos/' + id + '/contenido?expires=' + expires + '&signature=' + firma(id, expires)
  const previewUrl = archivo.tipo === 'pptx' && await stat(path.resolve(ROOT, archivo.clave + '.pdf')).then(() => true).catch(() => false)
    ? base + '&preview=1' : null
  return { archivo, url: base, previewUrl }
}

export async function urlArchivoParaPersona(id: string, persona: CapPersona, gestionar = false) {
  const archivo = await prisma.capArchivo.findUnique({ where: { id: validarId(id), estado: 'listo' } })
  if (!archivo) throw new CapError('Archivo no encontrado.', 404)
  if (!gestionar) {
    const asignacion = await prisma.capAsignacion.findUnique({
      where: { cursoId_personaTipo_personaId: { cursoId: archivo.cursoId, personaTipo: persona.tipo, personaId: persona.id } }
    })
    if (!asignacion) throw new CapError('Archivo no asignado.', 403)
  }
  return urlArchivo(id)
}

export async function archivoLocalFirmado(id: string, expiresRaw: string, signature: string, preview = false) {
  if (S3_MODE) throw new CapError('Archivo no disponible por esta ruta.', 404)
  const expires = Number(expiresRaw)
  if (!Number.isSafeInteger(expires) || expires < Date.now() / 1000 || expires > Date.now() / 1000 + 3600 ||
    !/^[0-9a-f]{64}$/.test(signature)) throw new CapError('Enlace vencido o inválido.', 403)
  const esperado = firma(validarId(id), expires)
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(esperado, 'hex'))) throw new CapError('Enlace inválido.', 403)
  const archivo = await prisma.capArchivo.findUnique({ where: { id, estado: 'listo' } })
  if (!archivo) throw new CapError('Archivo no encontrado.', 404)
  if (preview && archivo.tipo !== 'pptx') throw new CapError('Vista previa no disponible.', 404)
  const ruta = path.resolve(ROOT, archivo.clave + (preview ? '.pdf' : ''))
  if (!ruta.startsWith(ROOT + path.sep)) throw new CapError('Ruta de archivo inválida.', 400)
  return { archivo, ruta, mime: preview ? 'application/pdf' : archivo.mime }
}

export function mimeArchivo(tipo: string) {
  return TIPOS[tipo]?.mime ?? []
}
