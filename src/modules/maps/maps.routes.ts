/**
 * Autocompletado de sitios para los servicios: el mismo proxy híbrido que la web tiene en
 * SvelteKit (`ingreso-svelte/src/routes/api/maps/*`), aquí para que la app móvil lo use con su
 * token. Los lugares propios (`custom_places`: pozos, campamentos…) van primero; después HERE.
 *
 * La clave de HERE vive solo en el servidor (`HERE_MAPS_API_KEY`). Sin ella se devuelven solo
 * los lugares propios y un `error` que el cliente puede mostrar; el campo sigue aceptando texto.
 *
 * - `GET /maps/autocomplete?q=&limit=` → `{ results: [{ id, title, subtitle, address, source }], error }`
 * - `GET /maps/lookup?id=` → `{ id, title, address, city, lat, lng }`
 */

import { FastifyInstance } from 'fastify'

import { env } from '../../config/env'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { CustomPlacesService } from '../custom-places/custom-places.service'

const HERE_AUTOCOMPLETE = 'https://autocomplete.search.hereapi.com/v1/autocomplete'
const HERE_LOOKUP = 'https://lookup.search.hereapi.com/v1/lookup'
const TIMEOUT_MS = 8_000

interface HereItem {
  id: string
  title: string
  address?: { label?: string; city?: string; county?: string; countryName?: string }
  position?: { lat: number; lng: number }
}

async function here<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS) })
  if (!res.ok) throw new Error(`HERE respondió ${res.status}`)
  return (await res.json()) as T
}

export async function mapsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  app.get('/maps/autocomplete', async (request, reply) => {
    const { q: qRaw = '', limit: limitRaw = '8' } = request.query as { q?: string; limit?: string }
    const q = qRaw.trim().slice(0, 120)
    const limit = Math.min(Math.max(parseInt(limitRaw, 10) || 8, 1), 15)
    if (q.length < 3) return reply.send({ results: [], error: null })

    const locales = await CustomPlacesService.search({ q, limit } as any).catch(() => [])
    const results: { id: string; title: string; subtitle: string | null; address: string; source: 'local' | 'here' }[] =
      locales.map((p: any) => ({
        id: p.id,
        title: p.title,
        subtitle: p.subtitle ?? null,
        address: p.address ?? p.title,
        source: 'local' as const
      }))

    let error: string | null = null
    const key = env.HERE_MAPS_API_KEY
    if (!key) {
      error = 'La búsqueda de direcciones no está configurada en el servidor.'
    } else {
      const params = new URLSearchParams({ q, limit: String(limit), apiKey: key, in: 'countryCode:COL', lang: 'es' })
      try {
        const data = await here<{ items?: HereItem[] }>(`${HERE_AUTOCOMPLETE}?${params}`)
        for (const item of data.items ?? []) {
          const a = item.address ?? {}
          const subtitle = [a.city, a.county, a.countryName].filter(Boolean).join(', ')
          results.push({ id: item.id, title: item.title, subtitle, address: a.label ?? item.title, source: 'here' })
        }
      } catch (err) {
        request.log.warn({ err }, '[maps] autocomplete HERE')
        error = 'No se pudo consultar el buscador de direcciones.'
      }
    }

    /// Un lugar propio y uno de HERE con el mismo nombre: gana el propio, que es el de la operación.
    const vistos = new Set<string>()
    const unicos = results.filter((r) => {
      const clave = r.title.trim().toLowerCase()
      if (!clave || vistos.has(clave)) return false
      vistos.add(clave)
      return true
    })
    return reply.send({ results: unicos.slice(0, limit), error })
  })

  app.get('/maps/lookup', async (request, reply) => {
    const id = String((request.query as { id?: string }).id ?? '').trim()
    if (!id) return reply.status(400).send({ error: 'Falta el id del lugar.' })

    if (id.startsWith('local:cp:')) {
      const lugar = await CustomPlacesService.lookupById(id.replace(/^local:cp:/, ''))
      if (!lugar) return reply.status(404).send({ error: 'Lugar no encontrado.' })
      return reply.send({ id, title: lugar.title, address: lugar.address, city: lugar.subtitle ?? null, lat: lugar.lat, lng: lugar.lng })
    }

    const key = env.HERE_MAPS_API_KEY
    if (!key) return reply.status(503).send({ error: 'La búsqueda de direcciones no está configurada en el servidor.' })
    try {
      const params = new URLSearchParams({ id, apiKey: key, lang: 'es' })
      const item = await here<HereItem>(`${HERE_LOOKUP}?${params}`)
      if (!item.position?.lat || !item.position?.lng) {
        return reply.status(404).send({ error: 'Ese lugar no tiene coordenadas.' })
      }
      return reply.send({
        id: item.id,
        title: item.title,
        address: item.address?.label ?? item.title,
        city: item.address?.city ?? null,
        lat: item.position.lat,
        lng: item.position.lng
      })
    } catch (err) {
      request.log.warn({ err }, '[maps] lookup HERE')
      return reply.status(502).send({ error: 'No se pudo consultar el buscador de direcciones.' })
    }
  })
}
