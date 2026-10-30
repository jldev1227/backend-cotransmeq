import { existsSync } from 'node:fs'
import { chromium, type Page, type Request, type Response } from 'playwright-core'

const URL_ESTADO_CUENTA = 'https://www.fcm.org.co/simit/#/estado-cuenta'
const URL_CONSULTA = 'https://consultasimit.fcm.org.co/simit/microservices/estado-cuenta-simit/estadocuenta/consulta'
const URL_DETALLE_COMPARENDO = 'https://consultasimit.fcm.org.co/simit/microservices/comparendos-simit/comparendos/detalleComparendo'
const TIMEOUT_MS = 25_000

export interface DetalleComparendoSimit {
  numeroComparendo: string
  fechaImposicion: string | null
  horaImposicion: string | null
  direccion: string | null
  error: string | null
}

export interface ResultadoPortalSimit {
  estado_consulta: 'sin_deuda' | 'con_deuda'
  comparendos: number
  multas: number
  acuerdos_pago: number
  saldo_total: number
  detalle: { fuente: string; resumen: string; comparendosDetalle: DetalleComparendoSimit[] }
}

interface RespuestaSimit {
  multas: unknown[]
  resoluciones: unknown[]
  comparendos: unknown[]
  acuerdosPago: unknown[]
  pazSalvo: boolean
  totalGeneral: number
}

interface ReferenciaComparendo {
  numeroComparendo: string
  consecutivoComparendo: number | null
  fechaImposicion: string | null
  horaImposicion: string | null
  direccion: string | null
}

function rutaChromium(): string {
  const configurada = process.env.SIMIT_CHROMIUM_PATH
    ?? process.env.CHROME_PATH
    ?? process.env.CHROMIUM_PATH
  if (configurada && existsSync(configurada)) return configurada

  const candidatas = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome']
  const encontrada = candidatas.find((ruta) => existsSync(ruta))
  if (!encontrada) throw new Error('No se encontró Chromium para la consulta SIMIT.')
  return encontrada
}

function esObjeto(valor: unknown): valor is Record<string, unknown> {
  return typeof valor === 'object' && valor !== null && !Array.isArray(valor)
}

function textoDe(objeto: Record<string, unknown>, campo: string): string | null {
  const valor = objeto[campo]
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null
}

function consecutivoDe(valor: unknown): number | null {
  const numero = typeof valor === 'number'
    ? valor
    : typeof valor === 'string' && /^\d+$/.test(valor)
      ? Number(valor)
      : null
  return numero !== null && Number.isSafeInteger(numero) && numero > 0 ? numero : null
}

function referenciasComparendos(respuesta: RespuestaSimit): ReferenciaComparendo[] {
  const porNumero = new Map<string, ReferenciaComparendo>()
  for (const item of [...respuesta.comparendos, ...respuesta.multas, ...respuesta.resoluciones, ...respuesta.acuerdosPago]) {
    if (!esObjeto(item)) continue
    const numeroComparendo = textoDe(item, 'numeroComparendo')
    if (!numeroComparendo) continue
    const anterior = porNumero.get(numeroComparendo)
    const consecutivoComparendo = consecutivoDe(item.consecutivoComparendo)
    porNumero.set(numeroComparendo, {
      numeroComparendo,
      consecutivoComparendo: consecutivoComparendo ?? anterior?.consecutivoComparendo ?? null,
      fechaImposicion: textoDe(item, 'fechaComparendo') ?? anterior?.fechaImposicion ?? null,
      horaImposicion: textoDe(item, 'horaComparendo') ?? anterior?.horaImposicion ?? null,
      direccion: textoDe(item, 'direccionComparendo') ?? anterior?.direccion ?? null,
    })
  }
  return [...porNumero.values()]
}

function interpretarRespuestaSimit(valor: unknown): ResultadoPortalSimit {
  if (!esObjeto(valor)
    || !Array.isArray(valor.multas)
    || !Array.isArray(valor.resoluciones)
    || !Array.isArray(valor.comparendos)
    || !Array.isArray(valor.acuerdosPago)
    || typeof valor.pazSalvo !== 'boolean'
    || typeof valor.totalGeneral !== 'number'
    || !Number.isFinite(valor.totalGeneral)) {
    throw new Error('SIMIT respondió con un formato inesperado; la consulta queda pendiente de atención.')
  }

  const respuesta: RespuestaSimit = {
    multas: valor.multas,
    resoluciones: valor.resoluciones,
    comparendos: valor.comparendos,
    acuerdosPago: valor.acuerdosPago,
    pazSalvo: valor.pazSalvo,
    totalGeneral: valor.totalGeneral,
  }
  const camposDeuda = ['totalMultasPagar', 'cantMultasPagar', 'totalAcuerdosPagar', 'cantAcuerdosPagar'] as const
  const camposDePagoCompletos = camposDeuda.every((campo) =>
    typeof valor[campo] === 'number' && Number.isFinite(valor[campo]),
  )
  const hayValoresPorPagar = camposDeuda.some((campo) =>
    typeof valor[campo] === 'number' && Number.isFinite(valor[campo]) && valor[campo] > 0,
  )
  /// `pazSalvo: false` también llega con todos los rubros vacíos para algunas placas; el estado debe seguir el saldo y las cuentas por pagar.
  const conDeuda = hayValoresPorPagar
    || respuesta.totalGeneral > 0
    || (!camposDePagoCompletos && (
      respuesta.multas.length > 0
      || respuesta.resoluciones.length > 0
      || respuesta.comparendos.length > 0
      || respuesta.acuerdosPago.length > 0
    ))

  return {
    estado_consulta: conDeuda ? 'con_deuda' : 'sin_deuda',
    comparendos: respuesta.comparendos.length,
    multas: respuesta.multas.length,
    acuerdos_pago: respuesta.acuerdosPago.length,
    saldo_total: respuesta.totalGeneral,
    detalle: {
      fuente: URL_ESTADO_CUENTA,
      resumen: `Obligaciones por pagar: ${conDeuda ? 'sí' : 'no'}; paz y salvo: ${respuesta.pazSalvo ? 'sí' : 'no'}; comparendos: ${respuesta.comparendos.length}; multas: ${respuesta.multas.length}; resoluciones: ${respuesta.resoluciones.length}; acuerdos de pago: ${respuesta.acuerdosPago.length}; total: ${respuesta.totalGeneral}`,
      comparendosDetalle: [],
    },
  }
}

async function consultarDetalleComparendo(
  page: Page,
  referencia: ReferenciaComparendo,
  reCaptchaDTO: unknown,
): Promise<DetalleComparendoSimit> {
  const base: DetalleComparendoSimit = {
    numeroComparendo: referencia.numeroComparendo,
    fechaImposicion: referencia.fechaImposicion,
    horaImposicion: referencia.horaImposicion,
    direccion: referencia.direccion,
    error: null,
  }
  if (!referencia.consecutivoComparendo) {
    return { ...base, error: 'SIMIT no entregó el consecutivo requerido para consultar este detalle.' }
  }
  if (!esObjeto(reCaptchaDTO) || typeof reCaptchaDTO.response !== 'string') {
    return { ...base, error: 'SIMIT no entregó la validación requerida para consultar este detalle.' }
  }

  try {
    const resultado = await page.evaluate(async ({ url, payload, timeoutMs }) => {
      const controlador = new AbortController()
      const temporizador = window.setTimeout(() => controlador.abort(), timeoutMs)
      try {
        const respuesta = await fetch(url, {
          method: 'POST',
          credentials: 'include',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controlador.signal,
        })
        return { status: respuesta.status, cuerpo: await respuesta.text() }
      } finally {
        window.clearTimeout(temporizador)
      }
    }, {
      url: URL_DETALLE_COMPARENDO,
      payload: { consecutivoComparendo: referencia.consecutivoComparendo, reCaptchaDTO },
      timeoutMs: TIMEOUT_MS,
    })
    if (resultado.status < 200 || resultado.status >= 300) {
      return { ...base, error: `SIMIT no pudo consultar el detalle (HTTP ${resultado.status}).` }
    }

    const cuerpo: unknown = JSON.parse(resultado.cuerpo)
    if (!esObjeto(cuerpo)) return { ...base, error: 'SIMIT respondió un detalle con formato inesperado.' }
    const numeroRespuesta = textoDe(cuerpo, 'numeroComparendo')
    if (numeroRespuesta && numeroRespuesta !== referencia.numeroComparendo) {
      return { ...base, error: 'El número del detalle no coincide con el comparendo consultado.' }
    }
    return {
      numeroComparendo: numeroRespuesta ?? referencia.numeroComparendo,
      fechaImposicion: textoDe(cuerpo, 'fechaComparendo') ?? referencia.fechaImposicion,
      horaImposicion: textoDe(cuerpo, 'horaComparendo') ?? referencia.horaImposicion,
      direccion: textoDe(cuerpo, 'direccionComparendo') ?? referencia.direccion,
      error: null,
    }
  } catch {
    return { ...base, error: 'No fue posible leer el detalle del comparendo en SIMIT.' }
  }
}

async function agregarDetallesComparendos(page: Page, valor: unknown, reCaptchaDTO: unknown) {
  if (!esObjeto(valor)
    || !Array.isArray(valor.multas)
    || !Array.isArray(valor.resoluciones)
    || !Array.isArray(valor.comparendos)
    || !Array.isArray(valor.acuerdosPago)) return []

  const referencias = referenciasComparendos(valor as unknown as RespuestaSimit)
  const detalles: DetalleComparendoSimit[] = []
  for (const referencia of referencias) {
    detalles.push(await consultarDetalleComparendo(page, referencia, reCaptchaDTO))
  }
  return detalles
}

async function esperarRespuestaConsulta(page: Page) {
  const solicitud = page.waitForRequest((request) =>
    request.url().startsWith(URL_CONSULTA) && request.method() === 'POST',
  { timeout: TIMEOUT_MS })
  const espera = page.waitForResponse((respuesta) =>
    respuesta.url().startsWith(URL_CONSULTA)
    && respuesta.request().method() === 'POST',
  { timeout: TIMEOUT_MS })

  try {
    await page.locator('#btnNumDocPlaca').click()
  } catch {
    void solicitud.catch(() => undefined)
    void espera.catch(() => undefined)
    throw new Error('No se pudo enviar el formulario de consulta de SIMIT.')
  }

  let request: Request
  let response: Response
  try {
    [request, response] = await Promise.all([solicitud, espera])
  } catch {
    throw new Error('El portal SIMIT no respondió la consulta dentro del tiempo de espera; verifica si solicita una validación manual.')
  }
  if (!response.ok()) throw new Error(`SIMIT respondió con estado HTTP ${response.status()}.`)

  let cuerpo: unknown
  try {
    cuerpo = await response.json() as unknown
  } catch {
    throw new Error('SIMIT respondió un contenido que no es JSON válido.')
  }
  let reCaptchaDTO: unknown = null
  try {
    const payload = request.postDataJSON()
    reCaptchaDTO = esObjeto(payload) ? payload.reCaptchaDTO : null
  } catch {
    /// El resumen todavía se conserva si el cuerpo de la petición cambia; solo se marcará pendiente el detalle.
  }
  return { respuesta: cuerpo, reCaptchaDTO }
}

/** Abre Chromium una vez por lote y lee el JSON de la consulta emitida por el formulario oficial. */
export async function iniciarSesionSimit() {
  const browser = await chromium.launch({
    headless: true,
    executablePath: rutaChromium(),
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage({ locale: 'es-CO' })
    await page.goto(URL_ESTADO_CUENTA, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
    const campo = page.locator('#txtBusqueda')
    await campo.waitFor({ state: 'visible', timeout: TIMEOUT_MS })

    return {
      /** El formulario obtiene el desafío vigente y su POST se interpreta desde la respuesta JSON. */
      async consultar(identificador: string): Promise<ResultadoPortalSimit> {
        await campo.fill(identificador)
        const consulta = await esperarRespuestaConsulta(page)
        const resultado = interpretarRespuestaSimit(consulta.respuesta)
        const comparendosDetalle = await agregarDetallesComparendos(page, consulta.respuesta, consulta.reCaptchaDTO)
        return { ...resultado, detalle: { ...resultado.detalle, comparendosDetalle } }
      },
      cerrar: () => browser.close(),
    }
  } catch (error) {
    await browser.close()
    throw error
  }
}
