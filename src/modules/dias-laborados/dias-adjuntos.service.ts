/**
 * Soportes (facturas) de los días de MANTENIMIENTO.
 *
 * El conductor registra el día desde la app —primero en el teléfono, luego por
 * su cola offline— y, DESPUÉS de que el día existe en el servidor, puede
 * adjuntarle fotos o PDF de las facturas. Es opcional.
 *
 * La subida sigue el mismo camino que los adjuntos de formularios
 * (`formularios-portal.service.ts`):
 *
 *  1. `init` crea la fila `PENDING` y devuelve una URL prefirmada de PUT que
 *     lleva firmados el tipo, el tamaño y —si está habilitado— el SHA-256 de
 *     los bytes. S3 rechaza una subida que no cuadre con eso.
 *  2. El teléfono sube los bytes directo a S3.
 *  3. `complete` verifica el objeto ALMACENADO (tamaño + checksum nativo, o
 *     leyéndolo en streaming si el proveedor no lo expone) y pasa a `UPLOADED`.
 *
 * Todo es idempotente por `client_attachment_id`, que genera el teléfono: la
 * cola offline reintenta sin miedo a duplicar.
 *
 * La identidad sale SIEMPRE del token (`conductorId`), nunca del cuerpo.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '../../config/prisma'
import {
  computeS3ObjectSha256,
  getS3SignedUrl,
  getS3UploadUrl,
  headS3Object,
  sha256HexToBase64
} from '../../config/aws'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'

export class DiasAdjuntosError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

export const MAX_BYTES_ADJUNTO_DIA = 10 * 1024 * 1024
export const MAX_ADJUNTOS_VIVOS_POR_DIA = 10

/** Tipos admitidos y la extensión con la que se guardan en S3. */
const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
}

const PREFIJO_S3 = 'dias-laborados'
/// Vida de la URL de lectura que acompaña a cada adjunto en las consultas.
const TTL_URL_LECTURA_SEGUNDOS = 3600
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const initSchema = z.object({
  client_attachment_id: z
    .string()
    .trim()
    .min(1)
    .max(64)
    /// Va dentro de la clave de S3: nada que pueda escaparse del prefijo.
    .regex(/^[A-Za-z0-9_-]+$/, 'client_attachment_id solo admite letras, números, guion y guion bajo'),
  mime_type: z.string().trim().min(1).max(100),
  byte_size: z.number().int().positive(),
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, 'sha256 debe ser hexadecimal de 64 caracteres')
    .transform((v) => v.toLowerCase()),
  original_name: z.string().trim().max(255).nullish()
})

const completeSchema = z
  .object({
    sha256: z
      .string()
      .trim()
      .regex(/^[0-9a-fA-F]{64}$/)
      .transform((v) => v.toLowerCase())
      .optional(),
    byte_size: z.number().int().positive().optional()
  })
  .passthrough()

export interface AdjuntoDiaDto {
  id: string
  client_attachment_id: string
  mime_type: string
  byte_size: number
  original_name: string | null
  url: string
  uploaded_at: Date | null
}

// ─────────────────────────────────────────────────────────────────────────────
// Ayudas internas
// ─────────────────────────────────────────────────────────────────────────────

function exigirFecha(fecha: string): Date {
  if (!FECHA_RE.test(fecha)) {
    throw new DiasAdjuntosError('La fecha debe tener formato YYYY-MM-DD.', 400, 'DATOS_INVALIDOS')
  }
  return new Date(`${fecha}T00:00:00.000Z`)
}

function parsear<T>(schema: z.ZodType<T, any, any>, body: unknown): T {
  const r = schema.safeParse(body ?? {})
  if (!r.success) {
    const primero = r.error.issues[0]
    const campo = primero?.path?.join('.')
    throw new DiasAdjuntosError(
      `${campo ? `${campo}: ` : ''}${primero?.message ?? 'Datos inválidos'}`,
      400,
      'DATOS_INVALIDOS'
    )
  }
  return r.data
}

interface DiaBloqueado {
  id: string
  tipo: string
}

/**
 * Lee el día del conductor y BLOQUEA su fila hasta el final de la transacción.
 *
 * El lock serializa `init` con el guardado del día (que hace UPDATE sobre la
 * misma fila): sin él, un `init` podía leer MANTENIMIENTO justo antes de que el
 * día cambiara de tipo y dejar un adjunto vivo colgando de un día DESCANSO. Y
 * serializa dos `init` concurrentes del mismo día para que el tope de 10 no se
 * pase por una carrera.
 */
async function bloquearDia(
  tx: Prisma.TransactionClient,
  conductorId: string,
  /// Texto YYYY-MM-DD y no `Date`: un `Date` viaja como timestamptz y su
  /// `::date` depende de la zona de la sesión (medianoche UTC = día anterior en
  /// Bogotá).
  fecha: string
): Promise<DiaBloqueado> {
  const filas = await tx.$queryRaw<DiaBloqueado[]>`
    SELECT id::text AS id, tipo
      FROM registro_dia_laboral
     WHERE conductor_id = ${conductorId}::uuid
       AND fecha = ${fecha}::date
       AND deleted_at IS NULL
     FOR UPDATE`
  const dia = filas[0]
  if (!dia) {
    throw new DiasAdjuntosError('El día todavía no está registrado en el servidor.', 404, 'DIA_NO_ENCONTRADO')
  }
  return dia
}

async function diaVivo(conductorId: string, fecha: Date) {
  return prisma.registro_dia_laboral.findFirst({
    where: { conductor_id: conductorId, fecha, deleted_at: null },
    select: { id: true, tipo: true }
  })
}

async function aDto(a: {
  id: string
  client_attachment_id: string
  mime_type: string
  byte_size: number
  original_name: string | null
  object_key: string
  uploaded_at: Date | null
}): Promise<AdjuntoDiaDto> {
  return {
    id: a.id,
    client_attachment_id: a.client_attachment_id,
    mime_type: a.mime_type,
    byte_size: a.byte_size,
    original_name: a.original_name,
    url: await getS3SignedUrl(a.object_key, TTL_URL_LECTURA_SEGUNDOS),
    uploaded_at: a.uploaded_at
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// init
// ─────────────────────────────────────────────────────────────────────────────

export async function iniciarAdjuntoDia(conductorId: string, fecha: string, body: unknown) {
  exigirFecha(fecha)
  const input = parsear(initSchema, body)

  const plan = await prisma
    .$transaction(async (tx) => {
      const dia = await bloquearDia(tx, conductorId, fecha)

      if (dia.tipo !== 'MANTENIMIENTO') {
        throw new DiasAdjuntosError(
          'Solo los días de mantenimiento llevan soportes.',
          422,
          'SOLO_MANTENIMIENTO'
        )
      }
      const extension = EXTENSION_POR_MIME[input.mime_type]
      if (!extension) {
        throw new DiasAdjuntosError(
          'Solo se admiten fotos (JPG, PNG, WEBP) o PDF.',
          422,
          'TIPO_NO_PERMITIDO'
        )
      }
      if (input.byte_size > MAX_BYTES_ADJUNTO_DIA) {
        throw new DiasAdjuntosError(
          `El archivo supera el límite de ${MAX_BYTES_ADJUNTO_DIA / 1024 / 1024} MB.`,
          422,
          'ARCHIVO_MUY_GRANDE'
        )
      }

      const existente = await tx.registro_dia_laboral_adjunto.findUnique({
        where: { client_attachment_id: input.client_attachment_id }
      })

      if (existente) {
        /// Otro conductor u otro día con el mismo id no es un reintento.
        if (existente.conductor_id !== conductorId || existente.registro_dia_id !== dia.id) {
          throw new DiasAdjuntosError(
            'Ya existe un soporte con ese identificador en otro día.',
            409,
            'ADJUNTO_CONFLICTO'
          )
        }
        if (existente.deleted_at) {
          throw new DiasAdjuntosError('Ese soporte ya se eliminó.', 409, 'ADJUNTO_ELIMINADO')
        }
        if (existente.status === 'UPLOADED') {
          return { id: existente.id, yaSubido: true as const }
        }
        /// Reintento sobre una fila PENDING: tiene que describir el MISMO archivo.
        /// Firmar una URL para otros parámetros dejaría la fila y el objeto
        /// describiendo cosas distintas.
        if (
          existente.mime_type !== input.mime_type ||
          existente.byte_size !== input.byte_size ||
          existente.sha256 !== input.sha256
        ) {
          throw new DiasAdjuntosError(
            'Ya existe un soporte con ese identificador y otro archivo. Usa un identificador nuevo.',
            409,
            'ADJUNTO_CONFLICTO'
          )
        }
        return {
          id: existente.id,
          yaSubido: false as const,
          objectKey: existente.object_key,
          mimeType: existente.mime_type,
          byteSize: existente.byte_size,
          sha256: existente.sha256
        }
      }

      const vivos = await tx.registro_dia_laboral_adjunto.count({
        where: { registro_dia_id: dia.id, deleted_at: null }
      })
      if (vivos >= MAX_ADJUNTOS_VIVOS_POR_DIA) {
        throw new DiasAdjuntosError(
          `Un día admite hasta ${MAX_ADJUNTOS_VIVOS_POR_DIA} soportes.`,
          409,
          'LIMITE_ADJUNTOS'
        )
      }

      /// La clave incluye el `client_attachment_id`, que es único: dos intentos
      /// del mismo archivo escriben el mismo objeto y no dejan basura en S3.
      const objectKey = `${PREFIJO_S3}/${conductorId}/${fecha}/${input.client_attachment_id}.${extension}`
      const creado = await tx.registro_dia_laboral_adjunto.create({
        data: {
          registro_dia_id: dia.id,
          conductor_id: conductorId,
          client_attachment_id: input.client_attachment_id,
          object_key: objectKey,
          mime_type: input.mime_type,
          byte_size: input.byte_size,
          sha256: input.sha256,
          original_name: input.original_name || null,
          status: 'PENDING'
        },
        select: { id: true }
      })
      return {
        id: creado.id,
        yaSubido: false as const,
        objectKey,
        mimeType: input.mime_type,
        byteSize: input.byte_size,
        sha256: input.sha256
      }
    })
    .catch((err) => {
      /// Carrera con el mismo id en OTRO día (el lock solo serializa por día).
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new DiasAdjuntosError(
          'Ya existe un soporte con ese identificador en otro día.',
          409,
          'ADJUNTO_CONFLICTO'
        )
      }
      throw err
    })

  if (plan.yaSubido) {
    return { id: plan.id, status: 'UPLOADED' as const }
  }

  /// Se firma FUERA de la transacción para no alargar el lock del día.
  ///
  /// Con checksum nativo, `getSignedUrl` iza `x-amz-checksum-sha256` al query
  /// string y lo firma ahí; por eso NO va en `headers`: mandarlo además como
  /// cabecera la deja fuera de `X-Amz-SignedHeaders` y S3 responde 403 (mismo
  /// criterio que formularios y que `subirAdjuntoFormulario` en la app).
  const uploadUrl = await getS3UploadUrl(
    plan.objectKey,
    plan.mimeType,
    plan.byteSize,
    env.FORMS_S3_NATIVE_CHECKSUM ? sha256HexToBase64(plan.sha256) : null
  )

  return {
    id: plan.id,
    status: 'PENDING' as const,
    upload_url: uploadUrl,
    headers: { 'Content-Type': plan.mimeType } as Record<string, string>
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// complete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Verifica contra S3 que el objeto almacenado es el declarado y marca UPLOADED.
 *
 * La verificación es sobre los BYTES ALMACENADOS: checksum nativo si S3 lo
 * devuelve y, si no, lectura en streaming. Un fallo NO marca nada: la fila
 * sigue PENDING y la app puede pedir otra URL con `init` y volver a subir.
 */
export async function completarAdjuntoDia(
  conductorId: string,
  fecha: string,
  adjuntoId: string,
  body: unknown
) {
  const fechaDate = exigirFecha(fecha)
  const input = parsear(completeSchema, body)

  const dia = await diaVivo(conductorId, fechaDate)
  if (!dia) {
    throw new DiasAdjuntosError('El día todavía no está registrado en el servidor.', 404, 'DIA_NO_ENCONTRADO')
  }
  const adjunto = UUID_RE.test(adjuntoId)
    ? await prisma.registro_dia_laboral_adjunto.findFirst({
        where: { id: adjuntoId, conductor_id: conductorId, registro_dia_id: dia.id, deleted_at: null }
      })
    : null
  if (!adjunto) {
    throw new DiasAdjuntosError('El soporte no existe.', 404, 'ADJUNTO_NO_ENCONTRADO')
  }

  if (adjunto.status === 'UPLOADED') {
    return { ...(await aDto(adjunto)), status: 'UPLOADED' as const }
  }

  /// Opcional: si la app repite lo que declaró en `init`, tiene que coincidir.
  /// Ahorra el viaje a S3 cuando el teléfono cambió de archivo entre llamadas.
  if (
    (input.sha256 && input.sha256 !== adjunto.sha256) ||
    (input.byte_size && input.byte_size !== adjunto.byte_size)
  ) {
    throw new DiasAdjuntosError(
      'El archivo no coincide con el declarado al iniciar la subida.',
      422,
      'ARCHIVO_NO_COINCIDE'
    )
  }

  const metadata = await headS3Object(adjunto.object_key)
  if (!metadata) {
    throw new DiasAdjuntosError('El archivo todavía no llegó al almacenamiento.', 409, 'ARCHIVO_NO_SUBIDO')
  }
  if (metadata.contentLength !== adjunto.byte_size) {
    throw new DiasAdjuntosError(
      'El archivo almacenado no tiene el tamaño declarado. Vuelve a subirlo.',
      422,
      'ARCHIVO_NO_COINCIDE'
    )
  }

  let verificadoPor: 'native-checksum' | 'streaming-hash'
  if (metadata.checksumSha256) {
    if (metadata.checksumSha256 !== sha256HexToBase64(adjunto.sha256)) {
      throw new DiasAdjuntosError(
        'El archivo almacenado no coincide con el declarado. Vuelve a subirlo.',
        422,
        'ARCHIVO_NO_COINCIDE'
      )
    }
    verificadoPor = 'native-checksum'
  } else {
    if (env.FORMS_S3_NATIVE_CHECKSUM) {
      logger.warn(
        { type: 'dias-adjuntos-sin-checksum-nativo', adjunto_id: adjunto.id, object_key: adjunto.object_key },
        '[dias-laborados] S3 no devolvió ChecksumSHA256; se verifica leyendo el objeto'
      )
    }
    let calculado: { sha256Hex: string } | null
    try {
      calculado = await computeS3ObjectSha256(adjunto.object_key, adjunto.byte_size + 1024)
    } catch {
      throw new DiasAdjuntosError(
        'El archivo almacenado no se pudo verificar. Vuelve a subirlo.',
        422,
        'ARCHIVO_NO_COINCIDE'
      )
    }
    if (!calculado) {
      throw new DiasAdjuntosError('El archivo todavía no llegó al almacenamiento.', 409, 'ARCHIVO_NO_SUBIDO')
    }
    if (calculado.sha256Hex !== adjunto.sha256) {
      throw new DiasAdjuntosError(
        'El archivo almacenado no coincide con el declarado. Vuelve a subirlo.',
        422,
        'ARCHIVO_NO_COINCIDE'
      )
    }
    verificadoPor = 'streaming-hash'
  }

  /// Condicionado a que siga vivo y PENDING: si el día se retiró entretanto, no
  /// se resucita el adjunto; si otro `complete` ganó, se responde igual.
  await prisma.registro_dia_laboral_adjunto.updateMany({
    where: { id: adjunto.id, deleted_at: null, status: 'PENDING' },
    data: { status: 'UPLOADED', uploaded_at: new Date() }
  })
  const final = await prisma.registro_dia_laboral_adjunto.findUnique({ where: { id: adjunto.id } })
  if (!final || final.deleted_at || final.status !== 'UPLOADED') {
    throw new DiasAdjuntosError('El soporte no existe.', 404, 'ADJUNTO_NO_ENCONTRADO')
  }

  logger.info(
    { type: 'dias-adjunto-subido', adjunto_id: final.id, registro_dia_id: final.registro_dia_id, verificadoPor },
    '[dias-laborados] soporte de mantenimiento verificado'
  )
  return { ...(await aDto(final)), status: 'UPLOADED' as const }
}

// ─────────────────────────────────────────────────────────────────────────────
// delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft delete. Idempotente: borrar lo ya borrado —o lo que nunca llegó al
 * servidor— responde 200. Solo un adjunto de OTRO conductor da 404.
 *
 * Un adjunto propio que ya está borrado responde 200 aunque su día ya no exista
 * (retirar el día marca sus adjuntos): si no, la cola offline reintentaría para
 * siempre un borrado que ya ocurrió. El objeto de S3 se conserva.
 */
export async function eliminarAdjuntoDia(conductorId: string, fecha: string, adjuntoId: string) {
  const fechaDate = exigirFecha(fecha)

  const adjunto = UUID_RE.test(adjuntoId)
    ? await prisma.registro_dia_laboral_adjunto.findUnique({
        where: { id: adjuntoId },
        select: { id: true, conductor_id: true, registro_dia_id: true, deleted_at: true, object_key: true }
      })
    : null

  if (adjunto && adjunto.conductor_id !== conductorId) {
    throw new DiasAdjuntosError('El soporte no existe.', 404, 'ADJUNTO_NO_ENCONTRADO')
  }
  if (adjunto?.deleted_at) {
    return { id: adjunto.id, deleted: true }
  }

  const dia = await diaVivo(conductorId, fechaDate)
  if (!dia) {
    throw new DiasAdjuntosError('El día todavía no está registrado en el servidor.', 404, 'DIA_NO_ENCONTRADO')
  }
  if (!adjunto) {
    return { id: adjuntoId, deleted: true }
  }
  if (adjunto.registro_dia_id !== dia.id) {
    throw new DiasAdjuntosError('El soporte no pertenece a ese día.', 404, 'ADJUNTO_NO_ENCONTRADO')
  }

  await prisma.registro_dia_laboral_adjunto.updateMany({
    where: { id: adjunto.id, deleted_at: null },
    data: { deleted_at: new Date() }
  })
  logger.info(
    { type: 'dias-adjunto-eliminado', adjunto_id: adjunto.id, object_key: adjunto.object_key },
    '[dias-laborados] soporte de mantenimiento eliminado'
  )
  return { id: adjunto.id, deleted: true }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adjuntos visibles de varios días: solo UPLOADED y vivos, por `created_at`,
 * con URL firmada de lectura (1 h).
 *
 * Recibe los registros y no solo los ids para filtrar por tipo: un día que dejó
 * de ser MANTENIMIENTO por un camino que no retiró sus adjuntos (p. ej. la
 * reversión de un snapshot del canvas) no los muestra.
 */
export async function adjuntosDeDias(
  registros: Array<{ id: string; tipo: string | null }>
): Promise<Map<string, AdjuntoDiaDto[]>> {
  const mapa = new Map<string, AdjuntoDiaDto[]>()
  const ids = registros.filter((r) => r.tipo === 'MANTENIMIENTO').map((r) => r.id)
  if (ids.length === 0) return mapa

  const filas = await prisma.registro_dia_laboral_adjunto.findMany({
    where: { registro_dia_id: { in: ids }, deleted_at: null, status: 'UPLOADED' },
    orderBy: { created_at: 'asc' }
  })
  const dtos = await Promise.all(filas.map(aDto))
  filas.forEach((f, i) => {
    const lista = mapa.get(f.registro_dia_id) ?? []
    lista.push(dtos[i])
    mapa.set(f.registro_dia_id, lista)
  })
  return mapa
}

/** Añade `adjuntos` (siempre, `[]` si no hay) a cada registro. */
export async function conAdjuntos<T extends { id: string; tipo: string | null }>(
  registros: T[]
): Promise<Array<T & { adjuntos: AdjuntoDiaDto[] }>> {
  const mapa = await adjuntosDeDias(registros)
  return registros.map((r) => ({ ...r, adjuntos: mapa.get(r.id) ?? [] }))
}
