/**
 * Persistencia de las versiones documentales de la declaración de empresa de
 * transporte y de su trazabilidad de entrega.
 *
 * Dos invariantes que este módulo existe para sostener:
 *
 *  1. Una versión emitida no se toca nunca. La versión 1 (`recibida`) se crea
 *     con el envío público; cada decisión final del Oficial de Cumplimiento
 *     inserta una fila nueva (`evaluada`). No hay UPDATE del binario ni del
 *     hash: el índice único `(formulario_id, clase, version_documento)` lo
 *     hace imposible incluso ante una carrera.
 *  2. El token del enlace público solo existe en el correo/respuesta del
 *     usuario. En base de datos vive su SHA-256, de modo que ni un volcado de
 *     la tabla ni un log permitan descargar el documento.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { prisma } from '../../config/prisma'
import { uploadToS3, deleteFromS3, getS3ObjectStream } from '../../config/aws'
import { ttlDescargaPublica } from './sarlaft-email-mode'
import type { EstadoDocumental } from './declaracion-transporte-pdf.service'
import type { TemplateManifest } from './declaracion-transporte-template.manifest'

/** Familia de documento generado. Deja espacio a futuros formatos con template. */
export const CLASE_DECLARACION_TRANSPORTE = 'declaracion_empresa_transporte'

export type CanalEntrega = 'email_declarante' | 'email_interno' | 'descarga'
export type EstadoEntrega = 'pendiente' | 'enviado' | 'fallido' | 'descargado' | 'revocado'

export interface DocumentoGeneradoDTO {
  id: string
  version_documento: number
  estado_documental: EstadoDocumental
  codigo_template: string
  version_template: string
  template_sha256: string
  pdf_sha256: string
  s3_key: string
  mime_type: string
  tamano_bytes: string
  nombre_archivo: string
  generado_por_id: string | null
  created_at: string
}

function sha256(valor: Buffer | string): string {
  return createHash('sha256').update(valor).digest('hex')
}

/** Clave S3 de una versión documental. Incluye la versión para que ninguna
 *  emisión posterior pueda sobrescribir el objeto de una anterior. */
export function claveS3(radicado: string, version: number, año: number): string {
  const seguro = radicado.replace(/[^A-Za-z0-9_-]/g, '_')
  return `sarlaft/${año}/${seguro}/generado/declaracion_transporte_v${version}.pdf`
}

export const DeclaracionTransporteDocumentosService = {
  /**
   * Sube el PDF y registra la versión documental.
   *
   * El objeto S3 se sube ANTES de insertar la fila y, si el INSERT falla, se
   * borra: así no queda un objeto huérfano al que ninguna fila apunte. El
   * orden inverso dejaría una fila apuntando a un objeto inexistente, que es
   * peor porque el dashboard la mostraría como evidencia descargable.
   */
  async registrarVersion(args: {
    formularioId: string
    radicado: string
    marca: string
    pdf: Buffer
    pdfSha256: string
    nombreArchivo: string
    estadoDocumental: EstadoDocumental
    versionDocumento: number
    template: Pick<TemplateManifest, 'codigo' | 'version_template' | 'sha256'>
    generadoPorId?: string | null
  }): Promise<DocumentoGeneradoDTO> {
    const año = new Date().getUTCFullYear()
    const key = claveS3(args.radicado, args.versionDocumento, año)

    await uploadToS3(key, args.pdf, 'application/pdf')
    try {
      const fila = await prisma.formulario_sarlaft_ptee_documento_generado.create({
        data: {
          formulario_id: args.formularioId,
          marca: args.marca,
          clase: CLASE_DECLARACION_TRANSPORTE,
          version_documento: args.versionDocumento,
          estado_documental: args.estadoDocumental,
          codigo_template: args.template.codigo,
          version_template: args.template.version_template,
          template_sha256: args.template.sha256,
          s3_key: key,
          mime_type: 'application/pdf',
          tamano_bytes: BigInt(args.pdf.length),
          pdf_sha256: args.pdfSha256,
          generado_por_id: args.generadoPorId ?? null
        }
      })
      return aDTO(fila, args.nombreArchivo)
    } catch (err) {
      await deleteFromS3(key).catch(() => {})
      throw err
    }
  },

  /** Siguiente número de versión para el formulario. Empieza en 1. */
  async siguienteVersion(formularioId: string): Promise<number> {
    const ultima = await prisma.formulario_sarlaft_ptee_documento_generado.findFirst({
      where: { formulario_id: formularioId, clase: CLASE_DECLARACION_TRANSPORTE },
      orderBy: { version_documento: 'desc' },
      select: { version_documento: true }
    })
    return (ultima?.version_documento ?? 0) + 1
  },

  /** Versiones de un formulario, de la más reciente a la más antigua. */
  async listarVersiones(formularioId: string): Promise<DocumentoGeneradoDTO[]> {
    const filas = await prisma.formulario_sarlaft_ptee_documento_generado.findMany({
      where: { formulario_id: formularioId, clase: CLASE_DECLARACION_TRANSPORTE },
      orderBy: { version_documento: 'desc' }
    })
    return filas.map((f) => aDTO(f))
  },

  async obtenerVersion(documentoId: string) {
    return prisma.formulario_sarlaft_ptee_documento_generado.findUnique({
      where: { id: documentoId }
    })
  },

  /** Descarga el binario archivado desde S3. */
  async leerBinario(s3Key: string): Promise<Buffer | null> {
    const stream = await getS3ObjectStream(s3Key)
    if (!stream) return null
    const chunks: Buffer[] = []
    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    }
    return Buffer.concat(chunks)
  },

  // ── Entregas ───────────────────────────────────────────────────────────

  /**
   * Registra un intento de entrega.
   *
   * Es idempotente por `(documento, canal, destinatario, intento)`: un
   * reintento con el mismo número de intento actualiza la fila en vez de
   * duplicarla, y un reintento real usa el siguiente número.
   */
  async registrarEntrega(args: {
    documentoGeneradoId: string
    canal: CanalEntrega
    destinatario?: string | null
    estado: EstadoEntrega
    proveedor?: string | null
    providerMessageId?: string | null
    errorCodigo?: string | null
    intento?: number
  }) {
    const intento = args.intento ?? (await this.siguienteIntento(args))
    const datos = {
      estado: args.estado,
      proveedor: args.proveedor ?? null,
      provider_message_id: args.providerMessageId ?? null,
      error_codigo: args.errorCodigo ?? null,
      completed_at: args.estado === 'enviado' ? new Date() : null
    }
    return prisma.formulario_sarlaft_ptee_documento_entrega.upsert({
      where: {
        documento_generado_id_canal_destinatario_intento: {
          documento_generado_id: args.documentoGeneradoId,
          canal: args.canal,
          destinatario: args.destinatario ?? null,
          intento
        }
      },
      create: {
        documento_generado_id: args.documentoGeneradoId,
        canal: args.canal,
        destinatario: args.destinatario ?? null,
        intento,
        ...datos
      },
      update: datos
    })
  },

  /** Número del siguiente intento para ese destinatario y canal. */
  async siguienteIntento(args: {
    documentoGeneradoId: string
    canal: CanalEntrega
    destinatario?: string | null
  }): Promise<number> {
    const ultimo = await prisma.formulario_sarlaft_ptee_documento_entrega.findFirst({
      where: {
        documento_generado_id: args.documentoGeneradoId,
        canal: args.canal,
        destinatario: args.destinatario ?? null
      },
      orderBy: { intento: 'desc' },
      select: { intento: true, estado: true }
    })
    if (!ultimo) return 1
    // Un envío ya exitoso no se vuelve a numerar: reintentar sobre él debe
    // actualizar esa misma fila, no crear una entrega nueva idéntica.
    return ultimo.estado === 'enviado' ? ultimo.intento : ultimo.intento + 1
  },

  async listarEntregas(documentoGeneradoId: string) {
    return prisma.formulario_sarlaft_ptee_documento_entrega.findMany({
      where: { documento_generado_id: documentoGeneradoId },
      orderBy: { created_at: 'asc' }
    })
  },

  // ── Enlace temporal de descarga ────────────────────────────────────────

  /**
   * Crea un enlace de descarga de un solo documento.
   *
   * Devuelve el token en claro UNA sola vez; en base de datos queda su hash.
   * El radicado por sí solo nunca sirve como credencial: es un dato que el
   * declarante comparte por correo y que aparece en el propio PDF.
   */
  async crearTokenDescarga(
    documentoGeneradoId: string,
    ttlSegundos: number = ttlDescargaPublica()
  ): Promise<{ token: string; expiresAt: Date; entregaId: string }> {
    const token = randomBytes(32).toString('base64url')
    const expiresAt = new Date(Date.now() + ttlSegundos * 1000)
    const intento = await this.siguienteIntento({
      documentoGeneradoId,
      canal: 'descarga',
      destinatario: null
    })
    const fila = await prisma.formulario_sarlaft_ptee_documento_entrega.create({
      data: {
        documento_generado_id: documentoGeneradoId,
        canal: 'descarga',
        destinatario: null,
        estado: 'pendiente',
        intento,
        token_hash: sha256(token),
        expires_at: expiresAt
      }
    })
    return { token, expiresAt, entregaId: fila.id }
  },

  /**
   * Canjea un token de descarga.
   *
   * Devuelve `null` para token inexistente, vencido o revocado — sin
   * distinguir el motivo hacia afuera, para no convertir el endpoint en un
   * oráculo que confirme qué tokens existieron.
   */
  async canjearTokenDescarga(token: string): Promise<{
    documento: Awaited<ReturnType<typeof prisma.formulario_sarlaft_ptee_documento_generado.findUnique>>
    entregaId: string
  } | null> {
    if (!token || typeof token !== 'string') return null
    const hash = sha256(token)

    const entrega = await prisma.formulario_sarlaft_ptee_documento_entrega.findUnique({
      where: { token_hash: hash },
      include: { documento_generado: true }
    })
    if (!entrega || !entrega.token_hash) return null

    // Comparación en tiempo constante sobre el hash ya recuperado. La búsqueda
    // por índice no es constante, pero esto evita filtrar por comparación de
    // strings una vez que hay candidato.
    const a = Buffer.from(entrega.token_hash, 'utf8')
    const b = Buffer.from(hash, 'utf8')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    if (entrega.estado === 'revocado') return null
    if (!entrega.expires_at || entrega.expires_at.getTime() < Date.now()) return null

    await prisma.formulario_sarlaft_ptee_documento_entrega.update({
      where: { id: entrega.id },
      data: { estado: 'descargado', completed_at: new Date() }
    })

    return { documento: entrega.documento_generado, entregaId: entrega.id }
  },

  /** Revoca todos los enlaces vivos de un documento. */
  async revocarDescargas(documentoGeneradoId: string): Promise<number> {
    const r = await prisma.formulario_sarlaft_ptee_documento_entrega.updateMany({
      where: {
        documento_generado_id: documentoGeneradoId,
        canal: 'descarga',
        estado: { in: ['pendiente'] }
      },
      data: { estado: 'revocado' }
    })
    return r.count
  }
}

function aDTO(fila: any, nombreArchivo?: string): DocumentoGeneradoDTO {
  return {
    id: fila.id,
    version_documento: fila.version_documento,
    estado_documental: fila.estado_documental as EstadoDocumental,
    codigo_template: fila.codigo_template,
    version_template: fila.version_template,
    template_sha256: fila.template_sha256,
    pdf_sha256: fila.pdf_sha256,
    s3_key: fila.s3_key,
    mime_type: fila.mime_type,
    tamano_bytes: fila.tamano_bytes.toString(),
    nombre_archivo:
      nombreArchivo ??
      `${fila.codigo_template}_v${fila.version_documento}.pdf`.replace(/[^\w.-]/g, '_'),
    generado_por_id: fila.generado_por_id,
    created_at: fila.created_at.toISOString()
  }
}
