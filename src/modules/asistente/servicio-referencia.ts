import { prisma } from '../../config/prisma'
import type { Herramienta } from './asistente.types'
import { fechaCorta } from './asistente.utils'

/**
 * Un servicio existente como dato: para consultarlo y para crear otro «igual»
 * o «con la ruta invertida».
 *
 * Antes el asistente no tenía cómo leer un servicio por su id. Ante «es la
 * misma ruta invertida de este servicio 2979…» abría el ticket en pantalla
 * (que solo navega), no veía el origen ni el destino reales y los adivinaba:
 * creó Sertecpet → Guarataro cuando el usuario pidió Guarataro → Sertecpet.
 * Ahora `crear_servicio` acepta `servicio_referencia` + `invertir_ruta` y la
 * ruta la copia el servidor, no el modelo.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

/** Acepta el id suelto, un enlace /dashboard/servicios/<id> o «?ticket=<id>». */
export function idDeServicio(valor: unknown): string | undefined {
  if (typeof valor !== 'string') return undefined
  return valor.match(UUID)?.[0]?.toLowerCase()
}

const SELECT = {
  id: true,
  estado: true,
  fecha_solicitud: true,
  fecha_realizacion: true,
  fecha_finalizacion: true,
  origen_especifico: true,
  destino_especifico: true,
  origen_latitud: true,
  origen_longitud: true,
  destino_latitud: true,
  destino_longitud: true,
  proposito_servicio: true,
  observaciones: true,
  numero_planilla: true,
  valor: true,
  clientes: { select: { id: true, nombre: true, nit: true } },
  conductores: { select: { nombre: true, apellido: true, numero_identificacion: true } },
  vehiculos: { select: { placa: true } },
  municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true, nombre_departamento: true } },
  municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true, nombre_departamento: true } },
  recargos_planillas: { where: { deleted_at: null }, select: { numero_planilla: true }, take: 1 },
} as const

export async function cargarServicio(id: string) {
  return prisma.servicio.findFirst({ where: { id, deleted_at: null }, select: SELECT })
}

type ServicioCargado = NonNullable<Awaited<ReturnType<typeof cargarServicio>>>

export interface PuntoRuta {
  municipio: string
  departamento: string
  especifico: string | undefined
  coords: { lat: number; lng: number } | null
}

function punto(s: ServicioCargado, lado: 'origen' | 'destino'): PuntoRuta {
  const m = lado === 'origen' ? s.municipios_servicio_origen_idTomunicipios : s.municipios_servicio_destino_idTomunicipios
  const lat = lado === 'origen' ? s.origen_latitud : s.destino_latitud
  const lng = lado === 'origen' ? s.origen_longitud : s.destino_longitud
  const especifico = (lado === 'origen' ? s.origen_especifico : s.destino_especifico)?.trim()
  return {
    municipio: m.nombre_municipio,
    departamento: m.nombre_departamento,
    especifico: especifico || undefined,
    coords: lat !== null && lng !== null ? { lat, lng } : null,
  }
}

/** Ruta de un servicio, opcionalmente invertida (el destino pasa a ser el origen). */
export function rutaDe(s: ServicioCargado, invertir: boolean) {
  const o = punto(s, 'origen')
  const d = punto(s, 'destino')
  return invertir ? { origen: d, destino: o } : { origen: o, destino: d }
}

export function propositoDe(s: ServicioCargado): 'personal' | 'personal y herramienta' {
  return String(s.proposito_servicio).includes('herramienta') ? 'personal y herramienta' : 'personal'
}

const texto = (p: PuntoRuta) => `${p.especifico ? `${p.especifico} · ` : ''}${p.municipio} (${p.departamento})`

export const detalleServicio: Herramienta = {
  nombre: 'detalle_servicio',
  descripcion:
    'Lee un servicio concreto por su id o su enlace (/dashboard/servicios/<id>): cliente, ruta (municipio, punto exacto y coordenadas de origen y destino), fechas, conductor, placa, propósito, planilla, estado y observaciones. Úsala SIEMPRE que el usuario mencione un servicio por id o enlace, en vez de abrir su ticket. Para crear otro igual o con la ruta invertida no hace falta: pasa servicio_referencia a crear_servicio.',
  parametros: {
    type: 'object',
    properties: {
      servicio: { type: 'string', description: 'Id del servicio o su enlace, tal como lo dio el usuario' },
    },
    required: ['servicio'],
    additionalProperties: false,
  },
  etiqueta: 'Consultando el servicio',
  requiere: 'servicios',
  async ejecutar(args) {
    const id = idDeServicio(args.servicio)
    if (!id) return { error: 'No reconozco ese id de servicio. Pide el enlace del servicio o su id completo.' }
    const s = await cargarServicio(id)
    if (!s) return { error: 'No existe un servicio con ese id (o fue eliminado).' }
    const { origen, destino } = rutaDe(s, false)
    return {
      cliente: s.clientes.nombre,
      ruta: `${texto(origen)} → ${texto(destino)}`,
      origen,
      destino,
      fecha_realizacion: s.fecha_realizacion
        ? s.fecha_realizacion.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'medium', timeStyle: 'short' })
        : null,
      fecha_solicitud: fechaCorta(s.fecha_solicitud),
      fecha_finalizacion: fechaCorta(s.fecha_finalizacion),
      estado: String(s.estado).replace(/_/g, ' '),
      proposito: propositoDe(s),
      conductor: s.conductores ? `${s.conductores.nombre} ${s.conductores.apellido}`.trim() : null,
      placa: s.vehiculos?.placa ?? null,
      planilla: s.numero_planilla || s.recargos_planillas[0]?.numero_planilla || null,
      valor: Number(s.valor) || null,
      observaciones: s.observaciones || null,
      enlace: `/dashboard/servicios/${s.id}`,
    }
  },
}
