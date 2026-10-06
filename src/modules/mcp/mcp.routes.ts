import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { type UsuarioAsistente, cargarUsuarioAsistente, puedeUsar } from '../asistente/asistente.types'
import { topeCaracteres, topeLista } from '../asistente/asistente.service'
import { aTextoParaModelo, recortar } from '../asistente/asistente.utils'
import { buscarHerramienta, herramientasDisponibles } from '../asistente/herramientas'
import { apiTokensService, pareceToken } from './api-tokens.service'

/** Nombre con el que el servidor se presenta ante Claude. Cambia en el repo gemelo. */
const EMPRESA = 'Cotransmeq'
const NOMBRE_SERVIDOR = 'cotransmeq'

/**
 * URL pública de la app, para volver absolutos los enlaces que viajan a Claude.
 * `FRONTEND_URL` aquí es una lista separada por comas (orígenes CORS); se
 * prefiere `EMAIL_FRONTEND_URL`, que es la canónica, y si no, la primera https.
 */
function urlApp(): string {
  const candidatas = [env.EMAIL_FRONTEND_URL, ...(env.FRONTEND_URL ?? '').split(',')]
    .map((u) => (u ?? '').trim())
    .filter(Boolean)
  const elegida = candidatas.find((u) => u.startsWith('https://')) ?? candidatas[0] ?? ''
  return elegida.replace(/\/$/, '')
}

/**
 * Los enlaces de las herramientas son rutas de la app ("/dashboard/…"). Dentro
 * de la app sirven tal cual; para Claude o ChatGPT se vuelven absolutos. Se
 * mira el VALOR, no la clave: los enlaces viajan en `enlace`, `url`,
 * `servicio`, `pantalla`, `enlace_explorador`…
 */
function absolutizar(valor: unknown, base: string): unknown {
  if (Array.isArray(valor)) return valor.map((v) => absolutizar(v, base))
  if (valor && typeof valor === 'object' && !(valor instanceof Date)) {
    return Object.fromEntries(Object.entries(valor).map(([k, v]) => [k, absolutizar(v, base)]))
  }
  if (typeof valor === 'string' && valor.startsWith('/dashboard')) return `${base}${valor}`
  return valor
}

function instrucciones(u: UsuarioAsistente, base: string): string {
  return `Conectado a ${EMPRESA} como ${u.nombre} (áreas: ${u.areas.join(', ') || 'sin área'}; rol ${u.rol}). ${EMPRESA} es la plataforma interna con la que una empresa colombiana de transporte especial administra su flota, conductores, servicios, recargos y planillas, recorridos de conductores, nómina, liquidaciones de servicios y de terceros, facturas, formularios HSEQ (preoperacionales, inspecciones), asistencias, acciones correctivas, PESV y SARLAFT.
Las herramientas respetan los permisos de este usuario. La mayoría solo consultan; las que crean datos (crear_servicio, crear_servicios, crear_recargo, registrar_recorridos, crear_accion_correctiva, duplicar_liquidacion) solo aparecen si el usuario tiene permiso de escritura, exigen confirmado=true y deben llamarse después de mostrarle al usuario un resumen y de que él confirme una vez; no pidas confirmaciones repetidas. Para cualquier dato usa siempre las herramientas, no supongas; en las consultas asume lo razonable (mes en curso, todos los formularios) y dilo. search y fetch sirven para buscar en toda la plataforma y traer un resultado completo. Cuando una herramienta devuelva un enlace, inclúyelo para que el usuario abra la pantalla en ${base || 'la app'}. Responde en español de Colombia con formato numérico colombiano.`
}

function jsonRpcError(reply: FastifyReply, status: number, code: number, message: string) {
  return reply.status(status).send({ jsonrpc: '2.0', error: { code, message }, id: null })
}

/**
 * Servidor MCP (Streamable HTTP, sin estado) para conectar Claude o ChatGPT a
 * la app. Expone las mismas herramientas que el asistente del chat, filtradas
 * por los permisos del dueño del token, más `search`/`fetch` (el par que ChatGPT
 * exige para Deep Research).
 *
 * Autenticación con token personal (ver `apiTokensService`), por cabecera
 * `Authorization: Bearer cmq_…` (Claude Desktop / Claude Code / ChatGPT con
 * «token de acceso») o en la ruta `/mcp/cmq_…` para los conectores que solo
 * piden una URL (claude.ai, ChatGPT en modo desarrollador sin autenticación).
 *
 * Sin sesiones: cada POST crea un `Server` nuevo y responde en JSON. GET y
 * DELETE (stream del servidor y cierre de sesión) responden 405.
 */
export async function mcpRoutes(app: FastifyInstance) {
  app.post('/mcp', async (request, reply) => {
    const cabecera = request.headers.authorization ?? ''
    const token = cabecera.startsWith('Bearer ') ? cabecera.slice(7).trim() : ''
    return atender(token, request, reply)
  })

  app.post('/mcp/:token', async (request, reply) => {
    const { token } = request.params as { token: string }
    return atender(token, request, reply)
  })

  for (const ruta of ['/mcp', '/mcp/:token']) {
    app.route({
      method: ['GET', 'DELETE', 'PUT', 'PATCH'],
      url: ruta,
      handler: async (_request, reply) => jsonRpcError(reply.header('Allow', 'POST'), 405, -32000, 'Método no permitido'),
    })
  }
}

async function atender(token: string, request: FastifyRequest, reply: FastifyReply) {
  const usuarioId = pareceToken(token) ? await apiTokensService.autenticar(token) : null
  const usuario = usuarioId ? await cargarUsuarioAsistente(usuarioId) : null
  if (!usuario) return jsonRpcError(reply, 401, -32001, 'Token inválido o revocado')

  const base = urlApp()
  const server = new Server(
    { name: NOMBRE_SERVIDOR, version: '1.0.0' },
    { capabilities: { tools: {} }, instructions: instrucciones(usuario, base) },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: herramientasDisponibles(usuario, 'mcp').map((h) => ({
      name: h.nombre,
      description: h.descripcion,
      inputSchema: h.parametros as { type: 'object'; [k: string]: unknown },
      annotations: { title: h.etiqueta, readOnlyHint: !h.escribe, destructiveHint: false, idempotentHint: !h.escribe, openWorldHint: false },
    })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (peticion) => {
    const h = buscarHerramienta(peticion.params.name)
    if (!h || !puedeUsar(h, usuario, 'mcp')) {
      return { isError: true, content: [{ type: 'text', text: 'Herramienta no disponible para este usuario.' }] }
    }
    try {
      const args = peticion.params.arguments ?? {}
      const salida = absolutizar(recortar(await h.ejecutar(args, usuario), topeLista(h, args)), base)
      const texto = aTextoParaModelo(salida, Math.max(40000, topeCaracteres(h, args) ?? 0))
      /// `search`/`fetch` (contrato de ChatGPT) devuelven además el objeto
      /// estructurado, que es lo que su cliente lee.
      const estructurado = (h.nombre === 'search' || h.nombre === 'fetch') && salida && typeof salida === 'object' && !Array.isArray(salida)
      return { content: [{ type: 'text', text: texto }], ...(estructurado ? { structuredContent: salida as Record<string, unknown> } : {}) }
    } catch (e) {
      logger.warn({ herramienta: h.nombre, usuario: usuario.id, error: (e as Error).message }, 'MCP: herramienta falló')
      return { isError: true, content: [{ type: 'text', text: 'No se pudo consultar esta información.' }] }
    }
  })

  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })

  // La respuesta la escribe el SDK sobre los objetos crudos de Node. Las
  // cabeceras acumuladas en `reply` (CORS) hay que pasarlas a mano: tras
  // `hijack()` Fastify no las escribe.
  for (const [k, v] of Object.entries(reply.getHeaders())) {
    if (v !== undefined) reply.raw.setHeader(k, v as string)
  }
  reply.hijack()
  reply.raw.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    await server.connect(transport)
    await transport.handleRequest(request.raw, reply.raw, request.body)
  } catch (e) {
    logger.error({ error: (e as Error).message }, 'MCP: la petición falló')
    if (!reply.raw.headersSent) {
      reply.raw.writeHead(500, { 'Content-Type': 'application/json' })
      reply.raw.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Error interno' }, id: null }))
    }
  }
}
