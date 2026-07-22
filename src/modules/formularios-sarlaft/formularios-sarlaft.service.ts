import { prisma } from '../../config/prisma'
import { getFormularioPorCodigo, FormularioDefinicion, SeccionDefinicion, PreguntaDefinicion, getDocumentosRequeridos, UPLOAD_MAX_BYTES, UPLOAD_MIME_PERMITIDOS, UPLOAD_EXT_PERMITIDAS, TipoDocumentoId, DOCUMENTOS_REQUERIDOS } from './formularios-sarlaft.constants'
import type { SubmitFormularioSarlaftInput, ArchivoUpload } from './formularios-sarlaft.schema'
import { EmailService } from '../../services/email.service'
import { uploadToS3, deleteFromS3, getS3SignedUrl } from '../../config/aws'
import crypto from 'crypto'

// ──────────────────────────────────────────────────────────
// Generación de radicado
// ──────────────────────────────────────────────────────────
async function generarRadicado(tipoFormulario: string): Promise<string> {
  const year = new Date().getFullYear()
  const prefix = tipoFormulario === 'cliente_proveedor' ? 'CLI' : tipoFormulario === 'accionistas' ? 'ACC' : 'PER'

  // Conteo del año actual
  const desde = new Date(`${year}-01-01T00:00:00Z`)
  const hasta = new Date(`${year}-12-31T23:59:59Z`)

  const count = await prisma.formulario_sarlaft_ptee.count({
    where: { fecha_envio: { gte: desde, lte: hasta }, tipo_formulario: tipoFormulario }
  })

  const correlativo = String(count + 1).padStart(5, '0')
  return `SARLAFT-${year}-${prefix}-${correlativo}`
}

// ──────────────────────────────────────────────────────────
// Extracción de datos clave (para queries/filtrado)
// ──────────────────────────────────────────────────────────
function extraerDatosClave(
  formulario: FormularioDefinicion,
  respuestas: Record<string, any>
): {
  nombre_completo: string | null
  tipo_documento: string | null
  numero_documento: string | null
  correo: string | null
  telefono: string | null
} {
  // Mapeo por tipo de formulario
  if (formulario.tipo === 'personal') {
    return {
      nombre_completo: firstString(respuestas['PER-IG-01']),
      tipo_documento: 'CC',
      numero_documento: firstString(respuestas['PER-IG-02']),
      correo: firstString(respuestas['PER-IP-03']),
      telefono: firstString(respuestas['PER-IP-02'])
    }
  }

  if (formulario.tipo === 'accionistas') {
    return {
      nombre_completo: firstString(respuestas['ACC-EMP-01']),
      tipo_documento: 'NIT',
      numero_documento: firstString(respuestas['ACC-EMP-02']),
      correo: firstString(respuestas['ACC-EMP-05']),
      telefono: firstString(respuestas['ACC-EMP-04'])
    }
  }

  // cliente_proveedor — depende del tipo de cliente
  const tipoCliente = firstString(respuestas['CLI-IG-01'])
  if (tipoCliente === 'Persona Natural') {
    return {
      nombre_completo: firstString(respuestas['CLI-PN-01']),
      tipo_documento: 'CC',
      numero_documento: firstString(respuestas['CLI-PN-02']),
      correo: firstString(respuestas['CLI-PN-09']),
      telefono: firstString(respuestas['CLI-PN-08'])
    }
  }
  // Persona Jurídica o sin definir
  return {
    nombre_completo: firstString(respuestas['CLI-PJ-01']) ?? firstString(respuestas['CLI-PN-01']),
    tipo_documento: tipoCliente === 'Persona Jurídica' ? 'NIT' : 'CC',
    numero_documento: firstString(respuestas['CLI-PJ-02']) ?? firstString(respuestas['CLI-PN-02']),
    correo: firstString(respuestas['CLI-DP-06']) ?? firstString(respuestas['CLI-PN-09']),
    telefono: firstString(respuestas['CLI-DP-05']) ?? firstString(respuestas['CLI-PN-08'])
  }
}

function firstString(value: unknown): string | null {
  if (value == null) return null
  if (typeof value === 'string') return value.trim() || null
  if (typeof value === 'number') return String(value)
  return null
}

// ──────────────────────────────────────────────────────────
// Validación de campos obligatorios
// ──────────────────────────────────────────────────────────
function validarObligatorios(
  formulario: FormularioDefinicion,
  respuestas: Record<string, any>
): string[] {
  const errores: string[] = []

  for (const seccion of formulario.secciones) {
    if (!esSeccionVisible(seccion, respuestas)) continue

    if (seccion.tipo_bloque === 'tabla_repetible_multiple') {
      const filas = extraerFilasTabla(seccion, respuestas)
      // Si la sección no tiene campos obligatorios, se permite 0 filas
      const tieneObligatorios = seccion.preguntas.some(p => p.obligatorio)
      if (filas.length === 0 && tieneObligatorios) {
        errores.push(`La sección "${seccion.seccion}" requiere al menos un registro.`)
        continue
      }
      for (let i = 0; i < filas.length; i++) {
        const fila = filas[i]
        for (const p of seccion.preguntas) {
          if (p.obligatorio) {
            const v = fila[p.id]
            if (v == null || v === '') {
              errores.push(`Fila ${i + 1} de "${seccion.seccion}" — campo "${p.pregunta}" es obligatorio.`)
            }
          }
        }
      }
    } else {
      for (const p of seccion.preguntas) {
        if (!p.obligatorio) continue
        if (p.tipo_respuesta === 'declaracion_informativa') continue
        if (!esPreguntaVisible(p.id, respuestas)) continue
        const v = respuestas[p.id]
        if (v == null || v === '') {
          errores.push(`Campo obligatorio pendiente: "${p.pregunta}"`)
        }
      }
    }
  }

  return errores
}

function esSeccionVisible(seccion: SeccionDefinicion, respuestas: Record<string, any>): boolean {
  if (!seccion.condicional) return true
  // Convención: "Se diligencia si <ID_PREGUNTA> = <valor>"
  const match = seccion.condicional.match(/si\s+([A-Z0-9-]+)\s*=\s*(.+)$/i)
  if (!match) return true
  const [, preguntaId, valorEsperado] = match
  return respuestas[preguntaId] === valorEsperado.trim()
}

function esPreguntaVisible(preguntaId: string, respuestas: Record<string, any>): boolean {
  // Las preguntas *-DEC-04-N son condicionales si DEC-04 = Sí
  if (/^(?:PER|ACC|CLI)-DEC-04-[1-4]$/.test(preguntaId)) {
    const tipo = preguntaId.split('-')[0] // PER, ACC, CLI
    return respuestas[`${tipo}-DEC-04`] === 'Sí'
  }
  // CLI-DEC-05 también es condicional a CLI-DEC-04 = Sí
  if (preguntaId === 'CLI-DEC-05') {
    return respuestas['CLI-DEC-04'] === 'Sí'
  }
  return true
}

function extraerFilasTabla(seccion: SeccionDefinicion, respuestas: Record<string, any>): Array<Record<string, any>> {
  // El frontend envía la tabla bajo un key explícito definido en la sección
  // (`key_tabla`) o derivado del id de la primera pregunta como fallback.
  const tablaKey = seccion.key_tabla ?? `${seccion.preguntas[0]?.id.split('-').slice(0, -1).join('-')}__rows`
  const filas = respuestas[tablaKey]
  if (Array.isArray(filas)) return filas
  return []
}

// ──────────────────────────────────────────────────────────
// Validación de archivos
// ──────────────────────────────────────────────────────────
function validarArchivo(archivo: ArchivoUpload): string | null {
  if (archivo.size > UPLOAD_MAX_BYTES) {
    return `El archivo "${archivo.filename}" excede el tamaño máximo de 10 MB.`
  }
  // Validamos la extensión (lo más confiable) y además el mime type.
  const extOk = UPLOAD_EXT_PERMITIDAS.some((ext) => archivo.filename.toLowerCase().endsWith(ext))
  if (!extOk) {
    return `El archivo "${archivo.filename}" no tiene una extensión permitida. Solo se aceptan: ${UPLOAD_EXT_PERMITIDAS.join(', ')}.`
  }
  if (archivo.mimetype && !UPLOAD_MIME_PERMITIDOS.includes(archivo.mimetype)) {
    return `El archivo "${archivo.filename}" tiene un tipo MIME no permitido (${archivo.mimetype}).`
  }
  return null
}

function calcularHash(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

// ──────────────────────────────────────────────────────────
// Service público
// ──────────────────────────────────────────────────────────
export const FormulariosSarlaftService = {
  /**
   * Recibe y persiste un envío de formulario público con sus documentos adjuntos.
   * Acepta multipart/form-data con:
   *  - field 'payload': JSON string con las respuestas
   *  - fields 'doc_<tipo>': archivo (uno por cada documento requerido)
   */
  async submit(input: SubmitFormularioSarlaftInput, archivos: ArchivoUpload[], contextoHttp: { ip: string | null; userAgent: string | null; referer: string | null }) {
    const formulario = getFormularioPorCodigo(input.codigo_formulario)
    if (!formulario) {
      throw Object.assign(new Error(`Código de formulario no soportado: ${input.codigo_formulario}`), { statusCode: 400 })
    }

    // 1. Validar obligatorios
    const errores = validarObligatorios(formulario, input.respuestas)
    if (errores.length > 0) {
      throw Object.assign(new Error('Hay campos obligatorios pendientes'), {
        statusCode: 422,
        details: errores
      })
    }

    // 2. Validar archivos subidos
    const tipoCliente = firstString(input.respuestas['CLI-IG-01'])
    const docsRequeridos = getDocumentosRequeridos(formulario.tipo, tipoCliente as any)
    const docsRequeridosIds = new Set(docsRequeridos.map((d) => d.id))
    const archivosSubidosPorTipo = new Map<string, ArchivoUpload>()
    for (const archivo of archivos) {
      // fieldname esperado: "doc_<tipo_documento>"
      const match = archivo.fieldname.match(/^doc_(.+)$/)
      if (!match) continue
      const tipo = match[1]
      if (!docsRequeridosIds.has(tipo as TipoDocumentoId)) continue
      const err = validarArchivo(archivo)
      if (err) {
        throw Object.assign(new Error(err), { statusCode: 422 })
      }
      archivosSubidosPorTipo.set(tipo, archivo)
    }
    const docsFaltantes = docsRequeridos.filter((d) => !archivosSubidosPorTipo.has(d.id))
    if (docsFaltantes.length > 0) {
      throw Object.assign(
        new Error(`Faltan documentos obligatorios: ${docsFaltantes.map((d) => d.nombre).join(', ')}`),
        { statusCode: 422, details: docsFaltantes.map((d) => `Falta adjuntar: ${d.nombre}`) }
      )
    }

    // 3. Extraer datos clave
    const datosClave = extraerDatosClave(formulario, input.respuestas)

    // 4. Generar radicado
    const radicado = await generarRadicado(formulario.tipo)

    // 5. Persistir formulario + subir archivos a S3 + crear registros de documentos
    const fechaDiligenciamiento = input.fecha_diligenciamiento ? new Date(input.fecha_diligenciamiento) : null
    const year = new Date().getFullYear()

    const s3Keys: string[] = []
    try {
      const registro = await prisma.formulario_sarlaft_ptee.create({
        data: {
          radicado,
          tipo_formulario: formulario.tipo,
          codigo_formulario: formulario.codigo,
          version: formulario.version,
          fecha_diligenciamiento: fechaDiligenciamiento,
          respuestas: input.respuestas,
          nombre_completo: datosClave.nombre_completo,
          tipo_documento: datosClave.tipo_documento,
          numero_documento: datosClave.numero_documento,
          correo: datosClave.correo,
          telefono: datosClave.telefono,
          ip_origen: contextoHttp.ip,
          user_agent: contextoHttp.userAgent,
          referer: contextoHttp.referer,
          estado: 'recibido'
        }
      })

      // Subir cada archivo a S3 y crear el registro
      for (const [tipo, archivo] of archivosSubidosPorTipo) {
        const ext = archivo.filename.match(/\.[^.]+$/)?.[0] || ''
        const s3Key = `sarlaft/${year}/${radicado}/${tipo}_${Date.now()}${ext}`
        s3Keys.push(s3Key)
        await uploadToS3(s3Key, archivo.buffer, archivo.mimetype)
        await prisma.formulario_sarlaft_ptee_documento.create({
          data: {
            formulario_id: registro.id,
            tipo_documento: tipo,
            nombre_archivo: archivo.filename,
            s3_key: s3Key,
            mime_type: archivo.mimetype,
            tamano_bytes: BigInt(archivo.size),
            hash_sha256: calcularHash(archivo.buffer)
          }
        })
      }

      // 6. Email de notificación
      try {
        await this.notificarOficialCumplimiento(registradoToDTO(registro), formulario)
      } catch (err) {
        console.error('[FormulariosSarlaft] No se pudo enviar email de notificación:', err)
      }

      return {
        radicado: registro.radicado,
        fecha_envio: registro.fecha_envio.toISOString(),
        tipo_formulario: registro.tipo_formulario,
        codigo_formulario: registro.codigo_formulario,
        nombre_completo: registro.nombre_completo,
        documentos_adjuntos: archivosSubidosPorTipo.size,
        mensaje: 'Formulario y documentos recibidos exitosamente. El Oficial de Cumplimiento de COTRANSMEQ S.A.S. revisará la información y se pondrá en contacto si requiere aclaraciones.'
      }
    } catch (err) {
      // Si algo falla después de subir archivos a S3, los limpiamos
      for (const key of s3Keys) {
        try { await deleteFromS3(key) } catch {}
      }
      throw err
    }
  },

  /**
   * Notifica por email al Oficial de Cumplimiento que se recibió un nuevo envío.
   */
  /**
   * Listado paginado para el dashboard admin con búsqueda y filtros.
   */
  async listarAdmin(params: {
    page?: number
    limit?: number
    search?: string
    tipo_formulario?: 'cliente_proveedor' | 'accionistas' | 'personal' | null
    estado?: string | null
    fecha_desde?: string | null
    fecha_hasta?: string | null
  }) {
    const page = Math.max(1, params.page ?? 1)
    const limit = Math.min(100, Math.max(1, params.limit ?? 20))
    const skip = (page - 1) * limit

    const where: any = {}
    if (params.tipo_formulario) where.tipo_formulario = params.tipo_formulario
    if (params.estado) where.estado = params.estado
    if (params.fecha_desde || params.fecha_hasta) {
      where.fecha_envio = {}
      if (params.fecha_desde) where.fecha_envio.gte = new Date(params.fecha_desde)
      if (params.fecha_hasta) where.fecha_envio.lte = new Date(params.fecha_hasta)
    }
    if (params.search) {
      where.OR = [
        { radicado: { contains: params.search, mode: 'insensitive' } },
        { nombre_completo: { contains: params.search, mode: 'insensitive' } },
        { numero_documento: { contains: params.search, mode: 'insensitive' } },
        { correo: { contains: params.search, mode: 'insensitive' } }
      ]
    }

    const [items, total] = await Promise.all([
      prisma.formulario_sarlaft_ptee.findMany({
        where,
        include: {
          _count: { select: { documentos: true } },
          evaluado_por: { select: { id: true, nombre: true, correo: true } }
        },
        orderBy: { fecha_envio: 'desc' },
        skip,
        take: limit
      }),
      prisma.formulario_sarlaft_ptee.count({ where })
    ])

    return {
      items: items.map((f) => ({
        id: f.id,
        radicado: f.radicado,
        codigo_formulario: f.codigo_formulario,
        tipo_formulario: f.tipo_formulario,
        version: f.version,
        fecha_envio: f.fecha_envio.toISOString(),
        fecha_diligenciamiento: f.fecha_diligenciamiento?.toISOString() ?? null,
        nombre_completo: f.nombre_completo,
        tipo_documento: f.tipo_documento,
        numero_documento: f.numero_documento,
        correo: f.correo,
        telefono: f.telefono,
        estado: f.estado,
        documentos_count: f._count.documentos,
        evaluado_por: f.evaluado_por
          ? { id: f.evaluado_por.id, nombre: f.evaluado_por.nombre }
          : null
      })),
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    }
  },

  /**
   * Detalle completo de un formulario (con respuestas y documentos).
   */
  async obtenerDetalle(id: string) {
    const f = await prisma.formulario_sarlaft_ptee.findUnique({
      where: { id },
      include: {
        documentos: { orderBy: { tipo_documento: 'asc' } },
        evaluado_por: { select: { id: true, nombre: true, correo: true } }
      }
    })
    if (!f) return null

    return {
      id: f.id,
      radicado: f.radicado,
      codigo_formulario: f.codigo_formulario,
      tipo_formulario: f.tipo_formulario,
      version: f.version,
      fecha_envio: f.fecha_envio.toISOString(),
      fecha_diligenciamiento: f.fecha_diligenciamiento?.toISOString() ?? null,
      nombre_completo: f.nombre_completo,
      tipo_documento: f.tipo_documento,
      numero_documento: f.numero_documento,
      correo: f.correo,
      telefono: f.telefono,
      estado: f.estado,
      evaluacion_concepto: f.evaluacion_concepto,
      evaluacion_observaciones: f.evaluacion_observaciones,
      evaluado_at: f.evaluado_at?.toISOString() ?? null,
      evaluado_por: f.evaluado_por
        ? { id: f.evaluado_por.id, nombre: f.evaluado_por.nombre, correo: f.evaluado_por.correo }
        : null,
      ip_origen: f.ip_origen,
      user_agent: f.user_agent,
      referer: f.referer,
      respuestas: f.respuestas,
      documentos: f.documentos.map((d) => ({
        id: d.id,
        tipo_documento: d.tipo_documento,
        nombre_archivo: d.nombre_archivo,
        s3_key: d.s3_key,
        mime_type: d.mime_type,
        tamano_bytes: d.tamano_bytes.toString(),
        hash_sha256: d.hash_sha256,
        created_at: d.created_at.toISOString()
      })),
      created_at: f.created_at.toISOString(),
      updated_at: f.updated_at.toISOString()
    }
  },

  /**
   * Genera una URL firmada de S3 para descargar un documento del formulario.
   */
  async obtenerUrlDescargaDocumento(documentoId: string) {
    const doc = await prisma.formulario_sarlaft_ptee_documento.findUnique({
      where: { id: documentoId }
    })
    if (!doc) return null

    const url = await getS3SignedUrl(doc.s3_key, 300) // 5 minutos
    return {
      id: doc.id,
      nombre_archivo: doc.nombre_archivo,
      mime_type: doc.mime_type,
      tamano_bytes: doc.tamano_bytes.toString(),
      url,
      expires_in: 300
    }
  },

  /**
   * Actualiza el estado de evaluación de un formulario.
   */
  async actualizarEvaluacion(id: string, data: { estado?: string; concepto?: string | null; observaciones?: string | null; userId: string }) {
    return prisma.formulario_sarlaft_ptee.update({
      where: { id },
      data: {
        ...(data.estado && { estado: data.estado }),
        ...(data.concepto !== undefined && { evaluacion_concepto: data.concepto }),
        ...(data.observaciones !== undefined && { evaluacion_observaciones: data.observaciones }),
        evaluado_por_id: data.userId,
        evaluado_at: new Date()
      }
    })
  },

  async notificarOficialCumplimiento(registro: ReturnType<typeof registradoToDTO>, formulario: FormularioDefinicion) {
    const to = 'operaciones.transmeraldasas@gmail.com'
    const subject = `[SARLAFT ${registro.codigo_formulario}] Nuevo formulario recibido — Radicado ${registro.radicado}`

    const tipoLabel: Record<string, string> = {
      cliente_proveedor: 'Cliente / Proveedor',
      accionistas: 'Accionistas',
      personal: 'Vinculación de Personal'
    }

    // HTML del correo
    const html = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <style>
    body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #1a1a1a; line-height: 1.5; }
    .container { max-width: 640px; margin: 0 auto; padding: 24px; background: #FAF7F2; }
    .card { background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.05); }
    .header { display: flex; align-items: center; gap: 12px; padding-bottom: 16px; border-bottom: 1px solid #e5e7eb; }
    .badge { display: inline-block; background: #10B981; color: white; font-size: 11px; font-weight: 700; padding: 4px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
    h1 { font-size: 18px; margin: 12px 0 4px; color: #064e3b; }
    .subtitle { color: #6b7280; font-size: 13px; margin: 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    td { padding: 8px 0; font-size: 13px; vertical-align: top; }
    td.label { color: #6b7280; width: 200px; }
    td.value { color: #111827; font-weight: 600; }
    .footer { margin-top: 24px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    .cta { display: inline-block; margin-top: 16px; padding: 10px 20px; background: #10B981; color: white; text-decoration: none; border-radius: 8px; font-size: 13px; font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <div class="header">
        <span class="badge">${registro.codigo_formulario}</span>
      </div>
      <h1>Nuevo formulario SARLAFT + PTEE recibido</h1>
      <p class="subtitle">Tipo: ${tipoLabel[registro.tipo_formulario] ?? registro.tipo_formulario}</p>

      <table>
        <tr>
          <td class="label">Radicado</td>
          <td class="value">${registro.radicado}</td>
        </tr>
        <tr>
          <td class="label">Fecha de envío</td>
          <td class="value">${new Date(registro.fecha_envio).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</td>
        </tr>
        <tr>
          <td class="label">Titular</td>
          <td class="value">${registro.nombre_completo ?? '—'}</td>
        </tr>
        <tr>
          <td class="label">Documento</td>
          <td class="value">${registro.tipo_documento ? registro.tipo_documento + ' ' : ''}${registro.numero_documento ?? '—'}</td>
        </tr>
        <tr>
          <td class="label">Correo de contacto</td>
          <td class="value">${registro.correo ?? '—'}</td>
        </tr>
        <tr>
          <td class="label">Teléfono</td>
          <td class="value">${registro.telefono ?? '—'}</td>
        </tr>
        <tr>
          <td class="label">IP de origen</td>
          <td class="value">${registro.ip_origen ?? '—'}</td>
        </tr>
      </table>

      <a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/dashboard/sarlaft/${registro.id}" class="cta">
        Ver en el dashboard
      </a>

      <p style="margin-top:24px; font-size:13px; color:#6b7280;">
        Las respuestas completas del formulario se almacenaron como JSONB y están disponibles
        en el dashboard interno de cumplimiento para su revisión y evaluación.
      </p>

      <div class="footer">
        COTRANSMEQ S.A.S. — Sistema de cumplimiento SARLAFT + PTEE<br />
        Resolución 2328 de 2025 · Resolución 14673 de 2025 · Ley 1581 de 2012
      </div>
    </div>
  </div>
</body>
</html>`

    await EmailService.sendEmail({
      from: process.env.SMTP_FROM || 'Cotransmeq <noreply@transmeralda.com>',
      to: [to],
      subject,
      html
    })
  }
}

// Helper para serializar el registro a DTO de respuesta
function registradoToDTO(r: any) {
  return {
    id: r.id,
    radicado: r.radicado,
    tipo_formulario: r.tipo_formulario,
    codigo_formulario: r.codigo_formulario,
    fecha_envio: r.fecha_envio,
    nombre_completo: r.nombre_completo,
    tipo_documento: r.tipo_documento,
    numero_documento: r.numero_documento,
    correo: r.correo,
    telefono: r.telefono,
    ip_origen: r.ip_origen
  }
}
