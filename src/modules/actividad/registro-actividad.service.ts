/**
 * Registro de actividad: «qué hizo quién», para el panel de inicio y la
 * página de actividad reciente.
 *
 * No hay que instrumentar cada módulo: un hook `onSend` mira cada
 * POST/PUT/PATCH/DELETE que terminó bien y escribe una fila en
 * `registro_actividad` con una frase legible («creó el servicio …»). La
 * escritura no se espera: si falla, la petición del usuario ya respondió y
 * solo queda un aviso en el log.
 *
 * Lo que NO se registra (ver `EXCLUIR_*`): sesión y recuperación de
 * contraseña, el portal público del conductor, lecturas disfrazadas de POST
 * (búsquedas, informes, firmas de S3), autoguardados y trabajos en segundo
 * plano. Son ruido: nadie quiere ver «guardó un borrador» cuarenta veces.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'

const METODOS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const EXCLUIR_PREFIJOS = [
  '/api/auth',
  '/api/public',
  '/api/conductor-portal',
  '/api/mcp',
  '/api/asistente',
  '/api/notificaciones',
  '/api/api-tokens',
  '/api/app-usuarios/canjear',
  '/api/app-usuarios/dispositivos-push',
  '/api/usuario-push',
  '/api/pdf',
  '/api/desprendible',
  '/api/invitaciones/aceptar',
  '/api/mis-formularios/drafts',
  '/api/mis-formularios/attachments',
  '/api/liquidaciones-servicios/autoguardado',
  '/api/liquidaciones-servicios/draft',
  '/api/formularios/campana-portal/test',
  '/api/facturacion-liquidaciones/batch-info',
  '/api/contabilidad/conciliacion-terceros',
  '/api/viaticos/comprobantes',
  '/api/dias-laborados/solicitar-acceso',
  '/api/recorridos-snapshots/cron-hora',
  '/api/liquidaciones-terceros-snapshots/cron-hora',
  '/api/actividad',
]

/// Fragmentos del PATRÓN de la ruta que delatan trabajos, exportaciones o chat.
const EXCLUIR_FRAGMENTOS = ['/job/', '-job/', '/exportar', '/export', '/chat/', '/presign', '/lookup', '/validate', '/cron-hora']

/** Primer segmento de la ruta → módulo del panel (clave de ROUTE_PERMISSIONS). */
const PREFIJO_MODULO: Record<string, string> = {
  servicios: 'servicios',
  'custom-places': 'servicios',
  recargos: 'recargos',
  conductores: 'conductores',
  vehiculos: 'flota',
  documentos: 'flota',
  'documentos-compartidos': 'flota',
  clientes: 'clientes',
  terceros: 'terceros',
  usuarios: 'usuarios',
  invitaciones: 'usuarios',
  sesiones: 'sesiones',
  asistencias: 'asistencias',
  evaluaciones: 'evaluaciones',
  inducciones: 'evaluaciones',
  formularios: 'formularios',
  'form-field-templates': 'formularios',
  'mis-formularios': 'mis-formularios',
  'liquidaciones-servicios': 'liquidaciones-servicios',
  'facturacion-liquidaciones': 'liquidaciones-servicios',
  operadoras: 'liquidaciones-servicios',
  'liquidaciones-terceros': 'liquidaciones-terceros',
  'liquidaciones-terceros-snapshots': 'liquidaciones-terceros',
  'configuracion-descuentos-tercero': 'liquidaciones-terceros',
  nomina: 'nomina',
  liquidaciones: 'nomina',
  primas: 'nomina',
  extractos: 'extractos',
  'dias-laborados': 'recorridos',
  recorridos: 'recorridos',
  'recorridos-snapshots': 'recorridos',
  viaticos: 'viaticos',
  'salidas-nc': 'salidas-nc',
  'acciones-correctivas': 'acciones-correctivas',
  sarlaft: 'sarlaft',
  'formularios-sarlaft': 'sarlaft',
  'certificados-tributarios': 'certificados',
  contabilidad: 'contabilidad',
  'app-usuarios': 'perfil',
  dashboard: 'conductores',
}

/** Cómo se nombra el recurso de cada módulo en una frase. */
const RECURSO: Record<string, string> = {
  servicios: 'el servicio',
  recargos: 'la planilla de recargos',
  conductores: 'el conductor',
  flota: 'el vehículo',
  clientes: 'el cliente',
  terceros: 'el tercero',
  usuarios: 'el usuario',
  sesiones: 'la sesión',
  asistencias: 'el formulario de asistencia',
  evaluaciones: 'la evaluación',
  formularios: 'el formulario',
  'mis-formularios': 'un formulario',
  'liquidaciones-servicios': 'la liquidación de servicios',
  'liquidaciones-terceros': 'la liquidación de terceros',
  nomina: 'la liquidación de nómina',
  extractos: 'el extracto',
  recorridos: 'los recorridos',
  viaticos: 'los viáticos',
  'salidas-nc': 'la salida no conforme',
  'acciones-correctivas': 'la acción correctiva',
  sarlaft: 'el formulario SARLAFT',
  certificados: 'los certificados tributarios',
  contabilidad: 'contabilidad',
  perfil: 'su acceso a la app',
  otros: 'un registro',
}

export type AccionActividad = 'crear' | 'editar' | 'eliminar' | 'restaurar' | 'estado' | 'otro'

/**
 * Frases a medida para las rutas cuyo nombre genérico engaña («creó la
 * liquidación de nómina» cuando en realidad generó borradores en lote).
 * `{ref}` se sustituye por el consecutivo, placa o nombre si se conoce.
 */
const FRASES: Array<{ patron: RegExp; metodo?: string; accion: AccionActividad; frase: string }> = [
  { patron: /^\/api\/facturacion-liquidaciones$/, metodo: 'POST', accion: 'crear', frase: 'registró la factura {ref}' },
  { patron: /^\/api\/facturacion-liquidaciones\/:id\/anular$/, accion: 'estado', frase: 'anuló la factura {ref}' },
  { patron: /^\/api\/facturacion-liquidaciones\/:id\/items$/, accion: 'editar', frase: 'agregó liquidaciones a la factura {ref}' },
  { patron: /^\/api\/servicios\/:id\/compartir$/, accion: 'otro', frase: 'compartió el servicio {ref}' },
  { patron: /^\/api\/servicios\/:id\/planilla$/, accion: 'editar', frase: 'asignó planilla al servicio {ref}' },
  { patron: /^\/api\/servicios\/:id\/cancelar$/, accion: 'estado', frase: 'canceló el servicio {ref}' },
  { patron: /^\/api\/recargos\/:id\/liquidar$/, accion: 'estado', frase: 'liquidó la planilla de recargos {ref}' },
  { patron: /^\/api\/recargos\/:id\/duplicar$/, accion: 'crear', frase: 'duplicó la planilla de recargos {ref}' },
  { patron: /^\/api\/recargos\/:id\/recalcular$/, accion: 'otro', frase: 'recalculó la planilla de recargos {ref}' },
  { patron: /^\/api\/recargos\/recalcular-bulk$/, accion: 'otro', frase: 'recalculó planillas de recargos en lote' },
  { patron: /^\/api\/recargos\/planilla\/upload$/, accion: 'editar', frase: 'subió el archivo de una planilla' },
  { patron: /^\/api\/recargos\/cambiar-estado-multiple$/, accion: 'estado', frase: 'cambió el estado de varias planillas' },
  { patron: /^\/api\/recargos\/eliminar-multiple$/, accion: 'eliminar', frase: 'eliminó varias planillas de recargos' },
  { patron: /^\/api\/recargos\/restaurar-multiple$/, accion: 'restaurar', frase: 'restauró varias planillas de recargos' },
  { patron: /^\/api\/recargos\/configuraciones-salarios/, accion: 'editar', frase: 'cambió la configuración de salarios' },
  { patron: /^\/api\/nomina\/borradores\/generar$/, accion: 'crear', frase: 'generó borradores de nómina' },
  { patron: /^\/api\/nomina\/envios\/lote$/, accion: 'otro', frase: 'envió desprendibles de nómina' },
  { patron: /^\/api\/nomina\/estado-lote$/, accion: 'estado', frase: 'cambió el estado de liquidaciones de nómina' },
  { patron: /^\/api\/nomina\/liquidaciones\/:id\/estado$/, accion: 'estado', frase: 'cambió el estado de la liquidación de nómina {ref}' },
  { patron: /^\/api\/nomina\/snapshots/, accion: 'otro', frase: 'guardó una versión del canvas de nómina' },
  { patron: /^\/api\/nomina\/notificaciones$/, accion: 'otro', frase: 'envió notificaciones de nómina' },
  { patron: /^\/api\/liquidaciones-terceros\/generar-borrador/, accion: 'crear', frase: 'generó borradores de liquidaciones de terceros' },
  { patron: /^\/api\/liquidaciones-terceros\/guardar-borrador/, accion: 'editar', frase: 'guardó liquidaciones de terceros' },
  { patron: /^\/api\/liquidaciones-terceros\/estado-lote$/, accion: 'estado', frase: 'cambió el estado de liquidaciones de terceros' },
  { patron: /^\/api\/liquidaciones-terceros\/:id\/estado$/, accion: 'estado', frase: 'cambió el estado de la liquidación de terceros {ref}' },
  { patron: /^\/api\/liquidaciones-terceros\/items\/:pivoteId\/trasladar$/, accion: 'editar', frase: 'trasladó un ítem de una liquidación de terceros' },
  { patron: /^\/api\/liquidaciones-terceros\/items\/:pivoteId\/revertir-traslado$/, accion: 'editar', frase: 'revirtió el traslado de un ítem de terceros' },
  { patron: /^\/api\/liquidaciones-terceros\/migrar$/, accion: 'otro', frase: 'migró liquidaciones de terceros' },
  { patron: /^\/api\/liquidaciones-terceros\/config-gastos$/, accion: 'editar', frase: 'cambió la configuración de gastos de terceros' },
  { patron: /^\/api\/configuracion-descuentos-tercero$/, accion: 'editar', frase: 'cambió la configuración de descuentos de terceros' },
  { patron: /^\/api\/liquidaciones-servicios\/:id\/estado$/, accion: 'estado', frase: 'cambió el estado de la liquidación de servicios {ref}' },
  { patron: /^\/api\/liquidaciones-servicios\/config-liquidador$/, accion: 'editar', frase: 'cambió la configuración del liquidador' },
  { patron: /^\/api\/liquidaciones-servicios\/tarifas/, accion: 'editar', frase: 'cambió tarifas de liquidación' },
  { patron: /^\/api\/recorridos\/canvas\/filas$/, accion: 'editar', frase: 'editó el canvas de recorridos' },
  { patron: /^\/api\/recorridos\/snapshots$/, accion: 'otro', frase: 'guardó una versión del canvas de recorridos' },
  { patron: /^\/api\/dias-laborados\/registros/, accion: 'crear', frase: 'registró días laborados' },
  { patron: /^\/api\/dias-laborados\/admin\/registros-masivos$/, accion: 'crear', frase: 'registró días laborados en lote' },
  { patron: /^\/api\/dias-laborados\/admin\//, accion: 'editar', frase: 'corrigió días laborados' },
  { patron: /^\/api\/dias-laborados\/bonos/, accion: 'editar', frase: 'cambió bonos de recorridos' },
  { patron: /^\/api\/formularios\/asignaciones$/, metodo: 'POST', accion: 'crear', frase: 'asignó un formulario' },
  { patron: /^\/api\/formularios\/asignaciones\/:id$/, accion: 'editar', frase: 'cambió una asignación de formulario' },
  { patron: /^\/api\/formularios\/:formId\/versions\/:versionId\/publish$/, accion: 'estado', frase: 'publicó una versión del formulario' },
  { patron: /^\/api\/formularios\/:formId\/versions\/:versionId\/archive$/, accion: 'estado', frase: 'archivó una versión del formulario' },
  { patron: /^\/api\/formularios\/:formId\/versions\/:versionId\/clone$/, accion: 'crear', frase: 'clonó una versión del formulario' },
  { patron: /^\/api\/formularios\/:formId\/duplicate$/, accion: 'crear', frase: 'duplicó un formulario' },
  { patron: /^\/api\/formularios\/campana-portal\/enviar$/, accion: 'otro', frase: 'envió una campaña de formularios al portal' },
  { patron: /^\/api\/formularios\/submissions\/:id\/void$/, accion: 'estado', frase: 'anuló un envío de formulario' },
  { patron: /^\/api\/formularios\/submissions\/:id\/restore$/, accion: 'restaurar', frase: 'restauró un envío de formulario' },
  { patron: /^\/api\/mis-formularios\/submissions$/, accion: 'crear', frase: 'diligenció un formulario' },
  { patron: /^\/api\/asistencias\/formularios\/estado$/, accion: 'estado', frase: 'cambió el estado de formularios de asistencia' },
  { patron: /^\/api\/asistencias\/respuestas$/, metodo: 'DELETE', accion: 'eliminar', frase: 'eliminó firmas de un formulario de asistencia' },
  { patron: /^\/api\/evaluaciones\/:id\/responder$/, accion: 'crear', frase: 'respondió la evaluación {ref}' },
  { patron: /^\/api\/usuarios\/:id\/permisos$/, accion: 'editar', frase: 'cambió los permisos del usuario {ref}' },
  { patron: /^\/api\/usuarios\/:id\/activo$/, accion: 'estado', frase: 'cambió la activación del usuario {ref}' },
  { patron: /^\/api\/usuarios\/permisos\/bonos-planilla$/, accion: 'editar', frase: 'cambió permisos de bonos de planilla' },
  { patron: /^\/api\/usuarios\/:id\/firma$/, accion: 'editar', frase: 'cambió la firma del usuario {ref}' },
  { patron: /^\/api\/invitaciones$/, accion: 'crear', frase: 'invitó a alguien al equipo' },
  { patron: /^\/api\/sesiones\/usuario\/:usuarioId$/, accion: 'eliminar', frase: 'cerró todas las sesiones de un usuario' },
  { patron: /^\/api\/viaticos\/anticipos$/, metodo: 'POST', accion: 'crear', frase: 'registró un anticipo de viáticos' },
  { patron: /^\/api\/viaticos\/fondo\/recargas$/, accion: 'crear', frase: 'recargó el fondo de viáticos' },
  { patron: /^\/api\/viaticos\/fondo\/ajustes$/, accion: 'crear', frase: 'ajustó el fondo de viáticos' },
  { patron: /^\/api\/viaticos\/gastos\/:id\/anular$/, accion: 'estado', frase: 'anuló un gasto de viáticos' },
  { patron: /^\/api\/viaticos\/solicitudes\/:id\/rechazar$/, accion: 'estado', frase: 'rechazó una solicitud de viáticos' },
  { patron: /^\/api\/viaticos\/gastos-empresa/, accion: 'crear', frase: 'registró un gasto de la empresa' },
  { patron: /^\/api\/viaticos\/vehiculos\/:id\/tercero$/, accion: 'editar', frase: 'asoció un tercero a un vehículo para viáticos' },
  { patron: /^\/api\/clientes\/masivo$/, accion: 'crear', frase: 'importó clientes' },
  { patron: /^\/api\/conductores\/masivo$/, accion: 'crear', frase: 'importó conductores' },
  { patron: /^\/api\/vehiculos\/masivo$/, accion: 'crear', frase: 'importó vehículos' },
  { patron: /^\/api\/terceros\/importar-vehiculos$/, accion: 'crear', frase: 'importó vehículos de terceros' },
  { patron: /^\/api\/conductores\/:id\/foto$/, accion: 'editar', frase: 'cambió la foto del conductor {ref}' },
  { patron: /^\/api\/certificados-tributarios\//, accion: 'crear', frase: 'cargó certificados tributarios' },
  { patron: /^\/api\/extractos\/sync$/, accion: 'otro', frase: 'sincronizó extractos' },
  { patron: /^\/api\/extractos\/all$/, accion: 'eliminar', frase: 'eliminó todos los extractos' },
  { patron: /^\/api\/dashboard\/talento-humano\/seguridad-social$/, metodo: 'PUT', accion: 'editar', frase: 'cambió la seguridad social por defecto de la empresa' },
  { patron: /^\/api\/dashboard\/talento-humano\/seguridad-social\/aplicar$/, accion: 'editar', frase: 'completó la seguridad social de los conductores vinculados' },
  { patron: /^\/api\/app-usuarios\/enlace$/, metodo: 'POST', accion: 'crear', frase: 'generó su enlace de la app móvil' },
  { patron: /^\/api\/app-usuarios\/enlace$/, metodo: 'DELETE', accion: 'eliminar', frase: 'revocó su enlace de la app móvil' },
]

const REF_CLAVES = ['consecutivo', 'numero_factura', 'placa', 'numero_planilla', 'tematica', 'nombre_completo', 'nombre', 'titulo', 'title', 'codigo', 'code']

interface ContextoRegistro {
  patron: string
  metodo: string
  params: Record<string, unknown>
  body: unknown
  payload: unknown
}

function moduloDe(patron: string): string {
  const seg = patron.replace(/^\/api\//, '').split('/')[0] ?? ''
  return PREFIJO_MODULO[seg] ?? 'otros'
}

function accionGenerica(metodo: string, patron: string): AccionActividad {
  if (metodo === 'DELETE') return 'eliminar'
  if (/\/(restore|restaurar)(\/|$)/.test(patron)) return 'restaurar'
  if (/\/(estado|cambiar-estado|anular|cancelar|ocultar|activo)(\/|$)/.test(patron)) return 'estado'
  if (metodo === 'POST') return 'crear'
  return 'editar'
}

function primeroDe(obj: unknown, claves: string[]): string | null {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null
  const o = obj as Record<string, unknown>
  // nombre + apellido (conductores): juntos leen mejor que «nombre» a secas
  if (typeof o.nombre === 'string' && typeof o.apellido === 'string') return `${o.nombre} ${o.apellido}`.trim()
  for (const k of claves) {
    const v = o[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return null
}

/** Qué identifica al recurso para una persona: primero la respuesta, luego el body, luego el id. */
function referencia(ctx: ContextoRegistro): { id: string | null; ref: string | null } {
  const datos = (ctx.payload as any)?.data ?? ctx.payload
  const ref = primeroDe(datos, REF_CLAVES) ?? primeroDe(ctx.body, REF_CLAVES)
  const idParam = ctx.params.id ?? ctx.params.formId ?? ctx.params.liquidacion_id ?? ctx.params.consecutivo
  const id = typeof idParam === 'string' ? idParam : typeof (datos as any)?.id === 'string' ? (datos as any).id : null
  return { id, ref: ref && ref.length <= 255 ? ref : null }
}

function describir(ctx: ContextoRegistro): { modulo: string; accion: AccionActividad; descripcion: string; id: string | null; ref: string | null; detalle: Record<string, unknown> | null } {
  const modulo = moduloDe(ctx.patron)
  const { id, ref } = referencia(ctx)
  const detalle: Record<string, unknown> = {}
  const estado = (ctx.body as any)?.estado ?? (ctx.body as any)?.nuevo_estado
  if (typeof estado === 'string') detalle.estado = estado
  const cantidad = Array.isArray((ctx.body as any)?.ids) ? (ctx.body as any).ids.length : null
  if (cantidad) detalle.cantidad = cantidad

  const etiquetaRef = ref ?? (id ? `#${id.slice(0, 8)}` : '')
  const especial = FRASES.find((f) => f.patron.test(ctx.patron) && (!f.metodo || f.metodo === ctx.metodo))
  if (especial) {
    let frase = especial.frase.replace('{ref}', etiquetaRef).replace(/\s+/g, ' ').trim()
    if (especial.accion === 'estado' && detalle.estado) frase += ` a «${String(detalle.estado).toLowerCase()}»`
    if (detalle.cantidad) frase += ` (${detalle.cantidad})`
    return { modulo, accion: especial.accion, descripcion: frase, id, ref, detalle: Object.keys(detalle).length ? detalle : null }
  }

  const accion = accionGenerica(ctx.metodo, ctx.patron)
  const recurso = RECURSO[modulo] ?? RECURSO.otros
  const VERBO: Record<AccionActividad, string> = {
    crear: 'creó',
    editar: 'editó',
    eliminar: 'eliminó',
    restaurar: 'restauró',
    estado: 'cambió el estado de',
    otro: 'modificó',
  }
  let frase = `${VERBO[accion]} ${recurso} ${etiquetaRef}`.replace(/\s+/g, ' ').trim()
  if (accion === 'estado' && detalle.estado) frase += ` a «${String(detalle.estado).toLowerCase()}»`
  return { modulo, accion, descripcion: frase, id, ref, detalle: Object.keys(detalle).length ? detalle : null }
}

function parsearPayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return null
  if (payload.length > 64 * 1024) return null
  const t = payload.trimStart()
  if (!t.startsWith('{')) return null
  try {
    return JSON.parse(t)
  } catch {
    return null
  }
}

function excluida(patron: string, url: string): boolean {
  if (!url.startsWith('/api/')) return true
  if (EXCLUIR_PREFIJOS.some((p) => url.startsWith(p) || patron.startsWith(p))) return true
  return EXCLUIR_FRAGMENTOS.some((f) => patron.includes(f))
}

/**
 * Instala el hook. Va en `app.ts` después de los middlewares de autenticación
 * (el hook lee `request.user`, que ponen ellos).
 */
export function instalarRegistroActividad(app: FastifyInstance) {
  app.addHook('onSend', async (request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
    try {
      const metodo = request.method
      if (!METODOS.has(metodo) || reply.statusCode >= 400) return payload
      const user = (request as any).user
      if (!user?.id && !user?.sub) return payload
      const patron = (request as any).routeOptions?.url ?? (request as any).routerPath ?? request.url.split('?')[0]
      const url = request.url.split('?')[0]
      if (excluida(patron, url)) return payload

      const ctx: ContextoRegistro = {
        patron,
        metodo,
        params: (request.params as Record<string, unknown>) ?? {},
        body: request.body,
        payload: parsearPayload(payload),
      }
      const d = describir(ctx)
      const areas: string[] = Array.isArray(user.area) ? user.area : user.area ? [user.area] : []
      void prisma.registro_actividad
        .create({
          data: {
            usuario_id: user.id ?? user.sub,
            usuario_nombre: String(user.nombre ?? user.correo ?? 'Usuario'),
            usuario_areas: areas,
            modulo: d.modulo,
            accion: d.accion,
            metodo,
            ruta: patron.slice(0, 255),
            recurso_id: d.id?.slice(0, 80) ?? null,
            recurso_ref: d.ref,
            descripcion: d.descripcion,
            detalle: d.detalle ? (d.detalle as Prisma.InputJsonValue) : undefined,
            ip: (request.ip ?? '').slice(0, 64) || null,
          },
        })
        .catch((err: unknown) => request.log.warn({ err }, '[actividad] no se pudo registrar'))
    } catch (err) {
      request.log.warn({ err }, '[actividad] hook falló')
    }
    return payload
  })
}
