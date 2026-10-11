import { randomUUID } from 'crypto'
import path from 'path'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import {
  CATEGORIAS_DOCUMENTO,
  CATEGORIA_POR_CLAVE,
  DIAS_POR_VENCER,
  ESTADO_NO_APLICA,
  ESTADO_REEMPLAZADO,
  ESTADO_VIGENTE,
} from './catalogo'

/**
 * Documentos de la hoja de vida del vehículo, sobre la tabla `documento`.
 *
 * El documento ACTUAL de cada categoría es la fila `vigente` de vencimiento
 * más lejano (la misma regla del panel de mantenimiento): la carga de 2025
 * dejó varias filas `vigente` por categoría —cada renovación como fila
 * nueva— y así se leen bien sin migrarlas. Subir una versión nueva deja las
 * anteriores como `reemplazado`, que es el historial.
 *
 * `no_aplica` registra que la categoría todavía no le corresponde (la
 * tecnomecánica de un vehículo nuevo), con o sin soporte.
 */

export type EstadoVigencia = 'vigente' | 'por_vencer' | 'vencido' | 'sin_fecha' | 'no_aplica' | 'faltante' | 'cargado'

const SELECT_DOC = {
  id: true,
  categoria: true,
  nombre_original: true,
  mimetype: true,
  size: true,
  s3_key: true,
  estado: true,
  fecha_vigencia: true,
  fecha_vencimiento: true,
  fecha_expedicion: true,
  numero: true,
  emisor: true,
  metadata: true,
  created_at: true,
} as const

type FilaDoc = {
  id: string
  categoria: string
  nombre_original: string
  mimetype: string
  size: number
  s3_key: string | null
  estado: string
  fecha_vigencia: Date | null
  fecha_vencimiento: Date | null
  fecha_expedicion: Date | null
  numero: string | null
  emisor: string | null
  metadata: unknown
  created_at: Date
}

/** `YYYY-MM-DD` de una fecha `@db.Date` (llega a medianoche UTC). */
const isoDia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)

/** Hoy en Colombia, como `YYYY-MM-DD`. */
function hoyColombia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000)
}

/**
 * Vencimiento de una fila. La carga de 2025 guardó `fecha_vigencia` un día
 * DESPUÉS del real (03-10-2025 quedó como 2025-10-04); el valor bueno quedó en
 * `metadata.fechaVigenciaOriginal`, que por eso va antes que `fecha_vigencia`.
 */
export function vencimientoDe(d: Pick<FilaDoc, 'fecha_vencimiento' | 'fecha_vigencia' | 'metadata'>): string | null {
  const original = (d.metadata as Record<string, unknown> | null)?.fechaVigenciaOriginal
  return (
    isoDia(d.fecha_vencimiento) ??
    (typeof original === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(original) ? original : null) ??
    isoDia(d.fecha_vigencia)
  )
}

function serializar(d: FilaDoc) {
  const meta = (d.metadata ?? {}) as Record<string, unknown>
  return {
    id: d.id,
    categoria: d.categoria,
    nombre: d.nombre_original,
    mimetype: d.mimetype,
    size: d.size,
    estado: d.estado,
    tiene_archivo: Boolean(d.s3_key),
    fecha_vencimiento: vencimientoDe(d),
    fecha_expedicion: isoDia(d.fecha_expedicion),
    numero: d.numero,
    emisor: d.emisor,
    origen: (meta.origen as string) ?? (meta.uploadSession ? 'carga_2025' : 'app'),
    creado: d.created_at.toISOString(),
  }
}

export type DocumentoVehiculo = ReturnType<typeof serializar>

function estadoDe(clave: string, actual: FilaDoc | null, hoy: string): { estado: EstadoVigencia; dias: number | null } {
  const cat = CATEGORIA_POR_CLAVE.get(clave)
  if (!actual) return { estado: 'faltante', dias: null }
  if (actual.estado === ESTADO_NO_APLICA) return { estado: 'no_aplica', dias: null }
  if (!cat?.vence) return { estado: 'cargado', dias: null }
  const vence = vencimientoDe(actual)
  if (!vence) return { estado: 'sin_fecha', dias: null }
  const dias = diasEntre(hoy, vence)
  return { estado: dias < 0 ? 'vencido' : dias <= DIAS_POR_VENCER ? 'por_vencer' : 'vigente', dias }
}

/** Ordena para elegir el actual: no_aplica/vigente primero, luego vencimiento más lejano, luego el más reciente. */
function ordenarActuales(a: FilaDoc, b: FilaDoc) {
  const va = vencimientoDe(a) ?? ''
  const vb = vencimientoDe(b) ?? ''
  if (va !== vb) return va < vb ? 1 : -1
  return b.created_at.getTime() - a.created_at.getTime()
}

export const VehiculosDocumentosService = {
  catalogo() {
    return CATEGORIAS_DOCUMENTO
  },

  async listar(vehiculoId: string) {
    const filas = (await prisma.documento.findMany({
      where: { vehiculo_id: vehiculoId, deleted_at: null },
      select: SELECT_DOC,
    })) as FilaDoc[]

    const hoy = hoyColombia()
    const porCategoria = new Map<string, FilaDoc[]>()
    for (const f of filas) {
      if (!porCategoria.has(f.categoria)) porCategoria.set(f.categoria, [])
      porCategoria.get(f.categoria)!.push(f)
    }

    const categorias = CATEGORIAS_DOCUMENTO.map((cat) => {
      const todas = porCategoria.get(cat.clave) ?? []
      const candidatas = todas.filter((d) => d.estado === ESTADO_VIGENTE || d.estado === ESTADO_NO_APLICA).sort(ordenarActuales)
      const actual = candidatas[0] ?? null
      const historial = todas
        .filter((d) => d.id !== actual?.id)
        .sort(ordenarActuales)
        .map(serializar)
      const { estado, dias } = estadoDe(cat.clave, actual, hoy)
      return { ...cat, actual: actual ? serializar(actual) : null, estado, dias, historial }
    })

    const vig = categorias.filter((c) => c.vence)
    return {
      hoy,
      categorias,
      resumen: {
        vencidos: vig.filter((c) => c.estado === 'vencido').length,
        por_vencer: vig.filter((c) => c.estado === 'por_vencer').length,
        faltantes: vig.filter((c) => c.estado === 'faltante').length,
        al_dia: vig.filter((c) => c.estado === 'vigente' || c.estado === 'no_aplica').length,
        total: vig.length,
      },
    }
  },

  /**
   * Registra una versión nueva. Las filas `vigente`/`no_aplica` anteriores de
   * la misma categoría pasan a `reemplazado`: así el panel deja de contarlas.
   */
  async subir(params: {
    vehiculoId: string
    categoria: string
    archivo?: { buffer: Buffer; nombre: string; mimetype: string }
    fecha_vencimiento?: string | null
    fecha_expedicion?: string | null
    numero?: string | null
    emisor?: string | null
    no_aplica?: boolean
    usuarioId?: string | null
    origen?: string
    metadata?: Record<string, unknown>
    /**
     * `true`: se registra como versión anterior (`reemplazado`) sin tocar la
     * vigente. Lo usa el importador para cargar el historial de un folder.
     */
    comoHistorial?: boolean
  }) {
    const cat = CATEGORIA_POR_CLAVE.get(params.categoria)
    if (!cat) throw Object.assign(new Error('Categoría de documento desconocida'), { statusCode: 400 })
    if (params.no_aplica && !cat.puedeNoAplicar) {
      throw Object.assign(new Error(`${cat.etiqueta} no admite «no aplica»`), { statusCode: 400 })
    }
    if (!params.archivo && !params.no_aplica) {
      throw Object.assign(new Error('Falta el archivo'), { statusCode: 400 })
    }
    const vence = params.no_aplica || !cat.vence ? null : (params.fecha_vencimiento || null)
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) {
      throw Object.assign(new Error('Fecha de vencimiento inválida'), { statusCode: 400 })
    }

    const vehiculo = await prisma.vehiculos.findFirst({ where: { id: params.vehiculoId, deleted_at: null }, select: { id: true } })
    if (!vehiculo) throw Object.assign(new Error('Vehículo no encontrado'), { statusCode: 404 })

    const id = randomUUID()
    let s3Key: string | null = null
    let nombreArchivo = ''
    if (params.archivo) {
      const ext = (path.extname(params.archivo.nombre) || '.pdf').toLowerCase()
      nombreArchivo = `${id}${ext}`
      s3Key = `vehiculos/${params.vehiculoId}/documentos/${cat.clave}/${nombreArchivo}`
      await uploadToS3(s3Key, params.archivo.buffer, params.archivo.mimetype || 'application/pdf')
    }

    const ahora = new Date()
    return prisma.$transaction(async (tx) => {
      if (!params.comoHistorial) await tx.documento.updateMany({
        where: {
          vehiculo_id: params.vehiculoId,
          categoria: cat.clave,
          deleted_at: null,
          estado: { in: [ESTADO_VIGENTE, ESTADO_NO_APLICA] },
        },
        data: { estado: ESTADO_REEMPLAZADO, updated_at: ahora },
      })
      const fila = await tx.documento.create({
        data: {
          id,
          vehiculo_id: params.vehiculoId,
          categoria: cat.clave,
          tipo_documento: cat.clave,
          nombre_original: params.archivo?.nombre ?? 'No aplica',
          nombre_archivo: nombreArchivo,
          ruta_archivo: s3Key ?? '',
          s3_key: s3Key,
          filename: nombreArchivo || null,
          mimetype: params.archivo?.mimetype ?? '',
          size: params.archivo?.buffer.length ?? 0,
          estado: params.comoHistorial ? ESTADO_REEMPLAZADO : params.no_aplica ? ESTADO_NO_APLICA : ESTADO_VIGENTE,
          fecha_vencimiento: vence ? new Date(`${vence}T00:00:00Z`) : null,
          fecha_vigencia: vence ? new Date(`${vence}T00:00:00Z`) : null,
          fecha_expedicion: params.fecha_expedicion ? new Date(`${params.fecha_expedicion}T00:00:00Z`) : null,
          numero: params.numero || null,
          emisor: params.emisor || null,
          upload_date: ahora,
          created_at: ahora,
          updated_at: ahora,
          metadata: { origen: params.origen ?? 'app', subido_por: params.usuarioId ?? null, ...(params.metadata ?? {}) },
        },
        select: SELECT_DOC,
      })
      return serializar(fila as FilaDoc)
    })
  },

  /** Corrige fechas o datos sin cambiar el archivo (p. ej. un vencimiento leído mal). */
  async actualizar(
    vehiculoId: string,
    docId: string,
    datos: { fecha_vencimiento?: string | null; fecha_expedicion?: string | null; numero?: string | null; emisor?: string | null },
  ) {
    const doc = await prisma.documento.findFirst({ where: { id: docId, vehiculo_id: vehiculoId, deleted_at: null }, select: { id: true } })
    if (!doc) throw Object.assign(new Error('Documento no encontrado'), { statusCode: 404 })
    const fecha = (v: string | null | undefined) =>
      v === undefined ? undefined : v ? new Date(`${v}T00:00:00Z`) : null
    const fila = await prisma.documento.update({
      where: { id: docId },
      data: {
        fecha_vencimiento: fecha(datos.fecha_vencimiento),
        fecha_vigencia: fecha(datos.fecha_vencimiento),
        fecha_expedicion: fecha(datos.fecha_expedicion),
        numero: datos.numero === undefined ? undefined : datos.numero || null,
        emisor: datos.emisor === undefined ? undefined : datos.emisor || null,
        updated_at: new Date(),
      },
      select: SELECT_DOC,
    })
    return serializar(fila as FilaDoc)
  },

  /**
   * Borra (soft) una versión. Si era la actual, la versión reemplazada más
   * reciente vuelve a quedar vigente: borrar un SOAT subido por error no debe
   * dejar la categoría vacía si había uno anterior.
   */
  async eliminar(vehiculoId: string, docId: string) {
    const doc = await prisma.documento.findFirst({
      where: { id: docId, vehiculo_id: vehiculoId, deleted_at: null },
      select: { id: true, categoria: true, estado: true },
    })
    if (!doc) throw Object.assign(new Error('Documento no encontrado'), { statusCode: 404 })
    const ahora = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.documento.update({ where: { id: docId }, data: { deleted_at: ahora, updated_at: ahora } })
      if (doc.estado !== ESTADO_REEMPLAZADO) {
        const quedan = await tx.documento.count({
          where: { vehiculo_id: vehiculoId, categoria: doc.categoria, deleted_at: null, estado: { in: [ESTADO_VIGENTE, ESTADO_NO_APLICA] } },
        })
        if (quedan === 0) {
          const previa = await tx.documento.findFirst({
            where: { vehiculo_id: vehiculoId, categoria: doc.categoria, deleted_at: null, estado: ESTADO_REEMPLAZADO },
            orderBy: [{ fecha_vencimiento: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
            select: { id: true },
          })
          if (previa) await tx.documento.update({ where: { id: previa.id }, data: { estado: ESTADO_VIGENTE, updated_at: ahora } })
        }
      }
    })
  },

  /** URL firmada de 15 minutos para ver o descargar. */
  async url(vehiculoId: string, docId: string) {
    const doc = await prisma.documento.findFirst({
      where: { id: docId, vehiculo_id: vehiculoId, deleted_at: null },
      select: { s3_key: true, nombre_original: true },
    })
    if (!doc?.s3_key) throw Object.assign(new Error('Documento sin archivo'), { statusCode: 404 })
    return getS3SignedUrl(doc.s3_key, 15 * 60)
  },
}
