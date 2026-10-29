import { Prisma } from '@prisma/client'
import { getAccessibleModules, normalizarRutasOverride, type AccessLevel, type Area } from '../../config/permissions'

export interface UsuarioPermisosNotificacion {
  id: string
  area: unknown
  permisos_rutas: unknown
}

export interface NotificacionConReferencia {
  tipo: string
  referencia_tipo?: string | null
}

const TIPOS_LIQUIDACIONES = [
  'LIQUIDACION_ANULADA',
  'LIQUIDACION_PENDIENTE',
  'LIQUIDACION_CREADA',
  'LIQUIDACION_ACTUALIZADA',
  'LIQUIDACION_FACTURADA',
  'FACTURA_ANULADA',
]

const TIPOS_ACCIONES = [
  'ACTIVIDAD_PESV_ASIGNADA',
  'ACTIVIDAD_PESV_ACTUALIZADA',
  'ACTIVIDAD_PESV_VENCIDA',
  'ACCION_CORRECTIVA_RECORDATORIO',
  'ACCION_CORRECTIVA_VENCIDA',
]

const FILTROS_POR_MODULO: Record<string, Prisma.notificacionWhereInput[]> = {
  servicios: [{ referencia_tipo: 'servicio' }],
  extractos: [{ referencia_tipo: 'extracto' }],
  nomina: [{ referencia_tipo: { startsWith: 'nomina_desprendible' } }],
  formularios: [{ referencia_tipo: 'preoperacional' }],
  mantenimiento: [
    { referencia_tipo: 'preop_malo' },
    { referencia_tipo: { startsWith: 'mant:' } },
  ],
  recorridos: [{ referencia_tipo: { startsWith: 'dias_laborados:' } }],
  viaticos: [{ referencia_tipo: { startsWith: 'viatico_' } }],
  solicitudes: [{ referencia_tipo: 'solicitud_web' }],
  'acciones-correctivas': [
    { referencia_tipo: 'ACCION_CORRECTIVA' },
    { tipo: { in: TIPOS_ACCIONES as any } },
  ],
  incidentes: [{ referencia_tipo: { in: ['incidente', 'incidente_investigacion_pendiente'] } }],
  flota: [{ referencia_tipo: { startsWith: 'docveh:' } }],
  conductores: [{ referencia_tipo: { startsWith: 'doccond:' } }],
  'liquidaciones-servicios': [
    { referencia_tipo: { startsWith: 'factura:' } },
    { tipo: { in: TIPOS_LIQUIDACIONES as any } },
  ],
  'liquidaciones-servicios-seccion06': [{ referencia_tipo: 'liquidaciones-servicios-seccion06' }],
  'liquidaciones-terceros': [{ referencia_tipo: { startsWith: 'liquidaciones-terceros' } }],
}

function normalizarAreas(usuario: UsuarioPermisosNotificacion): Area[] {
  if (Array.isArray(usuario.area)) return usuario.area.filter((area): area is Area => typeof area === 'string')
  return typeof usuario.area === 'string' ? [usuario.area as Area] : []
}

/** Resuelve una notificación al permiso de ruta que protege su destino. */
export function moduloDeNotificacion(notificacion: NotificacionConReferencia): string | null {
  const referencia = notificacion.referencia_tipo ?? ''
  if (referencia === 'servicio') return 'servicios'
  if (referencia === 'extracto') return 'extractos'
  if (referencia.startsWith('nomina_desprendible')) return 'nomina'
  if (referencia === 'preoperacional') return 'formularios'
  if (referencia === 'preop_malo' || referencia.startsWith('mant:')) return 'mantenimiento'
  if (referencia.startsWith('dias_laborados:')) return 'recorridos'
  if (referencia.startsWith('viatico_')) return 'viaticos'
  if (referencia === 'solicitud_web') return 'solicitudes'
  if (referencia === 'ACCION_CORRECTIVA' || TIPOS_ACCIONES.includes(notificacion.tipo)) return 'acciones-correctivas'
  if (referencia === 'incidente' || referencia === 'incidente_investigacion_pendiente') return 'incidentes'
  if (referencia.startsWith('docveh:')) return 'flota'
  if (referencia.startsWith('doccond:')) return 'conductores'
  if (referencia === 'liquidaciones-servicios-seccion06') return 'liquidaciones-servicios-seccion06'
  if (referencia.startsWith('liquidaciones-terceros')) return 'liquidaciones-terceros'
  if (referencia.startsWith('factura:') || TIPOS_LIQUIDACIONES.includes(notificacion.tipo)) return 'liquidaciones-servicios'
  return null
}

function nivelPermisoRecibe(nivel: AccessLevel | undefined): boolean {
  return nivel === 'full' || nivel === 'limited'
}

/** Comprueba el nivel efectivo del módulo sin aceptar solo consulta. */
export function puedeOperarModuloParaAvisos(usuario: UsuarioPermisosNotificacion, modulo: string): boolean {
  const areas = normalizarAreas(usuario)
  const modulos = getAccessibleModules(areas, normalizarRutasOverride(usuario.permisos_rutas), usuario.id)
  return nivelPermisoRecibe(modulos[modulo])
}

/** `read` permite abrir una pantalla, pero no recibir avisos de cambios en ella. */
export function puedeRecibirNotificacion(
  usuario: UsuarioPermisosNotificacion,
  notificacion: NotificacionConReferencia,
): boolean {
  const modulo = moduloDeNotificacion(notificacion)
  if (!modulo) return false

  const areas = normalizarAreas(usuario)
  if (modulo === 'nomina' && !areas.some((area) => area === 'administracion' || area === 'talento_humano')) return false
  return puedeOperarModuloParaAvisos(usuario, modulo)
}

/** Construye el filtro SQL para listar y contar solo avisos cuyo módulo se puede operar. */
export function filtroNotificacionesPermitidas(
  modulos: Record<string, AccessLevel>,
): Prisma.notificacionWhereInput {
  const filtros = Object.entries(modulos)
    .filter(([, nivel]) => nivelPermisoRecibe(nivel))
    .flatMap(([modulo]) => FILTROS_POR_MODULO[modulo] ?? [])

  // Un filtro vacío no debe volverse «sin filtro»: eso expondría avisos antiguos.
  return filtros.length ? { OR: filtros } : { referencia_tipo: '__sin_permiso__' }
}
