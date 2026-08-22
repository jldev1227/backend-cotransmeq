/**
 * Integración del servicio con Prisma, almacenamiento y correo simulados.
 *
 * No toca ninguna base de datos ni ningún bucket: `prisma`, `aws` y
 * `EmailService` se sustituyen por dobles en memoria. Lo que se verifica es el
 * ORDEN y las garantías del flujo — que el radicado y el documento sean una
 * sola transacción funcional, que una falla de correo no destruya evidencia, y
 * que la versión recibida sea inmutable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CAMPOS, OPCION_CON_ALERTAS } from '../../src/modules/formularios-sarlaft/declaracion-transporte.validacion'
import { TEMPLATE_DECLARACION_TRANSPORTE } from '../../src/modules/formularios-sarlaft/declaracion-transporte-template.manifest'
import { CORREO_QA, anexoSintetico, respuestasBase } from './fixtures'

const CODIGO = TEMPLATE_DECLARACION_TRANSPORTE.codigo

// ──────────────────────────────────────────────────────────
// Dobles
// ──────────────────────────────────────────────────────────

/** Estado en memoria que hace de base de datos. */
const db = {
  formularios: [] as any[],
  documentos: [] as any[],
  generados: [] as any[],
  entregas: [] as any[]
}

/** Objetos "subidos". La clave es el s3_key. */
const almacenamiento = new Map<string, Buffer>()
/** Correos "enviados", en orden. */
const correos: Array<{ to: string[]; subject: string; html: string; attachments: any[] }> = []

let fallarUpload = false
let fallarCorreo = false
/** Por defecto la copia al declarante está apagada; los casos que la ejercitan
 *  la encienden explícitamente. */
let copiaDeclarante = false
let uuid = 0
const nuevoId = () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, '0')}`

function clave(fila: any, campos: string[]) {
  return campos.map((c) => String(fila[c] ?? '')).join('|')
}

vi.mock('../../src/config/prisma', () => ({
  prisma: {
    formulario_sarlaft_ptee: {
      count: vi.fn(async () => db.formularios.length),
      create: vi.fn(async ({ data }: any) => {
        if (db.formularios.some((f) => f.radicado === data.radicado)) {
          throw Object.assign(new Error('unique'), {
            code: 'P2002',
            meta: { target: ['radicado'] }
          })
        }
        const fila = {
          id: nuevoId(),
          fecha_envio: new Date('2026-08-22T15:00:00.000Z'),
          created_at: new Date('2026-08-22T15:00:00.000Z'),
          updated_at: new Date('2026-08-22T15:00:00.000Z'),
          estado: 'recibido',
          evaluacion_concepto: null,
          evaluacion_observaciones: null,
          evaluado_at: null,
          evaluado_por_id: null,
          ...data
        }
        db.formularios.push(fila)
        return fila
      }),
      delete: vi.fn(async ({ where }: any) => {
        const i = db.formularios.findIndex((f) => f.id === where.id)
        if (i < 0) throw new Error('no existe')
        return db.formularios.splice(i, 1)[0]
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const fila = db.formularios.find((f) => f.id === where.id)
        Object.assign(fila, data)
        return fila
      }),
      // `obtenerDetalle` pide `include: { documentos, evaluado_por }`, así que
      // el doble tiene que resolver las relaciones igual que Prisma.
      findUnique: vi.fn(async ({ where, include }: any) => {
        const fila = db.formularios.find((f) => f.id === where.id)
        if (!fila) return null
        if (!include) return fila
        return {
          ...fila,
          documentos: db.documentos.filter((d) => d.formulario_id === fila.id),
          evaluado_por: null
        }
      }),
      findMany: vi.fn(async () => db.formularios),
      count: vi.fn(async () => db.formularios.length)
    },
    formulario_sarlaft_ptee_documento: {
      create: vi.fn(async ({ data }: any) => {
        const fila = { id: nuevoId(), created_at: new Date(), ...data }
        db.documentos.push(fila)
        return fila
      })
    },
    formulario_sarlaft_ptee_documento_generado: {
      create: vi.fn(async ({ data }: any) => {
        const k = clave(data, ['formulario_id', 'clase', 'version_documento'])
        if (db.generados.some((g) => clave(g, ['formulario_id', 'clase', 'version_documento']) === k)) {
          throw Object.assign(new Error('unique'), { code: 'P2002' })
        }
        const fila = { id: nuevoId(), created_at: new Date(), generado_por: null, entregas: [], ...data }
        db.generados.push(fila)
        return fila
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let filas = db.generados.filter(
          (g) => g.formulario_id === where.formulario_id && (!where.clase || g.clase === where.clase)
        )
        if (orderBy?.version_documento === 'desc') {
          filas = [...filas].sort((a, b) => b.version_documento - a.version_documento)
        }
        return filas[0] ?? null
      }),
      findUnique: vi.fn(async ({ where }: any) =>
        db.generados.find((g) => g.id === where.id) ?? null
      ),
      findMany: vi.fn(async ({ where }: any) =>
        db.generados
          .filter((g) => g.formulario_id === where.formulario_id)
          .map((g) => ({ ...g, entregas: db.entregas.filter((e) => e.documento_generado_id === g.id) }))
          .sort((a, b) => b.version_documento - a.version_documento)
      )
    },
    formulario_sarlaft_ptee_documento_entrega: {
      create: vi.fn(async ({ data }: any) => {
        const fila = { id: nuevoId(), created_at: new Date(), completed_at: null, ...data }
        db.entregas.push(fila)
        return fila
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const w = where.documento_generado_id_canal_destinatario_intento
        const existente = db.entregas.find(
          (e) =>
            e.documento_generado_id === w.documento_generado_id &&
            e.canal === w.canal &&
            (e.destinatario ?? null) === (w.destinatario ?? null) &&
            e.intento === w.intento
        )
        if (existente) {
          Object.assign(existente, update)
          return existente
        }
        const fila = { id: nuevoId(), created_at: new Date(), ...create }
        db.entregas.push(fila)
        return fila
      }),
      findFirst: vi.fn(async ({ where, orderBy }: any) => {
        let filas = db.entregas.filter(
          (e) =>
            e.documento_generado_id === where.documento_generado_id &&
            e.canal === where.canal &&
            (e.destinatario ?? null) === (where.destinatario ?? null)
        )
        if (orderBy?.intento === 'desc') filas = [...filas].sort((a, b) => b.intento - a.intento)
        return filas[0] ?? null
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const fila = db.entregas.find((e) => e.token_hash === where.token_hash)
        if (!fila) return null
        return {
          ...fila,
          documento_generado: db.generados.find((g) => g.id === fila.documento_generado_id) ?? null
        }
      }),
      findMany: vi.fn(async ({ where }: any) =>
        db.entregas.filter((e) => e.documento_generado_id === where.documento_generado_id)
      ),
      update: vi.fn(async ({ where, data }: any) => {
        const fila = db.entregas.find((e) => e.id === where.id)
        Object.assign(fila, data)
        return fila
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const filas = db.entregas.filter(
          (e) =>
            e.documento_generado_id === where.documento_generado_id &&
            e.canal === where.canal &&
            where.estado.in.includes(e.estado)
        )
        filas.forEach((f) => Object.assign(f, data))
        return { count: filas.length }
      })
    }
  }
}))

vi.mock('../../src/config/aws', () => ({
  uploadToS3: vi.fn(async (key: string, buffer: Buffer) => {
    if (fallarUpload) throw new Error('S3 caído')
    almacenamiento.set(key, buffer)
    return key
  }),
  deleteFromS3: vi.fn(async (key: string) => {
    almacenamiento.delete(key)
  }),
  getS3SignedUrl: vi.fn(async (key: string) => `https://s3.test/${key}`),
  getS3ObjectStream: vi.fn(async (key: string) => {
    const b = almacenamiento.get(key)
    if (!b) return null
    return (async function* () {
      yield b
    })()
  })
}))

vi.mock('../../src/services/email.service', () => ({
  EmailService: {
    sendEmail: vi.fn(async (params: any) => {
      if (fallarCorreo) throw Object.assign(new Error('SMTP caído'), { code: 'ECONNREFUSED' })
      correos.push(params)
      return { id: `msg-${correos.length}` }
    })
  }
}))

// El servicio importa los dobles, así que se carga después de declararlos.
const { FormulariosSarlaftService } = await import(
  '../../src/modules/formularios-sarlaft/formularios-sarlaft.service'
)
const { DeclaracionTransporteDocumentosService } = await import(
  '../../src/modules/formularios-sarlaft/declaracion-transporte-documentos.service'
)

// ──────────────────────────────────────────────────────────

function entrada(overrides: Record<string, unknown> = {}, respuestas = respuestasBase()) {
  return {
    codigo_formulario: CODIGO,
    fecha_diligenciamiento: '2026-08-22',
    respuestas,
    correo_confirmacion: CORREO_QA,
    ...overrides
  } as any
}

const CONTEXTO = { ip: '203.0.113.9', userAgent: 'Mozilla/5.0 (QA)', referer: 'https://qa.test/' }

beforeEach(() => {
  db.formularios.length = 0
  db.documentos.length = 0
  db.generados.length = 0
  db.entregas.length = 0
  almacenamiento.clear()
  correos.length = 0
  fallarUpload = false
  fallarCorreo = false
  copiaDeclarante = false
  delete process.env.SARLAFT_CLIENT_COPY_ENABLED
  uuid = 0
})

/** Enciende la copia al declarante para el caso que la esté probando. */
function habilitarCopiaDeclarante() {
  copiaDeclarante = true
  process.env.SARLAFT_CLIENT_COPY_ENABLED = 'true'
}

describe('1. Orden del flujo de recepción', () => {
  it('valida, radica, persiste snapshot, genera, almacena, registra hash y notifica', async () => {
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)

    // Radicado con la serie propia del formato.
    expect(res.radicado).toMatch(/^DECL-TRA-\d{4}-\d{5}$/)

    // Snapshot persistido, sin la confirmación de correo.
    expect(db.formularios).toHaveLength(1)
    expect(db.formularios[0].respuestas['DET-REP-05']).toBeUndefined()
    expect(db.formularios[0].respuestas.correo_confirmacion).toBeUndefined()
    expect(db.formularios[0].estado).toBe('recibido')

    // Versión documental 1, en estado `recibida`, con su hash y su template.
    expect(db.generados).toHaveLength(1)
    const g = db.generados[0]
    expect(g.version_documento).toBe(1)
    expect(g.estado_documental).toBe('recibida')
    expect(g.pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(g.template_sha256).toBe(TEMPLATE_DECLARACION_TRANSPORTE.sha256)
    expect(g.codigo_template).toBe(CODIGO)

    // El binario está en almacenamiento y su hash coincide con el registrado.
    const guardado = almacenamiento.get(g.s3_key)!
    expect(guardado).toBeTruthy()
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(guardado).digest('hex')).toBe(g.pdf_sha256)

    // La respuesta trae documento, hash y enlace de descarga.
    expect(res.documento?.sha256).toBe(g.pdf_sha256)
    expect(res.documento?.download_url).toContain('token=')

    // Sin copia al declarante: no se informa entrega y no se registró ninguna.
    expect(res.entrega_email).toBeUndefined()
    expect(db.entregas.some((e) => e.canal === 'email_declarante')).toBe(false)
  })

  it('con la copia apagada, el ÚNICO correo que sale es el interno', async () => {
    await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    expect(correos).toHaveLength(1)
    expect(correos[0].subject).toContain('Nuevo formulario recibido')
    // El correo del declarante no aparece como destinatario en ningún envío.
    expect(correos.flatMap((c) => c.to)).not.toContain(CORREO_QA)
    expect(db.entregas.map((e) => e.canal).sort()).toEqual(['descarga', 'email_interno'])
  })

  it('el enlace de descarga no expone el radicado como credencial', async () => {
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    expect(res.documento!.download_url).not.toContain(res.radicado)

    // En base de datos solo vive el hash del token.
    const descarga = db.entregas.find((e) => e.canal === 'descarga')!
    expect(descarga.token_hash).toMatch(/^[0-9a-f]{64}$/)
    const token = new URL(res.documento!.download_url).searchParams.get('token')!
    expect(descarga.token_hash).not.toBe(token)
    expect(JSON.stringify(db.entregas)).not.toContain(token)
  })
})

describe('2 y 3. Fallas antes de reportar éxito', () => {
  it('si el generador falla, no queda radicado ni éxito documental', async () => {
    // Una observación que no cabe en las dos rayas del formato.
    const respuestas = respuestasBase({
      [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS,
      [CAMPOS.OBSERVACIONES]: 'palabra '.repeat(200)
    })
    await expect(
      FormulariosSarlaftService.submit(
        entrada({}, respuestas),
        [
          {
            fieldname: 'doc_anexo_alertas',
            filename: 'anexo.pdf',
            mimetype: 'application/pdf',
            buffer: anexoSintetico(),
            size: anexoSintetico().length
          }
        ],
        CONTEXTO
      )
    ).rejects.toThrow()

    expect(db.formularios).toHaveLength(0)
    expect(db.generados).toHaveLength(0)
    expect(correos).toHaveLength(0)
  })

  it('si el almacenamiento falla, se limpian solo los objetos de ese intento', async () => {
    fallarUpload = true
    await expect(
      FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    ).rejects.toThrow(/S3 caído/)

    expect(almacenamiento.size).toBe(0)
    expect(db.formularios).toHaveLength(0)
  })
})

describe('4 y 5. Correo y reintentos', () => {
  it('si el correo falla, se conservan radicado y documento y la entrega queda fallida', async () => {
    habilitarCopiaDeclarante()
    fallarCorreo = true
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)

    // La evidencia sobrevive: el trámite está recibido.
    expect(res.radicado).toBeTruthy()
    expect(db.formularios).toHaveLength(1)
    expect(db.generados).toHaveLength(1)
    expect(almacenamiento.size).toBeGreaterThan(0)

    const fallida = db.entregas.find((e) => e.canal === 'email_declarante')!
    expect(fallida.estado).toBe('fallido')
    expect(fallida.error_codigo).toBe('ECONNREFUSED')
    expect(res.entrega_email?.estado).toBe('fallido')
  })

  it('un reintento no duplica entregas idénticas', async () => {
    habilitarCopiaDeclarante()
    await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    const doc = db.generados[0]
    const antes = db.entregas.filter((e) => e.canal === 'email_declarante').length

    // Reintento sobre un envío ya exitoso: actualiza, no duplica.
    await DeclaracionTransporteDocumentosService.registrarEntrega({
      documentoGeneradoId: doc.id,
      canal: 'email_declarante',
      destinatario: CORREO_QA,
      estado: 'enviado',
      proveedor: 'resend',
      providerMessageId: 'msg-repetido'
    })
    const despues = db.entregas.filter((e) => e.canal === 'email_declarante').length
    expect(despues).toBe(antes)
  })
})

describe('6. Separación entre correo interno y copia del declarante', () => {
  it('la copia del declarante lleva solo el PDF; el interno conserva los anexos', async () => {
    habilitarCopiaDeclarante()
    const anexo = anexoSintetico()
    await FormulariosSarlaftService.submit(
      entrada(
        {},
        respuestasBase({
          [CAMPOS.CNF_ALERTAS]: OPCION_CON_ALERTAS,
          [CAMPOS.OBSERVACIONES]: 'Alerta informada en el anexo adjunto.'
        })
      ),
      [
        {
          fieldname: 'doc_anexo_alertas',
          filename: 'anexo_alertas.pdf',
          mimetype: 'application/pdf',
          buffer: anexo,
          size: anexo.length
        }
      ],
      CONTEXTO
    )

    expect(correos).toHaveLength(2)
    const interno = correos.find((c) => c.subject.includes('Nuevo formulario recibido'))!
    const declarante = correos.find((c) => c.subject.includes('Copia de tu declaración'))!

    // Interno: PDF + anexo + firma para auditoría.
    expect(interno.attachments.length).toBeGreaterThan(1)
    expect(interno.attachments.some((a: any) => a.filename === 'anexo_alertas.pdf')).toBe(true)

    // Declarante: exactamente un adjunto, y es el PDF generado.
    expect(declarante.attachments).toHaveLength(1)
    expect(declarante.attachments[0].contentType).toBe('application/pdf')
    expect(declarante.attachments[0].filename).toContain(CODIGO)
    // Ni anexos del titular, ni la firma como imagen suelta.
    expect(declarante.attachments.some((a: any) => /anexo|firma|cedula|rut/i.test(a.filename))).toBe(
      false
    )
    // Ni metadata HTTP en el cuerpo.
    expect(declarante.html).not.toContain(CONTEXTO.ip)
    expect(declarante.html).not.toContain(CONTEXTO.userAgent)
    expect(declarante.html).not.toContain('data:image')
  })

  it('ningún correo usa BCC', async () => {
    habilitarCopiaDeclarante()
    await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    for (const c of correos) {
      expect((c as any).bcc).toBeUndefined()
    }
  })
})

describe('7. Descarga pública por token', () => {
  it('acepta el token válido una vez y lo marca descargado', async () => {
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    const token = new URL(res.documento!.download_url).searchParams.get('token')!

    const canje = await DeclaracionTransporteDocumentosService.canjearTokenDescarga(token)
    expect(canje?.documento?.pdf_sha256).toBe(res.documento!.sha256)

    const binario = await DeclaracionTransporteDocumentosService.leerBinario(
      canje!.documento!.s3_key
    )
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(binario!).digest('hex')).toBe(res.documento!.sha256)

    const entrega = db.entregas.find((e) => e.canal === 'descarga')!
    expect(entrega.estado).toBe('descargado')
  })

  it('rechaza token inválido, vencido y revocado', async () => {
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    const token = new URL(res.documento!.download_url).searchParams.get('token')!

    expect(await DeclaracionTransporteDocumentosService.canjearTokenDescarga('inventado')).toBeNull()
    expect(await DeclaracionTransporteDocumentosService.canjearTokenDescarga('')).toBeNull()

    // Vencido.
    const entrega = db.entregas.find((e) => e.canal === 'descarga')!
    entrega.expires_at = new Date(Date.now() - 1000)
    expect(await DeclaracionTransporteDocumentosService.canjearTokenDescarga(token)).toBeNull()

    // Revocado.
    entrega.expires_at = new Date(Date.now() + 60_000)
    entrega.estado = 'pendiente'
    await DeclaracionTransporteDocumentosService.revocarDescargas(db.generados[0].id)
    expect(await DeclaracionTransporteDocumentosService.canjearTokenDescarga(token)).toBeNull()
  })
})

describe('9. Versionamiento de la decisión final', () => {
  it('condicionar crea la versión 2 sin alterar el hash de la primera', async () => {
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    const v1 = { ...db.generados[0] }

    await FormulariosSarlaftService.actualizarEvaluacion(db.formularios[0].id, {
      estado: 'condicionado',
      concepto: 'Aprobado con condiciones',
      observaciones: 'Debe actualizar la póliza antes de 30 días.',
      userId: nuevoId()
    })

    expect(db.generados).toHaveLength(2)
    const v2 = db.generados.find((g) => g.version_documento === 2)!
    expect(v2.estado_documental).toBe('evaluada')
    expect(v2.pdf_sha256).not.toBe(v1.pdf_sha256)
    expect(v2.generado_por_id).toBeTruthy()

    // La versión recibida es inmutable: mismo hash, misma clave, mismos bytes.
    const persistida = db.generados.find((g) => g.version_documento === 1)!
    expect(persistida.pdf_sha256).toBe(v1.pdf_sha256)
    expect(persistida.s3_key).toBe(v1.s3_key)
    expect(persistida.estado_documental).toBe('recibida')
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(almacenamiento.get(v1.s3_key)!).digest('hex')).toBe(
      v1.pdf_sha256
    )
    expect(res.documento!.sha256).toBe(v1.pdf_sha256)
  })

  it('aprobar y rechazar también emiten versión; en_revision y escalado no', async () => {
    await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    const id = db.formularios[0].id

    await FormulariosSarlaftService.actualizarEvaluacion(id, { estado: 'en_revision', userId: 'u' })
    expect(db.generados).toHaveLength(1)

    await FormulariosSarlaftService.actualizarEvaluacion(id, { estado: 'escalado', userId: 'u' })
    expect(db.generados).toHaveLength(1)

    await FormulariosSarlaftService.actualizarEvaluacion(id, { estado: 'aprobado', userId: 'u' })
    expect(db.generados).toHaveLength(2)

    await FormulariosSarlaftService.actualizarEvaluacion(id, { estado: 'rechazado', userId: 'u' })
    expect(db.generados).toHaveLength(3)
    expect(db.generados.map((g) => g.version_documento).sort()).toEqual([1, 2, 3])
  })

  it('el PDF administrativo sirve el binario archivado, no uno regenerado', async () => {
    const res = await FormulariosSarlaftService.submit(entrada(), [], CONTEXTO)
    const pdf = await FormulariosSarlaftService.generarPDFRespuesta(db.formularios[0].id)
    const { createHash } = await import('node:crypto')
    expect(createHash('sha256').update(pdf!.buffer).digest('hex')).toBe(res.documento!.sha256)
  })
})
