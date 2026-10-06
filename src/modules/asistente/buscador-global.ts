import { prisma } from '../../config/prisma'
import type { Herramienta, UsuarioAsistente } from './asistente.types'
import { textoOpcional } from './asistente.utils'
import { detalleServicio } from './servicio-referencia'
import { detalleLiquidacion } from './liquidaciones'
import { detalleAccionCorrectiva } from './acciones-correctivas'
import { detalleRecargo } from './recargos'
import { detalleEnvioFormulario } from './formularios'
import { detalleSarlaft } from './sarlaft'
import { detalleAsistencia } from './asistencias'

/**
 * `search` y `fetch`: el contrato que ChatGPT pide a un conector MCP para
 * usarlo en Deep Research y en «conocimiento de la empresa» (Claude también
 * los puede usar, pero tiene las herramientas específicas).
 *
 *  - `search({ query })` → `{ results: [{ id, title, url }] }`
 *  - `fetch({ id })`     → `{ id, title, text, url, metadata }`
 *
 * El `id` es `tipo:uuid` y `fetch` delega en la herramienta de detalle de ese
 * tipo, así los permisos se comprueban igual que en el resto. Solo van por MCP:
 * en el chat de la app el modelo ya tiene las búsquedas por entidad.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const POR_TIPO = 6

interface Resultado {
  id: string
  title: string
  url: string
}

const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })
const palabras = (q: string) => q.split(/\s+/).filter((p) => p.length > 1)

type Buscador = { modulo: string; buscar: (q: string) => Promise<Resultado[]> }

const BUSCADORES: Buscador[] = [
  {
    modulo: 'conductores',
    buscar: async (q) =>
      (
        await prisma.conductores.findMany({
          where: { deleted_at: null, oculto: false, AND: palabras(q).map((p) => ({ OR: [{ nombre: contiene(p) }, { apellido: contiene(p) }, { numero_identificacion: { contains: p } }] })) },
          select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
          take: POR_TIPO,
        })
      ).map((c) => ({ id: `conductor:${c.id}`, title: `Conductor ${c.nombre} ${c.apellido} (CC ${c.numero_identificacion})`, url: `/dashboard/conductores/${c.id}` })),
  },
  {
    modulo: 'flota',
    buscar: async (q) =>
      (
        await prisma.vehiculos.findMany({
          where: { deleted_at: null, OR: [{ placa: contiene(q.replace(/[\s-]/g, '')) }, { marca: contiene(q) }, { linea: contiene(q) }] },
          select: { id: true, placa: true, marca: true, linea: true },
          take: POR_TIPO,
        })
      ).map((v) => ({ id: `vehiculo:${v.id}`, title: `Vehículo ${v.placa} ${v.marca ?? ''} ${v.linea ?? ''}`.trim(), url: `/dashboard/flota/${v.id}` })),
  },
  {
    modulo: 'clientes',
    buscar: async (q) =>
      (
        await prisma.clientes.findMany({
          where: { deletedAt: null, oculto: false, OR: [{ nombre: contiene(q) }, { nit: contiene(q) }] },
          select: { id: true, nombre: true, nit: true },
          take: POR_TIPO,
        })
      ).map((c) => ({ id: `cliente:${c.id}`, title: `Cliente ${c.nombre} (NIT ${c.nit ?? '—'})`, url: `/dashboard/clientes/${c.id}` })),
  },
  {
    modulo: 'servicios',
    buscar: async (q) =>
      (
        await prisma.servicio.findMany({
          where: {
            deleted_at: null,
            OR: [
              { numero_planilla: contiene(q) },
              { clientes: { nombre: contiene(q) } },
              { origen_especifico: contiene(q) },
              { destino_especifico: contiene(q) },
              { conductores: { OR: [{ nombre: contiene(q) }, { apellido: contiene(q) }] } },
              { vehiculos: { placa: contiene(q.replace(/[\s-]/g, '')) } },
            ],
          },
          select: { id: true, fecha_realizacion: true, clientes: { select: { nombre: true } }, origen_especifico: true, destino_especifico: true },
          orderBy: { fecha_realizacion: 'desc' },
          take: POR_TIPO,
        })
      ).map((s) => ({
        id: `servicio:${s.id}`,
        title: `Servicio ${s.clientes.nombre} · ${s.origen_especifico || '?'} → ${s.destino_especifico || '?'} · ${s.fecha_realizacion?.toISOString().slice(0, 10) ?? ''}`,
        url: `/dashboard/servicios/${s.id}`,
      })),
  },
  {
    modulo: 'liquidaciones-servicios',
    buscar: async (q) =>
      (
        await prisma.liquidacion_servicio.findMany({
          where: { deleted_at: null, confirmada_at: { not: null }, OR: [{ consecutivo: contiene(q) }, { cliente: { nombre: contiene(q) } }, { osi: contiene(q) }, { factura_items: { some: { factura: { numero_factura: contiene(q) } } } }] },
          select: { id: true, consecutivo: true, mes: true, anio: true, estado: true, cliente: { select: { nombre: true } } },
          orderBy: [{ anio: 'desc' }, { mes: 'desc' }],
          take: POR_TIPO,
        })
      ).map((l) => ({ id: `liquidacion:${l.id}`, title: `Liquidación ${l.consecutivo} · ${l.cliente.nombre} · ${l.mes}/${l.anio} · ${l.estado.toLowerCase()}`, url: `/dashboard/liquidaciones-servicios/${l.id}?mode=view` })),
  },
  {
    modulo: 'recargos',
    buscar: async (q) =>
      (
        await prisma.recargos_planillas.findMany({
          where: { deleted_at: null, OR: [{ numero_planilla: contiene(q) }, { conductores: { OR: [{ nombre: contiene(q) }, { apellido: contiene(q) }] } }, { vehiculos: { placa: contiene(q.replace(/[\s-]/g, '')) } }] },
          select: { id: true, numero_planilla: true, mes: true, a_o: true, conductores: { select: { nombre: true, apellido: true } }, vehiculos: { select: { placa: true } } },
          orderBy: { created_at: 'desc' },
          take: POR_TIPO,
        })
      ).map((r) => ({ id: `planilla:${r.id}`, title: `Planilla de recargos ${r.numero_planilla ?? 's/n'} · ${r.conductores.nombre} ${r.conductores.apellido} · ${r.vehiculos.placa} · ${r.mes}/${r.a_o}`, url: '/dashboard/recargos' })),
  },
  {
    modulo: 'acciones-correctivas',
    buscar: async (q) =>
      (
        await prisma.acciones_correctivas_preventivas.findMany({
          where: { deleted_at: null, OR: [{ accion_numero: contiene(q) }, { descripcion_hallazgo: contiene(q) }, { proceso_origen_hallazgo: contiene(q) }] },
          select: { id: true, accion_numero: true, descripcion_hallazgo: true },
          orderBy: { created_at: 'desc' },
          take: POR_TIPO,
        })
      ).map((a) => ({ id: `accion:${a.id}`, title: `Acción correctiva ${a.accion_numero} · ${(a.descripcion_hallazgo ?? '').slice(0, 90)}`, url: `/dashboard/acciones-correctivas/${a.id}` })),
  },
  {
    modulo: 'sarlaft',
    buscar: async (q) =>
      (
        await prisma.formulario_sarlaft_ptee.findMany({
          where: { OR: [{ radicado: contiene(q) }, { nombre_completo: contiene(q) }, { numero_documento: contiene(q) }] },
          select: { id: true, radicado: true, nombre_completo: true, tipo_formulario: true },
          orderBy: { fecha_envio: 'desc' },
          take: POR_TIPO,
        })
      ).map((f) => ({ id: `sarlaft:${f.id}`, title: `SARLAFT ${f.radicado} · ${f.nombre_completo} · ${f.tipo_formulario.replace(/_/g, ' ')}`, url: `/dashboard/sarlaft/${f.id}` })),
  },
  {
    modulo: 'asistencias',
    buscar: async (q) =>
      (
        await prisma.formularios_asistencia.findMany({
          where: { deleted_at: null, OR: [{ tematica: contiene(q) }, { nombre_instructor: contiene(q) }, { lugar_sede: contiene(q) }] },
          select: { id: true, tematica: true, fecha: true },
          orderBy: { fecha: 'desc' },
          take: POR_TIPO,
        })
      ).map((a) => ({ id: `asistencia:${a.id}`, title: `Asistencia «${a.tematica}» · ${a.fecha.toISOString().slice(0, 10)}`, url: `/dashboard/asistencias/${a.id}/respuestas` })),
  },
  {
    modulo: 'formularios',
    buscar: async (q) =>
      (
        await prisma.form_submission.findMany({
          where: {
            deleted_at: null,
            status: 'SUBMITTED',
            OR: [{ conductor: { OR: [{ nombre: contiene(q) }, { apellido: contiene(q) }] } }, { vehiculo: { placa: contiene(q.replace(/[\s-]/g, '')) } }, { version: { form: { name: contiene(q) } } }],
          },
          select: { id: true, business_date: true, version: { select: { form: { select: { code: true, name: true } } } }, conductor: { select: { nombre: true, apellido: true } }, vehiculo: { select: { placa: true } } },
          orderBy: { business_date: 'desc' },
          take: POR_TIPO,
        })
      ).map((s) => ({
        id: `envio:${s.id}`,
        title: `Formulario ${s.version.form.code} ${s.version.form.name} · ${s.conductor ? `${s.conductor.nombre} ${s.conductor.apellido}` : ''} ${s.vehiculo?.placa ?? ''} · ${s.business_date.toISOString().slice(0, 10)}`,
        url: `/dashboard/formularios/envios/${s.id}`,
      })),
  },
]

export const search: Herramienta = {
  nombre: 'search',
  descripcion:
    'Búsqueda general en la plataforma: conductores, vehículos, clientes, servicios, liquidaciones, facturas, planillas de recargos, acciones correctivas, formularios SARLAFT, asistencias y envíos de formularios. Devuelve resultados con id, título y enlace; para el contenido completo de uno, llama a fetch con su id. Prefiere las herramientas específicas (buscar_*) cuando sepas qué tipo de dato buscas.',
  parametros: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Texto a buscar: nombre, placa, NIT, consecutivo, radicado, número…' } },
    required: ['query'],
    additionalProperties: false,
  },
  etiqueta: 'Buscando en toda la plataforma',
  requiere: null,
  canales: ['mcp'],
  salidaMaxima: { lista: 60 },
  async ejecutar(args, usuario) {
    const q = textoOpcional(args.query, 120)
    if (!q) return { results: [] }
    const permitidos = BUSCADORES.filter((b) => usuario.modulos.has(b.modulo))
    const grupos = await Promise.all(permitidos.map((b) => b.buscar(q).catch(() => [] as Resultado[])))
    return { results: grupos.flat() }
  },
}

/** Qué herramienta de detalle responde por cada tipo de id. */
const DETALLE: Record<string, { herramienta: Herramienta; arg: string }> = {
  servicio: { herramienta: detalleServicio, arg: 'servicio' },
  liquidacion: { herramienta: detalleLiquidacion, arg: 'liquidacion' },
  accion: { herramienta: detalleAccionCorrectiva, arg: 'accion' },
  planilla: { herramienta: detalleRecargo, arg: 'planilla' },
  envio: { herramienta: detalleEnvioFormulario, arg: 'envio' },
  sarlaft: { herramienta: detalleSarlaft, arg: 'formulario' },
  asistencia: { herramienta: detalleAsistencia, arg: 'asistencia' },
}

async function fichaSimple(tipo: string, id: string, usuario: UsuarioAsistente): Promise<Record<string, unknown> | null> {
  if (tipo === 'conductor' && usuario.modulos.has('conductores')) {
    const c = await prisma.conductores.findFirst({
      where: { id, deleted_at: null },
      select: { nombre: true, apellido: true, numero_identificacion: true, telefono: true, email: true, cargo: true, estado: true, sede_trabajo: true, categoria_licencia: true, vencimiento_licencia: true, fecha_ingreso: true },
    })
    return c ? { ...c, title: `Conductor ${c.nombre} ${c.apellido}`, url: `/dashboard/conductores/${id}` } : null
  }
  if (tipo === 'vehiculo' && usuario.modulos.has('flota')) {
    const v = await prisma.vehiculos.findFirst({
      where: { id, deleted_at: null },
      select: { placa: true, marca: true, linea: true, color: true, clase_vehiculo: true, combustible: true, kilometraje: true, fecha_matricula: true, estado: true, propietario_nombre: true, propietario_identificacion: true },
    })
    return v ? { ...v, title: `Vehículo ${v.placa}`, url: `/dashboard/flota/${id}` } : null
  }
  if (tipo === 'cliente' && usuario.modulos.has('clientes')) {
    const c = await prisma.clientes.findFirst({ where: { id, deletedAt: null }, select: { nombre: true, nit: true, representante: true, telefono: true, direccion: true, correo: true } })
    return c ? { ...c, title: `Cliente ${c.nombre}`, url: `/dashboard/clientes/${id}` } : null
  }
  return null
}

export const fetch: Herramienta = {
  nombre: 'fetch',
  descripcion: 'Trae el contenido completo de un resultado de search por su id (tipo:uuid): la ficha, el detalle o las respuestas según el tipo.',
  parametros: {
    type: 'object',
    properties: { id: { type: 'string', description: 'Id devuelto por search, con el formato tipo:uuid' } },
    required: ['id'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo el resultado',
  requiere: null,
  canales: ['mcp'],
  salidaMaxima: { lista: 200, caracteres: 45000 },
  async ejecutar(args, usuario, contexto) {
    const texto = textoOpcional(args.id, 200) ?? ''
    const [tipo, resto] = texto.includes(':') ? [texto.slice(0, texto.indexOf(':')).toLowerCase(), texto.slice(texto.indexOf(':') + 1)] : ['', texto]
    const uuid = resto.match(UUID)?.[0]?.toLowerCase()
    if (!uuid) return { error: 'El id debe tener el formato tipo:uuid, tal como lo devuelve search' }

    const simple = await fichaSimple(tipo, uuid, usuario)
    if (simple) {
      const { title, url, ...datos } = simple
      return { id: texto, title, url, text: JSON.stringify(datos), metadata: { tipo } }
    }
    const d = DETALLE[tipo]
    if (!d) return { error: `Tipo de resultado desconocido «${tipo}»` }
    if (!d.herramienta.requiere || !usuario.modulos.has(d.herramienta.requiere)) return { error: 'El usuario no tiene acceso a este tipo de dato' }
    const salida = (await d.herramienta.ejecutar({ [d.arg]: uuid }, usuario, contexto)) as Record<string, unknown>
    if (salida && 'error' in salida) return salida
    const { enlace, ...datos } = salida
    return { id: texto, title: tituloDe(tipo, datos), url: typeof enlace === 'string' ? enlace : undefined, text: JSON.stringify(datos), metadata: { tipo } }
  },
}

function tituloDe(tipo: string, d: Record<string, unknown>): string {
  switch (tipo) {
    case 'servicio':
      return `Servicio ${String(d.cliente ?? '')} · ${String(d.ruta ?? '')}`
    case 'liquidacion':
      return `Liquidación ${String(d.consecutivo ?? '')} · ${String(d.cliente ?? '')}`
    case 'accion':
      return `Acción correctiva ${String(d.accion_numero ?? '')}`
    case 'planilla':
      return `Planilla de recargos ${String(d.planilla ?? '')} · ${String(d.conductor ?? '')}`
    case 'envio':
      return `${String(d.formulario ?? 'Formulario')} · ${String(d.quien ?? '')} · ${String(d.fecha ?? '')}`
    case 'sarlaft':
      return `SARLAFT ${String(d.radicado ?? '')} · ${String(d.nombre ?? '')}`
    case 'asistencia':
      return `Asistencia «${String(d.tematica ?? '')}» · ${String(d.fecha ?? '')}`
    default:
      return tipo
  }
}

export const HERRAMIENTAS_BUSCADOR: readonly Herramienta[] = [search, fetch]
