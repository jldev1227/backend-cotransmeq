import { randomUUID } from 'crypto'
import path from 'path'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import {
  CATEGORIAS_DOCUMENTO_CONDUCTOR,
  CATEGORIA_CONDUCTOR_POR_CLAVE,
  ESTADO_NO_APLICA,
  ESTADO_REEMPLAZADO,
  ESTADO_VIGENTE,
} from './catalogo'
import { comprimirPdf } from './compresion'
import { estadoDe, hoyColombia, isoDia, vencimientoDe } from './vigencia'

/**
 * Documentos de la hoja de vida del conductor, sobre la tabla `documento`
 * (columna `conductor_id`). Calca los del vehículo:
 *
 * - El documento ACTUAL de cada categoría es la fila `vigente`/`no_aplica` de
 *   vencimiento más lejano; subir una versión nueva deja las anteriores como
 *   `reemplazado`, que es el historial.
 * - Solo se leen y escriben las categorías del catálogo: la `FOTO_PERFIL`
 *   vive en la misma tabla y la gestiona la ficha del conductor, no esto.
 *
 * La licencia además se sincroniza con `conductores.vencimiento_licencia` y
 * `categoria_licencia`, que son lo que leen el FUEC y el panel de talento
 * humano: subir la renovación aquí tiene que bastar para que el extracto
 * salga con la fecha nueva.
 */

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

const CLAVES = CATEGORIAS_DOCUMENTO_CONDUCTOR.map((c) => c.clave)
const LICENCIA = 'LICENCIA'

const errorHttp = (mensaje: string, statusCode: number) => Object.assign(new Error(mensaje), { statusCode })
const aFecha = (iso: string) => new Date(`${iso}T00:00:00Z`)

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
    categoria_licencia: typeof meta.categoria_licencia === 'string' ? meta.categoria_licencia : null,
    origen: (meta.origen as string) ?? (meta.uploadSession ? 'carga_2025' : 'app'),
    creado: d.created_at.toISOString(),
  }
}

export type DocumentoConductor = ReturnType<typeof serializar>

/** Ordena para elegir el actual: vencimiento más lejano primero, luego el más reciente. */
function ordenarActuales(a: FilaDoc, b: FilaDoc) {
  const va = vencimientoDe(a) ?? ''
  const vb = vencimientoDe(b) ?? ''
  if (va !== vb) return va < vb ? 1 : -1
  return b.created_at.getTime() - a.created_at.getTime()
}

async function exigirConductor(conductorId: string) {
  const c = await prisma.conductores.findFirst({
    where: { id: conductorId, deleted_at: null },
    select: { id: true, vencimiento_licencia: true, categoria_licencia: true },
  })
  if (!c) throw errorHttp('Conductor no encontrado', 404)
  return c
}

export const ConductoresDocumentosService = {
  catalogo() {
    return CATEGORIAS_DOCUMENTO_CONDUCTOR
  },

  async listar(conductorId: string) {
    const conductor = await exigirConductor(conductorId)
    const filas = (await prisma.documento.findMany({
      where: { conductor_id: conductorId, deleted_at: null, categoria: { in: CLAVES } },
      select: SELECT_DOC,
    })) as FilaDoc[]

    const hoy = hoyColombia()
    const porCategoria = new Map<string, FilaDoc[]>()
    for (const f of filas) {
      if (!porCategoria.has(f.categoria)) porCategoria.set(f.categoria, [])
      porCategoria.get(f.categoria)!.push(f)
    }

    const venceLicencia = isoDia(conductor.vencimiento_licencia)
    const categorias = CATEGORIAS_DOCUMENTO_CONDUCTOR.map((cat) => {
      const todas = porCategoria.get(cat.clave) ?? []
      const candidatas = todas.filter((d) => d.estado === ESTADO_VIGENTE || d.estado === ESTADO_NO_APLICA).sort(ordenarActuales)
      const actual = candidatas[0] ?? null
      const historial = todas
        .filter((d) => d.id !== actual?.id)
        .sort(ordenarActuales)
        .map(serializar)
      const esLicencia = cat.clave === LICENCIA
      const { estado, dias, vence } = estadoDe(cat.clave, actual, hoy, esLicencia ? venceLicencia : null)
      return {
        ...cat,
        actual: actual ? serializar(actual) : null,
        estado,
        dias,
        /// Fecha efectiva: en la licencia puede salir de la ficha aunque no
        /// haya archivo; el front la usa en vez de `actual.fecha_vencimiento`.
        /// No se llama `vence`: pisaría el `vence` (booleano) del catálogo.
        vencimiento: vence,
        historial,
        ...(esLicencia ? { categoria_licencia: conductor.categoria_licencia ?? null } : {}),
      }
    })

    /// El resumen cuenta lo obligatorio: lo que vence y lo marcado como
    /// requerido. Un «Otros cursos» que falte no es un hueco.
    const obligatorias = categorias.filter((c) => c.vence || c.requerido)
    return {
      hoy,
      categorias,
      resumen: {
        vencidos: obligatorias.filter((c) => c.estado === 'vencido').length,
        por_vencer: obligatorias.filter((c) => c.estado === 'por_vencer').length,
        faltantes: obligatorias.filter((c) => c.estado === 'faltante').length,
        sin_fecha: obligatorias.filter((c) => c.estado === 'sin_fecha').length,
        al_dia: obligatorias.filter((c) => ['vigente', 'cargado', 'no_aplica'].includes(c.estado)).length,
        total: obligatorias.length,
      },
    }
  },

  /**
   * Registra una versión nueva. Las filas `vigente`/`no_aplica` anteriores de
   * la misma categoría pasan a `reemplazado`: así deja de contar como actual.
   */
  async subir(params: {
    conductorId: string
    categoria: string
    archivo?: { buffer: Buffer; nombre: string; mimetype: string }
    fecha_vencimiento?: string | null
    fecha_expedicion?: string | null
    numero?: string | null
    emisor?: string | null
    categoria_licencia?: string | null
    no_aplica?: boolean
    usuarioId?: string | null
  }) {
    const cat = CATEGORIA_CONDUCTOR_POR_CLAVE.get(params.categoria)
    if (!cat) throw errorHttp('Categoría de documento desconocida', 400)
    if (params.no_aplica && !cat.puedeNoAplicar) throw errorHttp(`${cat.etiqueta} no admite «no aplica»`, 400)
    if (!params.archivo && !params.no_aplica) throw errorHttp('Falta el archivo', 400)
    const vence = params.no_aplica || !cat.vence ? null : params.fecha_vencimiento || null
    if (vence && !/^\d{4}-\d{2}-\d{2}$/.test(vence)) throw errorHttp('Fecha de vencimiento inválida', 400)
    const categoriaLicencia = cat.pideCategoriaLicencia ? params.categoria_licencia || null : null

    await exigirConductor(params.conductorId)

    const id = randomUUID()
    let s3Key: string | null = null
    let nombreArchivo = ''
    let buffer = params.archivo?.buffer
    if (params.archivo && buffer) {
      if (params.archivo.mimetype === 'application/pdf') buffer = await comprimirPdf(buffer)
      const ext = (path.extname(params.archivo.nombre) || '.pdf').toLowerCase()
      nombreArchivo = `${id}${ext}`
      /// Misma ruta que la carga de 2025 (`conductores/<id>/documentos/<CAT>/`).
      s3Key = `conductores/${params.conductorId}/documentos/${cat.clave}/${nombreArchivo}`
      await uploadToS3(s3Key, buffer, params.archivo.mimetype || 'application/pdf')
    }

    const ahora = new Date()
    return prisma.$transaction(async (tx) => {
      await tx.documento.updateMany({
        where: {
          conductor_id: params.conductorId,
          categoria: cat.clave,
          deleted_at: null,
          estado: { in: [ESTADO_VIGENTE, ESTADO_NO_APLICA] },
        },
        data: { estado: ESTADO_REEMPLAZADO, updated_at: ahora },
      })
      const fila = await tx.documento.create({
        data: {
          id,
          conductor_id: params.conductorId,
          categoria: cat.clave,
          tipo_documento: cat.clave,
          nombre_original: params.archivo?.nombre ?? 'No aplica',
          nombre_archivo: nombreArchivo,
          ruta_archivo: s3Key ?? '',
          s3_key: s3Key,
          filename: nombreArchivo || null,
          mimetype: params.archivo?.mimetype ?? '',
          size: buffer?.length ?? 0,
          estado: params.no_aplica ? ESTADO_NO_APLICA : ESTADO_VIGENTE,
          fecha_vencimiento: vence ? aFecha(vence) : null,
          fecha_vigencia: vence ? aFecha(vence) : null,
          fecha_expedicion: params.fecha_expedicion ? aFecha(params.fecha_expedicion) : null,
          numero: params.numero || null,
          emisor: params.emisor || null,
          upload_date: ahora,
          created_at: ahora,
          updated_at: ahora,
          metadata: {
            origen: 'app',
            subido_por: params.usuarioId ?? null,
            ...(categoriaLicencia ? { categoria_licencia: categoriaLicencia } : {}),
            ...(params.archivo && buffer && buffer.length < params.archivo.buffer.length
              ? { size_original: params.archivo.buffer.length }
              : {}),
          },
        },
        select: SELECT_DOC,
      })
      if (cat.clave === LICENCIA && (vence || categoriaLicencia)) {
        await tx.conductores.update({
          where: { id: params.conductorId },
          data: {
            ...(vence ? { vencimiento_licencia: aFecha(vence) } : {}),
            ...(categoriaLicencia ? { categoria_licencia: categoriaLicencia } : {}),
            updated_at: ahora,
          },
        })
      }
      return serializar(fila as FilaDoc)
    })
  },

  /** Corrige fechas o datos sin cambiar el archivo (p. ej. completar un vencimiento). */
  async actualizar(
    conductorId: string,
    docId: string,
    datos: {
      fecha_vencimiento?: string | null
      fecha_expedicion?: string | null
      numero?: string | null
      emisor?: string | null
      categoria_licencia?: string | null
    },
  ) {
    const doc = await prisma.documento.findFirst({
      where: { id: docId, conductor_id: conductorId, deleted_at: null, categoria: { in: CLAVES } },
      select: { id: true, categoria: true, estado: true, metadata: true },
    })
    if (!doc) throw errorHttp('Documento no encontrado', 404)
    const fecha = (v: string | null | undefined) => (v === undefined ? undefined : v ? aFecha(v) : null)
    const esLicenciaActual = doc.categoria === LICENCIA && doc.estado === ESTADO_VIGENTE
    const metadata =
      doc.categoria === LICENCIA && datos.categoria_licencia !== undefined
        ? { ...((doc.metadata ?? {}) as Record<string, unknown>), categoria_licencia: datos.categoria_licencia || null }
        : undefined
    const ahora = new Date()
    return prisma.$transaction(async (tx) => {
      const fila = await tx.documento.update({
        where: { id: docId },
        data: {
          fecha_vencimiento: fecha(datos.fecha_vencimiento),
          fecha_vigencia: fecha(datos.fecha_vencimiento),
          fecha_expedicion: fecha(datos.fecha_expedicion),
          numero: datos.numero === undefined ? undefined : datos.numero || null,
          emisor: datos.emisor === undefined ? undefined : datos.emisor || null,
          metadata,
          updated_at: ahora,
        },
        select: SELECT_DOC,
      })
      /// Solo la versión actual escribe en la ficha: corregir la fecha de una
      /// licencia vieja del historial no puede devolver el FUEC a esa fecha.
      if (esLicenciaActual && (datos.fecha_vencimiento || datos.categoria_licencia)) {
        await tx.conductores.update({
          where: { id: conductorId },
          data: {
            ...(datos.fecha_vencimiento ? { vencimiento_licencia: aFecha(datos.fecha_vencimiento) } : {}),
            ...(datos.categoria_licencia ? { categoria_licencia: datos.categoria_licencia } : {}),
            updated_at: ahora,
          },
        })
      }
      return serializar(fila as FilaDoc)
    })
  },

  /**
   * Borra (soft) una versión. Si era la actual, la reemplazada más reciente
   * vuelve a quedar vigente: borrar un examen subido por error no debe dejar
   * la categoría vacía si había uno anterior.
   *
   * En la licencia, la que revive vuelve a escribir su fecha en la ficha. Si
   * no queda ninguna, la ficha conserva la que tenía: pudo venir del
   * formulario del conductor y no hay de dónde sacar otra mejor.
   */
  async eliminar(conductorId: string, docId: string) {
    const doc = await prisma.documento.findFirst({
      where: { id: docId, conductor_id: conductorId, deleted_at: null, categoria: { in: CLAVES } },
      select: { id: true, categoria: true, estado: true },
    })
    if (!doc) throw errorHttp('Documento no encontrado', 404)
    const ahora = new Date()
    await prisma.$transaction(async (tx) => {
      await tx.documento.update({ where: { id: docId }, data: { deleted_at: ahora, updated_at: ahora } })
      if (doc.estado === ESTADO_REEMPLAZADO) return
      const quedan = await tx.documento.count({
        where: { conductor_id: conductorId, categoria: doc.categoria, deleted_at: null, estado: { in: [ESTADO_VIGENTE, ESTADO_NO_APLICA] } },
      })
      if (quedan > 0) return
      const previa = await tx.documento.findFirst({
        where: { conductor_id: conductorId, categoria: doc.categoria, deleted_at: null, estado: ESTADO_REEMPLAZADO },
        orderBy: [{ fecha_vencimiento: { sort: 'desc', nulls: 'last' } }, { created_at: 'desc' }],
        select: { id: true, fecha_vencimiento: true, metadata: true },
      })
      if (!previa) return
      await tx.documento.update({ where: { id: previa.id }, data: { estado: ESTADO_VIGENTE, updated_at: ahora } })
      if (doc.categoria === LICENCIA && previa.fecha_vencimiento) {
        const categoria = (previa.metadata as Record<string, unknown> | null)?.categoria_licencia
        await tx.conductores.update({
          where: { id: conductorId },
          data: {
            vencimiento_licencia: previa.fecha_vencimiento,
            ...(typeof categoria === 'string' && categoria ? { categoria_licencia: categoria } : {}),
            updated_at: ahora,
          },
        })
      }
    })
  },

  /** URL firmada de 15 minutos para ver o descargar. */
  async url(conductorId: string, docId: string) {
    const doc = await prisma.documento.findFirst({
      where: { id: docId, conductor_id: conductorId, deleted_at: null, categoria: { in: CLAVES } },
      select: { s3_key: true },
    })
    if (!doc?.s3_key) throw errorHttp('Documento sin archivo', 404)
    return getS3SignedUrl(doc.s3_key, 15 * 60)
  },
}
