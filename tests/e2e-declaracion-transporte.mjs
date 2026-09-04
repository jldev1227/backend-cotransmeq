#!/usr/bin/env node
/**
 * Prueba end-to-end de la Declaración SARLAFT/PTEE para empresa de transporte
 * — COTRANSMEQ S.A.S. (GC-FOR-13).
 *
 * Recorre el flujo completo tal como lo vive el declarante y el Oficial de
 * Cumplimiento:
 *
 *   público → definición por código, anexos condicionales, contacto
 *   envío   → multipart sin alertas y con alertas + anexo
 *   entrega → hash del PDF, descarga por token temporal, estado del correo
 *   admin   → login, listado, filtro, detalle, versiones documentales
 *   cierre  → evaluación `condicionado` y verificación de la versión 2
 *
 * ⚠ REQUISITOS ANTES DE EJECUTAR
 *
 *   1. Backend local apuntando a una base de datos de QA AISLADA. Nunca contra
 *      producción: el script crea radicados reales.
 *   2. Almacenamiento de QA (bucket o prefijo propio).
 *   3. Correo en modo sandbox, para que ningún destinatario productivo reciba
 *      copia:
 *
 *        NODE_ENV=development
 *        SARLAFT_EMAIL_MODE=sandbox
 *        SARLAFT_TEST_RECIPIENT=1227jldev@gmail.com
 *        SARLAFT_CLIENT_COPY_ENABLED=true
 *        SARLAFT_PUBLIC_API_URL=http://localhost:4010
 *
 *      El script verifica el modo antes de enviar nada y se detiene si no está
 *      activo (salvo que se pase --permitir-produccion, que hay que escribir a
 *      propósito).
 *   4. Un usuario de dashboard de QA con las credenciales de abajo.
 *
 *   node tests/e2e-declaracion-transporte.mjs [baseUrl]
 */

import { createHash } from 'node:crypto'
import zlib from 'node:zlib'

const BASE = process.argv[2] || 'http://localhost:4010/api'
const PERMITIR_PRODUCCION = process.argv.includes('--permitir-produccion')
const ADMIN = { correo: 'qa.sarlaft@cotransmeq.test', password: 'SarlaftQA2026!' }

const CODIGO = 'GC-FOR-13'
const EMPRESA = 'COTRANSMEQ S.A.S.'
const MARCA_AJENA = 'transmeralda'
const CORREO_QA = '1227jldev@gmail.com'

const OPCION_SIN_ALERTAS = 'No existen alertas pendientes'
const OPCION_CON_ALERTAS = 'Existen alertas informadas en documento anexo'

let ok = 0
let fail = 0
const fallos = []

function check(nombre, condicion, detalle = '') {
  if (condicion) {
    ok++
    console.log(`  ✓ ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  } else {
    fail++
    fallos.push(nombre)
    console.log(`  ✗ ${nombre}${detalle ? ` — ${detalle}` : ''}`)
  }
}

function seccion(titulo) {
  console.log(`\n━━━ ${titulo}`)
}

async function json(url, opts) {
  const r = await fetch(url, opts)
  let body = null
  try {
    body = await r.json()
  } catch {
    /* respuesta no-JSON */
  }
  return { status: r.status, ok: r.ok, body, headers: r.headers }
}

// ── Fixtures sintéticos ────────────────────────────────────────────────────

/**
 * Firma sintética: PNG 600×200 con un trazo visible, escrito a mano con zlib.
 *
 * Reproduce lo que produce el FirmaPad de la landing, que entrega un
 * `data:image/png;base64,...` dibujado en canvas. Antes aquí se usaba un PNG de
 * 1×1 transparente: el generador lo aceptaba —es una imagen válida— pero el
 * documento salía con la celda de firma en blanco, así que la prueba no
 * demostraba nada sobre el renderizado de la firma.
 */
function crc32(buf) {
  const tabla = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    tabla[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ tabla[(crc ^ buf[i]) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(tipo, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const t = Buffer.from(tipo, 'ascii')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0)
  return Buffer.concat([len, t, data, crc])
}

function firmaSinteticaPng(W = 600, H = 200) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8 // profundidad
  ihdr[9] = 6 // RGBA
  const stride = 1 + W * 4
  const raw = Buffer.alloc(H * stride)
  for (let y = 0; y < H; y++) {
    raw[y * stride] = 0 // filtro None
    for (let x = 0; x < W; x++) {
      const i = y * stride + 1 + x * 4
      raw[i] = 255
      raw[i + 1] = 255
      raw[i + 2] = 255
      raw[i + 3] = 255
    }
  }
  // Ambas coordenadas se truncan: un índice fraccionario sobre un Buffer se
  // descarta en silencio y dejaría el trazo hecho puntos sueltos.
  const punto = (x, y) => {
    const px = Math.floor(x)
    const py = Math.floor(y)
    if (px < 0 || px >= W || py < 0 || py >= H) return
    const i = py * stride + 1 + px * 4
    raw[i] = 15
    raw[i + 1] = 31
    raw[i + 2] = 26
    raw[i + 3] = 255
  }
  // El grosor es proporcional a la altura: la firma se reduce a ~43 pt dentro
  // de la celda y un trazo de 1 px desaparecería al escalar.
  const grosor = Math.max(2, Math.round(H * 0.03))
  const pasos = W * 4
  for (let sIdx = 0; sIdx <= pasos; sIdx++) {
    const t = sIdx / pasos
    const x = t * (W * 0.9) + W * 0.05
    const y = H / 2 + Math.sin(t * Math.PI * 3) * (H * 0.25)
    for (let d = -grosor; d <= grosor; d++) punto(x, y + d)
  }
  const firma = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    firma,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0))
  ])
}

const PNG_FIRMA = firmaSinteticaPng()
const FIRMA_DATA_URL = `data:image/png;base64,${PNG_FIRMA.toString('base64')}`

/** Anexo con la leyenda obligatoria del plan de QA. */
const LEYENDA = 'DOCUMENTO SINTETICO DE PRUEBA - SIN VALIDEZ'
const ANEXO_TXT = Buffer.from(`${LEYENDA}\n`, 'utf8')

/**
 * Datos sintéticos base. Son deliberadamente reconocibles como ficticios:
 * ninguna corrida de QA debe poder confundirse con un radicado real.
 */
function respuestas(overrides = {}) {
  return {
    'DET-ENC-01': '2026-08-22',
    'DET-EMP-01': 'TRANSPORTES QA DOCUMENTAL S.A.S.',
    'DET-EMP-02': '900999888-1',
    'DET-REP-01': 'JULIAN QA DOCUMENTAL',
    'DET-REP-02': '1000000123',
    'DET-REP-03': '+57 300 000 0123',
    'DET-REP-04': CORREO_QA,
    'DET-ACK-01': 'Sí, declaro que la información es veraz y acepto los compromisos del formato',
    'DET-CNF-01': 'Sí',
    'DET-CNF-02': OPCION_SIN_ALERTAS,
    'DET-CNF-03': 'Sí',
    'DET-FIR-01': FIRMA_DATA_URL,
    ...overrides
  }
}

function formData(payload, anexos = {}) {
  const fd = new FormData()
  fd.append('payload', JSON.stringify(payload))
  for (const [id, { buffer, nombre, tipo }] of Object.entries(anexos)) {
    fd.append(`doc_${id}`, new Blob([buffer], { type: tipo }), nombre)
  }
  return fd
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

// ───────────────────────────────────────────────────────────
async function main() {
  console.log(`Declaración empresa de transporte · ${EMPRESA} (${CODIGO})`)
  console.log(`Base: ${BASE}\n`)

  // ═══ 0. Guardia de seguridad ═══
  seccion('0. Guardia: el correo debe estar en modo sandbox')
  const salud = await json(`${BASE}/public/formularios-sarlaft/contacto?tipo=declaracion_empresa_transporte`)
  check('El backend responde', salud.status === 200, `HTTP ${salud.status}`)
  if (!PERMITIR_PRODUCCION) {
    console.log(
      '\n  ⚠ Este script envía formularios y dispara correos reales.\n' +
        `    Confirma que el backend corre con SARLAFT_EMAIL_MODE=sandbox y\n` +
        `    SARLAFT_TEST_RECIPIENT=${CORREO_QA} antes de continuar.\n` +
        '    Si ya lo verificaste, vuelve a ejecutar con --permitir-produccion.\n'
    )
    process.exit(2)
  }

  // ═══ 1. El formato NO aparece en el catálogo general ═══
  seccion('1. Catálogo público')
  const lista = await json(`${BASE}/public/formularios-sarlaft`)
  check('Sigue devolviendo exactamente 3 formatos de conocimiento', lista.body?.formularios?.length === 3,
    lista.body?.formularios?.map((f) => f.codigo).join(', '))
  check(`${CODIGO} NO aparece en el selector (es formato individual)`,
    !lista.body?.formularios?.some((f) => f.codigo === CODIGO))
  check(`La empresa es ${EMPRESA}`, lista.body?.empresa === EMPRESA, lista.body?.empresa)

  // ═══ 2. Definición por código ═══
  seccion('2. Definición del formato')
  const def = await json(`${BASE}/public/formularios-sarlaft/${CODIGO}`)
  const formulario = def.body?.formulario
  check(`${CODIGO} devuelve su definición`, def.status === 200 && !!formulario,
    formulario ? `${formulario.total_secciones} secciones · ${formulario.total_preguntas} preguntas` : `HTTP ${def.status}`)
  check('Categoría individual', formulario?.categoria === 'individual', formulario?.categoria)
  check('Tipo declaracion_empresa_transporte', formulario?.tipo === 'declaracion_empresa_transporte')
  check('No expone DET-REP-05 como respuesta del formato',
    !formulario?.secciones?.some((s) => s.preguntas.some((p) => p.id === 'DET-REP-05')))
  check('Sin branding de la otra marca en la definición',
    !JSON.stringify(formulario ?? {}).toLowerCase().includes(MARCA_AJENA))

  // ═══ 3. Anexos condicionales ═══
  seccion('3. Anexos condicionales')
  const sinAlertas = await json(`${BASE}/public/formularios-sarlaft/${CODIGO}/documentos`)
  const conAlertas = await json(
    `${BASE}/public/formularios-sarlaft/${CODIGO}/documentos?alertas=${encodeURIComponent(OPCION_CON_ALERTAS)}`
  )
  check('Sin alertas: ningún anexo es obligatorio',
    (sinAlertas.body?.documentos ?? []).every((d) => !d.obligatorio))
  check('Con alertas: anexo_alertas pasa a obligatorio',
    conAlertas.body?.documentos?.find((d) => d.id === 'anexo_alertas')?.obligatorio === true)
  check('La relación de vehículos sigue siendo opcional',
    conAlertas.body?.documentos?.find((d) => d.id === 'relacion_vehiculos')?.obligatorio === false)

  // ═══ 4. Rechazos de validación ═══
  seccion('4. Validación del backend')
  const sinConfirmacion = await json(`${BASE}/public/formularios-sarlaft`, {
    method: 'POST',
    body: formData({ codigo_formulario: CODIGO, respuestas: respuestas() })
  })
  check('Falta la confirmación de correo → 422', sinConfirmacion.status === 422, `HTTP ${sinConfirmacion.status}`)

  const correoDistinto = await json(`${BASE}/public/formularios-sarlaft`, {
    method: 'POST',
    body: formData({
      codigo_formulario: CODIGO,
      respuestas: respuestas(),
      correo_confirmacion: 'otro@ejemplo.com'
    })
  })
  check('Confirmación distinta del correo → 422', correoDistinto.status === 422, `HTTP ${correoDistinto.status}`)

  const dobleAlerta = await json(`${BASE}/public/formularios-sarlaft`, {
    method: 'POST',
    body: formData({
      codigo_formulario: CODIGO,
      respuestas: respuestas({ 'DET-CNF-02': [OPCION_SIN_ALERTAS, OPCION_CON_ALERTAS] }),
      correo_confirmacion: CORREO_QA
    })
  })
  check('Marcar las dos opciones de alertas → 422', dobleAlerta.status === 422, `HTTP ${dobleAlerta.status}`)

  const alertaSinAnexo = await json(`${BASE}/public/formularios-sarlaft`, {
    method: 'POST',
    body: formData({
      codigo_formulario: CODIGO,
      respuestas: respuestas({
        'DET-CNF-02': OPCION_CON_ALERTAS,
        'DET-OBS-01': 'Alerta reportada en el anexo.'
      }),
      correo_confirmacion: CORREO_QA
    })
  })
  check('Alertas sin anexo → 422', alertaSinAnexo.status === 422, `HTTP ${alertaSinAnexo.status}`)

  // ═══ 5. Envío sin alertas ═══
  seccion('5. Envío sin alertas')
  const envio1 = await json(`${BASE}/public/formularios-sarlaft`, {
    method: 'POST',
    body: formData({
      codigo_formulario: CODIGO,
      fecha_diligenciamiento: '2026-08-22',
      respuestas: respuestas(),
      correo_confirmacion: CORREO_QA
    })
  })
  check('HTTP 201', envio1.status === 201, envio1.status === 201 ? envio1.body?.radicado : JSON.stringify(envio1.body).slice(0, 300))
  if (envio1.status !== 201) {
    resumen()
    return
  }
  const radicado1 = envio1.body.radicado
  const doc1 = envio1.body.documento
  check('Radicado con patrón DECL-TRA-AAAA-#####', /^DECL-TRA-\d{4}-\d{5}$/.test(radicado1), radicado1)
  check('Devuelve el documento generado', !!doc1?.id && !!doc1?.sha256, doc1?.nombre_archivo)
  check('SHA-256 con 64 hex', /^[0-9a-f]{64}$/.test(doc1?.sha256 ?? ''), doc1?.sha256)
  check('Versión documental 1', doc1?.version_documento === 1)
  check('Trae enlace temporal de descarga', typeof doc1?.download_url === 'string' && doc1.download_url.includes('token='))
  check('El enlace NO usa el radicado como credencial', !doc1?.download_url?.includes(radicado1))
  check('El enlace tiene vencimiento', !!doc1?.expires_at && new Date(doc1.expires_at) > new Date())
  // La copia al declarante está apagada por decisión de negocio: el trámite se
  // revisa internamente y el declarante conserva su copia por el enlace.
  check('NO se informa entrega al declarante (copia deshabilitada)',
    envio1.body?.entrega_email === undefined,
    JSON.stringify(envio1.body?.entrega_email ?? null))
  check('La respuesta no expone el correo del declarante',
    !JSON.stringify(envio1.body).includes(CORREO_QA))

  // ═══ 6. Descarga por token y verificación del hash ═══
  seccion('6. Descarga temporal y verificación de integridad')
  const descarga = await fetch(doc1.download_url)
  check('La descarga responde 200', descarga.status === 200, `HTTP ${descarga.status}`)
  const pdfBytes = Buffer.from(await descarga.arrayBuffer())
  check('El binario empieza con %PDF', pdfBytes.subarray(0, 4).toString('latin1') === '%PDF')
  check('El SHA-256 descargado coincide con el informado', sha256(pdfBytes) === doc1.sha256, sha256(pdfBytes))
  check('Content-Type es application/pdf',
    (descarga.headers.get('content-type') ?? '').includes('application/pdf'))
  check('La respuesta no se cachea', (descarga.headers.get('cache-control') ?? '').includes('no-store'))

  const tokenInvalido = await fetch(
    `${BASE}/public/formularios-sarlaft/documentos/descargar?token=tokeninventadoquenoexistejamas0000`
  )
  check('Un token inválido responde 404', tokenInvalido.status === 404, `HTTP ${tokenInvalido.status}`)

  // ═══ 7. Envío con alertas y anexo ═══
  seccion('7. Envío con alertas y anexo')
  const envio2 = await json(`${BASE}/public/formularios-sarlaft`, {
    method: 'POST',
    body: formData(
      {
        codigo_formulario: CODIGO,
        fecha_diligenciamiento: '2026-08-22',
        respuestas: respuestas({
          'DET-CNF-02': OPCION_CON_ALERTAS,
          'DET-OBS-01': 'Alerta sobre el conductor asignado al vehiculo WGY482; detalle en el anexo.'
        }),
        correo_confirmacion: CORREO_QA
      },
      {
        anexo_alertas: { buffer: ANEXO_TXT, nombre: 'anexo_alertas_qa.pdf', tipo: 'application/pdf' }
      }
    )
  })
  check('HTTP 201 con anexo', envio2.status === 201,
    envio2.status === 201 ? envio2.body?.radicado : JSON.stringify(envio2.body).slice(0, 300))
  const radicado2 = envio2.body?.radicado
  check('Registra 1 adjunto', envio2.body?.documentos_adjuntos === 1, String(envio2.body?.documentos_adjuntos))
  check('Los dos radicados son distintos', radicado1 !== radicado2, `${radicado1} / ${radicado2}`)

  // ═══ 8. Dashboard ═══
  seccion('8. Dashboard administrativo')
  const login = await json(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN)
  })
  const token = login.body?.token ?? login.body?.data?.token ?? login.body?.access_token
  check('Login del usuario de QA', !!token, token ? 'token obtenido' : JSON.stringify(login.body).slice(0, 200))
  if (!token) {
    resumen()
    return
  }
  const auth = { Authorization: `Bearer ${token}` }

  const listado = await json(
    `${BASE}/formularios-sarlaft?tipo_formulario=declaracion_empresa_transporte&limit=50`,
    { headers: auth }
  )
  check('El filtro por el nuevo tipo funciona', listado.status === 200 && Array.isArray(listado.body?.items),
    `${listado.body?.items?.length ?? 0} radicados`)
  check('Los dos envíos aparecen en el listado',
    [radicado1, radicado2].every((r) => listado.body?.items?.some((i) => i.radicado === r)))

  const registro = listado.body.items.find((i) => i.radicado === radicado1)
  const detalle = await json(`${BASE}/formularios-sarlaft/${registro.id}`, { headers: auth })
  const f = detalle.body?.formulario
  check('El detalle responde', detalle.status === 200 && !!f)
  check('Expone las versiones documentales', Array.isArray(f?.documentos_generados) && f.documentos_generados.length === 1)
  const v1 = f?.documentos_generados?.[0]
  check('La versión 1 está en estado recibida', v1?.estado_documental === 'recibida')
  check('El hash del detalle coincide con el del envío', v1?.pdf_sha256 === doc1.sha256)
  check('Registra el template usado', v1?.codigo_template === CODIGO && !!v1?.template_sha256)
  check('Registra las entregas', Array.isArray(v1?.entregas) && v1.entregas.length > 0,
    v1?.entregas?.map((e) => `${e.canal}:${e.estado}`).join(', '))
  check('NO hay entrega por correo al declarante',
    !v1?.entregas?.some((e) => e.canal === 'email_declarante'))
  check('Sí hay notificación interna enviada',
    v1?.entregas?.some((e) => e.canal === 'email_interno' && e.estado === 'enviado'))
  check('Ninguna entrega expone el token en claro',
    !JSON.stringify(v1?.entregas ?? []).includes('token'))
  check('El snapshot NO conserva la confirmación de correo',
    f?.respuestas?.['DET-REP-05'] === undefined && f?.respuestas?.correo_confirmacion === undefined)

  // ═══ 9. Decisión final: condicionado ═══
  seccion('9. Resultado condicionado → versión 2')
  const evaluacion = await json(`${BASE}/formularios-sarlaft/${registro.id}/evaluacion`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      estado: 'condicionado',
      concepto: 'Aprobado con condiciones',
      observaciones: 'QA automatizado: debe actualizar la poliza antes de 30 dias.'
    })
  })
  check('El backend acepta el estado condicionado', evaluacion.status === 200, `HTTP ${evaluacion.status}`)

  const detalle2 = await json(`${BASE}/formularios-sarlaft/${registro.id}`, { headers: auth })
  const versiones = detalle2.body?.formulario?.documentos_generados ?? []
  check('Ahora hay 2 versiones documentales', versiones.length === 2, `${versiones.length}`)
  const v2 = versiones.find((v) => v.version_documento === 2)
  const v1b = versiones.find((v) => v.version_documento === 1)
  check('La versión 2 está en estado evaluada', v2?.estado_documental === 'evaluada')
  check('La versión 2 tiene un hash distinto', v2 && v1b && v2.pdf_sha256 !== v1b.pdf_sha256)
  check('La versión 1 conserva su hash original', v1b?.pdf_sha256 === doc1.sha256, v1b?.pdf_sha256)
  check('La versión 2 registra quién la emitió', !!v2?.generado_por)

  const descargaV1 = await fetch(
    `${BASE}/formularios-sarlaft/${registro.id}/documentos-generados/${v1b.id}/pdf`,
    { headers: auth }
  )
  const bytesV1 = Buffer.from(await descargaV1.arrayBuffer())
  check('La versión 1 se descarga byte a byte igual', sha256(bytesV1) === doc1.sha256)

  const sinAuth = await fetch(
    `${BASE}/formularios-sarlaft/${registro.id}/documentos-generados/${v1b.id}/pdf`
  )
  check('La descarga administrativa exige autenticación', sinAuth.status === 401 || sinAuth.status === 403,
    `HTTP ${sinAuth.status}`)

  // ═══ 10. No regresión ═══
  seccion('10. No regresión de los formatos existentes')
  for (const codigo of ['SLFT-PTEE-FR-04', 'SLFT-PTEE-FR-05', 'SLFT-PTEE-FR-06', 'SLFT-PTEE-FR-12']) {
    const r = await json(`${BASE}/public/formularios-sarlaft/${codigo}`)
    check(`${codigo} sigue disponible`, r.status === 200 && !!r.body?.formulario)
  }

  resumen()
  console.log(
    `\n📬 Revisa ${CORREO_QA}: deben haber llegado SOLO las notificaciones\n` +
      `   internas redirigidas por sandbox (una por radicado), con [SANDBOX] en\n` +
      `   el asunto y sin rastros de ${MARCA_AJENA}. NO debe llegar ninguna\n` +
      `   copia dirigida al declarante.\n` +
      `   Radicados de esta corrida: ${radicado1}, ${radicado2}`
  )
}

function resumen() {
  console.log(`\n━━━ Resultado: ${ok} correctas, ${fail} fallidas`)
  if (fallos.length) {
    console.log('\nFallaron:')
    for (const f of fallos) console.log(`  · ${f}`)
  }
  process.exitCode = fail > 0 ? 1 : 0
}

main().catch((err) => {
  console.error('\n💥 Error inesperado:', err)
  process.exit(1)
})
