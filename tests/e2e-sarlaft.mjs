#!/usr/bin/env node
/**
 * Prueba end-to-end del módulo SARLAFT + PTEE de COTRANSMEQ.
 *
 * Recorre el flujo completo tal como lo vive un usuario real:
 *   público   → listar formatos, leer estructura, anexos requeridos, contacto
 *   envío     → submit multipart con respuestas + firma + adjuntos
 *   admin     → login, listado, detalle, evaluación, PDF y ZIP de evidencia
 *
 * Las respuestas se generan a partir de la definición que devuelve el propio
 * backend, así que la prueba se mantiene válida si cambian las preguntas.
 *
 *   node e2e-sarlaft.mjs [baseUrl]
 */

const BASE = process.argv[2] || 'http://localhost:4010/api'
const ADMIN = { correo: 'qa.sarlaft@cotransmeq.test', password: 'SarlaftQA2026!' }

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

/** PNG 1×1 transparente — sirve como firma y como adjunto de prueba. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const FIRMA_DATA_URL = `data:image/png;base64,${PNG_1X1.toString('base64')}`

/** Valor de relleno coherente con el tipo y el formato de cada pregunta. */
function valorDe(p) {
  const texto = (p.pregunta || '').toLowerCase()
  switch (p.tipo_respuesta) {
    case 'fecha':
      return '2026-08-20'
    case 'numerico':
      return texto.includes('%') || texto.includes('participación') ? 100 : 5000000
    case 'seleccion_unica':
      return p.opciones?.[0] ?? 'Sí'
    case 'seleccion_multiple':
      return p.opciones?.length ? [p.opciones[0]] : []
    case 'firma':
      return FIRMA_DATA_URL
    case 'texto_largo':
      return 'Respuesta de prueba automatizada para la verificación del módulo SARLAFT de Cotransmeq.'
    case 'declaracion_informativa':
      return null
    default:
      if (texto.includes('correo')) return 'qa.sarlaft@cotransmeq.test'
      if (p.formato === 'telefono' || texto.includes('teléfono')) return '+57 302 571 1858'
      if (p.formato === 'documento') return '1122334455'
      if (p.formato === 'digitos') return '00123456789'
      if (texto.includes('placa')) return 'ABC123'
      return 'Prueba QA Cotransmeq'
  }
}

/** Construye el payload de respuestas recorriendo la definición del formato. */
function construirRespuestas(formulario) {
  const respuestas = {}
  for (const s of formulario.secciones) {
    if (s.tipo_bloque === 'tabla_repetible_multiple' || s.tipo_bloque === 'tabla_repetible') {
      const key = s.key_tabla ?? `${s.preguntas[0]?.id.split('-').slice(0, -1).join('-')}__rows`
      const fila = {}
      for (const p of s.preguntas) {
        const v = valorDe(p)
        if (v !== null) fila[p.id] = v
      }
      respuestas[key] = [fila]
      continue
    }
    for (const p of s.preguntas) {
      const v = valorDe(p)
      if (v !== null) respuestas[p.id] = v
    }
  }
  return respuestas
}

async function json(url, opts) {
  const r = await fetch(url, opts)
  let body = null
  try {
    body = await r.json()
  } catch {
    /* respuesta no-JSON */
  }
  return { status: r.status, ok: r.ok, body }
}

// ───────────────────────────────────────────────────────────
async function main() {
  console.log(`SARLAFT + PTEE · Cotransmeq — pruebas E2E contra ${BASE}\n`)

  // ═══ 1. Catálogo público ═══
  seccion('1. Catálogo público de formularios')
  const lista = await json(`${BASE}/public/formularios-sarlaft`)
  check('GET /public/formularios-sarlaft responde 200', lista.status === 200)
  check('Devuelve los 3 formatos de conocimiento SARLAFT', lista.body?.formularios?.length === 3,
    lista.body?.formularios?.map((f) => f.codigo).join(', '))
  check('La empresa es COTRANSMEQ S.A.S.', lista.body?.empresa === 'COTRANSMEQ S.A.S.', lista.body?.empresa)
  check('El marco normativo trae las 4 normas', lista.body?.marco_normativo?.length === 4)
  check('SLFT-PTEE-FR-12 NO aparece en el selector (es formato individual)',
    !lista.body?.formularios?.some((f) => f.codigo === 'SLFT-PTEE-FR-12'))

  // ═══ 2. Estructura de cada formato ═══
  seccion('2. Estructura de los 4 formatos')
  const CODIGOS = ['GC-FR-04', 'GC-FR-05', 'GC-FR-06', 'SLFT-PTEE-FR-12']
  const definiciones = {}
  for (const codigo of CODIGOS) {
    const r = await json(`${BASE}/public/formularios-sarlaft/${codigo}`)
    definiciones[codigo] = r.body?.formulario
    check(`${codigo} devuelve su definición`, r.status === 200 && !!r.body?.formulario,
      r.body?.formulario ? `${r.body.formulario.total_secciones} secciones · ${r.body.formulario.total_preguntas} preguntas` : `HTTP ${r.status}`)
  }
  const inexistente = await json(`${BASE}/public/formularios-sarlaft/GC-FR-99`)
  check('Un código inexistente responde 4xx', inexistente.status >= 400, `HTTP ${inexistente.status}`)

  // ═══ 3. Anexos requeridos ═══
  seccion('3. Anexos requeridos por formato')
  const docsPersonal = await json(`${BASE}/public/formularios-sarlaft/GC-FR-06/documentos`)
  check('GC-FR-06 ofrece 4 anexos, 2 obligatorios',
    docsPersonal.body?.documentos?.length === 4 &&
      docsPersonal.body.documentos.filter((d) => d.obligatorio).length === 2)
  const docsAut = await json(`${BASE}/public/formularios-sarlaft/SLFT-PTEE-FR-12/documentos`)
  const autObligatorios = docsAut.body?.documentos?.filter((d) => d.obligatorio) ?? []
  check('SLFT-PTEE-FR-12 exige 6 anexos obligatorios', autObligatorios.length === 6,
    autObligatorios.map((d) => d.id).join(', '))
  const docsPJ = await json(`${BASE}/public/formularios-sarlaft/GC-FR-04/documentos?tipo_cliente=Persona%20Jur%C3%ADdica`)
  const docsPN = await json(`${BASE}/public/formularios-sarlaft/GC-FR-04/documentos?tipo_cliente=Persona%20Natural`)
  check('GC-FR-04 pide composición accionaria solo a Persona Jurídica',
    docsPJ.body?.documentos?.some((d) => d.id === 'composicion_accionaria') &&
      !docsPN.body?.documentos?.some((d) => d.id === 'composicion_accionaria'))
  check('Config de subida: 10 MB y extensiones permitidas',
    docsPersonal.body?.config?.max_bytes === 10 * 1024 * 1024 &&
      docsPersonal.body?.config?.extensiones_permitidas?.includes('.pdf'))

  // ═══ 4. Contacto público ═══
  seccion('4. Contacto público por tipo')
  for (const tipo of ['cliente_proveedor', 'accionistas', 'personal', 'autorizacion_propietario']) {
    const r = await json(`${BASE}/public/formularios-sarlaft/contacto?tipo=${tipo}`)
    const c = r.body?.contacto
    check(`contacto?tipo=${tipo}`, r.status === 200 && !!c,
      c ? `${c.area_responsable} · ${c.telefono_principal} · ${c.correo_publico}` : `HTTP ${r.status}`)
    if (c) {
      check(`  ${tipo}: sin rastros de Transmeralda`,
        !JSON.stringify(c).toLowerCase().includes('transmeralda'))
    }
  }
  const tipoMalo = await json(`${BASE}/public/formularios-sarlaft/contacto?tipo=inventado`)
  check('Un tipo inválido responde 400', tipoMalo.status === 400, `HTTP ${tipoMalo.status}`)

  // ═══ 5. Validación de campos obligatorios ═══
  seccion('5. Rechazo de envíos incompletos')
  const fdVacio = new FormData()
  fdVacio.append('payload', JSON.stringify({ codigo_formulario: 'GC-FR-06', respuestas: {} }))
  const vacio = await json(`${BASE}/public/formularios-sarlaft`, { method: 'POST', body: fdVacio })
  check('Un envío sin respuestas se rechaza con 422', vacio.status === 422, `HTTP ${vacio.status}`)
  check('El rechazo enumera los campos pendientes', Array.isArray(vacio.body?.details) && vacio.body.details.length > 0,
    `${vacio.body?.details?.length ?? 0} errores`)

  const sinPayload = await json(`${BASE}/public/formularios-sarlaft`, { method: 'POST', body: new FormData() })
  check('Un envío sin payload se rechaza con 400', sinPayload.status === 400, `HTTP ${sinPayload.status}`)

  // ═══ 6. Envío completo — GC-FR-06 (Vinculación de Personal) ═══
  seccion('6. Envío completo GC-FR-06 (Vinculación de Personal)')
  const radicados = {}
  {
    const def = definiciones['GC-FR-06']
    const fd = new FormData()
    fd.append('payload', JSON.stringify({
      codigo_formulario: 'GC-FR-06',
      fecha_diligenciamiento: '2026-08-20',
      respuestas: construirRespuestas(def)
    }))
    fd.append('doc_cedula_representante', new Blob([PNG_1X1], { type: 'image/png' }), 'cedula_qa.png')
    fd.append('doc_rut', new Blob([PNG_1X1], { type: 'image/png' }), 'rut_qa.png')
    const r = await json(`${BASE}/public/formularios-sarlaft`, { method: 'POST', body: fd })
    check('El envío se acepta con 201', r.status === 201, r.status === 201 ? r.body?.radicado : JSON.stringify(r.body).slice(0, 300))
    if (r.status === 201) {
      radicados.personal = r.body.radicado
      check('El radicado sigue el patrón SARLAFT-AAAA-PER-#####', /^SARLAFT-\d{4}-PER-\d{5}$/.test(r.body.radicado), r.body.radicado)
      check('Registra los 2 adjuntos', r.body.documentos_adjuntos === 2, String(r.body.documentos_adjuntos))
      check('El mensaje de confirmación menciona a COTRANSMEQ S.A.S.', (r.body.mensaje || '').includes('COTRANSMEQ S.A.S.'))
    }
  }

  // ═══ 7. Envío completo — SLFT-PTEE-FR-12 (Autorización del Propietario) ═══
  seccion('7. Envío completo SLFT-PTEE-FR-12 (Autorización del Propietario)')
  {
    const def = definiciones['SLFT-PTEE-FR-12']
    const fd = new FormData()
    fd.append('payload', JSON.stringify({
      codigo_formulario: 'SLFT-PTEE-FR-12',
      fecha_diligenciamiento: '2026-08-20',
      respuestas: construirRespuestas(def)
    }))
    for (const d of autObligatorios) {
      fd.append(`doc_${d.id}`, new Blob([PNG_1X1], { type: 'image/png' }), `${d.id}_qa.png`)
    }
    const r = await json(`${BASE}/public/formularios-sarlaft`, { method: 'POST', body: fd })
    check('El envío se acepta con 201', r.status === 201, r.status === 201 ? r.body?.radicado : JSON.stringify(r.body).slice(0, 400))
    if (r.status === 201) {
      radicados.autorizacion = r.body.radicado
      check('El radicado usa la serie propia AUTPROP-AAAA-#####', /^AUTPROP-\d{4}-\d{5}$/.test(r.body.radicado), r.body.radicado)
      check('Registra los 6 adjuntos obligatorios', r.body.documentos_adjuntos === 6, String(r.body.documentos_adjuntos))
    }
  }

  // Falta de anexos obligatorios
  {
    const def = definiciones['SLFT-PTEE-FR-12']
    const fd = new FormData()
    fd.append('payload', JSON.stringify({ codigo_formulario: 'SLFT-PTEE-FR-12', respuestas: construirRespuestas(def) }))
    const r = await json(`${BASE}/public/formularios-sarlaft`, { method: 'POST', body: fd })
    check('Sin los anexos obligatorios se rechaza con 422', r.status === 422, `HTTP ${r.status}`)
  }

  // ═══ 8. Admin ═══
  seccion('8. Dashboard admin (requiere autenticación)')
  const sinAuth = await json(`${BASE}/formularios-sarlaft`)
  check('El listado admin exige autenticación', sinAuth.status === 401 || sinAuth.status === 403, `HTTP ${sinAuth.status}`)

  const login = await json(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(ADMIN)
  })
  const token = login.body?.token ?? login.body?.data?.token ?? login.body?.accessToken
  check('Login del usuario QA', !!token, token ? 'token obtenido' : JSON.stringify(login.body).slice(0, 200))
  if (!token) {
    resumen()
    return
  }
  const auth = { Authorization: `Bearer ${token}` }

  const listado = await json(`${BASE}/formularios-sarlaft?page=1&limit=20`, { headers: auth })
  check('El listado admin responde 200', listado.status === 200)
  check('Incluye los radicados recién creados',
    listado.body?.items?.some((i) => i.radicado === radicados.personal) &&
      listado.body?.items?.some((i) => i.radicado === radicados.autorizacion),
    `${listado.body?.pagination?.total ?? 0} registros en total`)

  const filtroAut = await json(`${BASE}/formularios-sarlaft?tipo_formulario=autorizacion_propietario`, { headers: auth })
  check('El filtro por tipo autorizacion_propietario funciona',
    filtroAut.status === 200 &&
      filtroAut.body?.items?.length > 0 &&
      filtroAut.body.items.every((i) => i.tipo_formulario === 'autorizacion_propietario'),
    `${filtroAut.body?.items?.length ?? 0} resultados`)

  const busqueda = await json(`${BASE}/formularios-sarlaft?search=${encodeURIComponent(radicados.personal)}`, { headers: auth })
  check('La búsqueda por radicado devuelve el registro', busqueda.body?.items?.length === 1)

  const registro = listado.body.items.find((i) => i.radicado === radicados.autorizacion)
  const detalle = await json(`${BASE}/formularios-sarlaft/${registro.id}`, { headers: auth })
  check('El detalle responde 200', detalle.status === 200)
  check('El detalle incluye la definición del formato para renderizado genérico', !!detalle.body?.formulario?.definicion)
  check('El detalle lista los 6 documentos', detalle.body?.formulario?.documentos?.length === 6)
  check('Los documentos traen hash SHA-256', detalle.body?.formulario?.documentos?.every((d) => !!d.hash_sha256))

  const docId = detalle.body.formulario.documentos[0].id
  const urlDoc = await json(`${BASE}/formularios-sarlaft/${registro.id}/documentos/${docId}/url`, { headers: auth })
  check('Genera URL firmada de S3 para un adjunto', urlDoc.status === 200 && !!urlDoc.body?.url,
    urlDoc.body?.url ? `expira en ${urlDoc.body.expires_in}s` : `HTTP ${urlDoc.status}`)

  const evalr = await json(`${BASE}/formularios-sarlaft/${registro.id}/evaluacion`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado: 'en_revision', concepto: 'procedente', observaciones: 'Revisión automática QA.' })
  })
  check('Actualiza la evaluación del Oficial de Cumplimiento', evalr.status === 200, `HTTP ${evalr.status}`)
  const trasEval = await json(`${BASE}/formularios-sarlaft/${registro.id}`, { headers: auth })
  check('El estado quedó en en_revision', trasEval.body?.formulario?.estado === 'en_revision', trasEval.body?.formulario?.estado)
  check('Queda registrado quién evaluó', !!trasEval.body?.formulario?.evaluado_por?.nombre,
    trasEval.body?.formulario?.evaluado_por?.nombre)

  // ═══ 9. PDF y evidencia ═══
  seccion('9. Generación de PDF y ZIP de evidencia')
  const pdf = await fetch(`${BASE}/formularios-sarlaft/${registro.id}/pdf`, { headers: auth })
  const pdfBuf = Buffer.from(await pdf.arrayBuffer())
  check('El PDF se descarga', pdf.status === 200, `${pdf.status} · ${(pdfBuf.length / 1024).toFixed(1)} KB`)
  check('El archivo es un PDF válido', pdfBuf.subarray(0, 4).toString() === '%PDF', pdfBuf.subarray(0, 8).toString().replace(/\s/g, ''))

  const zip = await fetch(`${BASE}/formularios-sarlaft/${registro.id}/evidencia`, { headers: auth })
  const zipBuf = Buffer.from(await zip.arrayBuffer())
  check('El ZIP de evidencia se descarga', zip.status === 200, `${zip.status} · ${(zipBuf.length / 1024).toFixed(1)} KB`)
  check('El archivo es un ZIP válido', zipBuf.subarray(0, 2).toString() === 'PK')

  resumen()
}

function resumen() {
  console.log(`\n${'═'.repeat(62)}`)
  console.log(`RESULTADO: ${ok} verificaciones correctas · ${fail} fallidas`)
  if (fallos.length) console.log(`Fallidas:\n  - ${fallos.join('\n  - ')}`)
  console.log('═'.repeat(62))
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('\nError inesperado en la prueba:', e)
  process.exit(2)
})
